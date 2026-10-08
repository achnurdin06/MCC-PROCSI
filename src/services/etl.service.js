const { queryPostgres } = require('../config/postgres');

class EtlService {
  /**
   * Mengambil seluruh Master Config dari schema etl_antam
   */
  async getMasterConfigs() {
    const [configsRes, rulesRes, lookupRes, targetConfigsRes] = await Promise.all([
      queryPostgres(`SELECT * FROM etl_antam.migration_config ORDER BY exec_order, config_id`),
      queryPostgres(`SELECT * FROM etl_antam.migration_convert_rule ORDER BY config_id, rule_id`),
      queryPostgres(`SELECT * FROM etl_antam.migration_lookup ORDER BY lookup_name`),
      queryPostgres(`SELECT * FROM etl_antam.migration_target_config ORDER BY exec_order, target_config_id`),
    ]);

    return {
      migration_config: configsRes.rows,
      migration_convert_rule: rulesRes.rows,
      migration_lookup: lookupRes.rows,
      migration_target_config: targetConfigsRes.rows,
      totals: {
        configs: configsRes.rows.length,
        rules: rulesRes.rows.length,
        lookups: lookupRes.rows.length,
        targetConfigs: targetConfigsRes.rows.length,
      },
    };
  }

  /**
   * Ringkasan metrik eksekusi ETL
   */
  async getEtlOverview() {
    const [runsSummary, errorsCount, latestRun] = await Promise.all([
      queryPostgres(`
        SELECT 
          COUNT(*) AS total_runs,
          COUNT(*) FILTER (WHERE UPPER(status) IN ('SUCCESS', 'COMPLETED', 'OK')) AS success_runs,
          COUNT(*) FILTER (WHERE UPPER(status) IN ('FAILED', 'ERROR')) AS failed_runs,
          COUNT(*) FILTER (WHERE UPPER(status) IN ('RUNNING', 'STARTED')) AS running_runs
        FROM etl_antam.migration_run
      `),
      queryPostgres(`SELECT COUNT(*) AS total_errors FROM etl_antam.migration_error_log`),
      queryPostgres(`SELECT * FROM etl_antam.migration_run ORDER BY run_id DESC LIMIT 1`),
    ]);

    return {
      totalRuns: parseInt(runsSummary.rows[0]?.total_runs, 10) || 0,
      successRuns: parseInt(runsSummary.rows[0]?.success_runs, 10) || 0,
      failedRuns: parseInt(runsSummary.rows[0]?.failed_runs, 10) || 0,
      runningRuns: parseInt(runsSummary.rows[0]?.running_runs, 10) || 0,
      totalErrors: parseInt(errorsCount.rows[0]?.total_errors, 10) || 0,
      latestRun: latestRun.rows[0] || null,
    };
  }

  /**
   * Mengambil riwayat eksekusi migrasi (migration_run)
   */
  async getMigrationRuns(options = {}) {
    const { limit = 50, page = 1, status } = options;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const offset = (pageNum - 1) * limitNum;

    let whereClause = '';
    const params = [];

    if (status) {
      params.push(status.toUpperCase());
      whereClause = `WHERE UPPER(status) = $${params.length}`;
    }

    const countRes = await queryPostgres(
      `SELECT COUNT(*) AS total FROM etl_antam.migration_run ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.total, 10) || 0;

    params.push(limitNum);
    params.push(offset);

    const runsRes = await queryPostgres(
      `
      SELECT 
        run_id,
        run_ts,
        start_time,
        end_time,
        status,
        hop_host,
        note,
        main_workflow,
        config_id,
        is_posted,
        posted_at,
        post_type,
        is_rolled_back,
        rolled_back_at,
        ROUND(EXTRACT(EPOCH FROM (end_time - start_time))::numeric, 2) AS duration_seconds
      FROM etl_antam.migration_run
      ${whereClause}
      ORDER BY run_id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
      params
    );

    return {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      runs: runsRes.rows,
    };
  }

  /**
   * Mengambil riwayat eksekusi migration_run untuk config tertentu
   */
  async getRunsByConfig(configId, limit = 10) {
    const idStr = String(configId);
    const runsRes = await queryPostgres(
      `
      SELECT 
        run_id,
        run_ts,
        start_time,
        end_time,
        status,
        hop_host,
        note,
        main_workflow,
        config_id,
        is_posted,
        posted_at,
        post_type,
        is_rolled_back,
        rolled_back_at,
        ROUND(EXTRACT(EPOCH FROM (end_time - start_time))::numeric, 2) AS duration_seconds
      FROM etl_antam.migration_run
      WHERE config_id = $1 OR config_id LIKE $2
      ORDER BY run_id DESC
      LIMIT $3
    `,
      [idStr, `%${idStr}%`, limit]
    );
    return runsRes.rows;
  }

  /**
   * Mengambil log langkah migrasi (migration_step_log)
   */
  async getStepLogs(options = {}) {
    const { runId, limit = 100 } = options;
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));

    let query = `
      SELECT 
        log_id,
        run_id,
        config_id,
        step_name,
        status,
        rows_src,
        rows_stg,
        rows_new,
        rows_changed,
        rows_deleted,
        start_time,
        end_time,
        message,
        ROUND(EXTRACT(EPOCH FROM (end_time - start_time))::numeric, 2) AS duration_seconds
      FROM etl_antam.migration_step_log
    `;
    const params = [];

    if (runId) {
      params.push(parseInt(runId, 10));
      query += ` WHERE run_id = $1`;
    }

    query += ` ORDER BY log_id DESC LIMIT $${params.length + 1}`;
    params.push(limitNum);

    const res = await queryPostgres(query, params);
    return res.rows;
  }

  /**
   * Mengambil log error migrasi (migration_error_log)
   */
  async getErrorLogs(options = {}) {
    const { runId, limit = 100 } = options;
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));

    let query = `
      SELECT 
        error_id,
        run_id,
        config_id,
        step_name,
        pipeline_name,
        transform_name,
        error_time,
        error_code,
        error_message,
        error_detail,
        error_field,
        row_data
      FROM etl_antam.migration_error_log
    `;
    const params = [];

    if (runId) {
      params.push(parseInt(runId, 10));
      query += ` WHERE run_id = $1`;
    }

    query += ` ORDER BY error_id DESC LIMIT $${params.length + 1}`;
    params.push(limitNum);

    const res = await queryPostgres(query, params);
    return res.rows;
  }
}

module.exports = new EtlService();
