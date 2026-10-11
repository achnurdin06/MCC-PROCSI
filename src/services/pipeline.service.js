const { querySqlServer } = require('../config/sqlserver');
const { queryPostgres } = require('../config/postgres');

function sanitizeIdentifier(name) {
  if (!name || typeof name !== 'string') return null;
  const clean = name.replace(/[^a-zA-Z0-9_]/g, '');
  return clean.length > 0 ? clean : null;
}

class PipelineService {
  /**
   * Mengambil seluruh list konfigurasi migration_config beserta rekonsiliasi 3-Tahap
   */
  async getPipelineSummary(filters = {}) {
    const { clientId, envId } = filters;
    const cid = clientId ? parseInt(clientId, 10) : null;
    const eid = envId ? parseInt(envId, 10) : null;

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

    // 1. Ambil seluruh konfigurasi dari etl_antam.migration_config
    const configsRes = await queryPostgres(`
      SELECT 
        config_id,
        exec_order,
        src_schema,
        src_view,
        tgt_schema,
        tgt_table,
        stg_table,
        pk_columns,
        compare_columns,
        id_column,
        id_width,
        id_seed,
        src_precheck_sql,
        is_active
      FROM etl_antam.migration_config
      ${cfgWhere}
      ORDER BY exec_order, config_id
    `, cfgParams);

    const configs = configsRes.rows;
    const pipelineResults = [];

    for (const cfg of configs) {
      let srcRows = null;
      let stgRows = null;
      let tgtRows = null;
      let srcError = null;
      let stgError = null;
      let tgtError = null;

      const cleanSrcSchema = sanitizeIdentifier(cfg.src_schema) || 'dbo';
      const cleanSrcView = sanitizeIdentifier(cfg.src_view);
      const cleanStgSchema = 'stg_antam';
      const cleanStgTable = sanitizeIdentifier(cfg.stg_table);
      const cleanTgtSchema = sanitizeIdentifier(cfg.tgt_schema) || 'vendor';
      const cleanTgtTable = sanitizeIdentifier(cfg.tgt_table);

      // 1. Hitung Baris Source (SQL Server)
      if (cleanSrcView) {
        try {
          const res = await querySqlServer(
            `SELECT COUNT_BIG(1) AS total FROM [${cleanSrcSchema}].[${cleanSrcView}]`
          );
          srcRows = parseInt(res.recordset[0]?.total, 10) || 0;
        } catch (e) {
          srcError = e.message;
        }
      }

      // 2. Hitung Baris Staging (PostgreSQL - stg_antam)
      if (cleanStgTable) {
        try {
          const res = await queryPostgres(
            `SELECT COUNT(*) AS total FROM "${cleanStgSchema}"."${cleanStgTable}"`
          );
          stgRows = parseInt(res.rows[0]?.total, 10) || 0;
        } catch (e) {
          stgError = e.message;
        }
      }

      // 3. Hitung Baris Target (PostgreSQL - tgt_schema / vendor)
      if (cleanTgtTable) {
        try {
          const res = await queryPostgres(
            `SELECT COUNT(*) AS total FROM "${cleanTgtSchema}"."${cleanTgtTable}"`
          );
          tgtRows = parseInt(res.rows[0]?.total, 10) || 0;
        } catch (e) {
          tgtError = e.message;
        }
      }

      // Ambil jumlah error terkait config_id ini
      const errorCountRes = await queryPostgres(
        `SELECT COUNT(*) AS total FROM etl_antam.migration_error_log WHERE config_id = $1`,
        [cfg.config_id]
      );
      const errorsCount = parseInt(errorCountRes.rows[0]?.total, 10) || 0;

      // Ambil log langkah terakhir
      const lastStepRes = await queryPostgres(
        `SELECT * FROM etl_antam.migration_step_log WHERE config_id = $1 ORDER BY log_id DESC LIMIT 1`,
        [cfg.config_id]
      );
      const lastStep = lastStepRes.rows[0] || null;

      // Evaluasi status alur Source ➔ Staging
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

      pipelineResults.push({
        configId: cfg.config_id,
        execOrder: cfg.exec_order,
        isActive: cfg.is_active,
        source: {
          database: 'antam_scm (SQL Server)',
          schema: cleanSrcSchema,
          view: cleanSrcView,
          rows: srcRows,
          error: srcError,
        },
        staging: {
          database: 'db_procsi (PostgreSQL)',
          schema: cleanStgSchema,
          table: cleanStgTable,
          rows: stgRows,
          error: stgError,
        },
        target: {
          database: 'db_procsi (PostgreSQL)',
          schema: cleanTgtSchema,
          table: cleanTgtTable,
          rows: tgtRows,
          error: tgtError,
        },
        reconciliation: {
          deltaSourceToStaging: (srcRows !== null && stgRows !== null) ? stgRows - srcRows : null,
          deltaStagingToTarget: (stgRows !== null && tgtRows !== null) ? tgtRows - stgRows : null,
          sourceToStagingStatus: stage1Status,
          errorsLogged: errorsCount,
          lastStep,
        },
        metadata: {
          pkColumns: cfg.pk_columns,
          compareColumns: cfg.compare_columns,
          idColumn: cfg.id_column,
          idWidth: cfg.id_width,
          idSeed: cfg.id_seed,
          srcPrecheckSql: cfg.src_precheck_sql,
        },
      });
    }

    // Ambil info latest migration_run secara umum dan per config (terfilter client & env)
    const latestRunsRes = await queryPostgres(`
      SELECT 
        run_id, run_ts, start_time, end_time, status, hop_host, note, main_workflow, config_id,
        is_posted, posted_at, post_type, is_rolled_back, rolled_back_at,
        ROUND(EXTRACT(EPOCH FROM (end_time - start_time))::numeric, 2) AS duration_seconds
      FROM etl_antam.migration_run
      ${cfgWhere}
      ORDER BY run_id DESC
      LIMIT 10
    `, cfgParams);

    // Tempelkan latestRun yang relevan ke masing-masing pipeline
    for (const p of pipelineResults) {
      const idStr = String(p.configId);
      const matchedRun = latestRunsRes.rows.find((r) => r.config_id === idStr || (r.config_id && r.config_id.includes(idStr)));
      p.latestRun = matchedRun || latestRunsRes.rows[0] || null;
    }

    return {
      totalConfigs: pipelineResults.length,
      pipelines: pipelineResults,
      recentRuns: latestRunsRes.rows,
    };
  }

