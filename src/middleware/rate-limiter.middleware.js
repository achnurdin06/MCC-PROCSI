/**
 * Lightweight In-Memory Sliding Window Rate Limiter
 * Melindungi endpoint login dan eksekusi kritis dari serangan brute-force / DoS
 */

const clientRequests = new Map(); // ip => Array<timestamp>

function createRateLimiter({ windowMs = 60 * 1000, maxRequests = 15, message = 'Terlalu banyak permintaan. Silakan coba kembali dalam beberapa saat.' } = {}) {
  // Interval pembersihan memori setiap 5 menit
  setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of clientRequests.entries()) {
      const validTimestamps = timestamps.filter(ts => (now - ts) < windowMs);
      if (validTimestamps.length === 0) {
        clientRequests.delete(ip);
      } else {
        clientRequests.set(ip, validTimestamps);
      }
    }
  }, 5 * 60 * 1000).unref();

  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
    const now = Date.now();

    const timestamps = clientRequests.get(ip) || [];
    const validTimestamps = timestamps.filter(ts => (now - ts) < windowMs);

    if (validTimestamps.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: message,
        retryAfterSeconds: Math.ceil((windowMs - (now - validTimestamps[0])) / 1000)
      });
    }

    validTimestamps.push(now);
    clientRequests.set(ip, validTimestamps);
    next();
  };
}

module.exports = {
  createRateLimiter,
  loginRateLimiter: createRateLimiter({
    windowMs: 60 * 1000, // 1 menit
    maxRequests: 10,     // Maks 10 percobaan per menit
    message: 'Terlalu banyak percobaan login yang gagal. Silakan tunggu 1 menit sebelum mencoba kembali.'
  })
};
