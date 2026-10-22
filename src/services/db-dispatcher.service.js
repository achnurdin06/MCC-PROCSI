const { queryPostgres, getPostgresPool } = require('../config/postgres');

/**
 * DB Dispatcher Service
 * Mengenkapsulasi seluruh eksekusi Stored Procedure, Function, dan Advisory Lock PostgreSQL (skema mc_center)
 * Memastikan interaksi database terstandarisasi, aman dari race-condition, dan tercatat di audit trail.
 */
class DbDispatcherService {
  constructor() {
    this.activeLocks = new Set();
  }

  /**
   * Mengambil Advisory Lock per configId untuk mencegah eksekusi tumpang-tindih (race condition)
   * Menggunakan kombinasi In-Memory Process Mutex + Database Advisory Lock
   */
  async acquireLock(configId) {
    const lockKey = String(configId || 4242);
    // 1. Cek in-memory lock terlebih dahulu (anti-race condition instan di node.js)
    if (this.activeLocks.has(lockKey)) {
      return false;
    }

    // 2. Tandai in-memory
    this.activeLocks.add(lockKey);

    // 3. Optional DB level lock (non-fatal jika pool reuse)
    try {
      const lockId = parseInt(configId, 10) || 4242;
      await queryPostgres('SELECT pg_try_advisory_lock($1) AS locked', [lockId]);
    } catch (e) {
      // Non-fatal
    }

    return true;
  }

  /**
   * Melepaskan Advisory Lock
   */
  async releaseLock(configId) {
    const lockKey = String(configId || 4242);
    this.activeLocks.delete(lockKey);
    try {
      const lockId = parseInt(configId, 10) || 4242;
      await queryPostgres('SELECT pg_advisory_unlock($1)', [lockId]);
    } catch (e) {
      // ignore
    }
  }

  /**
   * Inisialisasi baris migration_run baru dengan status RUNNING
   * Mengambil metadata client & environment aktif sebagai fallback jika tidak disertakan
   */
  async initRun({ configId, clientId, envId, mainWorkflow = 'visual_canvas', host = 'localhost' }) {
    const cleanConfigId = configId ? String(configId).replace(/\s+/g, '') : null;

    // Ambil data client dan environment aktif
    let cId = clientId ? parseInt(clientId, 10) : null;
    let eId = envId ? parseInt(envId, 10) : null;
    let clientName = 'ANTAM';
    let envName = 'Development';

    if (eId) {
      const envRes = await queryPostgres(`
        SELECT e.env_id, e.env_name, c.client_id, c.client_name 
        FROM mc_center.master_environment e
        JOIN mc_center.master_client c ON e.client_id = c.client_id
        WHERE e.env_id = $1
        LIMIT 1
      `, [eId]);
      if (envRes.rows.length > 0) {
        cId = envRes.rows[0].client_id;
        clientName = envRes.rows[0].client_name;
        envName = envRes.rows[0].env_name;
      }
    } else {
      const defRes = await queryPostgres(`
        SELECT e.env_id, e.env_name, c.client_id, c.client_name 
        FROM mc_center.master_environment e
        JOIN mc_center.master_client c ON e.client_id = c.client_id
        WHERE c.is_active = true AND e.is_active = true
        ORDER BY c.client_id ASC, e.env_id ASC
        LIMIT 1
      `);
      if (defRes.rows.length > 0) {
        cId = defRes.rows[0].client_id;
        eId = defRes.rows[0].env_id;
        clientName = defRes.rows[0].client_name;
        envName = defRes.rows[0].env_name;
      }
    }

    const insertSql = `
      INSERT INTO mc_center.migration_run (
        run_ts, hop_host, main_workflow, config_id,
        client_id, env_id, client, environment, status
      )
      VALUES (
        to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD_HH24MI'),
        $1, $2, $3, $4, $5, $6, $7, 'RUNNING'
      )
      RETURNING run_id, run_ts, config_id, client_id, env_id, client, environment, status
    `;

    const res = await queryPostgres(insertSql, [
      host,
      mainWorkflow,
      cleanConfigId,
      cId,
      eId,
      clientName,
      envName
    ]);

    return res.rows[0];
  }

