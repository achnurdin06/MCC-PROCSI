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

function parseContextId(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} harus berupa bilangan bulat positif.`);
  }

  return parsed;
}

async function validateSourceConnectionId(connectionId, envId = null, clientId = null) {
  const parsedConnectionId = parseContextId(connectionId, 'connection_id');
  const parsedEnvId = parseContextId(envId, 'env_id');
  const parsedClientId = parseContextId(clientId, 'client_id');
  const result = await queryPostgres(`
    SELECT c.connection_id
    FROM mc_center.master_connection c
    JOIN mc_center.master_environment e ON e.env_id = c.env_id
    WHERE c.connection_id = $1
      AND c.is_active = true
      AND UPPER(c.db_type) = 'MSSQL'
      AND UPPER(c.db_role) = 'SOURCE'
      AND ($2::int IS NULL OR c.env_id = $2)
      AND ($3::int IS NULL OR e.client_id = $3)
  `, [parsedConnectionId, parsedEnvId, parsedClientId]);
  if (!result.rows[0]) {
    throw new Error('Koneksi SOURCE tidak aktif atau tidak sesuai dengan client/environment yang dipilih.');
  }
  return result.rows[0].connection_id;
}

async function findSourceConnectionId(envId, clientId = null) {
  const parsedEnvId = parseContextId(envId, 'env_id');
  const parsedClientId = parseContextId(clientId, 'client_id');
  if (!parsedEnvId) return null;

  const result = await queryPostgres(`
    SELECT c.connection_id
    FROM mc_center.master_connection c
    JOIN mc_center.master_environment e ON e.env_id = c.env_id
    WHERE c.env_id = $1
      AND ($2::int IS NULL OR e.client_id = $2)
      AND c.is_active = true
      AND UPPER(c.db_type) = 'MSSQL'
      AND UPPER(c.db_role) = 'SOURCE'
    ORDER BY c.connection_id
  `, [parsedEnvId, parsedClientId]);
  if (result.rows.length > 1) {
    throw new Error('Environment memiliki lebih dari satu koneksi SOURCE SQL Server aktif; tetapkan satu koneksi aktif untuk proses ETL.');
  }
  if (parsedClientId && result.rows.length === 0) {
    throw new Error('Tidak ada koneksi SOURCE SQL Server aktif yang sesuai dengan client dan environment yang dipilih.');
  }
  return result.rows[0]?.connection_id || null;
}

async function resolveRequestSourceConnectionId(req) {
  const values = [req.params, req.query, req.body].filter((value) => value && typeof value === 'object');
  const envId = values
    .map((value) => value.env_id || value.envId)
    .find(Boolean);
  const clientId = values
    .map((value) => value.client_id || value.clientId)
    .find(Boolean);
  const explicitId = values
    .map((value) => value.connection_id || value.connectionId)
    .find(Boolean);
  if (explicitId) {
    return validateSourceConnectionId(explicitId, envId, clientId);
  }

  if (envId) return findSourceConnectionId(envId, clientId);

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
      if (runs.rows[0]?.env_id) return findSourceConnectionId(runs.rows[0].env_id, clientId);
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
    if (configs.rows[0]?.env_id) return findSourceConnectionId(configs.rows[0].env_id, clientId);
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
      if (configs.rows[0]?.env_id) return findSourceConnectionId(configs.rows[0].env_id, clientId);
    }
  }

  if (clientId) {
    throw new Error('env_id wajib dipilih untuk menentukan koneksi SOURCE milik client.');
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
