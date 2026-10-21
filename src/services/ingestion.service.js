const { querySqlServer } = require('../config/sqlserver');
const { queryPostgres, getPostgresPool } = require('../config/postgres');
const dbDispatcher = require('./db-dispatcher.service');

/**
 * Ingestion Service
 * Melakukan dynamic data extraction dari SQL Server View dan bulk insertion ke PostgreSQL Staging
 * Tanpa hardcoded schema/tipe data (bebas kendala UUID seperti pada Apache Hop).
 */
class IngestionService {
  /**
   * Introspeksi kolom yang cocok antara SQL Server View dan PostgreSQL Staging Table
   */
  async getMatchingColumns(srcSchema, srcView, stgTable) {
    // 1. Kolom di SQL Server
    const mssqlColRes = await querySqlServer(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @view
    `, { schema: srcSchema, view: srcView });

    const mssqlCols = (mssqlColRes.recordset || []).map(r => ({
      name: r.COLUMN_NAME,
      lower: r.COLUMN_NAME.toLowerCase(),
      type: r.DATA_TYPE.toLowerCase()
    }));

    // 2. Kolom di PostgreSQL Staging Table
    const actualStg = stgTable.endsWith('_src') ? stgTable : `${stgTable}_src`;
    const pgColRes = await queryPostgres(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'stg_antam' AND table_name = $1
    `, [actualStg]);

    const pgCols = (pgColRes.rows || []).map(r => ({
      name: r.column_name,
      lower: r.column_name.toLowerCase(),
      type: r.data_type.toLowerCase(),
      udt: r.udt_name.toLowerCase()
    }));

    // 3. Cocokkan kolom yang ada di kedua database (case-insensitive)
    const matching = [];
    for (const pCol of pgCols) {
      const match = mssqlCols.find(m => m.lower === pCol.lower);
      if (match) {
        matching.push({
          srcCol: match.name,
          pgCol: pCol.name,
          pgType: pCol.type,
          pgUdt: pCol.udt
        });
      }
    }

    if (matching.length === 0) {
      throw new Error(`Tidak ditemukan kolom yang cocok antara SQL Server ${srcSchema}.${srcView} dan Staging stg_antam.${actualStg}`);
    }

    return { actualStg, matching };
  }

  /**
   * Hitung total baris di SQL Server View
   */
  async countSourceRows(srcSchema, srcView) {
    const res = await querySqlServer(`SELECT COUNT_BIG(*) AS total FROM [${srcSchema}].[${srcView}]`);
    return parseInt(res.recordset[0]?.total || 0, 10);
  }

  /**
   * Sanitasi & konversi nilai baris agar aman masuk ke PostgreSQL
   */
  formatValueForPg(val, pgType, pgUdt) {
    if (val === undefined || val === null) return null;

    // UUID casting
    if (pgUdt === 'uuid' || pgType === 'uuid') {
      const str = String(val).trim();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(str) ? str : null;
    }

    // Boolean casting (bit SQL Server 0/1)
    if (pgType === 'boolean') {
      if (val === true || val === 1 || val === '1' || val === 'true') return true;
      if (val === false || val === 0 || val === '0' || val === 'false') return false;
      return null;
    }

    // Date/Timestamp handling
    if (pgType.includes('timestamp') || pgType.includes('date')) {
      if (val instanceof Date) return val.toISOString();
      const str = String(val).trim();
      if (!str || str === 'NULL' || str === '1900-01-01') return null;
      const d = new Date(str);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }

    // Number handling
    if (pgType.includes('int') || pgType.includes('numeric') || pgType.includes('double')) {
      if (val === '' || val === 'NULL') return null;
      return val;
    }

    return String(val);
  }

