const etlService = require('../services/etl.service');

class EtlController {
  // ==========================================
  // CONTEXT & WIZARD
  // ==========================================
  async getStatus(req, res) {
    try {
      const data = await etlService.getInitializationStatus();
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async initWizard(req, res) {
    try {
      const data = await etlService.initWizard(req.body);
      return res.json({ success: true, data, message: 'Inisialisasi sistem berhasil disimpan!' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ==========================================
  // CLIENT CRUD
  // ==========================================
  async getClients(req, res) {
    try {
      const data = await etlService.getClients(req.user);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async createClient(req, res) {
    try {
      const data = await etlService.createClient(req.body);
      return res.json({ success: true, data, message: 'Client berhasil ditambahkan.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async updateClient(req, res) {
    try {
      const data = await etlService.updateClient(req.params.id, req.body);
      return res.json({ success: true, data, message: 'Client berhasil diperbarui.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async deleteClient(req, res) {
    try {
      const data = await etlService.deleteClient(req.params.id);
      return res.json({ success: true, data, message: 'Client berhasil dihapus.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ==========================================
  // ENVIRONMENT CRUD
  // ==========================================
  async getEnvironmentDetails(req, res) {
    try {
      const data = await etlService.getEnvironmentWithConnections(req.params.id);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getEnvironmentHealth(req, res) {
    try {
      const data = await etlService.getEnvironmentHealth(req.params.id);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async saveEnvironmentWithConnections(req, res) {
    try {
      const data = await etlService.saveEnvironmentWithConnections(req.body);
      return res.json({ success: true, data, message: 'Environment dan daftar koneksi berhasil disimpan.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getEnvironments(req, res) {
    try {
      const { clientId } = req.query;
      const data = await etlService.getEnvironments(clientId, req.user);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async createEnvironment(req, res) {
    try {
      const data = await etlService.createEnvironment(req.body);
      return res.json({ success: true, data, message: 'Environment berhasil ditambahkan.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async updateEnvironment(req, res) {
    try {
      const data = await etlService.updateEnvironment(req.params.id, req.body);
      return res.json({ success: true, data, message: 'Environment berhasil diperbarui.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async deleteEnvironment(req, res) {
    try {
      const data = await etlService.deleteEnvironment(req.params.id);
      return res.json({ success: true, data, message: 'Environment berhasil dihapus.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ==========================================
  // CONNECTION CRUD & TEST PING
  // ==========================================
  async getConnections(req, res) {
    try {
      const { envId, clientId } = req.query;
      const data = await etlService.getConnections(envId, clientId);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async createConnection(req, res) {
    try {
      const data = await etlService.createConnection(req.body);
      return res.json({ success: true, data, message: 'Koneksi database berhasil ditambahkan.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async updateConnection(req, res) {
    try {
      const data = await etlService.updateConnection(req.params.id, req.body);
      return res.json({ success: true, data, message: 'Koneksi database berhasil diperbarui.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async deleteConnection(req, res) {
    try {
      const data = await etlService.deleteConnection(req.params.id);
      return res.json({ success: true, data, message: 'Koneksi database berhasil dihapus.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async testConnection(req, res) {
    try {
      const data = await etlService.testConnection(req.body);
      return res.json(data);
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ==========================================
  // CONFIG TABLES CRUD
  // ==========================================
  async getMasterConfigs(req, res) {
    try {
      const data = await etlService.getMasterConfigs(req.query);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async createConfigRecord(req, res) {
    try {
      const { table } = req.params;
      const data = await etlService.createConfigRecord(table, req.body);
      return res.json({ success: true, data, message: `Data berhasil ditambahkan ke tabel ${table}.` });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async updateConfigRecord(req, res) {
    try {
      const { table, id } = req.params;
      const data = await etlService.updateConfigRecord(table, id, req.body);
      return res.json({ success: true, data, message: `Data pada tabel ${table} berhasil diperbarui.` });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async deleteConfigRecord(req, res) {
    try {
      const { table, id } = req.params;
      const data = await etlService.deleteConfigRecord(table, id);
      return res.json({ success: true, data, message: `Data pada tabel ${table} berhasil dihapus.` });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ==========================================
  // PROCESS RUNS & LOGS
  // ==========================================
  async getOverview(req, res) {
    try {
      const { clientId, envId } = req.query;
      const data = await etlService.getEtlOverview({ clientId, envId });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getRuns(req, res) {
    try {
      const { limit, page, status, clientId, envId, sortBy, sortDir } = req.query;
      const data = await etlService.getMigrationRuns({ limit, page, status, clientId, envId, sortBy, sortDir });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getStepLogs(req, res) {
    try {
      const { runId, limit, page, status, sortBy, sortDir, clientId, envId } = req.query;
      const data = await etlService.getStepLogs({ runId, limit, page, status, sortBy, sortDir, clientId, envId });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getErrorLogs(req, res) {
    try {
      const { runId, limit, page, sortBy, sortDir, clientId, envId } = req.query;
      const data = await etlService.getErrorLogs({ runId, limit, page, sortBy, sortDir, clientId, envId });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ==========================================
  // SYNC TO APACHE HOP
  // ==========================================
  async syncHopConfig(req, res) {
    try {
      const { id } = req.params;
      const result = await etlService.generateHopConfig(id);
      return res.json({
        success: true,
        data: result,
        message: result.message || `File config Hop berhasil di-generate untuk environment ID ${id}.`,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = new EtlController();
