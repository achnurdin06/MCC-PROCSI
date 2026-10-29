const { verifyToken } = require('../utils/jwt');
const { queryPostgres } = require('../config/postgres');

/**
 * Autentikasi ketat:
 * - Query string `?token=` HANYA diizinkan untuk endpoint SSE stream (/api/flows/stream/...)
 *   karena EventSource browser standar tidak mendukung custom Authorization header.
 * - Endpoint lain WAJIB mengirim Authorization: Bearer <token>.
 * - Validasi status aktif pengguna ke database agar akun nonaktif/terhapus langsung terputus.
 */
async function requireAuth(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    const isStreamPath = req.baseUrl?.startsWith('/api/flows/stream') || req.path?.startsWith('/flows/stream') || req.originalUrl?.includes('/flows/stream/');
    if (!isStreamPath) {
      return res.status(401).json({
        success: false,
        error: 'Token via query string tidak diizinkan untuk endpoint ini. Gunakan header Authorization: Bearer <token>.',
      });
    }
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Akses ditolak. Token autentikasi tidak ditemukan. Silakan login terlebih dahulu.',
    });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;

    // Validasi DB: pastikan user masih aktif dan role terbaru sinkron
    if (payload.userId) {
      try {
        const uRes = await queryPostgres(
          `SELECT u.user_id, u.is_active, r.role_code
           FROM mc_center.sys_users u
           LEFT JOIN mc_center.sys_roles r ON u.role_id = r.role_id
           WHERE u.user_id = $1`,
          [payload.userId]
        );
        if (uRes.rows.length === 0 || !uRes.rows[0].is_active) {
          return res.status(401).json({
            success: false,
            error: 'Akun Anda telah dinonaktifkan atau dihapus. Silakan hubungi administrator.',
          });
        }
        if (uRes.rows[0].role_code) {
          req.user.roleCode = uRes.rows[0].role_code;
        }
      } catch (dbErr) {
        // Jika koneksi DB transient fail, izinkan lanjut dengan payload token
      }
    }

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: err.message || 'Sesi login tidak valid.',
    });
  }
}

function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Akses tidak terautentikasi.',
      });
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.roleCode)) {
      return res.status(403).json({
        success: false,
        error: `Akses ditolak. Peran '${req.user.roleCode}' tidak memiliki hak istimewa untuk aksi ini.`,
      });
    }

    next();
  };
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const payload = verifyToken(token);
      req.user = payload;
    } catch (e) {
      // Ignore token verification errors for optional auth
    }
  }
  next();
}

module.exports = {
  requireAuth,
  requireRole,
  optionalAuth,
};
