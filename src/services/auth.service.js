const { queryPostgres } = require('../config/postgres');
const { signToken, hashPassword, verifyPassword } = require('../utils/jwt');

class AuthService {
  /**
   * Autentikasi Pengguna & Penerbitan JWT
   */
  async login(username, password) {
    if (!username || !password) {
      throw new Error('Username dan password wajib diisi.');
    }

    const cleanUser = username.trim().toLowerCase();
    const userRes = await queryPostgres(
      `SELECT u.user_id, u.username, u.password_hash, u.full_name, u.email, u.is_active,
              u.client_id, c.client_code, c.client_name,
              u.env_id, e.env_code, e.env_name,
              r.role_id, r.role_code, r.role_name
       FROM etl_antam.sys_users u
       LEFT JOIN etl_antam.sys_roles r ON u.role_id = r.role_id
       LEFT JOIN etl_antam.master_client c ON u.client_id = c.client_id
       LEFT JOIN etl_antam.master_environment e ON u.env_id = e.env_id
       WHERE LOWER(u.username) = $1`,
      [cleanUser]
    );

    if (userRes.rows.length === 0) {
      throw new Error('Username atau kata sandi tidak sesuai.');
    }

    const user = userRes.rows[0];

    if (!user.is_active) {
      throw new Error('Akun pengguna ini sedang dinonaktifkan. Hubungi administrator.');
    }

    const isValidPassword = verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      throw new Error('Username atau kata sandi tidak sesuai.');
    }

    // Update last_login_at
    await queryPostgres(
      `UPDATE etl_antam.sys_users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
      [user.user_id]
    );

    // Ambil daftar menu & hak akses role
    const permissions = await this.getRolePermissions(user.role_id);
    const allowedMenus = permissions.filter((p) => p.can_view);

    // Ambil multi-client & multi-env penugasan
    const userClientsRes = await queryPostgres(
      `SELECT c.client_id, c.client_code, c.client_name 
       FROM etl_antam.sys_user_clients uc
       JOIN etl_antam.master_client c ON uc.client_id = c.client_id
       WHERE uc.user_id = $1
       ORDER BY c.client_id`,
      [user.user_id]
    );
    const userEnvsRes = await queryPostgres(
      `SELECT e.env_id, e.env_code, e.env_name, e.client_id 
       FROM etl_antam.sys_user_environments ue
       JOIN etl_antam.master_environment e ON ue.env_id = e.env_id
       WHERE ue.user_id = $1
       ORDER BY e.env_id`,
      [user.user_id]
    );

    let assignedClients = userClientsRes.rows;
    let clientIds = assignedClients.map(c => c.client_id);
    if (clientIds.length === 0 && user.client_id) {
      clientIds = [user.client_id];
      if (user.client_name) {
        assignedClients = [{ client_id: user.client_id, client_code: user.client_code, client_name: user.client_name }];
      }
    }

    let assignedEnvironments = userEnvsRes.rows;
    let envIds = assignedEnvironments.map(e => e.env_id);
    if (envIds.length === 0 && user.env_id) {
      envIds = [user.env_id];
      if (user.env_name) {
        assignedEnvironments = [{ env_id: user.env_id, env_code: user.env_code, env_name: user.env_name, client_id: user.client_id }];
      }
    }

    const tokenPayload = {
      userId: user.user_id,
      username: user.username,
      fullName: user.full_name,
      roleId: user.role_id,
      roleCode: user.role_code,
      roleName: user.role_name,
      clientId: user.client_id,
      clientCode: user.client_code,
      clientName: user.client_name,
      envId: user.env_id,
      envCode: user.env_code,
      envName: user.env_name,
      clientIds,
      envIds,
    };

    const token = signToken(tokenPayload);

    return {
      token,
      user: {
        userId: user.user_id,
        username: user.username,
        fullName: user.full_name,
        email: user.email,
        roleId: user.role_id,
        roleCode: user.role_code,
        roleName: user.role_name,
        clientId: user.client_id,
        clientCode: user.client_code,
        clientName: user.client_name,
        envId: user.env_id,
        envCode: user.env_code,
        envName: user.env_name,
        clientIds,
        assignedClients,
        envIds,
        assignedEnvironments,
      },
      menus: allowedMenus,
      permissions,
    };
  }

  /**
   * Profil pengguna yang sedang login berdasarkan JWT Token
   */
  async getProfile(userId) {
    const userRes = await queryPostgres(
      `SELECT u.user_id, u.username, u.full_name, u.email, u.is_active, u.last_login_at,
              u.client_id, c.client_code, c.client_name,
              u.env_id, e.env_code, e.env_name,
              r.role_id, r.role_code, r.role_name
       FROM etl_antam.sys_users u
       LEFT JOIN etl_antam.sys_roles r ON u.role_id = r.role_id
       LEFT JOIN etl_antam.master_client c ON u.client_id = c.client_id
       LEFT JOIN etl_antam.master_environment e ON u.env_id = e.env_id
       WHERE u.user_id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      throw new Error('Pengguna tidak ditemukan.');
    }

