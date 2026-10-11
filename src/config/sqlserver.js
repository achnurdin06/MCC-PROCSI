const sql = require('mssql');
const { ensureTunnel } = require('./tunnel');
require('dotenv').config();

function getEffectiveConfig() {
  const useTunnel = process.env.MSSQL_USE_SSH_TUNNEL === 'true';
  const targetServer = useTunnel ? '127.0.0.1' : (process.env.MSSQL_SERVER || 'localhost');
  const targetPort = useTunnel
    ? (parseInt(process.env.LOCAL_TUNNEL_PORT, 10) || 11433)
    : (parseInt(process.env.MSSQL_PORT, 10) || 1433);

  return {
    server: targetServer,
    port: targetPort,
    user: process.env.MSSQL_USER || 'sa',
    password: process.env.MSSQL_PASSWORD || '',
    database: process.env.MSSQL_DATABASE || 'master',
    options: {
      encrypt: process.env.MSSQL_ENCRYPT === 'true',
      trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false',
      enableArithAbort: true,
    },
    connectionTimeout: parseInt(process.env.MSSQL_CONNECTION_TIMEOUT, 10) || 15000,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
}

let pool = null;

async function getSqlServerPool() {
  if (pool && pool.connected) {
    return pool;
  }

  try {
    // Pastikan SSH tunnel aktif jika diaktifkan
    if (process.env.MSSQL_USE_SSH_TUNNEL === 'true') {
      await ensureTunnel();
    }

    if (pool) {
      await pool.close();
    }

    const config = getEffectiveConfig();
    pool = await new sql.ConnectionPool(config).connect();
    return pool;
  } catch (err) {
    pool = null;
    throw err;
  }
}

async function checkSqlServerConnection() {
  const startTime = Date.now();
  const rawHost = `${process.env.MSSQL_SERVER || 'localhost'}:${process.env.MSSQL_PORT || 1433}`;
  try {
    const currentPool = await getSqlServerPool();
    const result = await currentPool.request().query('SELECT DB_NAME() AS db_name, @@VERSION AS version');
    const latencyMs = Date.now() - startTime;
    return {
      connected: true,
      database: result.recordset[0]?.db_name || process.env.MSSQL_DATABASE,
      host: `${rawHost} (via SSH)`,
      latencyMs,
      version: result.recordset[0]?.version?.split('\n')[0] || 'SQL Server',
    };
  } catch (err) {
    if (pool) {
      try { await pool.close(); } catch (e) {}
      pool = null;
    }
    if (process.env.MSSQL_USE_SSH_TUNNEL === 'true') {
      const { closeTunnel } = require('./tunnel');
      closeTunnel().catch(() => {});
    }
    return {
      connected: false,
      database: process.env.MSSQL_DATABASE,
      host: rawHost,
      latencyMs: Date.now() - startTime,
      error: err.message || 'Gagal terhubung ke SQL Server',
    };
  }
}

async function querySqlServer(queryString, inputs = {}) {
  const currentPool = await getSqlServerPool();
  const request = currentPool.request();
  
  for (const [key, value] of Object.entries(inputs)) {
    request.input(key, value);
  }

  return await request.query(queryString);
}

module.exports = {
  sql,
  getEffectiveConfig,
  getSqlServerPool,
  checkSqlServerConnection,
  querySqlServer,
};
