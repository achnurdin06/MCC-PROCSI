const { querySqlServer } = require('../config/sqlserver');
const { queryPostgres } = require('../config/postgres');

function sanitizeIdentifier(name) {
  if (!name || typeof name !== 'string') return null;
  const clean = name.replace(/[^a-zA-Z0-9_]/g, '');
  return clean.length > 0 ? clean : null;
}

class PipelineService {
  // In-memory cache map untuk mempercepat display data secara drastis
  static _pipelineCache = new Map();

  invalidatePipelineCache() {
    PipelineService._pipelineCache.clear();
  }

  /**
   * Mengambil seluruh list konfigurasi migration_config beserta rekonsiliasi 3-Tahap
   * Dioptimasi dengan Paralel Query Concurrency, Single-Pass Grouping, & In-Memory TTL Cache
   */
  async getPipelineSummary(filters = {}) {
    const { clientId, envId, force = false } = filters;
    const cid = clientId ? parseInt(clientId, 10) : null;
    const eid = envId ? parseInt(envId, 10) : null;
    const cacheKey = `summary_${cid || 'all'}_${eid || 'all'}`;

    const now = Date.now();
    if (!force && PipelineService._pipelineCache.has(cacheKey)) {
      const cached = PipelineService._pipelineCache.get(cacheKey);
      if (now - cached.timestamp < 30000) { // TTL 30 detik
        return cached.data;
      }
    }

    let cfgWhere = '';
    const cfgParams = [];
    if (cid && eid) {
      cfgWhere = 'WHERE client_id = $1 AND env_id = $2';
      cfgParams.push(cid, eid);
    } else if (cid) {
      cfgWhere = 'WHERE client_id = $1';
      cfgParams.push(cid);
    } else if (eid) {
      cfgWhere = 'WHERE env_id = $1';
      cfgParams.push(eid);
    }

    // 1. Ambil seluruh konfigurasi dan data pendukung PostgreSQL secara PARALEL
    const [
      configsRes,
      targetConfigsRes,
      postStepLogsRes,
      latestRunsRes,
      errorCountsRes,
      lastStepLogsRes
    ] = await Promise.all([
      queryPostgres(`
        SELECT 
          config_id, name_config, exec_order, src_schema, src_view,
          tgt_schema, tgt_table, stg_table, pk_columns, compare_columns,
          id_column, id_width, id_seed, src_precheck_sql, is_active
        FROM mc_center.migration_config
        ${cfgWhere}
        ORDER BY exec_order, config_id
      `, cfgParams),
      queryPostgres(`
        SELECT target_config_id, config_id, exec_order, tgt_schema, tgt_table, pk_columns, is_active
        FROM mc_center.migration_target_config
        WHERE is_active = true
        ORDER BY config_id, exec_order, target_config_id
      `),
      queryPostgres(`
        SELECT log_id, run_id, config_id, step_name, rows_before, rows_after, message, start_time
        FROM mc_center.migration_step_log
        WHERE step_name = 'POST_TARGET'
        ORDER BY log_id DESC
      `),
      queryPostgres(`
        SELECT 
          run_id, run_ts, start_time, end_time, status, hop_host, note, main_workflow, config_id,
          is_posted, posted_at, post_type, is_rolled_back, rolled_back_at,
          ROUND(EXTRACT(EPOCH FROM (end_time - start_time))::numeric, 2) AS duration_seconds
        FROM mc_center.migration_run
        ${cfgWhere}
        ORDER BY run_id DESC
      `, cfgParams),
      queryPostgres(`
        SELECT config_id, run_id, COUNT(*)::int AS total
        FROM mc_center.migration_error_log
        GROUP BY config_id, run_id
      `),
      queryPostgres(`
        SELECT DISTINCT ON (config_id) *
        FROM mc_center.migration_step_log
        ORDER BY config_id, log_id DESC
      `)
    ]);

    const configs = configsRes.rows;
    const allTargetConfigs = targetConfigsRes.rows;
    const allPostStepLogs = postStepLogsRes.rows;
    const allRuns = latestRunsRes.rows;

    // Buat O(1) Fast Lookup Maps
    const errorMap = new Map();
    for (const er of errorCountsRes.rows) {
      errorMap.set(`${er.config_id}_${er.run_id}`, er.total);
    }

    const lastStepMap = new Map();
    for (const ls of lastStepLogsRes.rows) {
      lastStepMap.set(ls.config_id, ls);
    }

    // 2. Paralelisasi Perhitungan Staging & Source Rows
    // Eksekusi seluruh query SQL Server dan Postgres Staging secara bersamaan
    const srcPromises = configs.map(async (cfg) => {
      const cleanSrcSchema = sanitizeIdentifier(cfg.src_schema) || 'dbo';
      const cleanSrcView = sanitizeIdentifier(cfg.src_view);
      if (!cleanSrcView) return { configId: cfg.config_id, rows: null, error: null };
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout SQL Server view')), 4000)
        );
        const queryPromise = querySqlServer(`SELECT COUNT_BIG(1) AS total FROM [${cleanSrcSchema}].[${cleanSrcView}]`);
        const res = await Promise.race([queryPromise, timeoutPromise]);
        return { configId: cfg.config_id, rows: parseInt(res.recordset[0]?.total, 10) || 0, error: null };
      } catch (e) {
        return { configId: cfg.config_id, rows: null, error: e.message };
      }
    });

    const stgPromises = configs.map(async (cfg) => {
      const cleanStgSchema = 'stg_antam';
      const cleanStgTable = sanitizeIdentifier(cfg.stg_table);
      if (!cleanStgTable) return { configId: cfg.config_id, rows: null, error: null };
      try {
        const res = await queryPostgres(`SELECT COUNT(*) AS total FROM "${cleanStgSchema}"."${cleanStgTable}"`);
        return { configId: cfg.config_id, rows: parseInt(res.rows[0]?.total, 10) || 0, error: null };
      } catch (e) {
        return { configId: cfg.config_id, rows: null, error: e.message };
      }
    });

    const [srcResults, stgResults] = await Promise.all([
      Promise.all(srcPromises),
      Promise.all(stgPromises)
    ]);

    const srcMap = new Map(srcResults.map(r => [r.configId, r]));
    const stgMap = new Map(stgResults.map(r => [r.configId, r]));

    // 3. Kumpulkan fallback target tables yang actionStatus-nya POSTED dan perlu di-count jika belum ada di log
    const fallbackTargetQueries = [];
    const fallbackTargetMap = new Map();

    for (const cfg of configs) {
      const idStr = String(cfg.config_id);
      const matchedRun = allRuns.find((r) => {
        if (!r.config_id) return false;
        const ids = r.config_id.split(',').map((s) => s.trim());
        return ids.includes(idStr);
      }) || null;

      let cfgTargets = allTargetConfigs.filter((t) => t.config_id === cfg.config_id);
      if (cfgTargets.length === 0) {
        cfgTargets = [{
          target_config_id: null,
          config_id: cfg.config_id,
          exec_order: 1,
          tgt_schema: sanitizeIdentifier(cfg.tgt_schema) || 'vendor',
          tgt_table: sanitizeIdentifier(cfg.tgt_table),
          pk_columns: cfg.pk_columns,
          is_active: true
        }];
      }

      for (const t of cfgTargets) {
        const tSchema = sanitizeIdentifier(t.tgt_schema) || 'vendor';
        const tTable = sanitizeIdentifier(t.tgt_table);
        const matchedLog = allPostStepLogs.find((sl) =>
          sl.config_id === cfg.config_id &&
          (matchedRun ? sl.run_id === matchedRun.run_id : true) &&
          sl.message && tTable &&
          sl.message.toLowerCase().includes(tTable.toLowerCase())
        ) || allPostStepLogs.find((sl) =>
          sl.config_id === cfg.config_id &&
          sl.message && tTable &&
          sl.message.toLowerCase().includes(tTable.toLowerCase())
        );

        let actionStatus = 'NONE';
        if (matchedRun) {
          actionStatus = matchedRun.is_rolled_back ? 'ROLLED_BACK' : (matchedRun.is_posted ? 'POSTED' : 'STAGING ONLY');
        } else if (matchedLog) {
          actionStatus = 'POSTED';
        }

        if (tTable && (!matchedLog || matchedLog.rows_after === null)) {
          const key = `"${tSchema}"."${tTable}"`;
          if (!fallbackTargetMap.has(key)) {
            fallbackTargetMap.set(key, null);
            fallbackTargetQueries.push(
              queryPostgres(`SELECT COUNT(*) AS total FROM ${key}`)
                .then(r => fallbackTargetMap.set(key, parseInt(r.rows[0]?.total, 10) || 0))
                .catch(() => fallbackTargetMap.set(key, null))
            );
          }
        }
      }
    }

    if (fallbackTargetQueries.length > 0) {
      await Promise.all(fallbackTargetQueries);
    }

    // 4. Bangun seluruh pipeline results in-memory
    const pipelineResults = [];

    for (const cfg of configs) {
      const srcInfo = srcMap.get(cfg.config_id) || { rows: null, error: null };
      const stgInfo = stgMap.get(cfg.config_id) || { rows: null, error: null };
      const srcRows = srcInfo.rows;
      const stgRows = stgInfo.rows;
      const srcError = srcInfo.error;
      const stgError = stgInfo.error;

      const cleanSrcSchema = sanitizeIdentifier(cfg.src_schema) || 'dbo';
      const cleanSrcView = sanitizeIdentifier(cfg.src_view);
      const cleanStgSchema = 'stg_antam';
      const cleanStgTable = sanitizeIdentifier(cfg.stg_table);
      const cleanTgtSchema = sanitizeIdentifier(cfg.tgt_schema) || 'vendor';
      const cleanTgtTable = sanitizeIdentifier(cfg.tgt_table);

      const idStr = String(cfg.config_id);
      const matchedRun = allRuns.find((r) => {
        if (!r.config_id) return false;
        const ids = r.config_id.split(',').map((s) => s.trim());
        return ids.includes(idStr);
      }) || null;

      const errorsCount = matchedRun ? (errorMap.get(`${cfg.config_id}_${matchedRun.run_id}`) || 0) : 0;
      const lastStep = lastStepMap.get(cfg.config_id) || null;

      let stage1Status = 'UNKNOWN';
      if (srcRows !== null && stgRows !== null) {
        if (srcRows === stgRows) {
          stage1Status = 'MATCH';
        } else if (stgRows < srcRows) {
          stage1Status = 'PARTIAL';
        } else {
          stage1Status = 'OVERFLOW';
        }
      }

      let cfgTargets = allTargetConfigs.filter((t) => t.config_id === cfg.config_id);
      if (cfgTargets.length === 0) {
        cfgTargets = [{
          target_config_id: null,
          config_id: cfg.config_id,
          exec_order: 1,
          tgt_schema: cleanTgtSchema,
          tgt_table: cleanTgtTable,
          pk_columns: cfg.pk_columns,
          is_active: true
        }];
      }

      const resolvedTargets = [];
      for (const t of cfgTargets) {
        const tSchema = sanitizeIdentifier(t.tgt_schema) || 'vendor';
        const tTable = sanitizeIdentifier(t.tgt_table);

        const matchedLog = allPostStepLogs.find((sl) =>
          sl.config_id === cfg.config_id &&
          (matchedRun ? sl.run_id === matchedRun.run_id : true) &&
          sl.message && tTable &&
          sl.message.toLowerCase().includes(tTable.toLowerCase())
        ) || allPostStepLogs.find((sl) =>
          sl.config_id === cfg.config_id &&
          sl.message && tTable &&
          sl.message.toLowerCase().includes(tTable.toLowerCase())
        );

        let actionStatus = 'NONE';
        let postedAt = null;
        let rolledBackAt = null;

        if (matchedRun) {
          postedAt = matchedRun.posted_at;
          rolledBackAt = matchedRun.rolled_back_at;
          if (matchedRun.is_rolled_back) {
            actionStatus = 'ROLLED_BACK';
          } else if (matchedRun.is_posted) {
            actionStatus = 'POSTED';
          } else if (matchedRun.main_workflow === 'flow_1_staging' || matchedRun.note?.includes('Flow 1') || (!matchedRun.is_posted && matchedRun.status === 'SUCCESS')) {
            actionStatus = 'STAGING ONLY';
          } else {
            actionStatus = 'NOT_POSTED';
          }
        } else if (matchedLog) {
          actionStatus = 'POSTED';
        } else if (stgRows !== null && stgRows > 0) {
          actionStatus = 'STAGING ONLY';
        }

        let sumAfter = null;
        let sumBefore = null;

        // Ambil baris target: prioritaskan matchedLog (record audit aktual), fallback ke query count tabel target
        if (matchedLog && matchedLog.rows_after !== null && matchedLog.rows_after !== undefined) {
          sumAfter = parseInt(matchedLog.rows_after, 10);
        } else {
          sumAfter = fallbackTargetMap.get(`"${tSchema}"."${tTable}"`) ?? null;
        }

        if (matchedLog && matchedLog.rows_before !== null && matchedLog.rows_before !== undefined) {
          sumBefore = parseInt(matchedLog.rows_before, 10);
        } else if (sumAfter !== null && stgRows !== null && actionStatus === 'POSTED') {
          sumBefore = Math.max(0, sumAfter - stgRows);
        } else if (sumAfter !== null) {
          sumBefore = sumAfter;
        }

        // Koreksi Status Action jika tidak ada penambahan baris data baru ke target (+0 baris) saat proses POSTING:
        // Jika sesudah == sebelum (selisih 0) atau note run / pesan log menyatakan +0 baris ter-insert pada saat POSTING
        if (actionStatus === 'POSTED' && sumBefore !== null && sumAfter !== null && sumAfter === sumBefore) {
          actionStatus = 'NOT_POSTED';
        }
        if (actionStatus === 'POSTED' && matchedRun?.note && (matchedRun.note.includes('+0 baris diposting') || matchedRun.note.includes('ter-insert=0'))) {
          actionStatus = 'NOT_POSTED';
        }
        if (actionStatus === 'POSTED' && matchedLog?.message && (matchedLog.message.includes('Selisih=+0 baris') || matchedLog.message.includes('ter-insert=0'))) {
          actionStatus = 'NOT_POSTED';
        }

        const lastRunId = matchedRun?.run_id || matchedLog?.run_id || null;

        resolvedTargets.push({
          targetConfigId: t.target_config_id,
          execOrder: t.exec_order || 1,
          schema: tSchema,
          table: tTable,
          sumSource: srcRows,
          sumStaging: stgRows,
          sumBefore,
          sumAfter,
          lastRunId,
          actionStatus,
          postedAt,
          rolledBackAt
        });
      }

      const primaryTarget = resolvedTargets[0] || {
        schema: cleanTgtSchema,
        table: cleanTgtTable,
        sumAfter: null
      };

      pipelineResults.push({
        configId: cfg.config_id,
        nameConfig: cfg.name_config || null,
        execOrder: cfg.exec_order,
        isActive: cfg.is_active,
        source: {
          database: 'antam_scm (SQL Server)',
          schema: cleanSrcSchema,
          view: cleanSrcView,
          rows: srcRows,
          error: srcError
        },
        staging: {
          database: 'db_procsi (PostgreSQL)',
          schema: cleanStgSchema,
          table: cleanStgTable,
          rows: stgRows,
          error: stgError
        },
        target: {
          database: 'db_procsi (PostgreSQL)',
          schema: primaryTarget.schema,
          table: primaryTarget.table,
          rows: primaryTarget.sumAfter,
          error: null
        },
        targets: resolvedTargets,
        reconciliation: {
          deltaSourceToStaging: (srcRows !== null && stgRows !== null) ? stgRows - srcRows : null,
          deltaStagingToTarget: (stgRows !== null && primaryTarget.sumAfter !== null) ? primaryTarget.sumAfter - stgRows : null,
          sourceToStagingStatus: stage1Status,
          errorsLogged: errorsCount,
          lastStep
        },
        latestRun: matchedRun || allRuns[0] || null,
        metadata: {
          pkColumns: cfg.pk_columns,
          compareColumns: cfg.compare_columns,
          idColumn: cfg.id_column,
          idWidth: cfg.id_width,
          idSeed: cfg.id_seed,
          srcPrecheckSql: cfg.src_precheck_sql
        }
      });
    }

    const finalResult = {
      totalConfigs: pipelineResults.length,
      pipelines: pipelineResults,
      recentRuns: allRuns.slice(0, 10)
    };

    // Simpan ke in-memory cache
    PipelineService._pipelineCache.set(cacheKey, {
      timestamp: Date.now(),
      data: finalResult
    });

    return finalResult;
  }

  /**
   * Mengambil detail konfigurasi spesifik berserta rules, target configs, dan logs terkait
   */
  async getConfigDetail(configId) {
    const id = parseInt(configId, 10);
    if (!id) throw new Error('configId tidak valid.');

    const idStr = String(id);
    const [configRes, rulesRes, targetsRes, stepLogsRes, errorLogsRes, runsRes] = await Promise.all([
      queryPostgres('SELECT * FROM mc_center.migration_config WHERE config_id = $1', [id]),
      queryPostgres('SELECT * FROM mc_center.migration_convert_rule WHERE config_id = $1 ORDER BY rule_id', [id]),
      queryPostgres('SELECT * FROM mc_center.migration_target_config WHERE config_id = $1 ORDER BY exec_order', [id]),
      queryPostgres('SELECT * FROM mc_center.migration_step_log WHERE config_id = $1 ORDER BY log_id DESC LIMIT 15', [id]),
      queryPostgres('SELECT * FROM mc_center.migration_error_log WHERE config_id = $1 ORDER BY error_id DESC LIMIT 15', [id]),
      queryPostgres(`
        SELECT 
          run_id, run_ts, start_time, end_time, status, hop_host, note, main_workflow, config_id,
          is_posted, posted_at, post_type, is_rolled_back, rolled_back_at,
          ROUND(EXTRACT(EPOCH FROM (end_time - start_time))::numeric, 2) AS duration_seconds
        FROM mc_center.migration_run
        WHERE config_id = $1 OR config_id LIKE $2
        ORDER BY run_id DESC
        LIMIT 10
      `, [idStr, `%${idStr}%`]),
    ]);

    return {
      config: configRes.rows[0] || null,
      rules: rulesRes.rows,
      targetConfigs: targetsRes.rows,
      stepLogs: stepLogsRes.rows,
      errorLogs: errorLogsRes.rows,
      runs: runsRes.rows,
      latestRun: runsRes.rows[0] || null,
    };
  }

  /**
   * Mengambil isi data record di salah satu tahap (source, staging, target) untuk config tertentu
   */
  async getPipelineStageData(options) {
    const { configId, stage = 'staging', page = 1, limit = 25, sortBy, sortDir } = options;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const offset = (pageNum - 1) * limitNum;

    // Ambil info config
    const cfgRes = await queryPostgres(
      `SELECT * FROM mc_center.migration_config WHERE config_id = $1`,
      [parseInt(configId, 10)]
    );
    const cfg = cfgRes.rows[0];
    if (!cfg) {
      throw new Error(`Konfigurasi dengan config_id ${configId} tidak ditemukan.`);
    }

    if (stage === 'source') {
      // Source SQL Server
      const cleanSchema = sanitizeIdentifier(cfg.src_schema) || 'dbo';
      const cleanView = sanitizeIdentifier(cfg.src_view);

      const colQuery = await querySqlServer(`
        SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '${cleanSchema}' AND TABLE_NAME = '${cleanView}'
        ORDER BY ORDINAL_POSITION
      `);
      const columns = colQuery.recordset.map((c) => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE }));

      let total = 0;
      let rows = [];
      let sourceError = null;

      try {
        const countRes = await querySqlServer(`SELECT COUNT_BIG(1) AS total FROM [${cleanSchema}].[${cleanView}]`);
        total = parseInt(countRes.recordset[0]?.total, 10) || 0;

        let orderClause = columns[0] ? `[${columns[0].name}]` : '(SELECT NULL)';
        if (sortBy) {
          const matched = columns.find((c) => c.name.toLowerCase() === sortBy.toLowerCase());
          if (matched) {
            const dir = (sortDir && sortDir.toUpperCase() === 'DESC') ? 'DESC' : 'ASC';
            orderClause = `[${matched.name}] ${dir}`;
          }
        }

        const dataRes = await querySqlServer(`
          SELECT * FROM [${cleanSchema}].[${cleanView}]
          ORDER BY ${orderClause}
          OFFSET ${offset} ROWS FETCH NEXT ${limitNum} ROWS ONLY
        `);
        rows = dataRes.recordset;
      } catch (err) {
        sourceError = err.message;
      }

      return {
        stage: 'source',
        location: `SQL Server: [${cleanSchema}].[${cleanView}]`,
        tableExists: columns.length > 0,
        columns,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        rows,
        error: sourceError,
      };
    } else if (stage === 'staging') {
      // Staging PostgreSQL (stg_antam)
      const cleanSchema = 'stg_antam';
      const cleanTable = sanitizeIdentifier(cfg.stg_table);

      // Cek apakah tabel ada
      const tableCheck = await queryPostgres(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2
      `, [cleanSchema, cleanTable]);

      if (tableCheck.rows.length === 0) {
        return {
          stage: 'staging',
          location: `PostgreSQL: "${cleanSchema}"."${cleanTable}"`,
          tableExists: false,
          columns: [],
          total: 0,
          page: 1,
          limit: limitNum,
          totalPages: 1,
          rows: [],
          message: `Tabel staging "${cleanSchema}"."${cleanTable}" belum dibuat di PostgreSQL.`
        };
      }

      const colQuery = await queryPostgres(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [cleanSchema, cleanTable]);
      const columns = colQuery.rows.map((c) => ({ name: c.column_name, type: c.data_type }));

      const countRes = await queryPostgres(`SELECT COUNT(*) AS total FROM "${cleanSchema}"."${cleanTable}"`);
      const total = parseInt(countRes.rows[0]?.total, 10) || 0;

      let orderClause = columns[0] ? `"${columns[0].name}"` : '1';
      if (sortBy) {
        const matched = columns.find((c) => c.name.toLowerCase() === sortBy.toLowerCase());
        if (matched) {
          const dir = (sortDir && sortDir.toUpperCase() === 'DESC') ? 'DESC' : 'ASC';
          orderClause = `"${matched.name}" ${dir}`;
        }
      }

      const dataRes = await queryPostgres(`
        SELECT * FROM "${cleanSchema}"."${cleanTable}"
        ORDER BY ${orderClause}
        LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        stage: 'staging',
        location: `PostgreSQL: "${cleanSchema}"."${cleanTable}"`,
        tableExists: true,
        columns,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        rows: dataRes.rows,
      };
    } else {
      // Final Target PostgreSQL (tgt_schema / vendor)
      const cleanSchema = sanitizeIdentifier(options.targetSchema) || sanitizeIdentifier(cfg.tgt_schema) || 'vendor';
      const cleanTable = sanitizeIdentifier(options.targetTable) || sanitizeIdentifier(cfg.tgt_table);

      // Cek apakah tabel ada
      const tableCheck = await queryPostgres(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2
      `, [cleanSchema, cleanTable]);

      if (tableCheck.rows.length === 0) {
        return {
          stage: 'target',
          location: `PostgreSQL: "${cleanSchema}"."${cleanTable}"`,
          tableExists: false,
          columns: [],
          total: 0,
          page: 1,
          limit: limitNum,
          totalPages: 1,
          rows: [],
          message: `Tabel target "${cleanSchema}"."${cleanTable}" belum dibuat di PostgreSQL.`
        };
      }

      const colQuery = await queryPostgres(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [cleanSchema, cleanTable]);
      const columns = colQuery.rows.map((c) => ({ name: c.column_name, type: c.data_type }));

      const countRes = await queryPostgres(`SELECT COUNT(*) AS total FROM "${cleanSchema}"."${cleanTable}"`);
      const total = parseInt(countRes.rows[0]?.total, 10) || 0;

      let orderClause = columns[0] ? `"${columns[0].name}"` : '1';
      if (sortBy) {
        const matched = columns.find((c) => c.name.toLowerCase() === sortBy.toLowerCase());
        if (matched) {
          const dir = (sortDir && sortDir.toUpperCase() === 'DESC') ? 'DESC' : 'ASC';
          orderClause = `"${matched.name}" ${dir}`;
        }
      }

      const dataRes = await queryPostgres(`
        SELECT * FROM "${cleanSchema}"."${cleanTable}"
        ORDER BY ${orderClause}
        LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        stage: 'target',
        location: `PostgreSQL: "${cleanSchema}"."${cleanTable}"`,
        tableExists: true,
        columns,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        rows: dataRes.rows,
      };
    }
  }

  /**
  /**
   * Helper untuk mengambil data satu config untuk Berita Acara
   */
  async _getSingleConfigBeritaAcara(cfg) {
    const cleanSrcSchema = sanitizeIdentifier(cfg.src_schema) || 'dbo';
    const cleanSrcView = sanitizeIdentifier(cfg.src_view);
    const cleanStgSchema = 'stg_antam';
    const cleanStgTable = sanitizeIdentifier(cfg.stg_table);
    const cleanTgtSchema = sanitizeIdentifier(cfg.tgt_schema) || 'vendor';
    const cleanTgtTable = sanitizeIdentifier(cfg.tgt_table);

    // 1. Row counts
    let srcRows = 0;
    let stgRows = 0;
    let tgtRows = 0;

    if (cleanSrcView) {
      try {
        const res = await querySqlServer(`SELECT COUNT_BIG(1) AS total FROM [${cleanSrcSchema}].[${cleanSrcView}]`);
        srcRows = parseInt(res.recordset[0]?.total, 10) || 0;
      } catch (e) {}
    }

    if (cleanStgTable) {
      try {
        const res = await queryPostgres(`SELECT COUNT(*) AS total FROM "${cleanStgSchema}"."${cleanStgTable}"`);
        stgRows = parseInt(res.rows[0]?.total, 10) || 0;
      } catch (e) {}
    }

    if (cleanTgtTable) {
      try {
        const res = await queryPostgres(`SELECT COUNT(*) AS total FROM "${cleanTgtSchema}"."${cleanTgtTable}"`);
        tgtRows = parseInt(res.rows[0]?.total, 10) || 0;
      } catch (e) {}
    }

    // 2. Fetch Staging Data Attachment (Lampiran Data Staging)
    let stgColumns = [];
    let stgRowsData = [];
    if (cleanStgTable) {
      try {
        const stgColsQuery = await queryPostgres(`
          SELECT column_name, data_type 
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position
        `, [cleanStgSchema, cleanStgTable]);
        stgColumns = (stgColsQuery.rows || []).map((c) => ({ name: c.column_name, type: c.data_type }));

        const stgDataQuery = await queryPostgres(
          `SELECT * FROM "${cleanStgSchema}"."${cleanStgTable}" ORDER BY 1 LIMIT 500`
        );
        stgRowsData = stgDataQuery.rows || [];
      } catch (e) {}
    }

    // Fallback ke target table jika staging kosong namun target ada
    if (stgRowsData.length === 0 && cleanTgtTable) {
      try {
        const tgtColsQuery = await queryPostgres(`
          SELECT column_name, data_type 
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position
        `, [cleanTgtSchema, cleanTgtTable]);
        if (tgtColsQuery.rows && tgtColsQuery.rows.length > 0) {
          stgColumns = tgtColsQuery.rows.map((c) => ({ name: c.column_name, type: c.data_type }));
          const tgtDataQuery = await queryPostgres(
            `SELECT * FROM "${cleanTgtSchema}"."${cleanTgtTable}" ORDER BY 1 LIMIT 500`
          );
          stgRowsData = tgtDataQuery.rows || [];
        }
      } catch (e) {}
    }

    // 3. Fetch conversion rules
    let rules = [];
    try {
      const rulesRes = await queryPostgres(
        `SELECT * FROM mc_center.migration_convert_rule WHERE config_id = $1 ORDER BY rule_id`,
        [cfg.config_id]
      );
      rules = rulesRes.rows || [];
    } catch (e) {}

    let modName = cfg.name_config || (cfg.tgt_table || '').replace(/_/g, ' ').toUpperCase();
    if (!cfg.name_config) {
      const lowerTgt = (cfg.tgt_table || '').toLowerCase();
      if (lowerTgt.includes('vendor') || lowerTgt.includes('partner')) {
        modName = 'Business Partner';
      } else if (lowerTgt.includes('akta')) {
        modName = 'Akta Perusahaan';
      } else if (lowerTgt.includes('address')) {
        modName = 'Alamat Vendor';
      }
    }

    const deltaSrcStg = stgRows - srcRows;

    return {
      configId: cfg.config_id,
      nameConfig: cfg.name_config || null,
      execOrder: cfg.exec_order,
      modName,
      source: {
        database: 'antam_scm',
        schema: cleanSrcSchema,
        view: cleanSrcView,
        rows: srcRows,
      },
      staging: {
        database: 'db_procsi',
        schema: cleanStgSchema,
        table: cleanStgTable,
        rows: stgRows,
      },
      target: {
        database: 'db_procsi',
        schema: cleanTgtSchema,
        table: cleanTgtTable,
        rows: tgtRows,
      },
      deltaSourceToStaging: deltaSrcStg,
      deltaStagingToTarget: tgtRows - stgRows,
      pkColumns: cfg.pk_columns,
      compareColumns: cfg.compare_columns,
      idColumn: cfg.id_column,
      idWidth: cfg.id_width,
      idSeed: cfg.id_seed,
      rules,
      stagingAttachment: {
        schema: cleanStgSchema,
        table: cleanStgTable,
        totalRecords: stgRows,
        displayedRecords: stgRowsData.length,
        columns: stgColumns,
        rows: stgRowsData,
      },
    };
  }

  /**
   * Mengambil data lengkap untuk Berita Acara Validasi & Rekonsiliasi Data
   * Mendukung single configId atau multiple configIds (array / comma-separated)
   */
  async getBeritaAcaraData(configIdOrIds) {
    let ids = [];
    if (Array.isArray(configIdOrIds)) {
      ids = configIdOrIds.map((x) => parseInt(x, 10)).filter(Boolean);
    } else if (typeof configIdOrIds === 'string' && configIdOrIds.includes(',')) {
      ids = configIdOrIds.split(',').map((x) => parseInt(x.trim(), 10)).filter(Boolean);
    } else {
      const id = parseInt(configIdOrIds, 10);
      if (id) ids = [id];
    }

    if (ids.length === 0) throw new Error('configId tidak valid.');

    const cfgRes = await queryPostgres(
      'SELECT * FROM mc_center.migration_config WHERE config_id = ANY($1::int[]) ORDER BY exec_order, config_id',
      [ids]
    );
    const configs = cfgRes.rows;
    if (!configs || configs.length === 0) {
      throw new Error(`Konfigurasi config_id (${ids.join(', ')}) tidak ditemukan.`);
    }

    const items = [];
    for (const cfg of configs) {
      const item = await this._getSingleConfigBeritaAcara(cfg);
      items.push(item);
    }

    // 4. Generate Document No & Date
    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const timeStr = now.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const docDateCode = now.toISOString().slice(0, 10).replace(/-/g, '');
    const docNumber = `BA-VAL/ANTAM/${docDateCode}/CFG-${ids.map((i) => String(i).padStart(3, '0')).join('-')}`;

    const firstItem = items[0];
    const isSynced = firstItem.source.rows === firstItem.staging.rows && firstItem.source.rows > 0;
    const verdict = isSynced ? 'LULUS VALIDASI (100% SINKRON)' : (firstItem.staging.rows < firstItem.source.rows ? 'BELUM LENGKAP (PARSIAL)' : 'PERLU PENINJAUAN ULANG');

    return {
      document: {
        docNumber,
        title: 'BERITA ACARA VALIDASI DAN REKONSILIASI HASIL MIGRASI DATA',
        dateString: dateStr,
        timeString: timeStr,
        timestamp: now.toISOString(),
        verdict,
        isSynced,
      },
      configs: items,
      config: firstItem,
      rules: firstItem.rules,
      stagingAttachment: firstItem.stagingAttachment,
    };
  }

  /**
   * Komparasi mendalam kolom dan data antara Source View, Staging, dan Target
   * untuk evaluasi status keberhasilan migrasi (Sukses / Warning / Gagal)
   */
  async comparePipelineConfig(options = {}) {
    const { configId, targetTable, runId } = options;
    const cid = parseInt(configId, 10);
    if (!cid) throw new Error('configId wajib diisi dan harus berupa angka.');

    // 1. Ambil info konfigurasi utama
    const cfgRes = await queryPostgres(
      `SELECT * FROM mc_center.migration_config WHERE config_id = $1`,
      [cid]
    );
    const cfg = cfgRes.rows[0];
    if (!cfg) throw new Error(`Konfigurasi dengan config_id ${cid} tidak ditemukan.`);

    // 2. Ambil seluruh riwayat run untuk menemukan last_run_id konfigurasi ini
    const allRunsRes = await queryPostgres(`
      SELECT run_id, run_ts, start_time, end_time, status, is_posted, posted_at, is_rolled_back, rolled_back_at, note, config_id,
             ROUND(EXTRACT(EPOCH FROM (end_time - start_time))::numeric, 2) AS duration_seconds
      FROM mc_center.migration_run
      ORDER BY run_id DESC
      LIMIT 100
    `);

    const idStr = String(cid);
    const matchedRuns = allRunsRes.rows.filter((r) => {
      if (!r.config_id) return false;
      const ids = r.config_id.split(',').map((s) => s.trim());
      return ids.includes(idStr);
    });

    let selectedRun = null;
    if (runId) {
      selectedRun = allRunsRes.rows.find((r) => String(r.run_id) === String(runId)) || null;
    }
    if (!selectedRun) {
      selectedRun = matchedRuns[0] || null;
    }
    // Fallback: periksa migration_step_log untuk config_id ini jika tidak ditemukan di migration_run
    if (!selectedRun) {
      const lastStepRun = await queryPostgres(
        `SELECT run_id FROM mc_center.migration_step_log WHERE config_id = $1 ORDER BY log_id DESC LIMIT 1`,
        [cid]
      );
      if (lastStepRun.rows[0]?.run_id) {
        selectedRun = allRunsRes.rows.find((r) => String(r.run_id) === String(lastStepRun.rows[0].run_id)) || null;
      }
    }
    if (!selectedRun && allRunsRes.rows.length > 0) {
      selectedRun = allRunsRes.rows[0];
    }

    const effectiveRunId = selectedRun ? selectedRun.run_id : null;

    // 3. Ambil convert rules, target configs, error logs & step logs KHUSUS SESI RUN INI
    const [rulesRes, targetsRes, errorLogsRes, stepLogsRes] = await Promise.all([
      queryPostgres(`SELECT * FROM mc_center.migration_convert_rule WHERE config_id = $1 ORDER BY rule_id`, [cid]),
      queryPostgres(`SELECT * FROM mc_center.migration_target_config WHERE config_id = $1 ORDER BY exec_order`, [cid]),
      effectiveRunId
        ? queryPostgres(`SELECT * FROM mc_center.migration_error_log WHERE config_id = $1 AND run_id = $2 ORDER BY error_id DESC LIMIT 20`, [cid, effectiveRunId])
        : { rows: [] },
      effectiveRunId
        ? queryPostgres(`SELECT * FROM mc_center.migration_step_log WHERE config_id = $1 AND run_id = $2 ORDER BY log_id DESC LIMIT 20`, [cid, effectiveRunId])
        : queryPostgres(`SELECT * FROM mc_center.migration_step_log WHERE config_id = $1 ORDER BY log_id DESC LIMIT 10`, [cid]),
    ]);

    const rules = rulesRes.rows;
    const targetConfigs = targetsRes.rows;
    const errorLogs = errorLogsRes.rows;
    let stepLogs = stepLogsRes.rows;
    if (stepLogs.length === 0) {
      const fallbackStep = await queryPostgres(`SELECT * FROM mc_center.migration_step_log WHERE config_id = $1 ORDER BY log_id DESC LIMIT 10`, [cid]);
      stepLogs = fallbackStep.rows;
    }
    const latestRun = selectedRun;

    // Tentukan target yang dibandingkan
    let selectedTargetConfig = null;
    if (targetTable) {
      selectedTargetConfig = targetConfigs.find((t) => t.tgt_table === targetTable) || null;
    }
    if (!selectedTargetConfig && targetConfigs.length > 0) {
      selectedTargetConfig = targetConfigs[0];
    }

    const cleanSrcSchema = sanitizeIdentifier(cfg.src_schema) || 'dbo';
    const cleanSrcView = sanitizeIdentifier(cfg.src_view);
    const cleanStgSchema = 'stg_antam';
    const cleanStgTable = sanitizeIdentifier(cfg.stg_table);
    const cleanTgtSchema = sanitizeIdentifier(selectedTargetConfig?.tgt_schema || cfg.tgt_schema) || 'vendor';
    const cleanTgtTable = sanitizeIdentifier(selectedTargetConfig?.tgt_table || cfg.tgt_table);

    // 3. Ambil Metadata Kolom Source (SQL Server)
    let sourceCols = [];
    let sourceRowsCount = 0;
    let sourceSampleRows = [];
    let sourceError = null;

    if (cleanSrcView) {
      try {
        const colQ = await querySqlServer(`
          SELECT 
            COLUMN_NAME AS name, 
            DATA_TYPE AS data_type, 
            CHARACTER_MAXIMUM_LENGTH AS max_length,
            IS_NULLABLE AS is_nullable,
            ORDINAL_POSITION AS position
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = '${cleanSrcSchema}' AND TABLE_NAME = '${cleanSrcView}'
          ORDER BY ORDINAL_POSITION
        `);
        sourceCols = colQ.recordset || [];

        const cntQ = await querySqlServer(`SELECT COUNT_BIG(1) AS total FROM [${cleanSrcSchema}].[${cleanSrcView}]`);
        sourceRowsCount = parseInt(cntQ.recordset[0]?.total, 10) || 0;

        const sampleQ = await querySqlServer(`
          SELECT TOP 5 * FROM [${cleanSrcSchema}].[${cleanSrcView}]
        `);
        sourceSampleRows = sampleQ.recordset || [];
      } catch (err) {
        sourceError = err.message;
      }
    }

    // 4. Ambil Metadata Kolom Staging (PostgreSQL)
    let stagingCols = [];
    let stagingRowsCount = 0;
    let stagingSampleRows = [];
    let stagingError = null;
    let stagingExists = false;

    if (cleanStgTable) {
      try {
        const chkQ = await queryPostgres(`
          SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2
        `, [cleanStgSchema, cleanStgTable]);
        stagingExists = chkQ.rows.length > 0;

        if (stagingExists) {
          const colQ = await queryPostgres(`
            SELECT 
              column_name AS name, 
              data_type, 
              character_maximum_length AS max_length,
              is_nullable,
              ordinal_position AS position
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
          `, [cleanStgSchema, cleanStgTable]);
          stagingCols = colQ.rows;

          const cntQ = await queryPostgres(`SELECT COUNT(*) AS total FROM "${cleanStgSchema}"."${cleanStgTable}"`);
          stagingRowsCount = parseInt(cntQ.rows[0]?.total, 10) || 0;

          const sampleQ = await queryPostgres(`SELECT * FROM "${cleanStgSchema}"."${cleanStgTable}" LIMIT 5`);
          stagingSampleRows = sampleQ.rows;
        }
      } catch (err) {
        stagingError = err.message;
      }
    }

    // 5. Ambil Metadata Kolom Target (PostgreSQL)
    let targetCols = [];
    let targetRowsCount = 0;
    let targetSampleRows = [];
    let targetError = null;
    let targetExists = false;

    if (cleanTgtTable) {
      try {
        const chkQ = await queryPostgres(`
          SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2
        `, [cleanTgtSchema, cleanTgtTable]);
        targetExists = chkQ.rows.length > 0;

        if (targetExists) {
          const colQ = await queryPostgres(`
            SELECT 
              column_name AS name, 
              data_type, 
              character_maximum_length AS max_length,
              is_nullable,
              ordinal_position AS position
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
          `, [cleanTgtSchema, cleanTgtTable]);
          targetCols = colQ.rows;

          const cntQ = await queryPostgres(`SELECT COUNT(*) AS total FROM "${cleanTgtSchema}"."${cleanTgtTable}"`);
          targetRowsCount = parseInt(cntQ.rows[0]?.total, 10) || 0;

          // Ambil HANYA data yang berhasil dimigrasi dari staging ke tabel target
          const tColNames = targetCols.map((c) => c.name.toLowerCase());
          const sColNames = stagingCols.map((c) => c.name.toLowerCase());

          // 1. Coba ekstrak kondisi relasi dari mapping_sql
          let parsedCondition = null;
          if (selectedTargetConfig?.mapping_sql) {
            const match = selectedTargetConfig.mapping_sql.match(/WHERE\s+NOT\s+EXISTS\s*\([\s\S]*?WHERE\s+([\s\S]+?)\s*\)\s*$/i);
            if (match && match[1]) {
              parsedCondition = match[1].trim();
            }
          }

          // 2. Fallback kondisi korelasi berdasarkan kolom identitas
          const fallbackClauses = [];
          if (tColNames.includes('vendor_reference_id') && sColNames.includes('vendor_reference_id')) {
            fallbackClauses.push('(s.vendor_reference_id IS NOT NULL AND t.vendor_reference_id = s.vendor_reference_id)');
          }
          if (tColNames.includes('uuid') && sColNames.includes('uuid')) {
            fallbackClauses.push('(s.uuid IS NOT NULL AND t.uuid = s.uuid)');
          }
          if (tColNames.includes('id') && sColNames.includes('id')) {
            fallbackClauses.push('t.id = s.id');
          }
          if (tColNames.includes('username') && sColNames.includes('username')) {
            fallbackClauses.push('(s.username IS NOT NULL AND t.username = s.username)');
          }

          const joinSql = parsedCondition || (fallbackClauses.length > 0 ? fallbackClauses.join(' OR ') : 't.id = s.id');
          const orderCol = sColNames.includes('id') ? 's.id' : (sColNames.includes('uuid') ? 's.uuid' : '1');

          if (stagingExists && stagingRowsCount > 0) {
            try {
              const sampleQ = await queryPostgres(`
                SELECT t.* 
                FROM "${cleanTgtSchema}"."${cleanTgtTable}" t
                INNER JOIN "${cleanStgSchema}"."${cleanStgTable}" s ON ${joinSql}
                ORDER BY ${orderCol} ASC
                LIMIT 5
              `);
              targetSampleRows = sampleQ.rows;
            } catch (errSample) {
              console.warn('[compare] Gagal query correlated target sample, fallback ke basic sample:', errSample.message);
              const sampleQ = await queryPostgres(`SELECT * FROM "${cleanTgtSchema}"."${cleanTgtTable}" LIMIT 5`);
              targetSampleRows = sampleQ.rows;
            }
          } else {
            targetSampleRows = [];
          }
        }
      } catch (err) {
        targetError = err.message;
      }
    }

    // 6. Evaluasi Step Log POST_TARGET untuk mengetahui rows_before & rows_after aktual
    const postStep = stepLogs.find((s) => s.step_name === 'POST_TARGET') || null;
    const postRowsBefore = postStep && postStep.rows_before !== null ? parseInt(postStep.rows_before, 10) : null;
    const postRowsAfter = postStep && postStep.rows_after !== null ? parseInt(postStep.rows_after, 10) : null;

    // 7. Konstruksi Matriks Komparasi Kolom 3-Tahap
    // Kita kumpulkan semua kolom secara terpadu: Source, Staging, Target
    const pkColsList = (cfg.pk_columns ? String(cfg.pk_columns).split(',') : []).map((s) => s.trim().toLowerCase());
    const idCol = cfg.id_column ? String(cfg.id_column).trim().toLowerCase() : 'id';
    const metadataColNames = ['stg_id', 'created_at', 'updated_at', 'is_updated', 'fields_before', 'run_id'];

    const columnMatrix = [];
    const usedStagingCols = new Set();
    const usedSourceCols = new Set();
    const usedTargetCols = new Set();

    // Prioritas 1: Petakan berdasarkan Kolom Target
    for (const tCol of targetCols) {
      const tName = tCol.name;
      const tNameLower = tName.toLowerCase();
      const isPk = pkColsList.includes(tNameLower) || tNameLower === idCol;

      // Cari rule di migration_convert_rule
      const matchedRule = rules.find((r) =>
        r.column_name && r.column_name.toLowerCase() === tNameLower
      ) || null;

      // Cari kolom Staging yang bersesuaian
      let matchedStg = null;
      if (matchedRule && matchedRule.source_column) {
        matchedStg = stagingCols.find((s) => s.name.toLowerCase() === matchedRule.source_column.toLowerCase()) || null;
      }
      if (!matchedStg) {
        matchedStg = stagingCols.find((s) => s.name.toLowerCase() === tNameLower) || null;
      }

      // Cari kolom Source yang bersesuaian
      let matchedSrc = null;
      if (matchedRule && matchedRule.source_column) {
        matchedSrc = sourceCols.find((s) => s.name.toLowerCase() === matchedRule.source_column.toLowerCase()) || null;
      }
      if (!matchedSrc && matchedStg) {
        matchedSrc = sourceCols.find((s) => s.name.toLowerCase() === matchedStg.name.toLowerCase()) || null;
      }
      if (!matchedSrc) {
        matchedSrc = sourceCols.find((s) => s.name.toLowerCase() === tNameLower) || null;
      }

      if (matchedStg) usedStagingCols.add(matchedStg.name.toLowerCase());
      if (matchedSrc) usedSourceCols.add(matchedSrc.name.toLowerCase());
      usedTargetCols.add(tNameLower);

      let status = 'MATCH';
      let statusLabel = 'Sempurna (1:1)';
      let statusBadge = 'badge-success';

      if (matchedRule) {
        status = 'CONVERTED';
        statusLabel = matchedRule.lookup_name ? `Lookup (${matchedRule.lookup_name})` : 'Transformasi Rule';
        statusBadge = 'badge-info';
      } else if (!matchedSrc && !matchedStg) {
        if (isPk) {
          status = 'GENERATED_ID';
          statusLabel = 'Auto Generated / Seed';
          statusBadge = 'badge-primary';
        } else if (tCol.is_nullable === 'NO') {
          status = 'MISSING_REQUIRED';
          statusLabel = 'Wajib tapi Belum Terpetakan';
          statusBadge = 'badge-danger';
        } else {
          status = 'UNMAPPED_TARGET';
          statusLabel = 'Opsional / Nullable Target';
          statusBadge = 'badge-neutral';
        }
      } else if (matchedSrc && matchedStg && matchedSrc.data_type.toLowerCase() !== tCol.data_type.toLowerCase()) {
        status = 'TYPE_CONVERTED';
        statusLabel = `Cast (${matchedSrc.data_type} ➔ ${tCol.data_type})`;
        statusBadge = 'badge-warning';
      }

      columnMatrix.push({
        sourceCol: matchedSrc ? { name: matchedSrc.name, type: matchedSrc.data_type, nullable: matchedSrc.is_nullable } : null,
        stagingCol: matchedStg ? { name: matchedStg.name, type: matchedStg.data_type, nullable: matchedStg.is_nullable } : null,
        targetCol: { name: tCol.name, type: tCol.data_type, nullable: tCol.is_nullable },
        rule: matchedRule ? {
          ruleId: matchedRule.rule_id,
          lookupName: matchedRule.lookup_name,
          masterTable: matchedRule.master_table,
          onUnmapped: matchedRule.on_unmapped,
          defaultValue: matchedRule.default_value,
        } : null,
        isPk,
        status,
        statusLabel,
        statusBadge,
      });
    }

    // Prioritas 2: Kolom Staging yang belum terpetakan ke Target
    for (const sCol of stagingCols) {
      const sNameLower = sCol.name.toLowerCase();
      if (usedStagingCols.has(sNameLower)) continue;

      const isMeta = metadataColNames.includes(sNameLower);
      const matchedSrc = sourceCols.find((src) => src.name.toLowerCase() === sNameLower) || null;
      if (matchedSrc) usedSourceCols.add(matchedSrc.name.toLowerCase());

      columnMatrix.push({
        sourceCol: matchedSrc ? { name: matchedSrc.name, type: matchedSrc.data_type, nullable: matchedSrc.is_nullable } : null,
        stagingCol: { name: sCol.name, type: sCol.data_type, nullable: sCol.is_nullable },
        targetCol: null,
        rule: null,
        isPk: false,
        status: isMeta ? 'METADATA_ETL' : 'STAGING_EXTRA',
        statusLabel: isMeta ? 'Metadata ETL Staging' : 'Tambahan Staging (Unmapped)',
        statusBadge: isMeta ? 'badge-neutral' : 'badge-warning',
      });
    }

    // Prioritas 3: Kolom Source yang belum terpetakan sama sekali
    for (const srcCol of sourceCols) {
      const srcNameLower = srcCol.name.toLowerCase();
      if (usedSourceCols.has(srcNameLower)) continue;

      columnMatrix.push({
        sourceCol: { name: srcCol.name, type: srcCol.data_type, nullable: srcCol.is_nullable },
        stagingCol: null,
        targetCol: null,
        rule: null,
        isPk: false,
        status: 'UNMAPPED_SOURCE',
        statusLabel: 'Tidak Masuk Staging/Target',
        statusBadge: 'badge-neutral',
      });
    }

    // 8. Evaluasi Status Keberhasilan Migrasi (Verdict Engine)
    const rowCountMatchStage1 = sourceRowsCount === stagingRowsCount && sourceRowsCount > 0;
    const errorsCount = errorLogs.length;
    const isPosted = latestRun?.is_posted || (postStep !== null && postRowsAfter !== null && postRowsAfter > 0);
    const hasMissingRequiredTarget = columnMatrix.some((c) => c.status === 'MISSING_REQUIRED');

    // Cek target row match
    let targetSyncStatus = 'UNKNOWN';
    if (!targetExists) {
      targetSyncStatus = 'TABLE_NOT_FOUND';
    } else if (isPosted) {
      if (postRowsBefore !== null && postRowsAfter !== null) {
        const delta = postRowsAfter - postRowsBefore;
        if (delta === stagingRowsCount) {
          targetSyncStatus = 'FULL_INSERT';
        } else if (postRowsAfter >= stagingRowsCount) {
          targetSyncStatus = 'SYNCED_OR_UPSERT';
        } else {
          targetSyncStatus = 'PARTIAL_POST';
        }
      } else if (targetRowsCount >= stagingRowsCount && stagingRowsCount > 0) {
        targetSyncStatus = 'SYNCED_OR_EXCEEDS';
      } else {
        targetSyncStatus = 'PARTIAL';
      }
    } else {
      targetSyncStatus = 'NOT_POSTED';
    }

    // Tentukan Level Keputusan Akhir
    let verdictLevel = 'SUCCESS';
    let verdictTitle = 'MIGRASI SUKSES (100% SINKRON)';
    let verdictSubtitle = effectiveRunId 
      ? `[Sesi Run #${effectiveRunId} (${selectedRun?.status || 'OK'})] Seluruh data sumber terverifikasi utuh di Staging dan selaras dengan skema Target.`
      : 'Seluruh data sumber terverifikasi utuh di Staging dan selaras dengan skema Target.';
    let verdictBadge = 'badge-success';

    if (errorsCount > 0) {
      verdictLevel = 'FAILED';
      verdictTitle = 'MIGRASI GAGAL / MEMERLUKAN PERBAIKAN';
      verdictSubtitle = effectiveRunId
        ? `[Sesi Run #${effectiveRunId} (${selectedRun?.status || 'FAILED'})] Ditemukan ${errorsCount} log kesalahan saat eksekusi alur migrasi sesi ini.`
        : `Ditemukan ${errorsCount} log kesalahan saat eksekusi alur migrasi ini.`;
      verdictBadge = 'badge-danger';
    } else if (hasMissingRequiredTarget) {
      verdictLevel = 'WARNING';
      verdictTitle = 'SKEMA BELUM LENGKAP (KOLOM WAJIB BELUM TERPETAKAN)';
      verdictSubtitle = 'Terdapat kolom NOT NULL pada target yang belum memiliki sumber pemetaan.';
      verdictBadge = 'badge-warning';
    } else if (!rowCountMatchStage1 && sourceRowsCount > 0) {
      verdictLevel = 'WARNING';
      verdictTitle = 'TERDAPAT SELISIH BARIS (SOURCE ➔ STAGING)';
      verdictSubtitle = `Source View memiliki ${sourceRowsCount} baris, sedangkan Staging Table memiliki ${stagingRowsCount} baris.`;
      verdictBadge = 'badge-warning';
    } else if (targetSyncStatus === 'NOT_POSTED') {
      verdictLevel = 'STAGING_ONLY';
      verdictTitle = 'SUKSES DI TAHAP STAGING (BELUM DIPOSTING KE TARGET)';
      verdictSubtitle = effectiveRunId
        ? `[Sesi Run #${effectiveRunId} (${selectedRun?.status || 'OK'})] Data Source 100% match di Staging. Siap diposting ke target vendor bila diperlukan.`
        : 'Data Source 100% match di Staging. Siap diposting ke target vendor bila diperlukan.';
      verdictBadge = 'badge-info';
    }

    // Indikator Checklist
    const auditChecklist = [
      {
        id: 'chk_row_sync',
        category: 'Integritas Jumlah Baris',
        title: 'Rekonsiliasi Baris Source ➔ Staging',
        status: rowCountMatchStage1 ? 'PASS' : (stagingRowsCount === 0 ? 'FAIL' : 'WARN'),
        message: rowCountMatchStage1
          ? `✓ 100% Match: ${sourceRowsCount} baris dari SQL Server berhasil masuk ke PostgreSQL stg_antam.`
          : `Selisih: Source = ${sourceRowsCount} baris, Staging = ${stagingRowsCount} baris.`,
      },
      {
        id: 'chk_target_posting',
        category: 'Pemuatan Target Vendor',
        title: 'Status Posting ke Target PostgreSQL',
        status: isPosted ? 'PASS' : 'INFO',
        message: isPosted
          ? `✓ Data telah diposting ke tabel ${cleanTgtSchema}.${cleanTgtTable} (Total Target: ${targetRowsCount} baris).`
          : `Data masih berada di staging (belum di-post ke ${cleanTgtSchema}.${cleanTgtTable}).`,
      },
      {
        id: 'chk_schema_alignment',
        category: 'Keselarasan Struktur Kolom',
        title: 'Kesesuaian Kolom Target & Source',
        status: hasMissingRequiredTarget ? 'FAIL' : 'PASS',
        message: hasMissingRequiredTarget
          ? 'Ada kolom wajib (NOT NULL) di target yang tidak terpetakan dari sumber/rule.'
          : `✓ Seluruh ${targetCols.length} kolom target memiliki pemetaan yang valid dan konsisten.`,
      },
      {
        id: 'chk_rules_validity',
        category: 'Aturan Transformasi (Convert Rules)',
        title: 'Validasi Aturan Konversi & Lookup Master',
        status: rules.length > 0 ? 'PASS' : 'INFO',
        message: rules.length > 0
          ? `✓ Dikonfigurasi ${rules.length} aturan konversi (lookup & normalisasi) yang aktif.`
          : 'Konfigurasi ini tidak memerlukan convert rule tambahan (direct 1:1 mapping).',
      },
      {
        id: 'chk_error_logs',
        category: 'Audit Log & Integritas Sistem',
        title: 'Pemeriksaan Log Kesalahan (Error Logs)',
        status: errorsCount === 0 ? 'PASS' : 'FAIL',
        message: errorsCount === 0
          ? `✓ 0 error log pada sesi Run #${effectiveRunId || '-'}. Eksekusi migrasi berjalan bersih tanpa anomali data.`
          : `Terdeteksi ${errorsCount} error log pada sesi Run #${effectiveRunId || '-'}.`,
      },
    ];

    return {
      configId: cid,
      nameConfig: cfg.name_config,
      execOrder: cfg.exec_order,
      isActive: cfg.is_active,
      effectiveRunId,
      availableRuns: matchedRuns.slice(0, 15),
      source: {
        schema: cleanSrcSchema,
        view: cleanSrcView,
        database: 'antam_scm (SQL Server)',
        rowsCount: sourceRowsCount,
        columnsCount: sourceCols.length,
        columns: sourceCols,
        sampleRows: sourceSampleRows,
        error: sourceError,
      },
      staging: {
        schema: cleanStgSchema,
        table: cleanStgTable,
        database: 'db_procsi (PostgreSQL)',
        exists: stagingExists,
        rowsCount: stagingRowsCount,
        columnsCount: stagingCols.length,
        columns: stagingCols,
        sampleRows: stagingSampleRows,
        error: stagingError,
      },
      target: {
        schema: cleanTgtSchema,
        table: cleanTgtTable,
        database: 'db_procsi (PostgreSQL)',
        exists: targetExists,
        rowsCount: targetRowsCount,
        columnsCount: targetCols.length,
        columns: targetCols,
        sampleRows: targetSampleRows,
        migratedSampleCount: targetSampleRows.length,
        error: targetError,
        allTargetConfigs: targetConfigs,
      },
      rules,
      columnMatrix,
      metrics: {
        totalSourceCols: sourceCols.length,
        totalStagingCols: stagingCols.length,
        totalTargetCols: targetCols.length,
        totalMatrixCols: columnMatrix.length,
        mappedTargetCols: columnMatrix.filter((c) => c.targetCol && c.status !== 'UNMAPPED_TARGET' && c.status !== 'MISSING_REQUIRED').length,
        convertRulesActive: rules.length,
        errorsCount,
      },
      verdict: {
        level: verdictLevel,
        title: verdictTitle,
        subtitle: verdictSubtitle,
        badgeClass: verdictBadge,
        isSuccess: verdictLevel === 'SUCCESS',
        isStagingOnly: verdictLevel === 'STAGING_ONLY',
        rowCountMatch: rowCountMatchStage1,
        targetSyncStatus,
      },
      auditChecklist,
      recentErrors: errorLogs,
      recentSteps: stepLogs,
      latestRun: selectedRun,
    };
  }

  /**
   * Mengambil riwayat data staging dari stg_antam.staging_data_history
   * Mendukung filter runId, configId, deltaStatus, pagination
   */
  async getStagingHistory(filters = {}) {
    const { runId, configId, deltaStatus, limit = 100, offset = 0 } = filters;
    const conditions = [];
    const params = [];

    if (runId) {
      params.push(parseInt(runId, 10));
      conditions.push(`run_id = $${params.length}`);
    }
    if (configId) {
      params.push(parseInt(configId, 10));
      conditions.push(`config_id = $${params.length}`);
    }
    if (deltaStatus) {
      params.push(deltaStatus);
      conditions.push(`delta_status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim = Math.min(parseInt(limit, 10) || 100, 1000);
    const off = parseInt(offset, 10) || 0;

    const [countRes, rowsRes] = await Promise.all([
      queryPostgres(`SELECT count(*) as total FROM stg_antam.staging_data_history ${whereClause}`, params),
      queryPostgres(`
        SELECT history_id, run_id, config_id, table_name, business_key_columns, business_key_value, delta_status, payload, staged_at
        FROM stg_antam.staging_data_history
        ${whereClause}
        ORDER BY history_id DESC
        LIMIT ${lim} OFFSET ${off}
      `, params)
    ]);

    return {
      total: parseInt(countRes.rows[0]?.total || 0, 10),
      limit: lim,
      offset: off,
      rows: rowsRes.rows
    };
  }
}

module.exports = new PipelineService();


