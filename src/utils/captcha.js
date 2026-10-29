const crypto = require('crypto');

const TTL_MS = 2 * 60 * 1000;
const MAX_STORE = 5000;
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const store = new Map(); // captchaId => { answer, expiresAt }

function purgeExpired() {
  const now = Date.now();
  for (const [id, item] of store.entries()) {
    if (item.expiresAt <= now) store.delete(id);
  }
}
setInterval(purgeExpired, 60 * 1000).unref();

function rand(min, max) {
  return min + crypto.randomInt(0, Math.floor((max - min) * 100) + 1) / 100;
}

function buildSvg(text) {
  const width = 160;
  const height = 52;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="100%" height="100%" fill="#f1f5f9"/>`;
  for (let i = 0; i < 6; i++) {
    svg += `<path d="M${rand(0, width)} ${rand(0, height)} Q${rand(0, width)} ${rand(0, height)} ${rand(0, width)} ${rand(0, height)}" stroke="hsl(${crypto.randomInt(0, 360)},45%,55%)" stroke-width="1.4" fill="none"/>`;
  }
  const step = width / (text.length + 1);
  [...text].forEach((ch, i) => {
    const x = step * (i + 1) - 8;
    const y = rand(32, 42);
    const rot = rand(-22, 22);
    svg += `<text x="${x}" y="${y}" font-family="Verdana,Arial,sans-serif" font-size="${crypto.randomInt(26, 32)}" font-weight="700" fill="hsl(${crypto.randomInt(190, 260)},60%,28%)" transform="rotate(${rot} ${x} ${y})">${ch}</text>`;
  });
  for (let i = 0; i < 24; i++) {
    svg += `<circle cx="${rand(0, width)}" cy="${rand(0, height)}" r="${rand(0.6, 1.4)}" fill="#64748b" opacity="0.6"/>`;
  }
  return svg + '</svg>';
}

function createCaptcha() {
  if (store.size >= MAX_STORE) purgeExpired();
  if (store.size >= MAX_STORE) store.delete(store.keys().next().value);

  let text = '';
  for (let i = 0; i < 5; i++) text += CHARSET[crypto.randomInt(0, CHARSET.length)];

  const id = crypto.randomBytes(16).toString('hex');
  store.set(id, { answer: text, expiresAt: Date.now() + TTL_MS });
  return { captchaId: id, svg: buildSvg(text), expiresInSeconds: TTL_MS / 1000 };
}

// Sekali pakai: captcha dihapus pada setiap percobaan verifikasi, benar maupun salah
function verifyCaptcha(captchaId, answer) {
  if (typeof captchaId !== 'string' || typeof answer !== 'string') return false;
  const item = store.get(captchaId);
  store.delete(captchaId);
  if (!item || item.expiresAt <= Date.now()) return false;
  const a = Buffer.from(item.answer);
  const b = Buffer.from(answer.trim().toUpperCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { createCaptcha, verifyCaptcha };
