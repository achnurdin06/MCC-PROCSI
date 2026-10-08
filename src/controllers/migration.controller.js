const migrationService = require('../services/migration.service');

class MigrationController {
  async getHealth(req, res) {
    try {
      const data = await migrationService.getHealthStatus();
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getTables(req, res) {
    try {
      const data = await migrationService.getTablesList();
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getSummary(req, res) {
    try {
      const data = await migrationService.getSummaryMetrics();
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getTableData(req, res) {
    try {
      const { db, schema, table, page, limit, search } = req.query;
      if (!table) {
        return res.status(400).json({ success: false, error: 'Parameter "table" wajib diisi.' });
      }

      const data = await migrationService.getTableData({
        database: db || 'postgres',
        schema,
        table,
        page,
        limit,
        search,
      });

      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getDiscrepancies(req, res) {
    try {
      const { table, sourceSchema, targetSchema, primaryKey, limit } = req.query;
      if (!table) {
        return res.status(400).json({ success: false, error: 'Parameter "table" wajib diisi.' });
      }

      const data = await migrationService.findDiscrepancies({
        table,
        sourceSchema,
        targetSchema,
        primaryKey,
        limit,
      });

      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = new MigrationController();
