const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Dynamic Environment Loader (DEV vs PROD)
const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
const envFileName = nodeEnv === 'production' ? '.env.production' : '.env.development';
const envFilePath = path.resolve(process.cwd(), envFileName);

if (fs.existsSync(envFilePath)) {
  require('dotenv').config({ path: envFilePath });
} else {
  require('dotenv').config();
}

const apiRoutes = require('./routes/api');
const { getPostgresPool } = require('./config/postgres');
const { getSqlServerPool } = require('./config/sqlserver');
const { closeTunnel } = require('./config/tunnel');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sajikan Frontend Dashboard statis dari direktori public (tanpa cache browser lokal)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  },
}));

// API Routes with strict no-cache headers
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
}, apiRoutes);

// Fallback route untuk Single Page Application (kompatibel Express 5)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});

// Start server
const server = app.listen(PORT, () => {
  const currentEnv = (process.env.APP_ENV || (nodeEnv === 'production' ? 'PROD' : 'DEV')).toUpperCase();
  console.log(`=======================================================`);
  console.log(`🚀 Migration Command Center [${currentEnv}] Mode berjalan!`);
  console.log(`👉 Akses Dashboard: http://localhost:${PORT}`);
  console.log(`👉 API Health Check: http://localhost:${PORT}/api/health`);
  console.log(`⚙️  Database Aplikasi: ${process.env.APP_DB_NAME || process.env.PG_DATABASE || 'db_procsi'} (skema ${process.env.APP_DB_SCHEMA || 'mc_center'})`);
  console.log(`=======================================================`);
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\nMenerima ${signal}. Menutup server dan koneksi database...`);
  server.close(async () => {
    try {
      const pg = getPostgresPool();
      await pg.end();
      console.log('✓ PostgreSQL pool ditutup.');
    } catch (e) {
      // ignore
    }

    try {
      const sqlPool = await getSqlServerPool();
      await sqlPool.close();
      console.log('✓ SQL Server pool ditutup.');
    } catch (e) {
      // ignore
    }

    try {
      await closeTunnel();
    } catch (e) {
      // ignore
    }

    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = app;
