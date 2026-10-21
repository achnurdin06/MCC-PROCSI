const dagEngine = require('../services/dag-engine.service');
const dbDispatcher = require('../services/db-dispatcher.service');

/**
 * Flow Canvas Controller
 * Menyediakan antarmuka REST API non-blocking asynchronous dan Server-Sent Events (SSE)
 */
class FlowCanvasController {
  /**
   * Ambil daftar template preset graf
   */
  async getPresets(req, res) {
    try {
      const { clientId, envId } = req.query;
      const presets = await dagEngine.getPresetTemplates({ clientId, envId });
      return res.json({ success: true, data: presets });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Eksekusi flow dinamis ASYNCHRONOUS (Non-Blocking)
   * Mengembalikan runId secara instan (<50ms) agar UI dapat langsung streaming progres via SSE
   */
  async executeFlow(req, res) {
    try {
      const {
        flowId = 'flow_1_staging',
        configId,
        configIds,
        runId,
        clientId,
        envId,
        customNodes,
        customEdges,
        params = {}
      } = req.body;

      // Mendukung multi-select configIds (array), string koma "1,2", single number, atau "ALL"
      const rawCfg = configIds || configId || 1;
      let parsedConfigIds;

      if (Array.isArray(rawCfg)) {
        parsedConfigIds = rawCfg.map(x => parseInt(x, 10)).filter(n => !isNaN(n));
      } else if (String(rawCfg).trim().toUpperCase() === 'ALL') {
        parsedConfigIds = 'ALL';
      } else if (String(rawCfg).includes(',')) {
        parsedConfigIds = String(rawCfg).split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n));
      } else {
        const single = parseInt(rawCfg, 10);
        parsedConfigIds = isNaN(single) ? [1] : [single];
      }

      // Mendukung multi-select runIds (array), string koma "192,193", atau single number
      const rawRun = req.body.runIds || req.body.runId;
      let parsedRunIds = null;
      if (rawRun) {
        if (Array.isArray(rawRun)) {
          parsedRunIds = rawRun.map(x => parseInt(x, 10)).filter(n => !isNaN(n));
        } else if (String(rawRun).includes(',')) {
          parsedRunIds = String(rawRun).split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n));
        } else {
          const single = parseInt(rawRun, 10);
          parsedRunIds = isNaN(single) ? null : [single];
        }
      }

      // Jalankan flow secara asynchronous non-blocking
      const startResult = await dagEngine.startFlowAsync({
        flowId,
        configId: parsedConfigIds,
        runId: (parsedRunIds && parsedRunIds.length > 0) ? parsedRunIds[0] : (runId ? parseInt(runId, 10) : null),
        runIds: parsedRunIds,
        clientId,
        envId,
        customNodes,
        customEdges,
        params
      });

