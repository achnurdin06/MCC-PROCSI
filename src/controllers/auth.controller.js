const authService = require('../services/auth.service');

class AuthController {
  // Login
  async login(req, res) {
    try {
      const { username, password } = req.body;
      const result = await authService.login(username, password);
      res.json({
        success: true,
        data: result,
        message: `Selamat datang kembali, ${result.user.fullName}!`,
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err.message,
        message: err.message,
      });
    }
  }

  // Get current user profile
  async getMe(req, res) {
    try {
      const result = await authService.getProfile(req.user.userId);
      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err.message,
        message: err.message,
      });
    }
  }

  // Logout (stateless confirmation)
  async logout(req, res) {
    res.json({
      success: true,
      message: 'Sesi berhasil diakhiri.',
    });
  }

  // User Management
  async getUsers(req, res) {
    try {
      const users = await authService.getUsers();
      res.json({ success: true, data: users });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message, message: err.message });
    }
  }

  async createUser(req, res) {
    try {
      const user = await authService.createUser(req.body);
      res.json({
        success: true,
        data: user,
        message: `User '${user.username}' berhasil ditambahkan.`,
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message, message: err.message });
    }
  }

  async updateUser(req, res) {
    try {
      const user = await authService.updateUser(req.params.id, req.body);
      res.json({
        success: true,
        data: user,
        message: 'Data user berhasil diperbarui.',
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message, message: err.message });
    }
  }

  async resetPassword(req, res) {
    try {
      const password = req.body.password || req.body.new_password;
      const user = await authService.resetPassword(req.params.id, password);
      res.json({
        success: true,
        data: user,
        message: `Kata sandi untuk user '${user.username}' berhasil diubah.`,
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message, message: err.message });
    }
  }

  async deleteUser(req, res) {
    try {
      const result = await authService.deleteUser(req.params.id);
      res.json({
        success: true,
        data: result,
        message: 'Pengguna berhasil dihapus.',
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message, message: err.message });
    }
  }

  // Role Management
  async getRoles(req, res) {
    try {
      const roles = await authService.getRoles();
      res.json({ success: true, data: roles });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message, message: err.message });
    }
  }

  async createRole(req, res) {
    try {
      const role = await authService.createRole(req.body);
      res.json({
        success: true,
        data: role,
        message: `Role '${role.role_name}' berhasil dibuat.`,
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message, message: err.message });
    }
  }

  async updateRole(req, res) {
    try {
      const role = await authService.updateRole(req.params.id, req.body);
      res.json({
        success: true,
        data: role,
        message: 'Data role berhasil diperbarui.',
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message, message: err.message });
    }
  }

  async deleteRole(req, res) {
    try {
      const result = await authService.deleteRole(req.params.id);
      res.json({
        success: true,
        data: result,
        message: 'Role berhasil dihapus.',
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message, message: err.message });
    }
  }

  // Menu Management
  async getMenus(req, res) {
    try {
      const menus = await authService.getMenus();
      res.json({ success: true, data: menus });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message, message: err.message });
    }
  }

  async getRolePermissions(req, res) {
    try {
      const permissions = await authService.getRolePermissions(req.params.roleId);
      res.json({ success: true, data: permissions });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message, message: err.message });
    }
  }

  async saveRolePermissions(req, res) {
    try {
      const permissions = await authService.saveRolePermissions(
        req.params.roleId,
        req.body.permissions
      );
      res.json({
        success: true,
        data: permissions,
        message: 'Matriks izin menu berhasil disimpan.',
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message, message: err.message });
    }
  }
}

module.exports = new AuthController();
