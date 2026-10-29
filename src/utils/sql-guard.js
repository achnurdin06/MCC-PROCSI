// Guard SQL bebas: hanya satu pernyataan SELECT/WITH, tanpa komentar, tanpa fungsi/klausa berbahaya
const FORBIDDEN_SQL_KEYWORDS = /\b(INTO|EXEC|EXECUTE|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK|XP_\w+|SP_\w+|SHUTDOWN|GRANT|REVOKE|DROP|ALTER|CREATE|TRUNCATE|INSERT|UPDATE|DELETE|MERGE|COPY|DBLINK\w*|PG_READ_\w+|PG_SLEEP|LO_\w+|WAITFOR|DECLARE|SET)\b/i;
// Schema kontrol aplikasi (hash password, kredensial terenkripsi) tidak boleh dibaca lewat SQL bebas
const PROTECTED_OBJECTS = /\b(mc_center|sys_users|sys_roles|master_connection)\b/i;

function assertReadOnlySelect(sqlText) {
  const q = String(sqlText || '').trim();
  if (!q) throw new Error('Query SQL wajib diisi.');
  if (q.length > 20000) throw new Error('Query SQL terlalu panjang.');
  if (!/^(SELECT|WITH)\b/i.test(q)) throw new Error('Hanya query SELECT/WITH yang diizinkan.');
  if (/;/.test(q) || /--|\/\*|\*\//.test(q)) {
    throw new Error('Pernyataan majemuk dan komentar SQL tidak diizinkan.');
  }
  if (FORBIDDEN_SQL_KEYWORDS.test(q)) {
    throw new Error('Query mengandung perintah atau fungsi yang tidak diizinkan.');
  }
  if (PROTECTED_OBJECTS.test(q)) {
    throw new Error('Query mengakses objek sistem aplikasi yang dilindungi.');
  }
  return q;
}

// Identifier (schema/tabel/kolom) yang disisipkan ke SQL harus lolos allowlist
function assertSafeIdentifier(value, label = 'Identifier') {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)) {
    throw new Error(`${label} tidak valid. Gunakan huruf, angka, dan underscore saja.`);
  }
  return value;
}

module.exports = { assertReadOnlySelect, assertSafeIdentifier };
