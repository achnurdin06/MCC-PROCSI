const crypto = require('crypto');

const DEFAULT_EXPIRATION_SECONDS = 8 * 60 * 60; // 8 jam
const PBKDF2_ITERATIONS = 210000;

// Secret dibaca saat dipakai agar dotenv sudah termuat; tanpa fallback hardcoded
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET wajib diisi minimal 32 karakter pada environment.');
  }
  return secret;
}

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

/**
 * Generate JSON Web Token
 */
function signToken(payload, expiresInSeconds = DEFAULT_EXPIRATION_SECONDS) {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const signature = crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify and decode JSON Web Token
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token tidak valid atau tidak disertakan.');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Format token JWT tidak valid.');
  }

  const [encodedHeader, encodedPayload, signature] = parts;

  try {
    const header = JSON.parse(base64UrlDecode(encodedHeader));
    if (header.alg !== 'HS256') throw new Error('alg');
  } catch (_) {
    throw new Error('Format token JWT tidak valid.');
  }

  const expectedSignature = crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Tanda tangan token tidak sah (signature invalid).');
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Sesi token telah kedaluwarsa. Silakan login kembali.');
  }

  return payload;
}

/**
 * Hash password with PBKDF2 (salt:hash format with backward-compatible format)
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = PBKDF2_ITERATIONS;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  return `pbkdf2:${iterations}:${salt}:${hash}`;
}

/**
 * Compare password with stored hash using timingSafeEqual
 */
function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;

  try {
    // New format: pbkdf2:<iterations>:<salt>:<hash>
    if (storedHash.startsWith('pbkdf2:')) {
      const parts = storedHash.split(':');
      if (parts.length !== 4) return false;
      const iterations = parseInt(parts[1], 10) || 10000;
      const salt = parts[2];
      const originalHash = parts[3];
      const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
      const bufA = Buffer.from(hash);
      const bufB = Buffer.from(originalHash);
      return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
    }

    // Legacy format: <salt>:<hash> (1000 iterations)
    if (storedHash.includes(':')) {
      const [salt, originalHash] = storedHash.split(':');
      const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
      const bufA = Buffer.from(hash);
      const bufB = Buffer.from(originalHash);
      return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
    }

    return false;
  } catch (_) {
    return false;
  }
}

module.exports = {
  getJwtSecret,
  signToken,
  verifyToken,
  hashPassword,
  verifyPassword,
};
