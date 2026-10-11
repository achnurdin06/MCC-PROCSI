const { querySqlServer, sql } = require('../config/sqlserver');
const { queryPostgres, pool: defaultPgPool } = require('../config/postgres');

function sanitizeIdentifier(name) {
  if (!name || typeof name !== 'string') return null;
  const clean = name.replace(/[^a-zA-Z0-9_]/g, '');
  return clean.length > 0 ? clean : null;
}

let inMemoryConfiguredViews = [];

class SourceService {
  /**
   * Helper untuk mengambil metadata koneksi dari database
   */
  async getConnectionMeta(connectionId) {
    if (!connectionId) return null;
    try {
      const res = await queryPostgres(
        'SELECT * FROM etl_antam.master_connection WHERE connection_id = $1',
        [parseInt(connectionId, 10)]
      );
      return res.rows[0] || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Mengambil seluruh View di schema dbo pada SQL Server / Target DB beserta total baris & status config
   */
  async getDboViewsSummary(connectionId = null) {
    if (!connectionId) {
      return { totalViews: 0, totalRowsAllViews: 0, views: [] };
    }
    const conn = await this.getConnectionMeta(connectionId);
    if (!conn) {
      return { totalViews: 0, totalRowsAllViews: 0, views: [] };
    }
    const dbType = conn.db_type.toUpperCase();
    const schemaName = conn.db_schema || (dbType === 'MSSQL' ? 'dbo' : 'public');
    const databaseName = conn.database_name || 'antam_scm';

    let views = [];
    let totalRowsAllViews = 0;

    if (dbType === 'MSSQL') {
      const viewsQuery = await querySqlServer(`
        SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name]
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = '${schemaName}' AND TABLE_TYPE = 'VIEW'
        ORDER BY TABLE_NAME
      `);
      views = viewsQuery.recordset || [];
    } else {
      // PostgreSQL Views
      const viewsQuery = await queryPostgres(`
        SELECT table_schema AS "schema", table_name AS "name"
        FROM information_schema.views
        WHERE table_schema = $1
        ORDER BY table_name
      `, [schemaName]);
      views = viewsQuery.rows || [];
    }

    // Ambil metadata dari etl_antam.master_source_view
    let configuredMap = {};
    try {
      let q = 'SELECT view_id, view_name, query_sql, is_active, is_synced, connection_id FROM etl_antam.master_source_view';
      const params = [];
      if (connectionId) {
        q += ' WHERE connection_id = $1';
        params.push(parseInt(connectionId, 10));
      }
      const cfgRes = await queryPostgres(q, params);
      cfgRes.rows.forEach((r) => {
        configuredMap[r.view_name] = r;
      });
    } catch (e) {
      inMemoryConfiguredViews.forEach((r) => {
        configuredMap[r.view_name] = r;
      });
    }

    const viewList = [];
    for (const v of views) {
      const cleanName = sanitizeIdentifier(v.name);
      let count = 0;
      let error = null;

      if (cleanName) {
        try {
          if (dbType === 'MSSQL') {
            const countRes = await querySqlServer(`SELECT COUNT_BIG(1) AS total FROM [${schemaName}].[${cleanName}]`);
            count = parseInt(countRes.recordset[0]?.total, 10) || 0;
          } else {
            const countRes = await queryPostgres(`SELECT count(1) AS total FROM "${schemaName}"."${cleanName}"`);
            count = parseInt(countRes.rows[0]?.total, 10) || 0;
          }
          totalRowsAllViews += count;
        } catch (err) {
          error = err.message;
        }
      }

      const cfg = configuredMap[v.name];
      viewList.push({
        schema: schemaName,
        name: v.name,
        count,
        error,
        connectionId: connectionId ? parseInt(connectionId, 10) : (conn?.connection_id || 1),
        connectionName: conn?.connection_name || 'Default Source (SQL Server)',
        isConfigured: Boolean(cfg),
        isSynced: cfg ? cfg.is_synced : false,
        isActive: cfg ? cfg.is_active : true,
      });
    }

    return {
      connectionId: connectionId ? parseInt(connectionId, 10) : (conn?.connection_id || 1),
      connectionName: conn?.connection_name || 'SQL Server Source (dbo)',
      dbType,
      schema: schemaName,
      database: databaseName,
      totalViews: viewList.length,
      totalRowsAllViews,
      views: viewList,
    };
  }

  /**
   * Mengambil data isi record dari salah satu VIEW dengan paginasi
   */
  async getViewData(options) {
    const { view, page = 1, limit = 25, search = '', connectionId = null } = options;
    const cleanView = sanitizeIdentifier(view);
    if (!cleanView) {
      throw new Error('Nama view tidak valid.');
    }

    if (!connectionId) {
      throw new Error('Koneksi SOURCE belum dikonfigurasi untuk environment ini.');
    }
    const conn = await this.getConnectionMeta(connectionId);
    if (!conn) {
      throw new Error(`Koneksi database dengan ID ${connectionId} tidak ditemukan.`);
    }
    const dbType = conn.db_type.toUpperCase();
    const schemaName = conn.db_schema || (dbType === 'MSSQL' ? 'dbo' : 'public');

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const offset = (pageNum - 1) * limitNum;

    let columns = [];
    let total = 0;
    let rows = [];
    let bindingError = null;

    if (dbType === 'MSSQL') {
      const colQuery = await querySqlServer(`
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '${schemaName}' AND TABLE_NAME = '${cleanView}'
        ORDER BY ORDINAL_POSITION
      `);
      columns = colQuery.recordset.map((c) => ({
        name: c.COLUMN_NAME,
        type: c.DATA_TYPE,
        nullable: c.IS_NULLABLE === 'YES',
      }));

      if (columns.length === 0) {
        throw new Error(`View [${schemaName}].[${cleanView}] tidak ditemukan atau tidak memiliki kolom.`);
      }

      try {
        const countRes = await querySqlServer(`SELECT COUNT_BIG(1) AS total FROM [${schemaName}].[${cleanView}]`);
        total = parseInt(countRes.recordset[0]?.total, 10) || 0;

        const firstCol = columns[0].name;
        const dataRes = await querySqlServer(`
          SELECT * FROM [${schemaName}].[${cleanView}]
          ORDER BY [${firstCol}]
          OFFSET ${offset} ROWS
          FETCH NEXT ${limitNum} ROWS ONLY
        `);
        rows = dataRes.recordset;
      } catch (err) {
        bindingError = err.message;
      }
    } else {
      // PostgreSQL
      const colQuery = await queryPostgres(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [schemaName, cleanView]);

      columns = colQuery.rows.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
      }));

      if (columns.length === 0) {
        throw new Error(`View "${schemaName}"."${cleanView}" tidak ditemukan atau tidak memiliki kolom.`);
      }

      try {
        const countRes = await queryPostgres(`SELECT count(1) AS total FROM "${schemaName}"."${cleanView}"`);
        total = parseInt(countRes.rows[0]?.total, 10) || 0;

        const firstCol = columns[0].name;
        const dataRes = await queryPostgres(`
          SELECT * FROM "${schemaName}"."${cleanView}"
          ORDER BY "${firstCol}"
          LIMIT ${limitNum} OFFSET ${offset}
        `);
        rows = dataRes.rows;
      } catch (err) {
        bindingError = err.message;
      }
    }

