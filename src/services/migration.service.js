const { checkSqlServerConnection, querySqlServer } = require('../config/sqlserver');
const { checkPostgresConnection, queryPostgres } = require('../config/postgres');

/**
 * Validasi dan bersihkan nama tabel / kolom / schema guna menghindari SQL injection
 */
function sanitizeIdentifier(name) {
  if (!name || typeof name !== 'string') return null;
  const clean = name.replace(/[^a-zA-Z0-9_]/g, '');
  return clean.length > 0 ? clean : null;
}

const BLOCKED_BROWSE_TABLES = new Set(['sys_users', 'sys_roles', 'master_connection']);

class MigrationService {
  /**
   * Cek status koneksi kedua database
   */
  async getHealthStatus() {
    const [sqlServerStatus, pgStatus] = await Promise.all([
      checkSqlServerConnection(),
      checkPostgresConnection(),
    ]);

    return {
      sqlserver: {
        role: 'Source Database (MSSQL)',
        ...sqlServerStatus,
      },
      postgres: {
        role: 'Target Database (PostgreSQL)',
        ...pgStatus,
      },
      bothConnected: sqlServerStatus.connected && pgStatus.connected,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Mengambil daftar tabel dan row count secara cepat (Bulk Optimized)
   */
  async getTablesList() {
    let sqlServerTables = [];
    let pgTables = [];
    let sqlServerError = null;
    let pgError = null;

    try {
      const sqlResult = await querySqlServer(`
        SELECT s.name AS [schema], t.name AS [name], SUM(p.rows) AS [total]
        FROM sys.tables t
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        JOIN sys.partitions p ON t.object_id = p.object_id
        WHERE p.index_id IN (0,1)
        GROUP BY s.name, t.name
        ORDER BY t.name
      `);
      sqlServerTables = sqlResult.recordset.map((r) => ({
        schema: r.schema,
        name: r.name,
        count: parseInt(r.total, 10) || 0,
      }));
    } catch (err) {
      sqlServerError = err.message;
    }

    try {
      const pgResult = await queryPostgres(`
        SELECT schemaname AS "schema", relname AS "name", n_live_tup AS "total"
        FROM pg_stat_user_tables
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY relname
      `);
      pgTables = pgResult.rows.map((r) => ({
        schema: r.schema,
        name: r.name,
        count: parseInt(r.total, 10) || 0,
      }));
    } catch (err) {
      pgError = err.message;
    }

    // Gabungkan tabel berdasarkan nama (case-insensitive)
    const tableMap = new Map();

    sqlServerTables.forEach((t) => {
      const key = t.name.toLowerCase();
      tableMap.set(key, {
        name: t.name,
        sqlServer: { exists: true, schema: t.schema, count: t.count },
        postgres: { exists: false, schema: null, count: null },
      });
    });

    pgTables.forEach((t) => {
      const key = t.name.toLowerCase();
      if (tableMap.has(key)) {
        const item = tableMap.get(key);
        item.postgres = { exists: true, schema: t.schema, count: t.count };
      } else {
        tableMap.set(key, {
          name: t.name,
          sqlServer: { exists: false, schema: null, count: null },
          postgres: { exists: true, schema: t.schema, count: t.count },
        });
      }
    });

    // Urutkan: Tabel yang ada di SQL Server (Source) di atas, kemudian tabel lainnya
    const tables = Array.from(tableMap.values()).sort((a, b) => {
      if (a.sqlServer.exists && !b.sqlServer.exists) return -1;
      if (!a.sqlServer.exists && b.sqlServer.exists) return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      tables,
      errors: {
        sqlserver: sqlServerError,
        postgres: pgError,
      },
    };
  }

  /**
   * Mendapatkan summary jumlah baris & metrik rekonsiliasi secara cepat (<1 detik)
   */
  async getSummaryMetrics() {
    const { tables, errors } = await this.getTablesList();
    const summary = [];

    for (const tbl of tables) {
      const srcCount = tbl.sqlServer.count;
      const tgtCount = tbl.postgres.count;

      let status = 'UNKNOWN';
      let delta = null;

      if (!tbl.postgres.exists) {
        status = 'MISSING_IN_TARGET';
        delta = -(srcCount || 0);
      } else if (!tbl.sqlServer.exists) {
        status = 'ONLY_IN_TARGET';
        delta = tgtCount || 0;
      } else if (srcCount !== null && tgtCount !== null) {
        delta = tgtCount - srcCount;
        if (srcCount === tgtCount) {
          status = srcCount === 0 ? 'EMPTY_MATCH' : 'MATCH';
        } else if (tgtCount < srcCount) {
          status = 'PARTIAL';
        } else {
          status = 'OVERFLOW';
        }
      }

      summary.push({
        name: tbl.name,
        sqlServer: tbl.sqlServer,
        postgres: tbl.postgres,
        delta,
        status,
        error: null,
      });
    }

    const totalSourceRows = summary.reduce(
      (acc, s) => acc + (s.sqlServer.count || 0),
      0
    );
    const totalTargetRows = summary.reduce(
      (acc, s) => acc + (s.postgres.count || 0),
      0
    );

    return {
      totals: {
        totalTables: summary.length,
        fullyMigratedTables: summary.filter((s) => s.status === 'MATCH' || s.status === 'EMPTY_MATCH').length,
        partialTables: summary.filter((s) => s.status === 'PARTIAL').length,
        missingInTarget: summary.filter((s) => s.status === 'MISSING_IN_TARGET').length,
        totalSourceRows,
        totalTargetRows,
        totalDelta: totalTargetRows - totalSourceRows,
      },
      tables: summary,
      errors,
    };
  }

  /**
   * Mengambil data tabel tertentu (Paging & Data Inspection)
   */
  async getTableData(options) {
    const {
      database = 'postgres',
      schema,
      table,
      page = 1,
      limit = 25,
      search = '',
    } = options;

    const cleanTable = sanitizeIdentifier(table);
    if (!cleanTable) {
      throw new Error('Nama tabel tidak valid.');
    }
    // Tabel berisi hash password & kredensial terenkripsi tidak boleh dibrowse
    if (BLOCKED_BROWSE_TABLES.has(cleanTable.toLowerCase())
      || ['pg_catalog', 'information_schema'].includes(String(schema || '').toLowerCase())
      || /^(pg_|sys_)/i.test(cleanTable)) {
      throw new Error('Akses ke tabel ini tidak diizinkan.');
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const offset = (pageNum - 1) * limitNum;

    if (database === 'sqlserver') {
      let cleanSchema = sanitizeIdentifier(schema);
      if (!cleanSchema) {
        // Cari schema dari database SQL Server
        const schQuery = await querySqlServer(`
          SELECT TOP 1 TABLE_SCHEMA FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${cleanTable}'
        `);
        cleanSchema = schQuery.recordset[0]?.TABLE_SCHEMA || 'dbo';
      }

      // Dapatkan primary key atau kolom pertama
      const pkQuery = await querySqlServer(`
        SELECT TOP 1 COLUMN_NAME 
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = '${cleanSchema}' AND TABLE_NAME = '${cleanTable}'
      `);
      const pkColumn = pkQuery.recordset[0]?.COLUMN_NAME || null;

      // Ambil daftar kolom
      const colQuery = await querySqlServer(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = '${cleanSchema}' AND TABLE_NAME = '${cleanTable}'
        ORDER BY ORDINAL_POSITION
      `);
      const columns = colQuery.recordset.map((c) => ({
        name: c.COLUMN_NAME,
        type: c.DATA_TYPE,
      }));

      const orderByCol = pkColumn || (columns[0] ? `[${columns[0].name}]` : '(SELECT NULL)');

      // Hitung total baris
      const countRes = await querySqlServer(
        `SELECT COUNT_BIG(1) AS total FROM [${cleanSchema}].[${cleanTable}]`
      );
      const total = parseInt(countRes.recordset[0]?.total, 10) || 0;

      // Ambil data dengan paging
      const dataQuery = `
        SELECT * FROM [${cleanSchema}].[${cleanTable}]
        ORDER BY ${orderByCol.startsWith('[') ? orderByCol : `[${orderByCol}]`}
        OFFSET ${offset} ROWS
        FETCH NEXT ${limitNum} ROWS ONLY
      `;
      const dataRes = await querySqlServer(dataQuery);

      return {
        database: 'sqlserver',
        schema: cleanSchema,
        table: cleanTable,
        columns,
        primaryKey: pkColumn,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        rows: dataRes.recordset,
      };
    } else {
      // PostgreSQL
      let cleanSchema = sanitizeIdentifier(schema);
      if (!cleanSchema) {
        // Cari skema tabel yang cocok di PostgreSQL
        const schQuery = await queryPostgres(
          `SELECT table_schema FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
          [cleanTable]
        );
        cleanSchema = schQuery.rows[0]?.table_schema || 'public';
      }

      // Dapatkan primary key
      const pkQuery = await queryPostgres(
        `
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = $1
          AND tc.table_name = $2
        LIMIT 1
      `,
        [cleanSchema, cleanTable]
      );
      const pkColumn = pkQuery.rows[0]?.column_name || null;

      // Ambil daftar kolom
      const colQuery = await queryPostgres(
        `
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `,
        [cleanSchema, cleanTable]
      );
      const columns = colQuery.rows.map((c) => ({
        name: c.column_name,
        type: c.data_type,
      }));

      // Hitung total baris
      const countRes = await queryPostgres(
        `SELECT COUNT(*) AS total FROM "${cleanSchema}"."${cleanTable}"`
      );
      const total = parseInt(countRes.rows[0]?.total, 10) || 0;

      const orderByCol = pkColumn
        ? `"${pkColumn}"`
        : columns[0]
        ? `"${columns[0].name}"`
        : '1';

      // Ambil data dengan paging
      const dataQuery = `
        SELECT * FROM "${cleanSchema}"."${cleanTable}"
        ORDER BY ${orderByCol}
        LIMIT $1 OFFSET $2
      `;
      const dataRes = await queryPostgres(dataQuery, [limitNum, offset]);

      return {
        database: 'postgres',
        schema: cleanSchema,
        table: cleanTable,
        columns,
        primaryKey: pkColumn,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        rows: dataRes.rows,
      };
    }
  }

  /**
   * Deteksi record yang ada di Source (SQL Server) tapi belum ada di Target (PostgreSQL)
   */
  async findDiscrepancies(options) {
    const { table, sourceSchema = 'dbo', targetSchema, primaryKey, limit = 50 } = options;
    const cleanTable = sanitizeIdentifier(table);
    if (!cleanTable) throw new Error('Nama tabel tidak valid.');

    // Cari schema target jika tidak ditentukan
    let cleanTargetSchema = sanitizeIdentifier(targetSchema);
    if (!cleanTargetSchema) {
      const schQuery = await queryPostgres(
        `SELECT table_schema FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
        [cleanTable]
      );
      cleanTargetSchema = schQuery.rows[0]?.table_schema || 'public';
    }

    // Cari PK jika tidak diberikan
    let pk = sanitizeIdentifier(primaryKey);
    if (!pk) {
      const pkQuery = await querySqlServer(`
        SELECT TOP 1 COLUMN_NAME 
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = '${sanitizeIdentifier(sourceSchema) || 'dbo'}' AND TABLE_NAME = '${cleanTable}'
      `);
      pk = pkQuery.recordset[0]?.COLUMN_NAME || 'id';
    }

    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    // Ambil sampel ID dari SQL Server
    const srcIdsRes = await querySqlServer(`
      SELECT TOP ${limitNum * 2} [${pk}] 
      FROM [${sanitizeIdentifier(sourceSchema) || 'dbo'}].[${cleanTable}]
      ORDER BY [${pk}]
    `);
    const sourceIds = srcIdsRes.recordset.map((r) => r[pk]).filter((val) => val !== undefined && val !== null);

    if (sourceIds.length === 0) {
      return {
        table: cleanTable,
        primaryKey: pk,
        missingIds: [],
        message: 'Tabel di SQL Server kosong atau tidak memiliki record.',
      };
    }

    // Periksa apakah tabel target ada di PostgreSQL
    const checkTableExists = await queryPostgres(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
      [cleanTargetSchema, cleanTable]
    );

    if (checkTableExists.rows.length === 0) {
      return {
        table: cleanTable,
        primaryKey: pk,
        sampledCount: sourceIds.length,
        missingCount: sourceIds.length,
        missingIds: sourceIds.slice(0, limitNum),
        status: 'TARGET_TABLE_NOT_FOUND',
        message: `Tabel "${cleanTable}" belum dibuat di PostgreSQL (skema "${cleanTargetSchema}")!`,
      };
    }

    // Periksa ID mana yang tidak ada di PostgreSQL
    const placeholders = sourceIds.map((_, idx) => `$${idx + 1}`).join(',');
    const pgCheck = await queryPostgres(
      `
      SELECT "${pk}" 
      FROM "${cleanTargetSchema}"."${cleanTable}" 
      WHERE "${pk}" IN (${placeholders})
    `,
      sourceIds
    );

    const existingPgSet = new Set(pgCheck.rows.map((r) => String(r[pk])));
    const missingIds = sourceIds.filter((id) => !existingPgSet.has(String(id))).slice(0, limitNum);

    return {
      table: cleanTable,
      primaryKey: pk,
      sampledCount: sourceIds.length,
      missingCount: missingIds.length,
      missingIds,
      status: missingIds.length === 0 ? 'SYNCHRONIZED' : 'INCOMPLETE',
    };
  }
}

module.exports = new MigrationService();