    const user = userRes.rows[0];
    const permissions = await this.getRolePermissions(user.role_id);
    const allowedMenus = permissions.filter((p) => p.can_view);

    const userClientsRes = await queryPostgres(
      `SELECT c.client_id, c.client_code, c.client_name 
       FROM etl_antam.sys_user_clients uc
       JOIN etl_antam.master_client c ON uc.client_id = c.client_id
       WHERE uc.user_id = $1
       ORDER BY c.client_id`,
      [user.user_id]
    );
    const userEnvsRes = await queryPostgres(
      `SELECT e.env_id, e.env_code, e.env_name, e.client_id 
       FROM etl_antam.sys_user_environments ue
       JOIN etl_antam.master_environment e ON ue.env_id = e.env_id
       WHERE ue.user_id = $1
       ORDER BY e.env_id`,
      [user.user_id]
    );

    let assignedClients = userClientsRes.rows;
    let clientIds = assignedClients.map(c => c.client_id);
    if (clientIds.length === 0 && user.client_id) {
      clientIds = [user.client_id];
      if (user.client_name) {
        assignedClients = [{ client_id: user.client_id, client_code: user.client_code, client_name: user.client_name }];
      }
    }

    let assignedEnvironments = userEnvsRes.rows;
    let envIds = assignedEnvironments.map(e => e.env_id);
    if (envIds.length === 0 && user.env_id) {
      envIds = [user.env_id];
      if (user.env_name) {
        assignedEnvironments = [{ env_id: user.env_id, env_code: user.env_code, env_name: user.env_name, client_id: user.client_id }];
      }
    }

