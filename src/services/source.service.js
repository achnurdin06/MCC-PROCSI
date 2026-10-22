const { querySqlServer, sql } = require('../config/sqlserver');
const { queryPostgres, pool: defaultPgPool } = require('../config/postgres');

function sanitizeIdentifier(name) {
  if (!name || typeof name !== 'string') return null;
  const clean = name.replace(/[^a-zA-Z0-9_]/g, '');
  return clean.length > 0 ? clean : null;
}

let inMemoryConfiguredViews = [];

const viewsSummaryCache = new Map();
const VIEWS_CACHE_TTL_MS = 60 * 1000; // 60 detik cache TTL

class SourceService {
  /**
   * Helper untuk membersihkan cache summary views
   */
  invalidateCache(connectionId = null) {
    if (connectionId) {
      for (const key of viewsSummaryCache.keys()) {
        if (key.startsWith(`${connectionId}_`)) {
          viewsSummaryCache.delete(key);
        }
      }
    } else {
      viewsSummaryCache.clear();
    }
  }

  /**
   * Helper untuk mengambil metadata koneksi dari database
   */
  async getConnectionMeta(connectionId) {
    if (!connectionId) return null;
    try {
      const res = await queryPostgres(
        'SELECT * FROM mc_center.master_connection WHERE connection_id = $1',
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
  async getDboViewsSummary(connectionId = null, context = {}) {
    if (!connectionId) {
      return { totalViews: 0, totalRowsAllViews: 0, views: [] };
    }

    const cacheKey = `${connectionId}_${context?.clientId || 0}_${context?.envId || 0}`;
    const isForceRefresh = Boolean(context?.refresh);

    if (!isForceRefresh && viewsSummaryCache.has(cacheKey)) {
      const cached = viewsSummaryCache.get(cacheKey);
      if (Date.now() - cached.timestamp < VIEWS_CACHE_TTL_MS) {
        return cached.data;
      }
      viewsSummaryCache.delete(cacheKey);
    }

    const conn = await this.getConnectionMeta(connectionId);
    if (!conn) {
      return { totalViews: 0, totalRowsAllViews: 0, views: [] };
    }
    const dbType = conn.db_type.toUpperCase();
    const schemaName = conn.db_schema || (dbType === 'MSSQL' ? 'dbo' : 'public');
    const databaseName = conn.database_name || 'antam_scm';

    let views = [];

    if (dbType === 'MSSQL') {
      try {
        const viewsQuery = await querySqlServer(`
          SELECT 
            t.TABLE_SCHEMA AS [schema], 
            t.TABLE_NAME AS [name],
            CAST(ep.value AS NVARCHAR(MAX)) AS [description]
          FROM INFORMATION_SCHEMA.TABLES t
          LEFT JOIN sys.extended_properties ep 
            ON ep.major_id = OBJECT_ID(QUOTENAME(t.TABLE_SCHEMA) + '.' + QUOTENAME(t.TABLE_NAME))
            AND ep.minor_id = 0
            AND ep.name = 'MS_Description'
          WHERE t.TABLE_SCHEMA = '${schemaName}' AND t.TABLE_TYPE = 'VIEW'
          ORDER BY t.TABLE_NAME
        `);
        views = viewsQuery.recordset || [];
      } catch (e) {
        const viewsQuery = await querySqlServer(`
          SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name]
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = '${schemaName}' AND TABLE_TYPE = 'VIEW'
          ORDER BY TABLE_NAME
        `);
        views = viewsQuery.recordset || [];
      }
    } else {
      // PostgreSQL Views
      try {
        const viewsQuery = await queryPostgres(`
          SELECT 
            c.relname AS "name",
            n.nspname AS "schema",
            d.description AS "description"
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
          WHERE n.nspname = $1 AND c.relkind = 'v'
          ORDER BY c.relname
        `, [schemaName]);
        views = viewsQuery.rows || [];
      } catch (e) {
        const viewsQuery = await queryPostgres(`
          SELECT table_schema AS "schema", table_name AS "name"
          FROM information_schema.views
          WHERE table_schema = $1
          ORDER BY table_name
        `, [schemaName]);
        views = viewsQuery.rows || [];
      }
    }

    // Ambil metadata dari mc_center.master_source_view
    let configuredMap = {};
    try {
      let q = 'SELECT view_id, view_name, query_sql, description, is_active, is_synced, connection_id FROM mc_center.master_source_view';
      const params = [];
      if (connectionId) {
        q += ' WHERE connection_id = $1';
        params.push(parseInt(connectionId, 10));
      }
      q += ' ORDER BY view_id ASC';
      const cfgRes = await queryPostgres(q, params);
      cfgRes.rows.forEach((r) => {
        configuredMap[r.view_name] = r;
      });
    } catch (e) {
      try {
        let q = 'SELECT view_id, view_name, query_sql, is_active, is_synced, connection_id FROM mc_center.master_source_view';
        const params = [];
        if (connectionId) {
          q += ' WHERE connection_id = $1';
          params.push(parseInt(connectionId, 10));
        }
        q += ' ORDER BY view_id ASC';
        const cfgRes = await queryPostgres(q, params);
        cfgRes.rows.forEach((r) => {
          configuredMap[r.view_name] = r;
        });
      } catch (err2) {
        inMemoryConfiguredViews.forEach((r) => {
          configuredMap[r.view_name] = r;
        });
      }
    }

    // Ambil metadata relasi dari mc_center.migration_config
    const migrationConfigMap = {};
    try {
      let mcQuery = `
        SELECT config_id, exec_order, src_schema, src_view, tgt_schema, tgt_table, stg_table, is_active, client_id, env_id
        FROM mc_center.migration_config
      `;
      const mcParams = [];
      const mcConds = [];
      if (context?.clientId) {
        mcConds.push(`(client_id = $${mcParams.length + 1} OR client_id IS NULL)`);
        mcParams.push(context.clientId);
      }
      if (context?.envId) {
        mcConds.push(`(env_id = $${mcParams.length + 1} OR env_id IS NULL)`);
        mcParams.push(context.envId);
      }
      if (mcConds.length > 0) {
        mcQuery += ` WHERE ${mcConds.join(' AND ')}`;
      }
      mcQuery += ' ORDER BY exec_order, config_id';
      const mcRes = await queryPostgres(mcQuery, mcParams);
      for (const row of mcRes.rows) {
        if (!row.src_view) continue;
        const viewKey = row.src_view.trim().toLowerCase();
        if (!migrationConfigMap[viewKey]) {
          migrationConfigMap[viewKey] = [];
        }
        migrationConfigMap[viewKey].push({
          configId: row.config_id,
          execOrder: row.exec_order,
          srcSchema: row.src_schema,
          srcView: row.src_view,
          tgtSchema: row.tgt_schema,
          tgtTable: row.tgt_table,
          stgTable: row.stg_table,
          isActive: row.is_active,
        });
      }
    } catch (err) {
      console.warn('Gagal memuat relasi migration_config:', err.message);
    }

    // Tuning performa: jalankan query COUNT secara bertahap (batch) dengan READ UNCOMMITTED & timeout guard 4s
    const BATCH_SIZE = 8;
    const viewList = [];
    for (let i = 0; i < views.length; i += BATCH_SIZE) {
      const chunk = views.slice(i, i + BATCH_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (v) => {
          const cleanName = sanitizeIdentifier(v.name);
          let count = 0;
          let error = null;

          if (cleanName) {
            try {
              if (dbType === 'MSSQL') {
                const countQuery = querySqlServer(
                  `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SELECT COUNT_BIG(1) AS total FROM [${schemaName}].[${cleanName}]`
                );
                const timeoutPromise = new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('Hitung baris timeout (4s)')), 4000)
                );
                const countRes = await Promise.race([countQuery, timeoutPromise]);
                count = parseInt(countRes.recordset[0]?.total, 10) || 0;
              } else {
                const countRes = await queryPostgres(`SELECT count(1) AS total FROM "${schemaName}"."${cleanName}"`);
                count = parseInt(countRes.rows[0]?.total, 10) || 0;
              }
            } catch (err) {
              error = err.message;
            }
          }

          const cfg = configuredMap[v.name];
          const viewDesc = (cfg && cfg.description) ? cfg.description : (v.description || '');
          const viewKey = v.name ? v.name.trim().toLowerCase() : '';
          const migConfigs = migrationConfigMap[viewKey] || [];
          const isMigrationConfigured = migConfigs.length > 0;

          return {
            schema: schemaName,
            name: v.name,
            description: viewDesc,
            count,
            error,
            connectionId: connectionId ? parseInt(connectionId, 10) : (conn?.connection_id || 1),
            connectionName: conn?.connection_name || 'Default Source (SQL Server)',
            isConfigured: Boolean(cfg),
            isSynced: cfg ? cfg.is_synced : false,
            isActive: cfg ? cfg.is_active : true,
            isMigrationConfigured,
            migrationConfigs: migConfigs,
          };
        })
      );
      viewList.push(...chunkResults);
    }
    const totalRowsAllViews = viewList.reduce((acc, curr) => acc + (curr.count || 0), 0);

