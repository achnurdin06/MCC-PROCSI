const { queryPostgres } = require('../config/postgres');

const MAX_DELETE_IDS = 500;
const FLAG_COLUMNS = ['migration', 'is_migrated'];
const MIGRATED_FLAG_VALUES = ['1', 'y', 't', 'true'];
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const SAFE_ID_VALUE = /^[A-Za-z0-9_.\-]+$/;

const quoteIdent = (name) => {
  if (!SAFE_IDENT.test(String(name || ''))) {
    throw Object.assign(new Error(`Nama objek database tidak valid: "${name}"`), { code: 'INVALID_IDENTIFIER' });
  }
  return `"${name}"`;
};

const canonicalKey = (value) => {
  const s = String(value);
  return /^[0-9]+$/.test(s) ? (s.replace(/^0+/, '') || '0') : s;
};

// Padanan SQL dari canonicalKey: ID numerik dibandingkan tanpa nol di depan
const canonSql = (expr) => `(CASE WHEN (${expr}) ~ '^[0-9]+$' THEN COALESCE(NULLIF(LTRIM(${expr}, '0'), ''), '0') ELSE ${expr} END)`;

/**
 * Purge Pre-Check Service (Flow 4)
 * Menormalisasi input ID dan mengklasifikasikan setiap ID berdasarkan bukti migrasi
 * sebelum fungsi hapus di database dipanggil.
 */
class PurgePrecheckService {
  /**
   * Normalisasi input multi-ID: pisah koma/spasi/baris/titik-koma, hapus duplikat, LPAD, validasi, batasi jumlah
   */
  normalizeDeleteIds(raw, idWidth = null) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return [];
    const width = parseInt(idWidth, 10);
    const seen = new Set();
    const result = [];
    const invalid = [];