  /**
   * Catat langkah eksekusi granular ke mc_center.migration_step_log
   */
  async logStep({
    runId,
    configId,
    stepName,
    status = 'OK',
    message = null,
    rowsSrc = null,
    rowsStg = null,
    rowsNew = null,
    rowsChanged = null,
    rowsDeleted = null,
    rowsBefore = null,
    rowsAfter = null
  }) {
    const cleanConfigId = (configId !== null && configId !== undefined && !isNaN(parseInt(configId, 10))) 
      ? parseInt(configId, 10) 
      : null;

    const sql = `
      CALL mc_center.pr_log_step(
        $1::bigint, $2::int, $3::varchar, $4::varchar, $5::text,
        $6::bigint, $7::bigint, $8::bigint, $9::bigint, $10::bigint,
        $11::bigint, $12::bigint
      )
    `;
    await queryPostgres(sql, [
      runId,
      cleanConfigId,
      stepName,
      status,
      message,
      rowsSrc,
      rowsStg,
      rowsNew,
      rowsChanged,
      rowsDeleted,
      rowsBefore,
      rowsAfter
    ]);
  }

  /**
   * Catat kesalahan diagnostik ke mc_center.migration_error_log
   */
  async logError({
    runId,
    configId,
    stepName,
    pipelineName = 'orchestrator_engine',
    transformName = 'native_runner',
    errorCode,
    errorMessage,
    errorField = null,
    rowData = null
  }) {
    const sql = `
      INSERT INTO mc_center.migration_error_log (
        run_id, config_id, step_name, pipeline_name, transform_name,
        error_code, error_message, error_field, row_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    await queryPostgres(sql, [
      runId,
      configId || null,
      stepName,
      pipelineName,
      transformName,
      errorCode,
      errorMessage,
      errorField,
      rowData
    ]);
  }

  /**
   * Tandai run gagal via pr_fail
   */
  async failRun({ runId, configId, stepName, errorCode, errorMessage, errorDetail = null }) {
    try {
      await queryPostgres(`
        CALL mc_center.pr_fail(
          $1::bigint, $2::int, $3::varchar, $4::varchar, $5::text, $6::text
        )
      `, [runId, configId || null, stepName, errorCode, errorMessage, errorDetail]);
    } catch (err) {
      // Fallback jika stored procedure fail error
      await queryPostgres(`
        UPDATE mc_center.migration_run
        SET status = 'FAILED', note = COALESCE(note, '') || ' | ' || $2
        WHERE run_id = $1
      `, [runId, `FAILED at ${stepName}: ${errorMessage}`]);
    }
  }

  /**
   * Validasi target table & rules
   */
  async precheckTarget(runId, configId) {
    const res = await queryPostgres('SELECT mc_center.fn_precheck_target($1::bigint, $2::int) AS res', [runId, configId]);
    return res.rows[0]?.res === 0;
  }

  /**
   * Siapkan staging table (DROP & CREATE (LIKE target), Sequence LPAD 8-digit)
   */
  async prepareStaging(runId, configId) {
    const res = await queryPostgres('SELECT mc_center.fn_prepare_staging($1::bigint, $2::int) AS res', [runId, configId]);
    return res.rows[0]?.res === 0;
  }

  /**
   * Validasi jumlah baris staging terhadap sumber
   */
  async checkStaging(runId, configId, rowsSrc) {
    const res = await queryPostgres('SELECT mc_center.fn_check_staging($1::bigint, $2::int, $3::bigint) AS res', [runId, configId, rowsSrc]);
    return res.rows[0]?.res === 0;
  }

  /**
   * Konversi kode sumber ke master ID target via vw_convert_rule & migration_lookup
   */
  async convertStaging(runId, configId) {
    const res = await queryPostgres('SELECT mc_center.fn_convert_staging($1::bigint, $2::int) AS res', [runId, configId]);
    return res.rows[0]?.res === 0;
  }

  /**
   * Analisis delta data baru, berubah, dan terhapus
   */
  async checkDelta(runId, configId) {
    const res = await queryPostgres('SELECT mc_center.fn_check_delta($1::bigint, $2::int) AS res', [runId, configId]);
    return res.rows[0]?.res === 0;
  }

  /**
   * Guard Flow 2: Validasi apakah Run ID layak untuk di-post
   */
  async validatePostRun(runId) {
    try {
      const res = await queryPostgres('SELECT mc_center.fn_validate_post_run($1::text) AS res', [String(runId)]);
      return { valid: Boolean(res.rows[0]?.res), configId: res.rows[0]?.res, error: null };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  /**
   * Dispatch posting data ke multi-target tables
   */
  async postAllTargets(runId, configId, batchSize = 1000, useBatch = 'Y') {
    const bSize = (useBatch === 'Y') ? parseInt(batchSize, 10) || 1000 : null;
    const res = await queryPostgres(`
      SELECT mc_center.fn_post_all_targets($1::bigint, $2::int, $3::int, $4::text) AS res
    `, [runId, configId, bSize, useBatch]);
    return res.rows[0]?.res === 0;
  }

  /**
   * Dispatch posting untuk 1 target config spesifik (mendukung custom DAG)
   */
  async postTargetDispatch(runId, targetConfigId, batchSize = 1000, useBatch = 'Y', configId = null) {
    const bSize = (useBatch === 'Y') ? parseInt(batchSize, 10) || 1000 : null;
    const res = await queryPostgres(`
      SELECT mc_center.fn_post_target_dispatch($1::bigint, $2::int, $3::int, $4::text, $5::int) AS res
    `, [runId, targetConfigId, bSize, useBatch, configId]);
    return res.rows[0]?.res === 0;
  }

  /**
   * Guard Flow 3: Validasi apakah Run ID layak di-rollback
   */
  async validateRollbackTrigger(runId) {
    try {
      const res = await queryPostgres('SELECT mc_center.fn_validate_rollback_run($1::text) AS res', [String(runId)]);
      return { valid: true, configId: res.rows[0]?.res, error: null };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  /**
   * Rollback data target (Single-Record Lifecycle)
   */
  async rollbackAllTargets(runId, configId = null) {
    // Ambil configId dari migration_run jika null
    let cId = configId;
    if (!cId) {
      const r = await queryPostgres('SELECT config_id FROM mc_center.migration_run WHERE run_id = $1', [runId]);
      cId = r.rows[0]?.config_id ? parseInt(r.rows[0].config_id, 10) : 1;
    }
    const res = await queryPostgres('SELECT mc_center.fn_rollback_all_targets($1::bigint, $2::int) AS res', [runId, cId]);
    return res.rows[0]?.res === 0;
  }

  /**
   * Purge target data migrasi (Dual-guard protection migration='1')
   */
  async purgeTargetData(runId, configId, deleteIds = null) {
    const res = await queryPostgres(`
      SELECT mc_center.fn_purge_target_data($1::bigint, $2::int, NULLIF($3::text, '')) AS res
    `, [runId, configId, deleteIds || '']);
    return res.rows[0]?.res === 0;
  }

  /**
   * Selesaikan eksekusi run (Flow 1 / Flow 2)
   */
  async finishRun(runId, note = null, postType = null) {
    await queryPostgres(`
      CALL mc_center.pr_finish_run($1::bigint, $2::text, $3::text)
    `, [runId, note, postType]);
  }

  /**
   * Selesaikan eksekusi rollback (Flow 3)
   */
  async finishRollbackRun(runId) {
    await queryPostgres(`
      CALL mc_center.pr_finish_rollback_run($1::bigint, $1::bigint)
    `, [runId]);
  }

  /**
   * Ambil detail konfigurasi migrasi
   */
  async getConfigById(configId) {
    const res = await queryPostgres(`
      SELECT * FROM mc_center.migration_config WHERE config_id = $1
    `, [parseInt(configId, 10)]);
    return res.rows[0] || null;
  }

  /**
   * Ambil daftar target config untuk suatu config_id
   */
  async getTargetConfigs(configId) {
    const res = await queryPostgres(`
      SELECT * FROM mc_center.migration_target_config 
      WHERE config_id = $1 AND is_active = true
      ORDER BY exec_order ASC, target_config_id ASC
    `, [parseInt(configId, 10)]);
    return res.rows || [];
  }
}

module.exports = new DbDispatcherService();
