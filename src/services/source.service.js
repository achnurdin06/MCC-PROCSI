const { querySqlServer } = require('../config/sqlserver');

function sanitizeIdentifier(name) {
  if (!name || typeof name !== 'string') return null;
  const clean = name.replace(/[^a-zA-Z0-9_]/g, '');
  return clean.length > 0 ? clean : null;
}

class SourceService {
  /**
   * Mengambil seluruh View di schema dbo pada SQL Server beserta total barisnya
   */
  async getDboViewsSummary() {
    // 1. Ambil seluruh VIEW di schema dbo
    const viewsQuery = await querySqlServer(`
      SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name]
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_TYPE = 'VIEW'
      ORDER BY TABLE_NAME
    `);

    const views = viewsQuery.recordset;
    const viewList = [];
    let totalRowsAllViews = 0;

    // 2. Ambil count baris untuk masing-masing view
    for (const v of views) {
      const cleanName = sanitizeIdentifier(v.name);
      let count = 0;
      let error = null;

      if (cleanName) {
        try {
          const countRes = await querySqlServer(`SELECT COUNT_BIG(1) AS total FROM [dbo].[${cleanName}]`);
          count = parseInt(countRes.recordset[0]?.total, 10) || 0;
          totalRowsAllViews += count;
        } catch (err) {
          error = err.message;
        }
      }

      viewList.push({
        schema: 'dbo',
        name: v.name,
        count,
        error,
      });
    }

    return {
      schema: 'dbo',
      database: 'antam_scm',
      totalViews: viewList.length,
      totalRowsAllViews,
      views: viewList,
    };
  }

  /**
   * Mengambil data isi record dari salah satu VIEW di SQL Server dengan paginasi
   */
  async getViewData(options) {
    const { view, page = 1, limit = 25, search = '' } = options;
    const cleanView = sanitizeIdentifier(view);
    if (!cleanView) {
      throw new Error('Nama view SQL Server tidak valid.');
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const offset = (pageNum - 1) * limitNum;

    // Daftar kolom
    const colQuery = await querySqlServer(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${cleanView}'
      ORDER BY ORDINAL_POSITION
    `);
    const columns = colQuery.recordset.map((c) => ({
      name: c.COLUMN_NAME,
      type: c.DATA_TYPE,
      nullable: c.IS_NULLABLE === 'YES',
    }));

    if (columns.length === 0) {
      throw new Error(`View [dbo].[${cleanView}] tidak ditemukan atau tidak memiliki kolom.`);
    }

    let total = 0;
    let rows = [];
    let bindingError = null;

    try {
      // Hitung total baris
      const countRes = await querySqlServer(`SELECT COUNT_BIG(1) AS total FROM [dbo].[${cleanView}]`);
      total = parseInt(countRes.recordset[0]?.total, 10) || 0;

      // Order by kolom pertama secara default
      const firstCol = columns[0].name;

      // Query data dengan paging
      const dataRes = await querySqlServer(`
        SELECT * FROM [dbo].[${cleanView}]
        ORDER BY [${firstCol}]
        OFFSET ${offset} ROWS
        FETCH NEXT ${limitNum} ROWS ONLY
      `);
      rows = dataRes.recordset;
    } catch (err) {
      bindingError = err.message;
    }

    return {
      schema: 'dbo',
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
}

module.exports = new SourceService();
