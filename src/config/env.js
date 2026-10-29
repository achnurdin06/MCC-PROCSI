const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/**
 * Mendeteksi nama branch Git yang sedang aktif (jika ada folder .git)
 */
function detectGitBranch(rootDir) {
  try {
    const headPath = path.join(rootDir, '.git', 'HEAD');
    if (!fs.existsSync(headPath)) return null;

    const headContent = fs.readFileSync(headPath, 'utf8').trim();
    if (headContent.startsWith('ref: refs/heads/')) {
      return headContent.replace('ref: refs/heads/', '').trim();
    }
    return headContent.substring(0, 8); // Detached HEAD hash
  } catch (_) {
    return null;
  }
}

/**
 * Inisialisasi Environment Loader Dinamis:
 * - Branch `main` / `master` / `workstation-main` otomatis memuat `.env.production`
 * - Local / branch `dev` otomatis memuat `.env.development`
 * - Parameter `NODE_ENV` eksplisit (misal: npm run start:prod) tetap memiliki prioritas tertinggi
 */
function loadEnvironment() {
  const rootDir = path.resolve(__dirname, '../../');
  const detectedBranch = process.env.GIT_BRANCH || detectGitBranch(rootDir);

  // 1. Tentukan target mode (production vs development)
  let targetMode = null;
  const explicitNodeEnv = (process.env.NODE_ENV || '').trim().toLowerCase();

  if (explicitNodeEnv === 'production' || explicitNodeEnv === 'prod') {
    targetMode = 'production';
  } else if (explicitNodeEnv === 'development' || explicitNodeEnv === 'dev') {
    targetMode = 'development';
  } else if (detectedBranch) {
    // Penentuan otomatis berdasarkan branch git
    const isMainBranch = ['main', 'master', 'workstation-main', 'production'].includes(detectedBranch.toLowerCase());
    targetMode = isMainBranch ? 'production' : 'development';
  } else {
    // Default fallback lokal
    targetMode = 'development';
  }

  // 2. Tentukan nama file env target
  const targetFileName = targetMode === 'production' ? '.env.production' : '.env.development';
  const targetFilePath = path.join(rootDir, targetFileName);
  const fallbackFilePath = path.join(rootDir, '.env');

  let loadedFile = null;

  // Muat file env target jika ada
  if (fs.existsSync(targetFilePath)) {
    dotenv.config({ path: targetFilePath });
    loadedFile = targetFileName;
  }

  // Muat .env umum sebagai cadangan (nilai yang sudah ada dari file target tidak akan ditimpa)
  if (fs.existsSync(fallbackFilePath)) {
    dotenv.config({ path: fallbackFilePath });
    if (!loadedFile) loadedFile = '.env';
  }

  // Pastikan variabel runtime terisi konsisten
  process.env.NODE_ENV = targetMode;
  if (!process.env.APP_ENV) {
    process.env.APP_ENV = targetMode === 'production' ? 'PROD' : 'DEV';
  }

  return {
    nodeEnv: targetMode,
    appEnv: process.env.APP_ENV,
    gitBranch: detectedBranch || 'unknown',
    loadedEnvFile: loadedFile || 'system-env',
    isProduction: targetMode === 'production',
    isDevelopment: targetMode === 'development',
  };
}

// Jalankan otomatis saat modul pertama kali di-require
const envInfo = loadEnvironment();

module.exports = envInfo;
