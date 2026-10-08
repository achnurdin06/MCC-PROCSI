const { Pool } = require('pg');
require('dotenv').config();

const config = {
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT, 10) || 5432,
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'postgres',
  connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT_MILLIS, 10) || 10000,
  max: 10,
  idleTimeoutMillis: 30000,
};

let pool = null;

function getPostgresPool() {
  if (!pool) {
    pool = new Pool(config);
    pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client:', err);
    });
  }
  return pool;
}

async function checkPostgresConnection() {
  const startTime = Date.now();
  try {
    const currentPool = getPostgresPool();
    const result = await currentPool.query('SELECT current_database() AS db_name, version() AS version');
    const latencyMs = Date.now() - startTime;
    return {
      connected: true,
      database: result.rows[0]?.db_name || config.database,
      host: `${config.host}:${config.port}`,
      latencyMs,
      version: result.rows[0]?.version?.split(' ')[0] + ' ' + (result.rows[0]?.version?.split(' ')[1] || ''),
    };
  } catch (err) {
    return {
      connected: false,
      database: config.database,
      host: `${config.host}:${config.port}`,
      latencyMs: Date.now() - startTime,
      error: err.message || err.code || 'Tidak dapat terhubung ke PostgreSQL (Connection refused)',
    };
  }
}

async function queryPostgres(text, params = []) {
  const currentPool = getPostgresPool();
  return await currentPool.query(text, params);
}

module.exports = {
  pgConfig: config,
  getPostgresPool,
  checkPostgresConnection,
  queryPostgres,
};
