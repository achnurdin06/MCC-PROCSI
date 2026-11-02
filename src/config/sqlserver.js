const crypto = require('crypto');
const sql = require('mssql');
const { queryPostgres } = require('./postgres');
const { getCurrentSourceConnectionId } = require('./source-connection-context');
const { ensureTunnel, closeTunnel, isTunnelActive } = require('./tunnel');
const { decrypt } = require('../utils/encryption');
require('./env');

const pools = new Map();
const pendingPools = new Map();

async function loadSourceConnection(connectionId) {
  const id = connectionId || getCurrentSourceConnectionId();
  if (!id) {
    throw new Error('Koneksi SQL Server belum dipilih. Pilih environment dan atur koneksi SOURCE di Master Connection.');
  }

  const result = await queryPostgres(`
    SELECT connection_id, db_type, db_role, host, port, database_name,
           username, password, use_ssh_tunnel, ssh_host, ssh_port,
           ssh_user, ssh_password
    FROM mc_center.master_connection
    WHERE connection_id = $1 AND is_active = true
  `, [parseInt(id, 10)]);
  const connection = result.rows[0];
  if (!connection) {
    throw new Error(`Koneksi SOURCE aktif dengan ID ${id} tidak ditemukan di Master Connection.`);
  }
  if (String(connection.db_type).toUpperCase() !== 'MSSQL'
    || String(connection.db_role).toUpperCase() !== 'SOURCE') {
    throw new Error(`Koneksi ${id} bukan koneksi SOURCE SQL Server.`);
  }
  if (connection.password) connection.password = decrypt(connection.password);
  if (connection.ssh_password) connection.ssh_password = decrypt(connection.ssh_password);
  if (!connection.host || !connection.database_name || !connection.username || !connection.password) {
    throw new Error(`Konfigurasi koneksi SOURCE ${id} belum lengkap.`);
  }
  return connection;
}

