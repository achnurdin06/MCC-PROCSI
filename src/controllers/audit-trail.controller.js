const { listAuditTrail, recordMenuVisit } = require('../services/audit-trail.service');

class AuditTrailController {
  async recordMenu(req, res) {
    try {
      await recordMenuVisit({
        user: req.user,
        menuCode: req.body?.menuCode,
        envId: req.body?.envId,
        request: req,
      });
      return res.json({ success: true });
    } catch (err) {
      const forbidden = err.message.includes('tidak memiliki izin') || err.message.includes('assignment');
      const notFound = err.message.includes('tidak ditemukan');
      const invalid = err.message.includes('Kode menu tidak valid') || err.message.includes('Identitas pengguna tidak valid');
      if (!forbidden && !notFound && !invalid) {
        console.error('[AUDIT_TRAIL] Gagal mencatat menu:', err.message);
      }
      return res.status(forbidden ? 403 : notFound ? 404 : invalid ? 400 : 500).json({
        success: false,
        error: forbidden || notFound || invalid ? err.message : 'Gagal mencatat menu pada audit trail.',
      });
    }
  }

  async list(req, res) {
    try {
      const data = await listAuditTrail({
        user: req.user,
        search: req.query.search,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[AUDIT_TRAIL] Gagal memuat audit trail:', err.message);
      return res.status(500).json({ success: false, error: 'Gagal memuat audit trail.' });
    }
  }
}

module.exports = new AuditTrailController();
