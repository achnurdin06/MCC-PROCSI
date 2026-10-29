/**
 * Lightweight In-Memory Sliding Window Rate Limiter
 * Melindungi endpoint login dan eksekusi kritis dari serangan brute-force / DoS
 */

function getClientIp(req) {
  // Hanya gunakan req.ip yang sudah diproses Express (sesuai setting trust proxy)
  if (req.ip) return req.ip;
  if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return 'unknown-ip';
}

function createRateLimiter({
  windowMs = 60 * 1000,
  maxRequests = 15,
  message = 'Terlalu banyak permintaan. Silakan coba kembali dalam beberapa saat.',
  keyGenerator = (req) => getClientIp(req),
} = {}) {
  const clientRequests = new Map(); // key => Array<timestamp>

  // Interval pembersihan memori setiap 5 menit
  setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of clientRequests.entries()) {
      const validTimestamps = timestamps.filter(ts => (now - ts) < windowMs);
      if (validTimestamps.length === 0) {
        clientRequests.delete(key);
      } else {
        clientRequests.set(key, validTimestamps);
      }
    }
  }, 5 * 60 * 1000).unref();

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();

    const timestamps = clientRequests.get(key) || [];
    const validTimestamps = timestamps.filter(ts => (now - ts) < windowMs);

    if (validTimestamps.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: message,
        retryAfterSeconds: Math.ceil((windowMs - (now - validTimestamps[0])) / 1000)
      });
    }

    validTimestamps.push(now);
    clientRequests.set(key, validTimestamps);
    next();
  };
}

module.exports = {
  createRateLimiter,
  captchaRateLimiter: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: 'Terlalu banyak permintaan captcha. Silakan tunggu sebentar.'
  }),
  loginRateLimiter: createRateLimiter({
    windowMs: 60 * 1000, // 1 menit
    maxRequests: 10,     // Maks 10 percobaan per menit per kombinasi user/IP
    message: 'Terlalu banyak percobaan login yang gagal. Silakan tunggu 1 menit sebelum mencoba kembali.',
    keyGenerator: (req) => {
      const ip = getClientIp(req);
      const user = (req.body && typeof req.body.username === 'string') ? req.body.username.trim().toLowerCase() : '';
      return user ? `login:${ip}:${user}` : `login:${ip}`;
    },
  })
};
