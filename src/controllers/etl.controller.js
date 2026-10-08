const etlService = require('../services/etl.service');

class EtlController {
  async getOverview(req, res) {
    try {
      const data = await etlService.getEtlOverview();
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getMasterConfigs(req, res) {
    try {
      const data = await etlService.getMasterConfigs();
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getRuns(req, res) {
    try {
      const { limit, page, status } = req.query;
      const data = await etlService.getMigrationRuns({ limit, page, status });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getStepLogs(req, res) {
    try {
      const { runId, limit } = req.query;
      const data = await etlService.getStepLogs({ runId, limit });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getErrorLogs(req, res) {
    try {
      const { runId, limit } = req.query;
      const data = await etlService.getErrorLogs({ runId, limit });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = new EtlController();
