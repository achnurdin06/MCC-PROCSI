const pipelineService = require('../services/pipeline.service');

class PipelineController {
  async getPipelineSummary(req, res) {
    try {
      const data = await pipelineService.getPipelineSummary();
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getConfigDetail(req, res) {
    try {
      const { configId } = req.query;
      if (!configId) {
        return res.status(400).json({ success: false, error: 'Parameter "configId" wajib diisi.' });
      }

      const data = await pipelineService.getConfigDetail(configId);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getPipelineStageData(req, res) {
    try {
      const { configId, stage, page, limit } = req.query;
      if (!configId) {
        return res.status(400).json({ success: false, error: 'Parameter "configId" wajib diisi.' });
      }

      const data = await pipelineService.getPipelineStageData({ configId, stage, page, limit });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getBeritaAcara(req, res) {
    try {
      const { configId } = req.query;
      if (!configId) {
        return res.status(400).json({ success: false, error: 'Parameter "configId" wajib diisi.' });
      }

      const data = await pipelineService.getBeritaAcaraData(configId);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = new PipelineController();