function createPoolConfig(connection, localPort = null) {
  return {
    server: connection.use_ssh_tunnel ? '127.0.0.1' : connection.host,
    port: connection.use_ssh_tunnel ? localPort : (parseInt(connection.port, 10) || 1433),
    user: connection.username,
    password: connection.password,
    database: connection.database_name,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    connectionTimeout: 15000,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
}

function poolFingerprint(connection) {
  const configSnapshot = JSON.stringify({
    host: connection.host,
    port: connection.port,
    database_name: connection.database_name,
    username: connection.username,
    password: connection.password,
    use_ssh_tunnel: connection.use_ssh_tunnel,
    ssh_host: connection.ssh_host,
    ssh_port: connection.ssh_port,
    ssh_user: connection.ssh_user,
    ssh_password: connection.ssh_password,
  });
  return crypto.createHash('sha256').update(configSnapshot).digest('hex');
}

async function closePoolEntry(connectionId) {
  const entry = pools.get(String(connectionId));
  if (!entry) {
    await closeTunnel(connectionId);
    return;
  }
  pools.delete(String(connectionId));
  try {
    await entry.pool.close();
  } finally {
    await closeTunnel(connectionId);
  }
}

async function getSqlServerPool(connectionId = null) {
  const connection = await loadSourceConnection(connectionId);
  const id = String(connection.connection_id);
  const fingerprint = poolFingerprint(connection);
  const existing = pools.get(id);
  if (existing?.fingerprint === fingerprint
    && existing.pool.connected
    && (!connection.use_ssh_tunnel || isTunnelActive(id))) {
    return existing.pool;
  }

  if (pendingPools.has(id)) return pendingPools.get(id);

  const pending = (async () => {
    await closePoolEntry(id);
    const localPort = connection.use_ssh_tunnel
      ? await ensureTunnel(connection, id)
      : null;
    let pool;
    try {
      pool = await new sql.ConnectionPool(createPoolConfig(connection, localPort)).connect();
    } catch (err) {
      await closeTunnel(id);
      throw err;
    }
    pools.set(id, { pool, fingerprint });
    pool.on('error', (err) => {
      console.error(`Unexpected error on SQL Server connection ${id}:`, err);
      if (pools.get(id)?.pool === pool) {
        pools.delete(id);
        closeTunnel(id).catch((tunnelErr) => {
          console.warn(`Gagal menutup SSH tunnel koneksi ${id}:`, tunnelErr.message);
        });
      }
    });
    return pool;
  })().finally(() => pendingPools.delete(id));

  pendingPools.set(id, pending);
  return pending;
}

async function checkSqlServerConnection(connectionId = null) {
  const startedAt = Date.now();
  try {
    const connection = await loadSourceConnection(connectionId);
    const pool = await getSqlServerPool(connection.connection_id);
    const result = await pool.request().query('SELECT DB_NAME() AS db_name, @@VERSION AS version');
    const versionParts = (result.recordset[0]?.version || '').split('\n')[0].split(' ');
    return {
      connected: true,
      database: result.recordset[0]?.db_name || connection.database_name,
      host: `${connection.host}:${connection.port}`,
      latencyMs: Date.now() - startedAt,
      version: `${versionParts[0] || 'SQL'} ${versionParts[1] || 'Server'}`,
    };
  } catch (err) {
    return {
      connected: false,
      database: null,
      host: null,
      latencyMs: Date.now() - startedAt,
      error: err.message || 'Gagal terhubung ke SQL Server.',
    };
  }
}

async function testSqlServerConnection(connection) {
  const startedAt = Date.now();
  const testKey = `test-${Date.now()}-${Math.random()}`;
  let pool;
  try {
    const config = {
      ...connection,
      connection_id: testKey,
      db_type: 'MSSQL',
      db_role: 'SOURCE',
      port: parseInt(connection.port, 10) || 1433,
      ssh_port: parseInt(connection.ssh_port, 10) || 22,
      use_ssh_tunnel: Boolean(connection.use_ssh_tunnel),
    };
    const localPort = config.use_ssh_tunnel ? await ensureTunnel(config, testKey) : null;
    pool = await new sql.ConnectionPool(createPoolConfig(config, localPort)).connect();
    const result = await pool.request().query('SELECT @@VERSION AS version');
    return {
      success: true,
      latencyMs: Date.now() - startedAt,
      message: 'Koneksi ke SQL Server berhasil.',
      version: result.recordset[0]?.version?.split('\n')[0],
    };
  } catch (err) {
    return {
      success: false,
      latencyMs: Date.now() - startedAt,
      error: err.message || 'Gagal terhubung ke SQL Server.',
    };
  } finally {
    if (pool) await pool.close();
    if (connection.use_ssh_tunnel) await closeTunnel(testKey);
  }
}

async function querySqlServer(queryString, inputs = {}, connectionId = null) {
  const pool = await getSqlServerPool(connectionId);
  const request = pool.request();
  for (const [key, value] of Object.entries(inputs || {})) {
    request.input(key, value);
  }
  return request.query(queryString);
}

async function streamSqlServerRows(queryString, batchSize, onBatch, connectionId = null) {
  const pool = await getSqlServerPool(connectionId);
  const request = pool.request();
  request.stream = true;

  return new Promise((resolve, reject) => {
    let buffer = [];
    let chain = Promise.resolve();
    let failed = false;

    const fail = (err) => {
      if (failed) return;
      failed = true;
      buffer = [];
      try { request.cancel(); } catch (_) {}
      reject(err);
    };

    const enqueue = (batch) => {
      chain = chain
        .then(() => (failed ? null : onBatch(batch)))
        .then(() => { if (!failed) request.resume(); })
        .catch(fail);
    };

    request.on('row', (row) => {
      if (failed) return;
      buffer.push(row);
      if (buffer.length >= batchSize) {
        const batch = buffer;
        buffer = [];
        request.pause();
        enqueue(batch);
      }
    });
    request.on('error', fail);
    request.on('done', () => {
      chain.then(async () => {
        if (failed) return;
        if (buffer.length > 0) await onBatch(buffer);
        resolve();
      }).catch(fail);
    });
    request.query(queryString);
  });
}

async function closeAllSqlServerPools() {
  const pendingResults = await Promise.allSettled([...pendingPools.values()]);
  pendingResults
    .filter((result) => result.status === 'rejected')
    .forEach((result) => console.warn('SQL Server pool gagal tersambung sebelum shutdown:', result.reason.message));
  await Promise.all([...pools.keys()].map((id) => closePoolEntry(id)));
}

module.exports = {
  sql,
  loadSourceConnection,
  testSqlServerConnection,
  streamSqlServerRows,
  getSqlServerPool,
  checkSqlServerConnection,
  querySqlServer,
  closeAllSqlServerPools,
};
