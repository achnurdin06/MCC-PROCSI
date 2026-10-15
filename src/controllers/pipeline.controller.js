const pipelineService = require('../services/pipeline.service');

class PipelineController {
  async getPipelineSummary(req, res) {
    try {
      const { clientId, envId } = req.query;
      const data = await pipelineService.getPipelineSummary({ clientId, envId });
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
      const { configId, stage, page, limit, targetTable, targetSchema, sortBy, sortDir } = req.query;
      if (!configId) {
        return res.status(400).json({ success: false, error: 'Parameter "configId" wajib diisi.' });
      }

      const data = await pipelineService.getPipelineStageData({ configId, stage, page, limit, targetTable, targetSchema, sortBy, sortDir });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getBeritaAcara(req, res) {
    try {
      const { configId, configIds } = req.query;
      const targetParam = configIds || configId;
      if (!targetParam) {
        return res.status(400).json({ success: false, error: 'Parameter "configId" atau "configIds" wajib diisi.' });
      }

      const data = await pipelineService.getBeritaAcaraData(targetParam);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = new PipelineController();