    for (const token of String(raw).split(/[\s,;]+/)) {
      const cleaned = token.replace(/^['"]+|['"]+$/g, '').trim();
      if (!cleaned) continue;
      if (!SAFE_ID_VALUE.test(cleaned)) {
        invalid.push(cleaned);
        continue;
      }
      const value = (/^[0-9]+$/.test(cleaned) && width > 0) ? cleaned.padStart(width, '0') : cleaned;
      if (!seen.has(value)) {
        seen.add(value);
        result.push(value);
      }
    }

    if (invalid.length > 0) {
      throw Object.assign(
        new Error(`Format ID tidak valid: ${invalid.slice(0, 10).join(', ')}. Gunakan huruf, angka, titik, strip atau underscore, dipisahkan koma/spasi.`),
        { code: 'INVALID_DELETE_IDS' }
      );
    }
    if (result.length > MAX_DELETE_IDS) {
      throw Object.assign(
        new Error(`Jumlah ID (${result.length}) melebihi batas ${MAX_DELETE_IDS} per proses. Pecah menjadi beberapa proses.`),
        { code: 'TOO_MANY_DELETE_IDS' }
      );
    }
    return result;
  }

  async _loadConfig(configId) {
    const res = await queryPostgres(`
      SELECT config_id, name_config, tgt_schema, tgt_table, pk_columns, id_column, id_width, business_keys
      FROM mc_center.migration_config
      WHERE config_id = $1
    `, [configId]);
    return res.rows[0] || null;
  }

  // Kolom business key berakhiran _id (mis. vendor_id) yang menautkan baris anak ke induknya
  _ownerColumn(cfg, idColumn, cols) {
    const keys = String(cfg.business_keys || '').split(',').map(k => k.trim()).filter(Boolean);
    // Hanya business key komposit (mis. vendor_id,number); key tunggal seperti vendor_reference_id bukan ID induk
    if (keys.length < 2) return null;
    const first = keys[0];
    return (first !== idColumn && /_id$/.test(first) && cols.includes(first) && SAFE_IDENT.test(first)) ? first : null;
  }

  async _detectColumns(schema, table, idColumn) {
    const res = await queryPostgres(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
    `, [schema, table]);
    const cols = res.rows.map(r => r.column_name);
    return {
      tableExists: cols.length > 0,
      columns: cols,
      idColumnExists: cols.includes(idColumn),
      flagColumn: FLAG_COLUMNS.find(c => cols.includes(c)) || null
    };
  }

  // Bukti migrasi: ID target tercatat di payload staging_data_history (kolom id_column), dibandingkan tanpa nol di depan
  async _historyEvidence(configId, idColumn, ids) {
    if (!ids || ids.length === 0) return new Set();
    try {
      const res = await queryPostgres(`
        SELECT DISTINCT payload ->> $2 AS found_id
        FROM stg_antam.staging_data_history
        WHERE config_id = $1
          AND ${canonSql('payload ->> $2')} = ANY($3::text[])
      `, [configId, idColumn, ids.map(canonicalKey)]);
      return new Set(res.rows.map(r => canonicalKey(r.found_id)));
    } catch (err) {
      // Gagal baca riwayat tidak boleh dianggap "tidak ada bukti"; batalkan demi keamanan data
      throw Object.assign(new Error(`Gagal membaca riwayat staging (stg_antam.staging_data_history): ${err.message}`), { code: 'PURGE_BLOCKED' });
    }
  }

  /**
   * Klasifikasi untuk satu config.
   * Status per ID: MIGRATED_ACTIVE | PROTECTED | ALREADY_PURGED | NOT_FOUND
   */
  async classifyConfig(configId, rawDeleteIds) {
    const cfg = await this._loadConfig(configId);
    if (!cfg) {
      throw Object.assign(new Error(`Konfigurasi #${configId} tidak ditemukan.`), { code: 'CONFIG_NOT_FOUND' });
    }

    const idColumn = cfg.id_column || (cfg.pk_columns ? String(cfg.pk_columns).split(',')[0].trim() : 'id');
    const ids = this.normalizeDeleteIds(rawDeleteIds, cfg.id_width);
    const tableLabel = `${cfg.tgt_schema}.${cfg.tgt_table}`;
    const base = {
      configId: cfg.config_id,
      configName: cfg.name_config,
      table: tableLabel,
      idColumn,
      mode: ids.length > 0 ? 'SPECIFIC' : 'ALL',
      ids,
      items: [],
      candidates: [],
      protectedIds: [],
      candidateCount: 0,
      flagColumn: null
    };

    const cols = await this._detectColumns(cfg.tgt_schema, cfg.tgt_table, idColumn);
    if (!cols.tableExists || !cols.idColumnExists) {
      return { ...base, note: `Tabel/kolom ID ${tableLabel}.${idColumn} tidak ditemukan di target; tidak ada yang dapat dihapus.`,
        items: ids.map(id => ({ id, status: 'NOT_FOUND' })) };
    }

    const tbl = `${quoteIdent(cfg.tgt_schema)}.${quoteIdent(cfg.tgt_table)}`;
    const idCol = quoteIdent(idColumn);
    const flagCol = cols.flagColumn ? quoteIdent(cols.flagColumn) : null;
    const isMigrated = (v) => MIGRATED_FLAG_VALUES.includes(String(v ?? '').trim().toLowerCase());
    const out = { ...base, flagColumn: cols.flagColumn };

    // Mode "hapus semua data migrasi": hitung baris ber-flag migrasi
    if (ids.length === 0) {
      if (!flagCol) {
        return { ...out, candidateCount: null, note: 'Tabel target tidak memiliki kolom flag migrasi; validasi dilakukan oleh fungsi database.' };
      }
      const cnt = await queryPostgres(
        `SELECT COUNT(*)::int AS n FROM ${tbl} WHERE LOWER(${flagCol}::text) = ANY($1::text[])`,
        [MIGRATED_FLAG_VALUES]
      );
      return { ...out, candidateCount: cnt.rows[0].n };
    }

    const ownerColumn = this._ownerColumn(cfg, idColumn, cols.columns);
    const ownerCol = ownerColumn ? quoteIdent(ownerColumn) : null;
    out.ownerColumn = ownerColumn;

    const rows = await queryPostgres(`
      SELECT ${idCol}::text AS id_val${ownerCol ? `, ${ownerCol}::text AS owner_val` : ''}${flagCol ? `, ${flagCol}::text AS flag_val` : ''}
      FROM ${tbl}
      WHERE ${canonSql(`${ownerCol || idCol}::text`)} = ANY($1::text[])
    `, [ids.map(canonicalKey)]);

    const byOwner = new Map();
    const byPk = new Map();
    for (const r of rows.rows) {
      if (ownerCol && r.owner_val != null) {
        const k = canonicalKey(r.owner_val);
        if (!byOwner.has(k)) byOwner.set(k, []);
        byOwner.get(k).push(r);
      }
      byPk.set(canonicalKey(r.id_val), r);
    }

    // Tabel anak (punya kolom owner) hanya dicocokkan lewat owner; kecocokan PK kebetulan bisa milik induk lain
    const matchedRows = (cKey) => {
      if (ownerColumn) return byOwner.has(cKey) ? { via: ownerColumn, list: byOwner.get(cKey) } : null;
      return byPk.has(cKey) ? { via: idColumn, list: [byPk.get(cKey)] } : null;
    };

    const allRowPks = [...new Set(rows.rows.map(r => r.id_val))];
    const rowEvidence = await this._historyEvidence(cfg.config_id, idColumn, allRowPks);
    const inputEvidence = ownerColumn ? new Set() : await this._historyEvidence(cfg.config_id, idColumn, ids);
    const ownerEvidence = ownerColumn ? await this._historyEvidence(cfg.config_id, ownerColumn, ids) : new Set();
    const candidateSet = new Set();

    for (const id of ids) {
      const cKey = canonicalKey(id);
      const matched = matchedRows(cKey);

      if (matched) {
        const verdicts = matched.list.map(row => {
          if (flagCol && isMigrated(row.flag_val)) return { ok: true, row, why: `flag ${cols.flagColumn}=${row.flag_val}` };
          if (rowEvidence.has(canonicalKey(row.id_val))) return { ok: true, row, why: 'riwayat staging (staging_data_history)' };
          return { ok: false, row, why: `flag ${cols.flagColumn || 'migration'}=${row.flag_val ?? 'NULL'} dan tidak ada di riwayat staging` };
        });
        const viaOwner = matched.via === ownerColumn;
        const okRows = verdicts.filter(v => v.ok);
        const badRows = verdicts.filter(v => !v.ok);
        const viaNote = viaOwner ? ` via ${ownerColumn}, ${okRows.length} baris (id ${okRows.map(v => v.row.id_val).join(', ')})` : '';
        if (viaOwner && okRows.length === 0) {
          // Baris anak milik vendor ini bukan hasil migrasi: dilewati, tidak memblokir proses
          out.items.push({ id, status: 'NOT_FOUND', detail: `tidak pernah dimigrasikan; ${badRows.length} baris milik ${ownerColumn} ini bukan data migrasi dan dilewati` });
        } else if (!viaOwner && badRows.length > 0) {
          out.items.push({ id, status: 'PROTECTED', detail: badRows[0].why });
          out.protectedIds.push(id);
        } else {
          const skipped = viaOwner && badRows.length > 0 ? `; ${badRows.length} baris non-migrasi dilewati` : '';
          out.items.push({ id, status: 'MIGRATED_ACTIVE', detail: `terverifikasi sah dari ${okRows[0].why}${viaNote}${skipped}` });
          okRows.forEach(v => candidateSet.add(v.row.id_val));
        }
      } else if (inputEvidence.has(cKey) || ownerEvidence.has(cKey)) {
        out.items.push({ id, status: 'ALREADY_PURGED', detail: 'pernah dimigrasikan tetapi saat ini sudah tidak ada di target' });
      } else {
        out.items.push({ id, status: 'NOT_FOUND', detail: 'tidak pernah dimigrasikan dan tidak ditemukan di target' });
      }
    }
    out.candidates = [...candidateSet];
    out.candidateCount = out.candidates.length;
    return out;
  }

  /**
   * Klasifikasi seluruh config terpilih. Mode STRICT: bila ada PROTECTED, hasil ditandai blocked.
   */
  async buildPlan(configIds, rawDeleteIds) {
    const configs = [];
    for (const configId of configIds) {
      configs.push(await this.classifyConfig(parseInt(configId, 10), rawDeleteIds));
    }
    const protectedAll = configs.flatMap(c => c.protectedIds.map(id => ({ configId: c.configId, table: c.table, id })));
    const totalCandidates = configs.reduce((s, c) => s + (c.candidateCount === null ? 1 : c.candidateCount), 0);
    return {
      configs,
      blocked: protectedAll.length > 0,
      protectedIds: protectedAll,
      hasWork: totalCandidates > 0,
      normalizedIds: configs[0]?.ids || []
    };
  }

  /**
   * Hitung ulang baris yang masih ada setelah purge (untuk menghitung baris terhapus)
   */
  async countRemaining(configPlan) {
    const cfg = await this._loadConfig(configPlan.configId);
    if (!cfg) return null;
    const tbl = `${quoteIdent(cfg.tgt_schema)}.${quoteIdent(cfg.tgt_table)}`;
    const idCol = quoteIdent(configPlan.idColumn);
    if (configPlan.mode === 'SPECIFIC') {
      const res = await queryPostgres(
        `SELECT COUNT(*)::int AS n FROM ${tbl} WHERE ${idCol}::text = ANY($1::text[])`,
        [configPlan.candidates]
      );
      return res.rows[0].n;
    }
    if (!configPlan.flagColumn) return null;
    const res = await queryPostgres(
      `SELECT COUNT(*)::int AS n FROM ${tbl} WHERE LOWER(${quoteIdent(configPlan.flagColumn)}::text) = ANY($1::text[])`,
      [MIGRATED_FLAG_VALUES]
    );
    return res.rows[0].n;
  }

  /**
   * Error STRICT: proses dibatalkan seluruhnya bila ada ID yang bukan data migrasi
   */
  blockedError(plan) {
    const list = plan.protectedIds.map(p => `${p.id} (${p.table})`).join(', ');
    return Object.assign(
      new Error(`NOT_MIGRATION_DATA: Penghapusan dibatalkan demi keamanan data (mode STRICT, tidak ada data yang dihapus). ID berikut ada di tabel target namun terdeteksi sebagai data master/non-migrasi asli (bukan hasil migrasi Antam): ${list}. Solusi: Hapus ID tersebut dari input, atau jika data tersebut baru saja dimigrasikan ulang, jalankan Flow 1 (Staging) lalu Flow 2 (Posting) terlebih dahulu agar riwayat migrasinya tercatat resmi di staging_data_history.`),
      { code: 'PURGE_BLOCKED' }
    );
  }

  /**
   * Bangun pesan ringkas yang mudah dipahami pengguna
   */
  summarize(plan) {
    const lines = [];
    for (const c of plan.configs) {
      const by = (s) => c.items.filter(i => i.status === s).map(i => i.id);
      const parts = [];
      if (c.mode === 'ALL') parts.push(c.candidateCount === null ? 'seluruh data migrasi (validasi di database)' : `${c.candidateCount} baris ber-flag migrasi`);
      if (by('MIGRATED_ACTIVE').length) parts.push(`dihapus: ${by('MIGRATED_ACTIVE').join(', ')}`);
      if (by('ALREADY_PURGED').length) parts.push(`sudah pernah dihapus: ${by('ALREADY_PURGED').join(', ')}`);
      if (by('NOT_FOUND').length) parts.push(`tidak pernah dimigrasikan: ${by('NOT_FOUND').join(', ')}`);
      if (by('PROTECTED').length) parts.push(`dilindungi (bukan data migrasi): ${by('PROTECTED').join(', ')}`);
      lines.push(`[${c.table}] ${parts.join(' | ') || c.note || 'tidak ada data'}`);
    }
    return lines.join('\n');
  }
}

module.exports = new PurgePrecheckService();