  /**
   * Jalankan streaming ingestion dari SQL Server ke PostgreSQL Staging
   */
  async streamIngestion({
    runId,
    configId,
    srcSchema,
    srcView,
    stgTable,
    batchSize = 2000,
    onProgress = null
  }) {
    const startTime = Date.now();
    const { actualStg, matching } = await this.getMatchingColumns(srcSchema, srcView, stgTable);
    const totalRows = await this.countSourceRows(srcSchema, srcView);

    if (totalRows === 0) {
      await dbDispatcher.logStep({
        runId,
        configId,
        stepName: 'STAGING',
        status: 'OK',
        message: 'Tidak ada data pada view sumber (0 baris).',
        rowsSrc: 0,
        rowsStg: 0
      });
      return { totalRows: 0, loadedRows: 0, errorRows: 0, elapsedMs: Date.now() - startTime };
    }

    // Ambil seluruh data dari SQL Server View
    // Kolom diambil sesuai daftar matching
    const selectCols = matching.map(m => `[${m.srcCol}]`).join(', ');
    const srcQuery = `SELECT ${selectCols} FROM [${srcSchema}].[${srcView}]`;

    const srcData = await querySqlServer(srcQuery);
    const rows = srcData.recordset || [];

    // Dynamic Safe Batch Sizing (PostgreSQL 65,535 parameter limit protection)
    const colCount = Math.max(1, matching.length);
    const maxSafeChunk = Math.floor(60000 / colCount);
    const effectiveBatchSize = Math.max(50, Math.min(batchSize || 2000, maxSafeChunk));

    let loadedRows = 0;
    let errorRows = 0;
    const pgColNames = matching.map(m => `"${m.pgCol}"`).join(', ');

    try {
      // Chunking per effectiveBatchSize untuk parameterized multi-row insert
      for (let i = 0; i < rows.length; i += effectiveBatchSize) {
        const chunk = rows.slice(i, i + effectiveBatchSize);
        
        try {
          const valuePlaceholders = [];
          const params = [];
          let paramIdx = 1;

          for (const row of chunk) {
            const rowPlaceholders = [];
            for (const m of matching) {
              const rawVal = row[m.srcCol];
              const formatted = this.formatValueForPg(rawVal, m.pgType, m.pgUdt);
              params.push(formatted);
              rowPlaceholders.push(`$${paramIdx++}`);
            }
            valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
          }

          const insertQuery = `
            INSERT INTO stg_antam."${actualStg}" (${pgColNames})
            VALUES ${valuePlaceholders.join(', ')}
          `;

          await queryPostgres(insertQuery, params);
          loadedRows += chunk.length;
        } catch (chunkErr) {
          // Fallback: Jika batch gagal (misal data type mismatch pada salah satu baris),
          // lakukan insert per-baris untuk mengisolasi baris bermasalah ke migration_error_log
          for (const row of chunk) {
            try {
              const rowParams = [];
              const rowPlaceholders = [];
              let pIdx = 1;
              for (const m of matching) {
                rowParams.push(this.formatValueForPg(row[m.srcCol], m.pgType, m.pgUdt));
                rowPlaceholders.push(`$${pIdx++}`);
              }
              await queryPostgres(
                `INSERT INTO stg_antam."${actualStg}" (${pgColNames}) VALUES (${rowPlaceholders.join(', ')})`,
                rowParams
              );
              loadedRows++;
            } catch (singleRowErr) {
              errorRows++;
              const rowDataStr = Object.entries(row).map(([k, v]) => `${k}=${v}`).join('|');
              await dbDispatcher.logError({
                runId,
                configId,
                stepName: 'STAGING',
                pipelineName: 'native_ingestion_stream',
                transformName: 'insert_staging',
                errorCode: 'STAGING_INSERT_ERROR',
                errorMessage: singleRowErr.message,
                errorField: actualStg,
                rowData: rowDataStr.substring(0, 2000)
              });
            }
          }
        }

        // Notifikasi callback progress untuk real-time events
        const elapsed = Date.now() - startTime;
        const speed = elapsed > 0 ? Math.round((loadedRows / elapsed) * 1000) : loadedRows;
        if (typeof onProgress === 'function') {
          onProgress({
            loadedRows,
            totalRows,
            errorRows,
            speed,
            percent: Math.min(100, Math.round((loadedRows / totalRows) * 100))
          });
        }
      }

      const totalElapsed = Date.now() - startTime;
      const streamMsg = `Selesai streaming data ke stg_antam.[${actualStg}]: ${loadedRows}/${totalRows} baris berhasil, ${errorRows} baris error (batch size: ${effectiveBatchSize}), durasi ${totalElapsed}ms`;
      return { 
        totalRows, 
        loadedRows, 
        errorRows, 
        elapsedMs: totalElapsed, 
        message: streamMsg 
      };
    } catch (streamErr) {
      // Idempotent Auto-Cleanup on Failure (Kimball Staging Best Practice)
      // Mencegah sisa data setengah jalan (partial dirty data) mengotori tabel staging
      try {
        await queryPostgres(`TRUNCATE TABLE stg_antam."${actualStg}"`);
        console.warn(`[INGESTION] Auto-clean: Tabel stg_antam."${actualStg}" di-truncate setelah streaming terhenti akibat error.`);
      } catch (cleanupErr) {
        console.error(`[INGESTION] Gagal melakukan auto-cleanup staging:`, cleanupErr.message);
      }
      throw streamErr;
    }
  }
}

module.exports = new IngestionService();
