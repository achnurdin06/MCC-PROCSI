const sourceService = require('../services/source.service');

class SourceController {
  async getViewsSummary(req, res) {
    try {
      const data = await sourceService.getDboViewsSummary();
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getViewData(req, res) {
    try {
      const { view, page, limit, search } = req.query;
      if (!view) {
        return res.status(400).json({ success: false, error: 'Parameter "view" wajib diisi.' });
      }

      const data = await sourceService.getViewData({ view, page, limit, search });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = new SourceController();
