const crypto = require('crypto');

/**
 * Enterprise AES-256-GCM Encryption Service
 * Menyediakan enkripsi simetris terotentikasi (Authenticated Encryption with Associated Data)
 * Format Ciphertext: ENC:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes / 96 bits disarankan NIST untuk GCM
const TAG_LENGTH = 16; // 16 bytes / 128 bits auth tag

function getMasterKey() {
  const rawKey = process.env.ENCRYPTION_MASTER_KEY || process.env.JWT_SECRET || 'mig-antam-default-master-key-32b';
  // Selalu pastikan buffer key tepat 32 bytes (256 bits) menggunakan SHA-256
  return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Enkripsi data plaintext menjadi ciphertext berformat aman
 * @param {string|number} value - Nilai yang ingin dienkripsi
 * @returns {string|null} Ciphertext berformat ENC:v1:... atau null jika input kosong
 */
function encrypt(value) {
  if (value === null || value === undefined) return null;
  const str = String(value);
  if (str.trim() === '') return '';
  if (str.startsWith('ENC:v1:')) return str; // Hindari re-enkripsi ganda

  try {
    const key = getMasterKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(str, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `ENC:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (err) {
    console.error('[ENCRYPTION_ERROR] Gagal mengenkripsi data:', err.message);
    throw new Error('Gagal mengenkripsi data sensitif.');
  }
}

/**
 * Dekripsi ciphertext menjadi plaintext asli
 * @param {string} cipherText - Ciphertext dengan format ENC:v1:...
 * @returns {string} Plaintext asli atau nilai awal jika bukan format ENC:v1:
 */
function decrypt(cipherText) {
  if (!cipherText || typeof cipherText !== 'string') return cipherText;
  if (!cipherText.startsWith('ENC:v1:')) return cipherText; // Graceful fallback jika data belum dienkripsi

  try {
    const parts = cipherText.split(':');
    if (parts.length !== 5) {
      console.warn('[DECRYPTION_WARN] Format ciphertext ENC tidak valid.');
      return cipherText;
    }

    const iv = Buffer.from(parts[2], 'hex');
    const authTag = Buffer.from(parts[3], 'hex');
    const encryptedHex = parts[4];

    const key = getMasterKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('[DECRYPTION_ERROR] Gagal mendekripsi data (kemungkinan key berbeda atau data rusak):', err.message);
    // Kembalikan placeholder jika dekripsi gagal agar tidak menyebabkan hard crash
    return '[ENCRYPTED_DATA_CANNOT_DECRYPT]';
  }
}

/**
 * Cek apakah string merupakan data terenkripsi
 */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith('ENC:v1:');
}

/**
 * Masking nilai sensitif untuk tampilan UI / API (misal password)
 */
function maskCredential(value) {
  if (!value) return '';
  return '••••••••';
}

/**
 * Daftar kolom sensitif per tabel staging yang wajib dienkripsi
 */
const SENSITIVE_STAGING_COLUMNS = {
  stg_user_src: ['password', 'nik', 'current_token'],
  stg_bank_src: ['nomor_rekening', 'swift_number'],
  stg_vendors_src: ['no_ktp_pic'],
};

/**
 * Cek apakah sebuah kolom staging harus dienkripsi
 */
function isSensitiveStagingColumn(stgTable, colName) {
  if (process.env.ENABLE_STAGING_ENCRYPTION === 'false') return false;
  if (!stgTable || !colName) return false;
  const cleanTable = String(stgTable).toLowerCase().trim();
  const actualTable = cleanTable.endsWith('_src') ? cleanTable : `${cleanTable}_src`;
  const cleanCol = String(colName).toLowerCase().trim();
  const cols = SENSITIVE_STAGING_COLUMNS[actualTable] || [];
  return cols.includes(cleanCol);
}

module.exports = {
  encrypt,
  decrypt,
  isEncrypted,
  maskCredential,
  SENSITIVE_STAGING_COLUMNS,
  isSensitiveStagingColumn,
};
