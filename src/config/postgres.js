const { Pool } = require('pg');
require('dotenv').config();

const config = {
  host: process.env.APP_DB_HOST || process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.APP_DB_PORT || process.env.PG_PORT, 10) || 5432,
  user: process.env.APP_DB_USER || process.env.PG_USER || 'postgres',
  password: process.env.APP_DB_PASSWORD || process.env.PG_PASSWORD || '',
  database: process.env.APP_DB_NAME || process.env.PG_DATABASE || 'postgres',
  connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT_MILLIS, 10) || 10000,
  max: parseInt(process.env.APP_DB_MAX_POOL, 10) || 10,
  idleTimeoutMillis: 30000,
};

const DB_CONTROL_SCHEMA = process.env.APP_DB_SCHEMA || 'mc_center';

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
  DB_CONTROL_SCHEMA,
  getPostgresPool,
  checkPostgresConnection,
  queryPostgres,
};