    return {
      schema: schemaName,
      view: cleanView,
      columns,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      rows,
      error: bindingError,
    };
  }

  /**
   * Mengambil definisi query SQL dari VIEW
   */
  async getViewDefinition(viewName, connectionId = null) {
    const cleanView = sanitizeIdentifier(viewName);
    if (!cleanView) throw new Error('Nama view tidak valid.');

    const conn = await this.getConnectionMeta(connectionId);
    const dbType = conn ? conn.db_type.toUpperCase() : 'MSSQL';
    const schemaName = conn ? (conn.db_schema || (dbType === 'MSSQL' ? 'dbo' : 'public')) : 'dbo';

    let dbDefinition = null;
    try {
      if (dbType === 'MSSQL') {
        const defRes = await querySqlServer(`
          SELECT OBJECT_DEFINITION(OBJECT_ID('[${schemaName}].[${cleanView}]')) AS definition
        `);
        dbDefinition = defRes.recordset[0]?.definition || null;
      } else {
        const defRes = await queryPostgres(`
          SELECT view_definition FROM information_schema.views
          WHERE table_schema = $1 AND table_name = $2
        `, [schemaName, cleanView]);
        dbDefinition = defRes.rows[0]?.view_definition || null;
      }
    } catch (err) {
      console.warn('Gagal membaca definition:', err.message);
    }

    let savedConfig = null;
    try {
      let q = `
        SELECT * FROM etl_antam.master_source_view 
        WHERE view_name = $1 AND schema_name = $2
      `;
      const params = [cleanView, schemaName];
      if (connectionId) {
        q += ' AND connection_id = $3';
        params.push(parseInt(connectionId, 10));
      }
      q += ' ORDER BY view_id DESC LIMIT 1';
      const res = await queryPostgres(q, params);
      savedConfig = res.rows[0] || null;
    } catch (e) {
      savedConfig = inMemoryConfiguredViews.find((v) => v.view_name === cleanView) || null;
    }

    return {
      viewName: cleanView,
      schema: schemaName,
      connectionId: connectionId ? parseInt(connectionId, 10) : (conn?.connection_id || null),
      sqlServerDefinition: dbDefinition,
      savedConfig,
      isConfigured: Boolean(savedConfig),
    };
  }

  /**
   * Simpan atau sinkronkan definisi query view ke tabel etl_antam.master_source_view
   */
  async saveViewDefinition(payload) {
    const { schema_name = 'dbo', view_name, query_sql, description = '', connection_id = null } = payload;
    const cleanView = sanitizeIdentifier(view_name);
    if (!cleanView || !query_sql) throw new Error('Nama view dan Query SQL wajib diisi.');

    try {
      const res = await queryPostgres(`
        INSERT INTO etl_antam.master_source_view (
          schema_name, view_name, query_sql, description, connection_id, is_active, is_synced, last_synced_at
        ) VALUES ($1, $2, $3, $4, $5, true, true, CURRENT_TIMESTAMP)
        RETURNING *
      `, [
        schema_name,
        cleanView,
        query_sql.trim(),
        description,
        connection_id ? parseInt(connection_id, 10) : null,
      ]);
      return res.rows[0];
    } catch (err) {
      const existingIdx = inMemoryConfiguredViews.findIndex((v) => v.view_name === cleanView);
      const item = {
        view_id: existingIdx !== -1 ? inMemoryConfiguredViews[existingIdx].view_id : inMemoryConfiguredViews.length + 1,
        schema_name,
        view_name: cleanView,
        query_sql: query_sql.trim(),
        description,
        connection_id: connection_id ? parseInt(connection_id, 10) : null,
        is_active: true,
        is_synced: true,
        last_synced_at: new Date().toISOString(),
      };
      if (existingIdx !== -1) inMemoryConfiguredViews[existingIdx] = item;
      else inMemoryConfiguredViews.push(item);
      return item;
    }
  }

  /**
   * Eksekusi DDL CREATE OR ALTER VIEW di database target sesuai connection_id
   */
  async createOrAlterView(payload) {
    const { schema_name = 'dbo', view_name, query_sql, description = '', connection_id = null } = payload;
    const cleanView = sanitizeIdentifier(view_name);
    if (!cleanView || !query_sql) throw new Error('Nama View dan Query SQL wajib diisi.');

    const conn = await this.getConnectionMeta(connection_id);
    const dbType = conn ? conn.db_type.toUpperCase() : 'MSSQL';
    const effSchema = schema_name || (conn ? conn.db_schema : 'dbo') || 'dbo';

    let cleanQuery = query_sql.trim();
    if (cleanQuery.endsWith(';')) {
      cleanQuery = cleanQuery.slice(0, -1).trim();
    }

    if (dbType === 'MSSQL') {
      const ddlStatement = `CREATE OR ALTER VIEW [${effSchema}].[${cleanView}] AS\n${cleanQuery}`;
      await querySqlServer(ddlStatement);
    } else {
      // PostgreSQL
      const ddlStatement = `CREATE OR REPLACE VIEW "${effSchema}"."${cleanView}" AS\n${cleanQuery}`;
      await queryPostgres(ddlStatement);
    }

    // Simpan ke master_source_view
    const saved = await this.saveViewDefinition({
      schema_name: effSchema,
      view_name: cleanView,
      query_sql: cleanQuery,
      description,
      connection_id: connection_id ? parseInt(connection_id, 10) : (conn?.connection_id || null),
    });

    return {
      success: true,
      message: `View [${effSchema}].[${cleanView}] berhasil dibuat / diperbarui di database target (${conn?.connection_name || 'Default'}) dan disinkronkan ke katalog view.`,
      view: saved,
    };
  }

  /**
   * Validasi query SELECT sebelum membuat view
   */
  async validateQuery(querySql, connectionId = null) {
    if (!querySql || typeof querySql !== 'string') throw new Error('Query SQL wajib diisi.');

    const conn = await this.getConnectionMeta(connectionId);
    const dbType = conn ? conn.db_type.toUpperCase() : 'MSSQL';

    let cleanQuery = querySql.trim();
    if (cleanQuery.endsWith(';')) cleanQuery = cleanQuery.slice(0, -1).trim();

    const startTime = Date.now();
    try {
      if (dbType === 'MSSQL') {
        const testSql = `SELECT TOP 1 * FROM (${cleanQuery}) AS __syntax_validation_subquery`;
        const res = await querySqlServer(testSql);
        const durationMs = Date.now() - startTime;
        const columns = res.recordset && res.recordset.length > 0 ? Object.keys(res.recordset[0]) : [];
        return {
          valid: true,
          message: 'Query SQL valid dan siap dieksekusi sebagai View di SQL Server.',
          durationMs,
          columns,
        };
      } else {
        const testSql = `SELECT * FROM (${cleanQuery}) AS __syntax_validation_subquery LIMIT 1`;
        const res = await queryPostgres(testSql);
        const durationMs = Date.now() - startTime;
        const columns = res.fields ? res.fields.map((f) => f.name) : [];
        return {
          valid: true,
          message: 'Query SQL valid dan siap dieksekusi sebagai View di PostgreSQL.',
          durationMs,
          columns,
        };
      }
    } catch (err) {
      return {
        valid: false,
        durationMs: Date.now() - startTime,
        error: err.message,
      };
    }
  }

  /**
   * Hapus view dari database target dan nonaktifkan catatannya di katalog
   */
  async dropView(viewName, connectionId = null) {
    const cleanView = sanitizeIdentifier(viewName);
    if (!cleanView) throw new Error('Nama view tidak valid.');

    const conn = await this.getConnectionMeta(connectionId);
    const dbType = conn ? conn.db_type.toUpperCase() : 'MSSQL';
    const schemaName = conn ? (conn.db_schema || (dbType === 'MSSQL' ? 'dbo' : 'public')) : 'dbo';

    if (dbType === 'MSSQL') {
      await querySqlServer(`DROP VIEW IF EXISTS [${schemaName}].[${cleanView}]`);
    } else {
      await queryPostgres(`DROP VIEW IF EXISTS "${schemaName}"."${cleanView}"`);
    }

    try {
      await queryPostgres(`
        UPDATE etl_antam.master_source_view 
        SET is_active = false, is_synced = false, updated_at = CURRENT_TIMESTAMP
        WHERE view_name = $1
      `, [cleanView]);
    } catch (e) {
      const item = inMemoryConfiguredViews.find((v) => v.view_name === cleanView);
      if (item) { item.is_active = false; item.is_synced = false; }
    }

    return {
      success: true,
      message: `View [${schemaName}].[${cleanView}] berhasil dihapus dari database target.`,
    };
  }

  /**
   * Sinkronkan seluruh view eksisting ke tabel master_source_view
   */
  async syncAllExistingViews(connectionId = null) {
    const conn = await this.getConnectionMeta(connectionId);
    const dbType = conn ? conn.db_type.toUpperCase() : 'MSSQL';
    const schemaName = conn ? (conn.db_schema || (dbType === 'MSSQL' ? 'dbo' : 'public')) : 'dbo';

    const synced = [];
    if (dbType === 'MSSQL') {
      const viewsQuery = await querySqlServer(`
        SELECT TABLE_NAME AS [name]
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = '${schemaName}' AND TABLE_TYPE = 'VIEW'
        ORDER BY TABLE_NAME
      `);

      for (const row of viewsQuery.recordset) {
        const cleanName = sanitizeIdentifier(row.name);
        if (!cleanName) continue;

        try {
          const defRes = await querySqlServer(`SELECT OBJECT_DEFINITION(OBJECT_ID('[${schemaName}].[${cleanName}]')) AS definition`);
          let def = defRes.recordset[0]?.definition;
          if (def) {
            const item = await this.saveViewDefinition({
              schema_name: schemaName,
              view_name: cleanName,
              query_sql: def,
              description: `Auto-synced dari SQL Server [${schemaName}].[${cleanName}]`,
              connection_id: connectionId ? parseInt(connectionId, 10) : (conn?.connection_id || null),
            });
            synced.push(item);
          }
        } catch (err) {
          console.warn(`Gagal sync view ${cleanName}:`, err.message);
        }
      }
    } else {
      const viewsQuery = await queryPostgres(`
        SELECT table_name AS "name"
        FROM information_schema.views
        WHERE table_schema = $1
        ORDER BY table_name
      `, [schemaName]);

      for (const row of viewsQuery.rows) {
        const cleanName = sanitizeIdentifier(row.name);
        if (!cleanName) continue;

        try {
          const defRes = await queryPostgres(`
            SELECT view_definition FROM information_schema.views
            WHERE table_schema = $1 AND table_name = $2
          `, [schemaName, cleanName]);
          let def = defRes.rows[0]?.view_definition;
          if (def) {
            const item = await this.saveViewDefinition({
              schema_name: schemaName,
              view_name: cleanName,
              query_sql: def,
              description: `Auto-synced dari PostgreSQL "${schemaName}"."${cleanName}"`,
              connection_id: connectionId ? parseInt(connectionId, 10) : (conn?.connection_id || null),
            });
            synced.push(item);
          }
        } catch (err) {
          console.warn(`Gagal sync view ${cleanName}:`, err.message);
        }
      }
    }

    return {
      totalSynced: synced.length,
      synced,
    };
  }
}

module.exports = new SourceService();
