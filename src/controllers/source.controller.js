const sourceService = require('../services/source.service');

class SourceController {
  async getViewsSummary(req, res) {
    try {
      const { connection_id, client_id, env_id, refresh } = req.query;
      const data = await sourceService.getDboViewsSummary(connection_id, {
        clientId: client_id ? parseInt(client_id, 10) : null,
        envId: env_id ? parseInt(env_id, 10) : null,
        refresh: refresh === 'true' || refresh === '1',
      });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getViewData(req, res) {
    try {
      const { view, page, limit, search, connection_id } = req.query;
      if (!view) {
        return res.status(400).json({ success: false, error: 'Parameter "view" wajib diisi.' });
      }

      const data = await sourceService.getViewData({ view, page, limit, search, connectionId: connection_id });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getViewDefinition(req, res) {
    try {
      const { view, connection_id } = req.query;
      if (!view) {
        return res.status(400).json({ success: false, error: 'Parameter "view" wajib diisi.' });
      }

      const data = await sourceService.getViewDefinition(view, connection_id);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async saveViewDefinition(req, res) {
    try {
      const data = await sourceService.saveViewDefinition(req.body);
      return res.json({ success: true, data, message: 'Definisi view berhasil disimpan & disinkronkan ke tabel konfigurasi.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async createOrAlterView(req, res) {
    try {
      const data = await sourceService.createOrAlterView(req.body);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async validateQuery(req, res) {
    try {
      const { query_sql, connection_id } = req.body;
      const data = await sourceService.validateQuery(query_sql, connection_id);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async dropView(req, res) {
    try {
      const { viewName } = req.params;
      const connectionId = req.query.connection_id || req.body?.connection_id;
      const data = await sourceService.dropView(viewName, connectionId);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async syncAllViews(req, res) {
    try {
      const connectionId = req.query.connection_id || req.body?.connection_id;
      const data = await sourceService.syncAllExistingViews(connectionId);
      return res.json({ success: true, data, message: 'Seluruh view berhasil disinkronkan ke tabel konfigurasi.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = new SourceController();