  /**
   * Mengambil detail konfigurasi spesifik berserta rules, target configs, dan logs terkait
   */
  async getConfigDetail(configId) {
    const id = parseInt(configId, 10);
    if (!id) throw new Error('configId tidak valid.');

    const idStr = String(id);
    const [configRes, rulesRes, targetsRes, stepLogsRes, errorLogsRes, runsRes] = await Promise.all([
      queryPostgres('SELECT * FROM etl_antam.migration_config WHERE config_id = $1', [id]),
      queryPostgres('SELECT * FROM etl_antam.migration_convert_rule WHERE config_id = $1 ORDER BY rule_id', [id]),
      queryPostgres('SELECT * FROM etl_antam.migration_target_config WHERE config_id = $1 ORDER BY exec_order', [id]),
      queryPostgres('SELECT * FROM etl_antam.migration_step_log WHERE config_id = $1 ORDER BY log_id DESC LIMIT 15', [id]),
      queryPostgres('SELECT * FROM etl_antam.migration_error_log WHERE config_id = $1 ORDER BY error_id DESC LIMIT 15', [id]),
      queryPostgres(`
        SELECT 
          run_id, run_ts, start_time, end_time, status, hop_host, note, main_workflow, config_id,
          is_posted, posted_at, post_type, is_rolled_back, rolled_back_at,
          ROUND(EXTRACT(EPOCH FROM (end_time - start_time))::numeric, 2) AS duration_seconds
        FROM etl_antam.migration_run
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
    const { configId, stage = 'staging', page = 1, limit = 25 } = options;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const offset = (pageNum - 1) * limitNum;

    // Ambil info config
    const cfgRes = await queryPostgres(
      `SELECT * FROM etl_antam.migration_config WHERE config_id = $1`,
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

        const firstCol = columns[0] ? `[${columns[0].name}]` : '(SELECT NULL)';
        const dataRes = await querySqlServer(`
          SELECT * FROM [${cleanSchema}].[${cleanView}]
          ORDER BY ${firstCol}
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

      const firstCol = columns[0] ? `"${columns[0].name}"` : '1';
      const dataRes = await queryPostgres(`
        SELECT * FROM "${cleanSchema}"."${cleanTable}"
        ORDER BY ${firstCol}
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
      const cleanSchema = sanitizeIdentifier(cfg.tgt_schema) || 'vendor';
      const cleanTable = sanitizeIdentifier(cfg.tgt_table);

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

      const firstCol = columns[0] ? `"${columns[0].name}"` : '1';
      const dataRes = await queryPostgres(`
        SELECT * FROM "${cleanSchema}"."${cleanTable}"
        ORDER BY ${firstCol}
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
   * Mengambil data lengkap untuk Berita Acara Validasi & Rekonsiliasi Data
   */
  async getBeritaAcaraData(configId) {
    const id = parseInt(configId, 10);
    if (!id) throw new Error('configId tidak valid.');

    const cfgRes = await queryPostgres(
      'SELECT * FROM etl_antam.migration_config WHERE config_id = $1',
      [id]
    );
    const cfg = cfgRes.rows[0];
    if (!cfg) throw new Error(`Konfigurasi config_id ${configId} tidak ditemukan.`);

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
    const stgColsQuery = await queryPostgres(`
      SELECT column_name, data_type 
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `, [cleanStgSchema, cleanStgTable]);
    const stgColumns = stgColsQuery.rows.map((c) => ({ name: c.column_name, type: c.data_type }));

    // Ambil data staging untuk lampiran
    const stgDataQuery = await queryPostgres(
      `SELECT * FROM "${cleanStgSchema}"."${cleanStgTable}" ORDER BY 1 LIMIT 500`
    );
    const stgRowsData = stgDataQuery.rows;

    // 3. Fetch conversion rules
    const rulesRes = await queryPostgres(
      `SELECT * FROM etl_antam.migration_convert_rule WHERE config_id = $1 ORDER BY rule_id`,
      [id]
    );

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
    const docNumber = `BA-VAL/ANTAM/${docDateCode}/CFG-${String(id).padStart(3, '0')}`;

    // Verdict
    const deltaSrcStg = stgRows - srcRows;
    const isSynced = srcRows === stgRows && srcRows > 0;
    const verdict = isSynced ? 'LULUS VALIDASI (100% SINKRON)' : (stgRows < srcRows ? 'BELUM LENGKAP (PARSIAL)' : 'PERLU PENINJAUAN ULANG');

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
      config: {
        configId: cfg.config_id,
        execOrder: cfg.exec_order,
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
      },
      rules: rulesRes.rows,
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
}

module.exports = new PipelineService();