    return {
      user: {
        userId: user.user_id,
        username: user.username,
        fullName: user.full_name,
        email: user.email,
        roleId: user.role_id,
        roleCode: user.role_code,
        roleName: user.role_name,
        clientId: user.client_id,
        clientCode: user.client_code,
        clientName: user.client_name,
        envId: user.env_id,
        envCode: user.env_code,
        envName: user.env_name,
        clientIds,
        assignedClients,
        envIds,
        assignedEnvironments,
        lastLoginAt: user.last_login_at,
      },
      menus: allowedMenus,
      permissions,
    };
  }

  // ==========================================
  // USER MANAGEMENT
  // ==========================================
  async getUsers() {
    const res = await queryPostgres(`
      SELECT u.user_id, u.username, u.full_name, u.email, u.is_active, u.last_login_at, u.created_at,
             u.client_id, c.client_code, c.client_name,
             u.env_id, e.env_code, e.env_name,
             r.role_id, r.role_code, r.role_name,
             COALESCE(
               (SELECT json_agg(json_build_object('client_id', mc.client_id, 'client_code', mc.client_code, 'client_name', mc.client_name))
                FROM etl_antam.sys_user_clients uc
                JOIN etl_antam.master_client mc ON uc.client_id = mc.client_id
                WHERE uc.user_id = u.user_id),
               '[]'::json
             ) AS assigned_clients,
             COALESCE(
               (SELECT json_agg(json_build_object('env_id', me.env_id, 'env_code', me.env_code, 'env_name', me.env_name, 'client_id', me.client_id))
                FROM etl_antam.sys_user_environments ue
                JOIN etl_antam.master_environment me ON ue.env_id = me.env_id
                WHERE ue.user_id = u.user_id),
               '[]'::json
             ) AS assigned_environments
      FROM etl_antam.sys_users u
      LEFT JOIN etl_antam.sys_roles r ON u.role_id = r.role_id
      LEFT JOIN etl_antam.master_client c ON u.client_id = c.client_id
      LEFT JOIN etl_antam.master_environment e ON u.env_id = e.env_id
      ORDER BY u.user_id ASC
    `);
    return res.rows;
  }

  async createUser(data) {
    const { username, password, full_name, email, role_id, client_id, env_id, client_ids = [], env_ids = [], is_active = true } = data;
    if (!username || !password || !full_name) {
      throw new Error('Username, password, dan Nama Lengkap wajib diisi.');
    }

    const cleanUser = username.trim().toLowerCase();
    const existing = await queryPostgres(
      `SELECT user_id FROM etl_antam.sys_users WHERE LOWER(username) = $1`,
      [cleanUser]
    );
    if (existing.rows.length > 0) {
      throw new Error(`Username "${username}" sudah digunakan.`);
    }

    const resolvedClientId = client_ids.length > 0 ? parseInt(client_ids[0], 10) : (client_id ? parseInt(client_id, 10) : null);
    const resolvedEnvId = env_ids.length > 0 ? parseInt(env_ids[0], 10) : (env_id ? parseInt(env_id, 10) : null);
    const pwdHash = hashPassword(password);

    const res = await queryPostgres(
      `INSERT INTO etl_antam.sys_users (username, password_hash, full_name, email, role_id, client_id, env_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING user_id, username, full_name, email, role_id, client_id, env_id, is_active, created_at`,
      [cleanUser, pwdHash, full_name.trim(), email ? email.trim() : null, role_id ? parseInt(role_id, 10) : null, resolvedClientId, resolvedEnvId, is_active]
    );

    const newUser = res.rows[0];

    // Simpan penugasan multi-client
    const finalClientIds = Array.isArray(client_ids) && client_ids.length > 0 
      ? client_ids 
      : (client_id ? [client_id] : []);
    for (const cid of finalClientIds) {
      await queryPostgres(
        `INSERT INTO etl_antam.sys_user_clients (user_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [newUser.user_id, parseInt(cid, 10)]
      );
    }

    // Simpan penugasan multi-env
    const finalEnvIds = Array.isArray(env_ids) && env_ids.length > 0 
      ? env_ids 
      : (env_id ? [env_id] : []);
    for (const eid of finalEnvIds) {
      await queryPostgres(
        `INSERT INTO etl_antam.sys_user_environments (user_id, env_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [newUser.user_id, parseInt(eid, 10)]
      );
    }

    return newUser;
  }

  async updateUser(userId, data) {
    const { full_name, email, role_id, client_id, env_id, client_ids, env_ids, is_active } = data;
    const uid = parseInt(userId, 10);

    const resolvedClientId = Array.isArray(client_ids)
      ? (client_ids.length > 0 ? parseInt(client_ids[0], 10) : null)
      : (client_id !== undefined ? (client_id ? parseInt(client_id, 10) : null) : undefined);

    const resolvedEnvId = Array.isArray(env_ids)
      ? (env_ids.length > 0 ? parseInt(env_ids[0], 10) : null)
      : (env_id !== undefined ? (env_id ? parseInt(env_id, 10) : null) : undefined);

    const res = await queryPostgres(
      `UPDATE etl_antam.sys_users
       SET full_name = COALESCE($1, full_name),
           email = COALESCE($2, email),
           role_id = COALESCE($3, role_id),
           client_id = CASE WHEN $4::boolean THEN $5::integer ELSE client_id END,
           env_id = CASE WHEN $6::boolean THEN $7::integer ELSE env_id END,
           is_active = COALESCE($8, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $9
       RETURNING user_id, username, full_name, email, role_id, client_id, env_id, is_active, updated_at`,
      [
        full_name ? full_name.trim() : null,
        email !== undefined ? (email ? email.trim() : null) : null,
        role_id ? parseInt(role_id, 10) : null,
        resolvedClientId !== undefined,
        resolvedClientId,
        resolvedEnvId !== undefined,
        resolvedEnvId,
        is_active !== undefined ? is_active : null,
        uid,
      ]
    );

    if (res.rows.length === 0) {
      throw new Error(`User ID ${userId} tidak ditemukan.`);
    }

    // Update multi-client mapping if specified
    if (client_ids !== undefined) {
      await queryPostgres(`DELETE FROM etl_antam.sys_user_clients WHERE user_id = $1`, [uid]);
      if (Array.isArray(client_ids)) {
        for (const cid of client_ids) {
          if (cid) {
            await queryPostgres(
              `INSERT INTO etl_antam.sys_user_clients (user_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [uid, parseInt(cid, 10)]
            );
          }
        }
      }
    }

    // Update multi-env mapping if specified
    if (env_ids !== undefined) {
      await queryPostgres(`DELETE FROM etl_antam.sys_user_environments WHERE user_id = $1`, [uid]);
      if (Array.isArray(env_ids)) {
        for (const eid of env_ids) {
          if (eid) {
            await queryPostgres(
              `INSERT INTO etl_antam.sys_user_environments (user_id, env_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [uid, parseInt(eid, 10)]
            );
          }
        }
      }
    }

    return res.rows[0];
  }

  async resetPassword(userId, newPassword) {
    if (!newPassword || newPassword.length < 5) {
      throw new Error('Password baru minimal 5 karakter.');
    }
    const uid = parseInt(userId, 10);
    const pwdHash = hashPassword(newPassword);

    const res = await queryPostgres(
      `UPDATE etl_antam.sys_users
       SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2
       RETURNING user_id, username`,
      [pwdHash, uid]
    );

    if (res.rows.length === 0) {
      throw new Error(`User ID ${userId} tidak ditemukan.`);
    }
    return res.rows[0];
  }

  async deleteUser(userId) {
    const uid = parseInt(userId, 10);
    const res = await queryPostgres(
      `DELETE FROM etl_antam.sys_users WHERE user_id = $1 RETURNING user_id, username`,
      [uid]
    );
    if (res.rows.length === 0) {
      throw new Error(`User ID ${userId} tidak ditemukan.`);
    }
    return { success: true, deleted: res.rows[0] };
  }

  // ==========================================
  // ROLE MANAGEMENT
  // ==========================================
  async getRoles() {
    const res = await queryPostgres(`
      SELECT r.role_id, r.role_code, r.role_name, r.description, r.is_active, r.created_at,
             COUNT(u.user_id) AS user_count
      FROM etl_antam.sys_roles r
      LEFT JOIN etl_antam.sys_users u ON r.role_id = u.role_id
      GROUP BY r.role_id
      ORDER BY r.role_id ASC
    `);
    return res.rows;
  }

  async createRole(data) {
    const { role_code, role_name, description, is_active = true } = data;
    if (!role_code || !role_name) {
      throw new Error('Kode Role dan Nama Role wajib diisi.');
    }

    const cleanCode = role_code.trim().toUpperCase();
    const existing = await queryPostgres(
      `SELECT role_id FROM etl_antam.sys_roles WHERE role_code = $1`,
      [cleanCode]
    );
    if (existing.rows.length > 0) {
      throw new Error(`Kode Role "${cleanCode}" sudah ada.`);
    }

    const res = await queryPostgres(
      `INSERT INTO etl_antam.sys_roles (role_code, role_name, description, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [cleanCode, role_name.trim(), description ? description.trim() : null, is_active]
    );

    const newRole = res.rows[0];

    // Berikan izin default view untuk menu utama
    const allMenus = await this.getMenus();
    for (const m of allMenus) {
      await queryPostgres(
        `INSERT INTO etl_antam.sys_role_menus (role_id, menu_id, can_view, can_create, can_update, can_delete)
         VALUES ($1, $2, false, false, false, false)
         ON CONFLICT DO NOTHING`,
        [newRole.role_id, m.menu_id]
      );
    }

    return newRole;
  }

  async updateRole(roleId, data) {
    const { role_name, description, is_active } = data;
    const rid = parseInt(roleId, 10);

    const res = await queryPostgres(
      `UPDATE etl_antam.sys_roles
       SET role_name = COALESCE($1, role_name),
           description = COALESCE($2, description),
           is_active = COALESCE($3, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE role_id = $4
       RETURNING *`,
      [role_name ? role_name.trim() : null, description !== undefined ? description : null, is_active, rid]
    );

    if (res.rows.length === 0) {
      throw new Error(`Role ID ${roleId} tidak ditemukan.`);
    }
    return res.rows[0];
  }

  async deleteRole(roleId) {
    const rid = parseInt(roleId, 10);
    // Jangan hapus SUPERADMIN
    const chk = await queryPostgres(`SELECT role_code FROM etl_antam.sys_roles WHERE role_id = $1`, [rid]);
    if (chk.rows.length > 0 && chk.rows[0].role_code === 'SUPERADMIN') {
      throw new Error('Role SUPERADMIN sistem tidak boleh dihapus.');
    }

    const res = await queryPostgres(
      `DELETE FROM etl_antam.sys_roles WHERE role_id = $1 RETURNING role_id, role_code`,
      [rid]
    );
    if (res.rows.length === 0) {
      throw new Error(`Role ID ${roleId} tidak ditemukan.`);
    }
    return { success: true, deleted: res.rows[0] };
  }

  // ==========================================
  // MENU & PERMISSION MANAGEMENT
  // ==========================================
  async getMenus() {
    const res = await queryPostgres(`
      SELECT menu_id, menu_code, menu_name, menu_icon, menu_order, route_tab, is_active
      FROM etl_antam.sys_menus
      ORDER BY menu_order ASC, menu_id ASC
    `);
    return res.rows;
  }

  async getRolePermissions(roleId) {
    if (!roleId) return [];
    const rid = parseInt(roleId, 10);
    const res = await queryPostgres(
      `SELECT m.menu_id, m.menu_code, m.menu_name, m.menu_icon, m.menu_order, m.route_tab,
              COALESCE(rm.can_view, false) AS can_view,
              COALESCE(rm.can_create, false) AS can_create,
              COALESCE(rm.can_update, false) AS can_update,
              COALESCE(rm.can_delete, false) AS can_delete
       FROM etl_antam.sys_menus m
       LEFT JOIN etl_antam.sys_role_menus rm ON m.menu_id = rm.menu_id AND rm.role_id = $1
       ORDER BY m.menu_order ASC, m.menu_id ASC`,
      [rid]
    );
    return res.rows;
  }

  async saveRolePermissions(roleId, permissions) {
    const rid = parseInt(roleId, 10);
    if (!Array.isArray(permissions)) {
      throw new Error('Data izin permission harus berupa array.');
    }

    for (const item of permissions) {
      const mid = parseInt(item.menu_id, 10);
      const canView = Boolean(item.can_view);
      const canCreate = Boolean(item.can_create);
      const canUpdate = Boolean(item.can_update);
      const canDelete = Boolean(item.can_delete);

      await queryPostgres(
        `INSERT INTO etl_antam.sys_role_menus (role_id, menu_id, can_view, can_create, can_update, can_delete)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (role_id, menu_id) DO UPDATE SET
           can_view = EXCLUDED.can_view,
           can_create = EXCLUDED.can_create,
           can_update = EXCLUDED.can_update,
           can_delete = EXCLUDED.can_delete`,
        [rid, mid, canView, canCreate, canUpdate, canDelete]
      );
    }

    return this.getRolePermissions(rid);
  }
}

module.exports = new AuthService();
