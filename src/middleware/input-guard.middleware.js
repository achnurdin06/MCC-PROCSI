/**
 * Lapisan pertahanan tambahan terhadap SQL Injection pada endpoint autentikasi.
 * Lapisan utama tetap query terparameter ($1, $2, ...) di service layer.
 * Password tidak diperiksa karena tidak pernah disisipkan ke SQL (hanya di-hash).
 */

const SQLI_PATTERNS = [
  /(--|#|\/\*|\*\/)/,
  /(;|\\x00|\0)/,
  /\b(union\s+(all\s+)?select|select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from|drop\s+(table|database|schema)|alter\s+table|truncate\s+table|exec(ute)?\s|xp_cmdshell|pg_sleep|waitfor\s+delay|information_schema|benchmark\s*\()/i,
  /(['"`]\s*(or|and)\s+['"`\d])/i,
  /(\bor\b|\band\b)\s+\d+\s*=\s*\d+/i,
];

function looksLikeSqlInjection(value) {
  return SQLI_PATTERNS.some((re) => re.test(value));
}

function sqlInjectionGuard(fields) {
  return (req, res, next) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ success: false, error: 'Format permintaan tidak valid.', message: 'Format permintaan tidak valid.' });
    }

    for (const field of fields) {
      const value = body[field];
      if (value === undefined || value === null) continue;
      // Menolak objek/array (mis. {"$ne": ""}) agar tipe data selalu string
      if (typeof value !== 'string') {
        return res.status(400).json({ success: false, error: `Input "${field}" tidak valid.`, message: `Input "${field}" tidak valid.` });
      }
      if (value.length > 255 || looksLikeSqlInjection(value)) {
        console.warn(`[SECURITY] Input mencurigakan pada field "${field}" dari IP ${req.ip}`);
        return res.status(400).json({ success: false, error: 'Input mengandung karakter atau pola yang tidak diizinkan.', message: 'Input mengandung karakter atau pola yang tidak diizinkan.' });
      }
    }

    if (body.password !== undefined && typeof body.password !== 'string') {
      return res.status(400).json({ success: false, error: 'Input "password" tidak valid.', message: 'Input "password" tidak valid.' });
    }
    next();
  };
}

module.exports = { sqlInjectionGuard, looksLikeSqlInjection };
