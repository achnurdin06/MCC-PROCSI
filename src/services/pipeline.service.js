const { querySqlServer } = require('../config/sqlserver');
const { queryPostgres } = require('../config/postgres');

function sanitizeIdentifier(name) {
  if (!name || typeof name !== 'string') return null;
  const clean = name.replace(/[^a-zA-Z0-9_]/g, '');
  return clean.length > 0 ? clean : null;
}

const ACTION_STATUS = {
  STAGING: 'STAGING ONLY',
  POSTED: 'POSTED',
  NOT_POSTED: 'NOT_POSTED',
  ROLLED_BACK: 'ROLLED_BACK',
  NONE: 'NONE'
};

function isZeroPostRun(run) {
  return Boolean(run) && (
    (run.main_workflow === 'flow_2_post' && run.is_posted === false) ||
    (run.note && (run.note.includes('+0 baris diposting') || run.note.includes('ter-insert=0')))
  );
}

// Rollback dianggap lebih baru jika selesai setelah run lain terakhir beraktivitas.
// Dibandingkan berdasarkan waktu, bukan run_id, karena run_id Flow 2/3 mengikuti run Flow 1.
function isRollbackNewerThanRun(rollbackRun, otherRun) {
  const rolledBackAt = rollbackRun?.rolled_back_at ? new Date(rollbackRun.rolled_back_at).getTime() : NaN;
  const otherAt = new Date(otherRun?.end_time || otherRun?.start_time).getTime();
  return Number.isFinite(rolledBackAt) && Number.isFinite(otherAt) && rolledBackAt > otherAt;
}

/**
 * Satu-satunya sumber kebenaran penentuan Status Action per run.
 * Run Flow 1 yang belum diposting SELALU berstatus STAGING, dievaluasi sebelum
 * pengecekan "+0 baris" agar teks pada note tidak menggesernya menjadi NOT_POSTED.
 */
function resolveActionStatus(run, { hasPostLog = false, stgRows = null } = {}) {
  if (!run) {
    if (hasPostLog) return ACTION_STATUS.POSTED;
    return stgRows !== null && stgRows > 0 ? ACTION_STATUS.STAGING : ACTION_STATUS.NONE;
  }
  if (run.is_rolled_back) return ACTION_STATUS.ROLLED_BACK;
  if (run.main_workflow === 'flow_1_staging' && !run.is_posted) return ACTION_STATUS.STAGING;
  if (isZeroPostRun(run)) return ACTION_STATUS.NOT_POSTED;
  if (run.is_posted) return ACTION_STATUS.POSTED;
  if (run.note?.includes('Flow 1')) return ACTION_STATUS.STAGING;
  if (run.main_workflow === 'flow_2_post') return ACTION_STATUS.NOT_POSTED;
  if (run.status === 'SUCCESS') return ACTION_STATUS.STAGING;
  return ACTION_STATUS.NOT_POSTED;
}

class PipelineService {
  static resolveActionStatus = resolveActionStatus;
  static ACTION_STATUS = ACTION_STATUS;

  // In-memory cache map untuk mempercepat display data secara drastis
  static _pipelineCache = new Map();
  static _inflight = new Map();
  static _countCache = new Map();
  static COUNT_TTL_MS = 120000;
  static COUNT_CONCURRENCY = 6;

  invalidatePipelineCache() {
    PipelineService._pipelineCache.clear();
    PipelineService._countCache.clear();
  }

  /**
   * Hitung baris dengan cache TTL, dedupe request paralel, dan batas konkurensi
   * agar tidak menghabiskan pool koneksi.
   */
  static async _cachedCount(key, force, loader) {
    const hit = PipelineService._countCache.get(key);
    if (!force && hit && hit.value !== undefined && Date.now() - hit.timestamp < PipelineService.COUNT_TTL_MS) {
      return hit.value;
    }
    if (hit && hit.promise) return hit.promise;
    const promise = loader().then((value) => {
      PipelineService._countCache.set(key, { timestamp: Date.now(), value });
      return value;
    }).catch((err) => {
      PipelineService._countCache.delete(key);
      throw err;
    });
    PipelineService._countCache.set(key, { promise });
    return promise;
  }