      return res.json({
        success: true,
        data: startResult,
        message: startResult.message
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Ambil data diagnostik error detail untuk modal error handling
   */
  async getErrorDiagnostic(req, res) {
    try {
      const { runId } = req.params;
      if (!runId) return res.status(400).json({ success: false, error: 'Run ID wajib ditentukan.' });

      const diagnostics = await dagEngine.getErrorDiagnostic(runId);
      return res.json({ success: true, data: diagnostics });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Shortcut Eksekusi Flow 1 (Landing Staging & Convert) - Non-Blocking
   */
  async executeFlow1(req, res) {
    try {
      const { configId = 1, clientId, envId } = req.body;
      const startResult = await dagEngine.startFlowAsync({
        flowId: 'flow_1_staging',
        configId: parseInt(configId, 10),
        clientId,
        envId
      });
      return res.json({ success: true, data: startResult, message: 'Flow 1 Staging berhasil dimulai.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Shortcut Eksekusi Flow 2 (Multi-Target Post) - Non-Blocking
   */
  async executeFlow2(req, res) {
    try {
      const { runId, configId = 1, useBatch = 'Y', batchSize = 1000 } = req.body;
      if (!runId) return res.status(400).json({ success: false, error: 'Run ID wajib ditentukan untuk Flow 2 Post.' });

      const startResult = await dagEngine.startFlowAsync({
        flowId: 'flow_2_post',
        runId: parseInt(runId, 10),
        configId: parseInt(configId, 10),
        params: { useBatch, batchSize: parseInt(batchSize, 10) }
      });
      return res.json({ success: true, data: startResult, message: 'Flow 2 Post berhasil dimulai.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Shortcut Eksekusi Flow 3 (Safe Rollback) - Non-Blocking
   */
  async executeFlow3(req, res) {
    try {
      const { runId, configId } = req.body;
      if (!runId) return res.status(400).json({ success: false, error: 'Run ID wajib ditentukan untuk Rollback.' });

      const startResult = await dagEngine.startFlowAsync({
        flowId: 'flow_3_rollback',
        runId: parseInt(runId, 10),
        configId: configId ? parseInt(configId, 10) : null
      });
      return res.json({ success: true, data: startResult, message: 'Flow 3 Rollback berhasil dimulai.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Shortcut Eksekusi Flow 4 (Purge Target) - Non-Blocking
   */
  async executeFlow4(req, res) {
    try {
      const rawCfg = req.body.configIds || req.body.configId;
      let parsedConfigIds = [1];
      if (Array.isArray(rawCfg)) {
        parsedConfigIds = rawCfg.map(x => parseInt(x, 10)).filter(n => !isNaN(n));
      } else if (String(rawCfg).includes(',')) {
        parsedConfigIds = String(rawCfg).split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n));
      } else if (rawCfg !== undefined && rawCfg !== null) {
        const single = parseInt(rawCfg, 10);
        parsedConfigIds = isNaN(single) ? [1] : [single];
      }

      const { deleteIds = null } = req.body;
      const startResult = await dagEngine.startFlowAsync({
        flowId: 'flow_4_purge',
        configId: parsedConfigIds,
        params: { deleteIds }
      });
      return res.json({ success: true, data: startResult, message: 'Flow 4 Target Purge berhasil dimulai.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Server-Sent Events (SSE) Stream untuk Live Canvas Visualizer
   */
  streamFlowEvents(req, res) {
    const { runId } = req.params;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });

    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'Terkoneksi ke Live Stream Canvas', runId })}\n\n`);

    // 1. Replay event masa lalu yang sudah sempat di-emit agar tidak ada race condition jika stream terlambat connect
    const pastEvents = dagEngine.getRunEvents(runId);
    for (const ev of pastEvents) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }

    // Jika alur sudah tuntas sebelum stream terbuka, kirim event masa lalu lalu tutup stream
    const isFinished = pastEvents.some(e => e.type === 'FLOW_COMPLETED' || e.type === 'FLOW_FAILED');
    if (isFinished) {
      setTimeout(() => res.end(), 500);
      return;
    }

    const matchesRun = (data) => {
      const targetId = String(runId);
      return String(data.runId) === targetId || String(data.primaryRunId) === targetId;
    };

    const emitToClient = (data) => {
      if (matchesRun(data)) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    const onFlowStarted = (data) => emitToClient(data);
    const onBatchConfigStarted = (data) => emitToClient(data);
    const onBatchConfigCompleted = (data) => emitToClient(data);
    const onBatchRunStarted = (data) => emitToClient(data);
    const onBatchRunCompleted = (data) => emitToClient(data);
    const onBatchRunFailed = (data) => emitToClient(data);
    const onNodeStarted = (data) => emitToClient(data);
    const onNodeProgress = (data) => emitToClient(data);
    const onNodeCompleted = (data) => emitToClient(data);
    const onFlowCompleted = (data) => {
      emitToClient(data);
      setTimeout(() => res.end(), 1000);
    };
    const onFlowFailed = (data) => {
      emitToClient(data);
      setTimeout(() => res.end(), 1000);
    };

    dagEngine.on('flow_started', onFlowStarted);
    dagEngine.on('batch_config_started', onBatchConfigStarted);
    dagEngine.on('batch_config_completed', onBatchConfigCompleted);
    dagEngine.on('batch_run_started', onBatchRunStarted);
    dagEngine.on('batch_run_completed', onBatchRunCompleted);
    dagEngine.on('batch_run_failed', onBatchRunFailed);
    dagEngine.on('node_started', onNodeStarted);
    dagEngine.on('node_progress', onNodeProgress);
    dagEngine.on('node_completed', onNodeCompleted);
    dagEngine.on('flow_completed', onFlowCompleted);
    dagEngine.on('flow_failed', onFlowFailed);

    req.on('close', () => {
      dagEngine.off('flow_started', onFlowStarted);
      dagEngine.off('batch_config_started', onBatchConfigStarted);
      dagEngine.off('batch_config_completed', onBatchConfigCompleted);
      dagEngine.off('batch_run_started', onBatchRunStarted);
      dagEngine.off('batch_run_completed', onBatchRunCompleted);
      dagEngine.off('batch_run_failed', onBatchRunFailed);
      dagEngine.off('node_started', onNodeStarted);
      dagEngine.off('node_progress', onNodeProgress);
      dagEngine.off('node_completed', onNodeCompleted);
      dagEngine.off('flow_completed', onFlowCompleted);
      dagEngine.off('flow_failed', onFlowFailed);
    });
  }
}

module.exports = new FlowCanvasController();
