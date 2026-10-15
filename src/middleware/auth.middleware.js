const { verifyToken } = require('../utils/jwt');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Akses ditolak. Token autentikasi tidak ditemukan. Silakan login terlebih dahulu.',
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = verifyToken(token);
    req.user = payload;
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