  static async _mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return results;
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

    // Request paralel dengan parameter sama berbagi satu proses hitung
    const inflightKey = `${cacheKey}_${force ? 'f' : 'n'}`;
    if (PipelineService._inflight.has(inflightKey)) {
      return PipelineService._inflight.get(inflightKey);
    }
    const task = this._buildPipelineSummary({ cid, eid, force, cacheKey })
      .finally(() => PipelineService._inflight.delete(inflightKey));
    PipelineService._inflight.set(inflightKey, task);
    return task;
  }

  async _buildPipelineSummary({ cid, eid, force, cacheKey }) {

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
    const configIdsSubquery = `(SELECT config_id FROM mc_center.migration_config ${cfgWhere})`;
    const [
      configsRes,
      targetConfigsRes,
      postStepLogsRes,
      rollbackStepLogsRes,
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
        WHERE is_active = true AND config_id IN ${configIdsSubquery}
        ORDER BY config_id, exec_order, target_config_id
      `, cfgParams),
      queryPostgres(`
        SELECT log_id, run_id, config_id, step_name, rows_before, rows_after, message, start_time
        FROM mc_center.migration_step_log
        WHERE step_name = 'POST_TARGET' AND config_id IN ${configIdsSubquery}
        ORDER BY log_id DESC
      `, cfgParams),
      queryPostgres(`
        SELECT log_id, run_id, config_id, step_name, rows_before, rows_after, message, start_time
        FROM mc_center.migration_step_log
        WHERE step_name = 'ROLLBACK_TARGET' AND status = 'OK' AND config_id IN ${configIdsSubquery}
        ORDER BY log_id DESC
      `, cfgParams),
      queryPostgres(`
        SELECT 
          run_id, run_ts, start_time, end_time, status, hop_host, note, main_workflow, config_id,
          is_posted, posted_at, post_type, is_rolled_back, rolled_back_at,
          ROUND(EXTRACT(EPOCH FROM (end_time - start_time))::numeric, 2) AS duration_seconds
        FROM mc_center.migration_run
        ${cfgWhere}
        ORDER BY GREATEST(COALESCE(end_time, start_time), COALESCE(posted_at, start_time), COALESCE(rolled_back_at, start_time)) DESC NULLS LAST, run_id DESC
      `, cfgParams),
      queryPostgres(`
        SELECT config_id, run_id, COUNT(*)::int AS total
        FROM mc_center.migration_error_log
        WHERE config_id IN ${configIdsSubquery}
        GROUP BY config_id, run_id
      `, cfgParams),
      queryPostgres(`
        SELECT DISTINCT ON (config_id) *
        FROM mc_center.migration_step_log
        WHERE config_id IN ${configIdsSubquery}
        ORDER BY config_id, log_id DESC
      `, cfgParams)
    ]);

    const configs = configsRes.rows;
    const allTargetConfigs = targetConfigsRes.rows;
    const allPostStepLogs = postStepLogsRes.rows;
    const allRollbackStepLogs = rollbackStepLogsRes.rows;
    const allRuns = latestRunsRes.rows;

    // Indeks run per config_id (urutan run_id DESC dipertahankan) agar pencarian tidak O(configs x runs)
    const runsByConfig = new Map();
    for (const r of allRuns) {
      if (!r.config_id) continue;
      for (const id of new Set(r.config_id.split(',').map((x) => x.trim()))) {
        if (!runsByConfig.has(id)) runsByConfig.set(id, []);
        runsByConfig.get(id).push(r);
      }
    }

    // Buat O(1) Fast Lookup Maps
    const errorMap = new Map();
    for (const er of errorCountsRes.rows) {
      errorMap.set(`${er.config_id}_${er.run_id}`, er.total);
    }

    const postLogsByConfig = new Map();
    for (const sl of allPostStepLogs) {
      if (!postLogsByConfig.has(sl.config_id)) postLogsByConfig.set(sl.config_id, []);
      postLogsByConfig.get(sl.config_id).push(sl);
    }

    const lastStepMap = new Map();
    for (const ls of lastStepLogsRes.rows) {
      lastStepMap.set(ls.config_id, ls);
    }

    // 2. Paralelisasi Perhitungan Staging & Source Rows
    // Eksekusi seluruh query SQL Server dan Postgres Staging secara bersamaan
    const srcTask = PipelineService._mapLimit(configs, PipelineService.COUNT_CONCURRENCY, async (cfg) => {
      const cleanSrcSchema = sanitizeIdentifier(cfg.src_schema) || 'dbo';
      const cleanSrcView = sanitizeIdentifier(cfg.src_view);
      if (!cleanSrcView) return { configId: cfg.config_id, rows: null, error: null };
      try {
        const rows = await PipelineService._cachedCount(`src_${cleanSrcSchema}.${cleanSrcView}`, force, async () => {
          let timer;
          const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Timeout SQL Server view')), 4000);
          });
          try {
            const queryPromise = querySqlServer(`SELECT COUNT_BIG(1) AS total FROM [${cleanSrcSchema}].[${cleanSrcView}]`);
            const res = await Promise.race([queryPromise, timeoutPromise]);
            return parseInt(res.recordset[0]?.total, 10) || 0;
          } finally {
            clearTimeout(timer);
          }
        });
        return { configId: cfg.config_id, rows, error: null };
      } catch (e) {
        return { configId: cfg.config_id, rows: null, error: e.message };
      }
    });

    const stgTask = PipelineService._mapLimit(configs, PipelineService.COUNT_CONCURRENCY, async (cfg) => {
      const cleanStgTable = sanitizeIdentifier(cfg.stg_table);
      if (!cleanStgTable) return { configId: cfg.config_id, rows: null, error: null };
      try {
        const rows = await PipelineService._cachedCount(`stg_${cleanStgTable}`, force, async () => {
          const res = await queryPostgres(`SELECT COUNT(*) AS total FROM "stg_antam"."${cleanStgTable}"`);
          return parseInt(res.rows[0]?.total, 10) || 0;
        });
        return { configId: cfg.config_id, rows, error: null };
      } catch (e) {
        return { configId: cfg.config_id, rows: null, error: e.message };
      }
    });

    const [srcResults, stgResults] = await Promise.all([srcTask, stgTask]);

    const srcMap = new Map(srcResults.map(r => [r.configId, r]));
    const stgMap = new Map(stgResults.map(r => [r.configId, r]));

    // 3. Kumpulkan fallback target tables yang actionStatus-nya POSTED dan perlu di-count jika belum ada di log
    const fallbackTargetQueries = [];
    const fallbackTargetMap = new Map();

    for (const cfg of configs) {
      const idStr = String(cfg.config_id);
      const matchedRun = (runsByConfig.get(idStr) || [])[0] || null;

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
        // Hitung ulang tabel target selalu dilakukan: sesi staging (Flow 1) tidak punya log POST_TARGET sendiri
        if (tTable) {
          const key = `"${tSchema}"."${tTable}"`;
          if (!fallbackTargetMap.has(key)) {
            fallbackTargetMap.set(key, null);
            fallbackTargetQueries.push(key);
          }
        }
      }
    }

    if (fallbackTargetQueries.length > 0) {
      await PipelineService._mapLimit(fallbackTargetQueries, PipelineService.COUNT_CONCURRENCY, async (key) => {
        try {
          const total = await PipelineService._cachedCount(`tgt_${key}`, force, async () => {
            const r = await queryPostgres(`SELECT COUNT(*) AS total FROM ${key}`);
            return parseInt(r.rows[0]?.total, 10) || 0;
          });
          fallbackTargetMap.set(key, total);
        } catch (e) {
          fallbackTargetMap.set(key, null);
        }
      });
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
      const matchedRun = (runsByConfig.get(idStr) || [])[0] || null;

      // Cari sesi migrasi terakhir yang BUKAN flow_4_purge (misal Flow 1 Staging, Flow 2 Post, Flow 3 Rollback)
      const matchedMigrationRun = (runsByConfig.get(idStr) || []).find((r) => !(r.main_workflow === 'flow_4_purge' || r.main_workflow?.includes('purge'))) || null;

      // Cari sesi rollback terakhir yang valid (is_rolled_back = true)
      const matchedRollbackRun = (runsByConfig.get(idStr) || []).find((r) => r.main_workflow === 'flow_3_rollback' && r.is_rolled_back) || null;

      // Urutan runsByConfig = aktivitas terakhir (end/post/rollback), bukan run_id terbesar.
      // Ketika proses flow_4_purge, actionStatus tetap dengan status terakhir pada hasil migrasi.
      // Prioritas penentuan status:
      //   1. Jika run terbaru adalah purge -> gunakan run migrasi non-purge sebelumnya
      //   2. Jika ada rollback aktif (is_rolled_back) DAN run terbaru non-purge adalah rollback itu sendiri -> tampilkan rollback
      //   3. Semua kasus lain (mis. flow 1 staging baru setelah rollback) -> gunakan run terbaru langsung
      let runForAction;
      if (matchedRun && (matchedRun.main_workflow === 'flow_4_purge' || matchedRun.main_workflow?.includes('purge'))) {
        // Jika run terbaru adalah purge, gunakan run migrasi sebelumnya
        runForAction = matchedMigrationRun || matchedRun;
      } else if (matchedRollbackRun && matchedMigrationRun && (
        matchedMigrationRun.run_id === matchedRollbackRun.run_id ||
        isRollbackNewerThanRun(matchedRollbackRun, matchedMigrationRun)
      )) {
        // Rollback adalah aksi terakhir yang mengubah target (run +0 post / staging yang lebih lama
        // secara waktu tidak membatalkan rollback) -> tampilkan status rollback
        runForAction = matchedRollbackRun;
      } else {
        // Ada run baru setelah rollback (mis. flow_1 staging baru) -> gunakan run terbaru langsung
        runForAction = matchedRun;
      }

      const errorsCount = runForAction ? (errorMap.get(`${cfg.config_id}_${runForAction.run_id}`) || 0) : 0;
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

        const cfgPostLogs = postLogsByConfig.get(cfg.config_id) || [];
        const tTableLower = tTable ? tTable.toLowerCase() : null;
        const logMatchesTable = (sl) => tTableLower && sl.message && sl.message.toLowerCase().includes(tTableLower);
        const matchedLog = cfgPostLogs.find((sl) => (runForAction ? sl.run_id === runForAction.run_id : true) && logMatchesTable(sl))
          || cfgPostLogs.find(logMatchesTable);

        let actionStatus = resolveActionStatus(runForAction, { hasPostLog: Boolean(matchedLog), stgRows });
        const postedAt = runForAction ? runForAction.posted_at : null;
        const rolledBackAt = runForAction ? runForAction.rolled_back_at : null;

        let sumAfter = null;
        let sumBefore = null;

        // Jika ROLLED_BACK: gunakan log ROLLBACK_TARGET untuk sumBefore/sumAfter (nilai setelah rollback = nilai sebelum posting)
        // Sesi staging belum memposting apa pun: log POST_TARGET milik sesi lama (yang mungkin sudah di-rollback)
        // tidak boleh dipakai, sehingga Sum After dihitung ulang dari isi tabel target saat ini.
        const auditLog = actionStatus === ACTION_STATUS.STAGING ? null : matchedLog;

        const rollbackLog = (actionStatus === 'ROLLED_BACK' && runForAction)
          ? allRollbackStepLogs.find((sl) =>
              sl.run_id === runForAction.run_id &&
              sl.message && tTable &&
              sl.message.toLowerCase().includes(tTable.toLowerCase())
            ) || null
          : null;

        if (rollbackLog) {
          // sumAfter = jumlah baris target setelah rollback (= sebelum posting)
          sumAfter = rollbackLog.rows_after !== null ? parseInt(rollbackLog.rows_after, 10) : null;
          // sumBefore = jumlah baris target sebelum rollback (= saat posting selesai)
          sumBefore = rollbackLog.rows_before !== null ? parseInt(rollbackLog.rows_before, 10) : null;
        } else {
          // Ambil baris target dari POST_TARGET log: prioritaskan matchedLog (record audit aktual), fallback ke query count tabel target
          if (auditLog && auditLog.rows_after !== null && auditLog.rows_after !== undefined) {
            sumAfter = parseInt(auditLog.rows_after, 10);
          } else {
            sumAfter = fallbackTargetMap.get(`"${tSchema}"."${tTable}"`) ?? null;
          }

          if (auditLog && auditLog.rows_before !== null && auditLog.rows_before !== undefined) {
            sumBefore = parseInt(auditLog.rows_before, 10);
          } else if (sumAfter !== null && stgRows !== null && actionStatus === 'POSTED') {
            sumBefore = Math.max(0, sumAfter - stgRows);
          } else if (sumAfter !== null) {
            sumBefore = sumAfter;
          }
        }

        // Koreksi Status Action jika tidak ada penambahan baris data baru ke target (+0 baris) saat proses POSTING:
        // HANYA jika sesi adalah proses POSTING aktual (BUKAN flow_4_purge atau ROLLED_BACK)
        const isPurgeRun = matchedRun && (matchedRun.main_workflow === 'flow_4_purge' || matchedRun.main_workflow?.includes('purge'));
        if (!isPurgeRun && actionStatus !== 'ROLLED_BACK') {
          if (runForAction?.main_workflow === 'flow_2_post' && sumBefore !== null && sumAfter !== null && sumAfter === sumBefore) {
            actionStatus = 'NOT_POSTED';
          }
          if (actionStatus === 'POSTED' && sumBefore !== null && sumAfter !== null && sumAfter === sumBefore) {
            actionStatus = 'NOT_POSTED';
          }
          if (actionStatus === 'POSTED' && matchedRun?.note && (matchedRun.note.includes('+0 baris diposting') || matchedRun.note.includes('ter-insert=0'))) {
            actionStatus = 'NOT_POSTED';
          }
          if (actionStatus === 'POSTED' && matchedLog?.message && (matchedLog.message.includes('Selisih=+0 baris') || matchedLog.message.includes('ter-insert=0'))) {
            actionStatus = 'NOT_POSTED';
          }
        }

        const lastRunId = runForAction?.run_id || matchedRun?.run_id || matchedLog?.run_id || null;

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
        latestRun: runForAction || matchedRun || allRuns[0] || null,
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
        ORDER BY GREATEST(COALESCE(end_time, start_time), COALESCE(posted_at, start_time), COALESCE(rolled_back_at, start_time)) DESC NULLS LAST, run_id DESC
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
      ORDER BY GREATEST(COALESCE(end_time, start_time), COALESCE(posted_at, start_time), COALESCE(rolled_back_at, start_time)) DESC NULLS LAST, run_id DESC
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
      selectedRun = matchedRuns.find((r) => r.main_workflow !== 'flow_4_purge' && !r.main_workflow?.includes('purge')) || matchedRuns[0] || null;
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
    const { runId, configId, deltaStatus, search, limit = 100, offset = 0 } = filters;
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

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      conditions.push(`(business_key_value ILIKE $${params.length} OR payload->>'id' ILIKE $${params.length})`);
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

  /**
   * Ringkasan run yang tercatat di staging_data_history untuk satu config
   * (jumlah baris per delta_status + status posting/rollback dari migration_run)
   */
  async getStagingHistoryRuns(configId) {
    const cid = parseInt(configId, 10);
    if (!cid) throw new Error('configId wajib diisi dan harus berupa angka.');

    const res = await queryPostgres(`
      SELECT h.run_id,
             count(*)::int AS total_rows,
             count(*) FILTER (WHERE h.delta_status = 'NEW_DELTA')::int AS new_delta,
             count(*) FILTER (WHERE h.delta_status = 'ALREADY_IN_TARGET')::int AS already_in_target,
             min(h.staged_at) AS staged_at,
             r.status, r.is_posted, r.posted_at, r.is_rolled_back, r.rolled_back_at
        FROM stg_antam.staging_data_history h
        LEFT JOIN mc_center.migration_run r ON r.run_id = h.run_id
       WHERE h.config_id = $1
       GROUP BY h.run_id, r.status, r.is_posted, r.posted_at, r.is_rolled_back, r.rolled_back_at
       ORDER BY h.run_id DESC
       LIMIT 200
    `, [cid]);

    return { configId: cid, runs: res.rows };
  }
}

module.exports = new PipelineService();


