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
       FROM mc_center.sys_users u
       LEFT JOIN mc_center.sys_roles r ON u.role_id = r.role_id
       LEFT JOIN mc_center.master_client c ON u.client_id = c.client_id
       LEFT JOIN mc_center.master_environment e ON u.env_id = e.env_id
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
      `UPDATE mc_center.sys_users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
      [user.user_id]
    );

    // Ambil daftar menu & hak akses role
    const permissions = await this.getRolePermissions(user.role_id);
    const allowedMenus = permissions.filter((p) => p.can_view);

    // Ambil multi-client & multi-env penugasan
    const userClientsRes = await queryPostgres(
      `SELECT c.client_id, c.client_code, c.client_name 
       FROM mc_center.sys_user_clients uc
       JOIN mc_center.master_client c ON uc.client_id = c.client_id
       WHERE uc.user_id = $1
       ORDER BY c.client_id`,
      [user.user_id]
    );
    const userEnvsRes = await queryPostgres(
      `SELECT e.env_id, e.env_code, e.env_name, e.client_id 
       FROM mc_center.sys_user_environments ue
       JOIN mc_center.master_environment e ON ue.env_id = e.env_id
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
       FROM mc_center.sys_users u
       LEFT JOIN mc_center.sys_roles r ON u.role_id = r.role_id
       LEFT JOIN mc_center.master_client c ON u.client_id = c.client_id
       LEFT JOIN mc_center.master_environment e ON u.env_id = e.env_id
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
       FROM mc_center.sys_user_clients uc
       JOIN mc_center.master_client c ON uc.client_id = c.client_id
       WHERE uc.user_id = $1
       ORDER BY c.client_id`,
      [user.user_id]
    );
    const userEnvsRes = await queryPostgres(
      `SELECT e.env_id, e.env_code, e.env_name, e.client_id 
       FROM mc_center.sys_user_environments ue
       JOIN mc_center.master_environment e ON ue.env_id = e.env_id
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
                FROM mc_center.sys_user_clients uc
                JOIN mc_center.master_client mc ON uc.client_id = mc.client_id
                WHERE uc.user_id = u.user_id),
               '[]'::json
             ) AS assigned_clients,
             COALESCE(
               (SELECT json_agg(json_build_object('env_id', me.env_id, 'env_code', me.env_code, 'env_name', me.env_name, 'client_id', me.client_id))
                FROM mc_center.sys_user_environments ue
                JOIN mc_center.master_environment me ON ue.env_id = me.env_id
                WHERE ue.user_id = u.user_id),
               '[]'::json
             ) AS assigned_environments
      FROM mc_center.sys_users u
      LEFT JOIN mc_center.sys_roles r ON u.role_id = r.role_id
      LEFT JOIN mc_center.master_client c ON u.client_id = c.client_id
      LEFT JOIN mc_center.master_environment e ON u.env_id = e.env_id
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
      `SELECT user_id FROM mc_center.sys_users WHERE LOWER(username) = $1`,
      [cleanUser]
    );
    if (existing.rows.length > 0) {
      throw new Error(`Username "${username}" sudah digunakan.`);
    }

    const resolvedClientId = client_ids.length > 0 ? parseInt(client_ids[0], 10) : (client_id ? parseInt(client_id, 10) : null);
    const resolvedEnvId = env_ids.length > 0 ? parseInt(env_ids[0], 10) : (env_id ? parseInt(env_id, 10) : null);
    const pwdHash = hashPassword(password);

    const res = await queryPostgres(
      `INSERT INTO mc_center.sys_users (username, password_hash, full_name, email, role_id, client_id, env_id, is_active)
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
        `INSERT INTO mc_center.sys_user_clients (user_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [newUser.user_id, parseInt(cid, 10)]
      );
    }

    // Simpan penugasan multi-env
    const finalEnvIds = Array.isArray(env_ids) && env_ids.length > 0 
      ? env_ids 
      : (env_id ? [env_id] : []);
    for (const eid of finalEnvIds) {
      await queryPostgres(
        `INSERT INTO mc_center.sys_user_environments (user_id, env_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
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
      `UPDATE mc_center.sys_users
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
      await queryPostgres(`DELETE FROM mc_center.sys_user_clients WHERE user_id = $1`, [uid]);
      if (Array.isArray(client_ids)) {
        for (const cid of client_ids) {
          if (cid) {
            await queryPostgres(
              `INSERT INTO mc_center.sys_user_clients (user_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [uid, parseInt(cid, 10)]
            );
          }
        }
      }
    }

    // Update multi-env mapping if specified
    if (env_ids !== undefined) {
      await queryPostgres(`DELETE FROM mc_center.sys_user_environments WHERE user_id = $1`, [uid]);
      if (Array.isArray(env_ids)) {
        for (const eid of env_ids) {
          if (eid) {
            await queryPostgres(
              `INSERT INTO mc_center.sys_user_environments (user_id, env_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
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
      `UPDATE mc_center.sys_users
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
      `DELETE FROM mc_center.sys_users WHERE user_id = $1 RETURNING user_id, username`,
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
      FROM mc_center.sys_roles r
      LEFT JOIN mc_center.sys_users u ON r.role_id = u.role_id
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
      `SELECT role_id FROM mc_center.sys_roles WHERE role_code = $1`,
      [cleanCode]
    );
    if (existing.rows.length > 0) {
      throw new Error(`Kode Role "${cleanCode}" sudah ada.`);
    }

    const res = await queryPostgres(
      `INSERT INTO mc_center.sys_roles (role_code, role_name, description, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [cleanCode, role_name.trim(), description ? description.trim() : null, is_active]
    );

    const newRole = res.rows[0];

    // Berikan izin default view untuk menu utama
    const allMenus = await this.getMenus();
    for (const m of allMenus) {
      await queryPostgres(
        `INSERT INTO mc_center.sys_role_menus (role_id, menu_id, can_view, can_create, can_update, can_delete)
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
      `UPDATE mc_center.sys_roles
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
    const chk = await queryPostgres(`SELECT role_code FROM mc_center.sys_roles WHERE role_id = $1`, [rid]);
    if (chk.rows.length > 0 && chk.rows[0].role_code === 'SUPERADMIN') {
      throw new Error('Role SUPERADMIN sistem tidak boleh dihapus.');
    }

    const res = await queryPostgres(
      `DELETE FROM mc_center.sys_roles WHERE role_id = $1 RETURNING role_id, role_code`,
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
      SELECT menu_id, menu_code, menu_name, menu_icon, menu_order, route_tab, sub_title, content_html, is_custom, is_active, created_at, updated_at
      FROM mc_center.sys_menus
      ORDER BY menu_order ASC, menu_id ASC
    `);
    return res.rows;
  }

  async getRolePermissions(roleId) {
    if (!roleId) return [];
    const rid = parseInt(roleId, 10);
    const res = await queryPostgres(
      `SELECT m.menu_id, m.menu_code, m.menu_name, m.menu_icon, m.menu_order, m.route_tab, m.sub_title, m.content_html, m.is_custom, m.is_active,
              COALESCE(rm.can_view, false) AS can_view,
              COALESCE(rm.can_create, false) AS can_create,
              COALESCE(rm.can_update, false) AS can_update,
              COALESCE(rm.can_delete, false) AS can_delete
       FROM mc_center.sys_menus m
       LEFT JOIN mc_center.sys_role_menus rm ON m.menu_id = rm.menu_id AND rm.role_id = $1
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
        `INSERT INTO mc_center.sys_role_menus (role_id, menu_id, can_view, can_create, can_update, can_delete)
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

  // ==========================================
  // MENU CRUD (MAINTAIN MENU)
  // ==========================================
  async createMenu(data) {
    const { menu_name, is_active = true } = data;
    let { menu_code, route_tab, route_path, menu_icon, icon, menu_order, sub_title, content_html } = data;
    menu_icon = menu_icon || icon || '📌';
    route_tab = route_tab || route_path;

    if (!menu_name || !menu_name.trim()) {
      throw new Error('Nama Menu wajib diisi.');
    }

    // Auto-generate menu_code jika kosong
    if (!menu_code || !menu_code.trim()) {
      const randSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const slug = menu_name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').substring(0, 16);
      menu_code = `MENU_${slug}_${randSuffix}`;
    } else {
      menu_code = menu_code.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
    }

    const cleanCode = menu_code;
    const existing = await queryPostgres(
      `SELECT menu_id FROM mc_center.sys_menus WHERE menu_code = $1`,
      [cleanCode]
    );
    if (existing.rows.length > 0) {
      throw new Error(`Kode Menu "${cleanCode}" sudah digunakan.`);
    }

    // Route tab unik untuk menu kustom
    if (!route_tab || !route_tab.trim()) {
      route_tab = `tab-custom-${cleanCode.toLowerCase().replace(/_/g, '-')}`;
    } else {
      route_tab = route_tab.trim().toLowerCase();
    }

    // Hitung order default jika tidak ditentukan
    let orderNum = parseInt(menu_order, 10);
    if (isNaN(orderNum)) {
      const maxOrderRes = await queryPostgres(`SELECT COALESCE(MAX(menu_order), 0) + 1 AS next_order FROM mc_center.sys_menus`);
      orderNum = maxOrderRes.rows[0]?.next_order || 10;
    }

    const res = await queryPostgres(
      `INSERT INTO mc_center.sys_menus (menu_code, menu_name, menu_icon, menu_order, route_tab, sub_title, content_html, is_custom, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, NOW(), NOW())
       RETURNING menu_id, menu_code, menu_name, menu_icon, menu_order, route_tab, sub_title, content_html, is_custom, is_active, created_at, updated_at`,
      [
        cleanCode,
        menu_name.trim(),
        menu_icon?.trim() || '📌',
        orderNum,
        route_tab,
        sub_title?.trim() || null,
        content_html || '',
        Boolean(is_active)
      ]
    );

    const newMenu = res.rows[0];

    // Otomatis berikan izin view ke semua roles yang ada
    const roles = await queryPostgres(`SELECT role_id, role_code FROM mc_center.sys_roles`);
    for (const r of roles.rows) {
      const isSuper = r.role_code === 'SUPERADMIN';
      await queryPostgres(
        `INSERT INTO mc_center.sys_role_menus (role_id, menu_id, can_view, can_create, can_update, can_delete)
         VALUES ($1, $2, true, $3, $3, $3)
         ON CONFLICT (role_id, menu_id) DO NOTHING`,
        [r.role_id, newMenu.menu_id, isSuper]
      );
    }

    return newMenu;
  }

  async updateMenu(menuId, data) {
    const mid = parseInt(menuId, 10);
    const { menu_name, menu_order, sub_title, content_html, is_active } = data;
    let { menu_code, route_tab, route_path, menu_icon, icon } = data;
    menu_icon = menu_icon !== undefined ? menu_icon : icon;
    route_tab = route_tab !== undefined ? route_tab : route_path;

    const menuCheck = await queryPostgres(
      `SELECT menu_id, menu_code, route_tab, is_custom FROM mc_center.sys_menus WHERE menu_id = $1`,
      [mid]
    );
    if (menuCheck.rows.length === 0) {
      throw new Error(`Menu ID ${mid} tidak ditemukan.`);
    }

    const currentMenu = menuCheck.rows[0];

    // Validasi menu_code jika diubah
    let newCode = null;
    if (menu_code !== undefined && menu_code !== null) {
      newCode = menu_code.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
      if (newCode && newCode !== currentMenu.menu_code) {
        const exist = await queryPostgres(
          `SELECT menu_id FROM mc_center.sys_menus WHERE menu_code = $1 AND menu_id != $2`,
          [newCode, mid]
        );
        if (exist.rows.length > 0) {
          throw new Error(`Kode Menu "${newCode}" sudah digunakan oleh menu lain.`);
        }
      }
    }

    const newRoute = route_tab !== undefined ? (route_tab ? route_tab.trim().toLowerCase() : null) : null;
    const newName = menu_name !== undefined ? (menu_name ? menu_name.trim() : null) : null;
    const newIcon = menu_icon !== undefined ? (menu_icon ? menu_icon.trim() : null) : null;
    const newSubTitle = sub_title !== undefined ? (sub_title ? sub_title.trim() : '') : null;
    const newContent = content_html !== undefined ? content_html : null;
    const newOrder = menu_order !== undefined && menu_order !== '' ? parseInt(menu_order, 10) : null;
    const newActive = is_active !== undefined ? Boolean(is_active) : null;

    const res = await queryPostgres(
      `UPDATE mc_center.sys_menus 
       SET menu_code = COALESCE($1, menu_code),
           route_tab = COALESCE($2, route_tab),
           menu_name = COALESCE($3, menu_name),
           menu_icon = COALESCE($4, menu_icon),
           menu_order = COALESCE($5, menu_order),
           sub_title = CASE WHEN $6::text IS NOT NULL THEN $6 ELSE sub_title END,
           content_html = CASE WHEN $7::text IS NOT NULL THEN $7 ELSE content_html END,
           is_active = COALESCE($8, is_active),
           updated_at = NOW()
       WHERE menu_id = $9
       RETURNING menu_id, menu_code, menu_name, menu_icon, menu_order, route_tab, sub_title, content_html, is_custom, is_active, created_at, updated_at`,
      [newCode, newRoute, newName, newIcon, newOrder, newSubTitle, newContent, newActive, mid]
    );
    return res.rows[0];
  }

  async deleteMenu(menuId) {
    const mid = parseInt(menuId, 10);
    
    const menu = await queryPostgres(
      `SELECT menu_id, menu_name, is_custom FROM mc_center.sys_menus WHERE menu_id = $1`,
      [mid]
    );
    if (menu.rows.length === 0) {
      throw new Error(`Menu ID ${mid} tidak ditemukan.`);
    }

    if (!menu.rows[0].is_custom) {
      throw new Error(`Menu bawaan sistem "${menu.rows[0].menu_name}" tidak dapat dihapus. Anda dapat menonaktifkannya jika tidak ingin ditampilkan.`);
    }

    await queryPostgres(
      `DELETE FROM mc_center.sys_role_menus WHERE menu_id = $1`,
      [mid]
    );

    await queryPostgres(
      `DELETE FROM mc_center.sys_menus WHERE menu_id = $1`,
      [mid]
    );

    return { success: true, message: `Menu "${menu.rows[0].menu_name}" berhasil dihapus.` };
  }
}

module.exports = new AuthService();