    const result = {
      connectionId: connectionId ? parseInt(connectionId, 10) : (conn?.connection_id || 1),
      connectionName: conn?.connection_name || 'SQL Server Source (dbo)',
      dbType,
      schema: schemaName,
      database: databaseName,
      totalViews: viewList.length,
      totalRowsAllViews,
      totalMigrationConfigured: viewList.filter((v) => v.isMigrationConfigured).length,
      views: viewList,
    };

    // Simpan ke cache jika sukses
    viewsSummaryCache.set(cacheKey, {
      timestamp: Date.now(),
      data: result,
    });

    return result;
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
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '${schemaName}' AND TABLE_NAME = '${cleanView}'
        ORDER BY ORDINAL_POSITION
      `);
      columns = colQuery.recordset.map((c) => ({
        name: c.COLUMN_NAME,
        type: c.DATA_TYPE,
        nullable: c.IS_NULLABLE === 'YES',
        maxLength: c.CHARACTER_MAXIMUM_LENGTH,
        precision: c.NUMERIC_PRECISION,
        scale: c.NUMERIC_SCALE,
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
        SELECT column_name, data_type, is_nullable, character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [schemaName, cleanView]);

      columns = colQuery.rows.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
        maxLength: c.character_maximum_length,
        precision: c.numeric_precision,
        scale: c.numeric_scale,
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
   * Helper untuk mengekstrak perintah query SELECT murni
   * Menghilangkan komentar awalan, opsi SET/GO, serta klausa CREATE/ALTER VIEW ... AS
   */
  extractSelectQuery(rawSql) {
    if (!rawSql || typeof rawSql !== 'string') return '';
    let sql = rawSql.trim();

    // 1. Bersihkan komentar awal (-- baris atau /* blok */), opsi SET, dan GO dari skrip SQL Server
    sql = sql.replace(/^(?:\s*(?:--[^\r\n]*|\/\*[\s\S]*?\*\/|SET\s+[^;\r\n]+;?|GO\b)\s*)+/gi, '').trim();

    // 2. Regex mencocokkan pola CREATE (OR ALTER|REPLACE) VIEW <apapun> AS <query> atau ALTER VIEW <apapun> AS <query>
    const match = sql.match(/^(?:CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER)\s+VIEW\s+[\s\S]*?\bAS\b\s*([\s\S]*)$/i);
    if (match && match[1]) {
      sql = match[1].trim();
    }

    // 3. Bersihkan titik koma di akhir
    while (sql.endsWith(';')) {
      sql = sql.slice(0, -1).trim();
    }
    return sql;
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
        SELECT * FROM mc_center.master_source_view 
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

    let dbDescription = null;
    try {
      if (dbType === 'MSSQL') {
        const epRes = await querySqlServer(`
          SELECT CAST(ep.value AS NVARCHAR(MAX)) AS [description]
          FROM sys.extended_properties ep
          WHERE ep.major_id = OBJECT_ID(QUOTENAME('${schemaName}') + '.' + QUOTENAME('${cleanView}'))
            AND ep.minor_id = 0
            AND ep.name = 'MS_Description'
        `);
        dbDescription = epRes.recordset[0]?.description || null;
      } else {
        const descRes = await queryPostgres(`
          SELECT d.description
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
          WHERE n.nspname = $1 AND c.relname = $2
        `, [schemaName, cleanView]);
        dbDescription = descRes.rows[0]?.description || null;
      }
    } catch (e) {}

    const resolvedDescription = savedConfig?.description || dbDescription || '';
    const rawSql = savedConfig?.query_sql || dbDefinition || '';
    const cleanSelect = this.extractSelectQuery(rawSql);

    return {
      viewName: cleanView,
      schema: schemaName,
      connectionId: connectionId ? parseInt(connectionId, 10) : (conn?.connection_id || null),
      sqlServerDefinition: dbDefinition,
      querySql: cleanSelect || rawSql,
      description: resolvedDescription,
      savedConfig,
      isConfigured: Boolean(savedConfig),
    };
  }

  /**
   * Simpan atau sinkronkan definisi query view ke tabel mc_center.master_source_view
   */
  async saveViewDefinition(payload) {
    const { schema_name = 'dbo', view_name, query_sql, description = '', connection_id = null } = payload;
    const cleanView = sanitizeIdentifier(view_name);
    if (!cleanView || !query_sql) throw new Error('Nama view dan Query SQL wajib diisi.');

    // Selalu pastikan hanya klausa SELECT murni yang disimpan (tanpa pembungkus CREATE/ALTER VIEW ... AS)
    const pureQuerySql = this.extractSelectQuery(query_sql);
    if (!pureQuerySql) throw new Error('Query SQL tidak valid atau tidak memuat klausa query pembentuk.');

    try {
      // Upsert: periksa apakah sudah tercatat sebelumnya
      const checkQ = connection_id
        ? 'SELECT view_id FROM mc_center.master_source_view WHERE view_name = $1 AND schema_name = $2 AND connection_id = $3'
        : 'SELECT view_id FROM mc_center.master_source_view WHERE view_name = $1 AND schema_name = $2';
      const checkParams = connection_id ? [cleanView, schema_name, parseInt(connection_id, 10)] : [cleanView, schema_name];
      const existing = await queryPostgres(checkQ, checkParams);

      if (existing.rows.length > 0) {
        const updateRes = await queryPostgres(`
          UPDATE mc_center.master_source_view
          SET query_sql = $1, description = $2, is_active = true, is_synced = true, last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE view_id = $3
          RETURNING *
        `, [pureQuerySql, description, existing.rows[0].view_id]);
        return updateRes.rows[0];
      }

      const res = await queryPostgres(`
        INSERT INTO mc_center.master_source_view (
          schema_name, view_name, query_sql, description, connection_id, is_active, is_synced, last_synced_at
        ) VALUES ($1, $2, $3, $4, $5, true, true, CURRENT_TIMESTAMP)
        RETURNING *
      `, [
        schema_name,
        cleanView,
        pureQuerySql,
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
        query_sql: pureQuerySql,
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

    let cleanQuery = this.extractSelectQuery(query_sql);
    if (!cleanQuery) cleanQuery = query_sql.trim();
    while (cleanQuery.endsWith(';')) {
      cleanQuery = cleanQuery.slice(0, -1).trim();
    }

    // Pastikan uji validitas query lolos sebelum mengubah / membentuk View di database
    const valResult = await this.validateQuery(cleanQuery, connection_id);
    if (!valResult.valid) {
      throw new Error(`Uji validitas query gagal: ${valResult.error}`);
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
      columns: valResult.columns || [],
    };
  }

  /**
   * Validasi query SELECT sebelum membuat view
   */
  async validateQuery(querySql, connectionId = null) {
    if (!querySql || typeof querySql !== 'string') throw new Error('Query SQL wajib diisi.');

    const conn = await this.getConnectionMeta(connectionId);
    const dbType = conn ? conn.db_type.toUpperCase() : 'MSSQL';

    let cleanQuery = this.extractSelectQuery(querySql);
    if (!cleanQuery) cleanQuery = querySql.trim();
    while (cleanQuery.endsWith(';')) {
      cleanQuery = cleanQuery.slice(0, -1).trim();
    }

    const startTime = Date.now();
    try {
      if (dbType === 'MSSQL') {
        let res;
        // Jika query memiliki klausa WITH (CTE), jalankan parse metadata langsung
        if (/^\s*WITH\s+/i.test(cleanQuery)) {
          const testSql = `SET FMTONLY ON;\n${cleanQuery};\nSET FMTONLY OFF;`;
          res = await querySqlServer(testSql);
        } else {
          try {
            const testSql = `SELECT TOP 1 * FROM (\n${cleanQuery}\n) AS __syntax_validation_subquery`;
            res = await querySqlServer(testSql);
          } catch (subErr) {
            // Fallback ke SET FMTONLY jika pembungkusan subquery terkendala klausa ORDER BY
            const testSql = `SET FMTONLY ON;\n${cleanQuery};\nSET FMTONLY OFF;`;
            res = await querySqlServer(testSql);
          }
        }
        const durationMs = Date.now() - startTime;
        const columns = res.recordset && res.recordset.length > 0 ? Object.keys(res.recordset[0]) : [];
        return {
          valid: true,
          message: 'Query SQL valid dan siap dieksekusi sebagai View di SQL Server.',
          durationMs,
          columns,
          cleanQuery,
        };
      } else {
        const testSql = `SELECT * FROM (\n${cleanQuery}\n) AS __syntax_validation_subquery LIMIT 1`;
        const res = await queryPostgres(testSql);
        const durationMs = Date.now() - startTime;
        const columns = res.fields ? res.fields.map((f) => f.name) : [];
        return {
          valid: true,
          message: 'Query SQL valid dan siap dieksekusi sebagai View di PostgreSQL.',
          durationMs,
          columns,
          cleanQuery,
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

    // Dependency Guard: Cek apakah view ini aktif digunakan pada migration_config
    try {
      const activeConfigsRes = await queryPostgres(
        `SELECT config_id, name_config, tgt_table FROM mc_center.migration_config WHERE LOWER(TRIM(src_view)) = LOWER(TRIM($1))`,
        [cleanView]
      );
      if (activeConfigsRes.rows && activeConfigsRes.rows.length > 0) {
        const configLabels = activeConfigsRes.rows
          .map((c) => c.name_config || `Config #${c.config_id}`)
          .join(', ');
        throw new Error(
          `View [${cleanView}] diproteksi karena sedang aktif digunakan pada Migration Config: ${configLabels}. Harap hapus atau ubah konfigurasi terkait sebelum menghapus view ini.`
        );
      }
    } catch (err) {
      if (err.message && err.message.includes('diproteksi karena sedang aktif')) {
        throw err;
      }
      console.warn('Gagal cek dependensi migration_config:', err.message);
    }

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
        UPDATE mc_center.master_source_view 
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
            const cleanSql = this.extractSelectQuery(def);
            if (!cleanSql) {
              console.warn(`Gagal ekstrak query SELECT dari view [${schemaName}].[${cleanName}]`);
              continue;
            }
            const item = await this.saveViewDefinition({
              schema_name: schemaName,
              view_name: cleanName,
              query_sql: cleanSql,
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
            const cleanSql = this.extractSelectQuery(def);
            if (!cleanSql) {
              console.warn(`Gagal ekstrak query SELECT dari view "${schemaName}"."${cleanName}"`);
              continue;
            }
            const item = await this.saveViewDefinition({
              schema_name: schemaName,
              view_name: cleanName,
              query_sql: cleanSql,
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
