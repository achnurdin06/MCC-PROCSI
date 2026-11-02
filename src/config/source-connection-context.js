const { AsyncLocalStorage } = require('async_hooks');
const { queryPostgres } = require('./postgres');

const sourceConnectionContext = new AsyncLocalStorage();

function runWithSourceConnection(connectionId, callback) {
  return sourceConnectionContext.run(
    { connectionId: connectionId ? parseInt(connectionId, 10) : null },
    callback
  );
}

function getCurrentSourceConnectionId() {
  return sourceConnectionContext.getStore()?.connectionId || null;
}

function sourceConnectionMiddleware(req, res, next) {
  resolveRequestSourceConnectionId(req)
    .then((connectionId) => runWithSourceConnection(connectionId, next))
    .catch(next);
}

async function findSourceConnectionId(envId) {
  if (!envId) return null;
  const parsedEnvId = parseInt(envId, 10);
  if (!Number.isInteger(parsedEnvId) || parsedEnvId < 1) {
    throw new Error('env_id harus berupa bilangan bulat positif.');
  }
  const result = await queryPostgres(`
    SELECT connection_id
    FROM mc_center.master_connection
    WHERE env_id = $1
      AND is_active = true
      AND UPPER(db_type) = 'MSSQL'
      AND UPPER(db_role) = 'SOURCE'
    ORDER BY connection_id
  `, [parsedEnvId]);
  if (result.rows.length > 1) {
    throw new Error('Environment memiliki lebih dari satu koneksi SOURCE SQL Server aktif; tetapkan satu koneksi aktif untuk proses ETL.');
  }
  return result.rows[0]?.connection_id || null;
}

async function resolveRequestSourceConnectionId(req) {
  const values = [req.params, req.query, req.body].filter((value) => value && typeof value === 'object');
  const explicitId = values
    .map((value) => value.connection_id || value.connectionId)
    .find(Boolean);
  if (explicitId) {
    const parsedId = parseInt(explicitId, 10);
    if (!Number.isInteger(parsedId) || parsedId < 1) {
      throw new Error('connection_id harus berupa bilangan bulat positif.');
    }
    return parsedId;
  }

  const envId = values
    .map((value) => value.env_id || value.envId)
    .find(Boolean);
  if (envId) return findSourceConnectionId(envId);

  const runValue = values
    .map((value) => value.runIds || value.run_ids || value.runId || value.run_id)
    .find(Boolean);
  if (runValue) {
    const runIds = (Array.isArray(runValue) ? runValue : String(runValue).split(','))
      .map((id) => parseInt(id, 10))
      .filter(Number.isInteger);
    if (runIds.length > 0) {
      const runs = await queryPostgres(`
        SELECT DISTINCT env_id
        FROM mc_center.migration_run
        WHERE run_id = ANY($1::bigint[])
          AND env_id IS NOT NULL
      `, [runIds]);
      if (runs.rows.length > 1) {
        throw new Error('Run yang dipilih berasal dari beberapa environment. Jalankan satu environment dalam satu flow.');
      }
      if (runs.rows[0]?.env_id) return findSourceConnectionId(runs.rows[0].env_id);
    }
  }

  const configValue = values
    .map((value) => value.configIds || value.config_ids || value.configId || value.config_id)
    .find(Boolean);
  if (typeof configValue === 'string' && configValue.trim().toUpperCase() === 'ALL') {
    const clientId = values.map((value) => value.clientId || value.client_id).find(Boolean);
    const params = [];
    let clientFilter = '';
    if (clientId) {
      params.push(parseInt(clientId, 10));
      clientFilter = 'AND (client_id = $1 OR client_id IS NULL)';
    }
    const configs = await queryPostgres(`
      SELECT DISTINCT env_id
      FROM mc_center.migration_config
      WHERE is_active = true
        AND env_id IS NOT NULL
        ${clientFilter}
    `, params);
    if (configs.rows.length > 1) {
      throw new Error('Pilih satu environment sebelum menjalankan seluruh konfigurasi.');
    }
    if (configs.rows[0]?.env_id) return findSourceConnectionId(configs.rows[0].env_id);
  }
  if (configValue) {
    const configIds = (Array.isArray(configValue) ? configValue : String(configValue).split(','))
      .map((id) => parseInt(id, 10))
      .filter(Number.isInteger);
    if (configIds.length > 0) {
      const configs = await queryPostgres(`
        SELECT DISTINCT env_id
        FROM mc_center.migration_config
        WHERE config_id = ANY($1::int[])
          AND env_id IS NOT NULL
      `, [configIds]);
      if (configs.rows.length > 1) {
        throw new Error('Konfigurasi yang dipilih berasal dari beberapa environment. Jalankan satu environment dalam satu flow.');
      }
      if (configs.rows[0]?.env_id) return findSourceConnectionId(configs.rows[0].env_id);
    }
  }

  return null;
}

module.exports = {
  runWithSourceConnection,
  getCurrentSourceConnectionId,
  findSourceConnectionId,
  resolveRequestSourceConnectionId,
  sourceConnectionMiddleware,
};
