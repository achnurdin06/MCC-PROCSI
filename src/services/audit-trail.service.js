const { queryPostgres } = require('../config/postgres');

let infrastructurePromise = null;

function ensureAuditTrailInfrastructure() {
  if (!infrastructurePromise) {
    infrastructurePromise = (async () => {
      await queryPostgres(`
        CREATE TABLE IF NOT EXISTS mc_center.audit_trail (
          audit_id BIGSERIAL PRIMARY KEY,
          actor_user_id INTEGER,
          actor_username VARCHAR(100) NOT NULL,
          actor_role VARCHAR(50) NOT NULL,
          action VARCHAR(30) NOT NULL,
          http_method VARCHAR(10) NOT NULL,
          endpoint VARCHAR(500) NOT NULL,
          http_status SMALLINT NOT NULL,
          client_id INTEGER,
          env_id INTEGER,
          menu_code VARCHAR(100),
          menu_name VARCHAR(150),
          ip_address INET,
          user_agent VARCHAR(500),
          duration_ms INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_audit_trail_created_at
          ON mc_center.audit_trail (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_trail_actor_user_id
          ON mc_center.audit_trail (actor_user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_trail_scope
          ON mc_center.audit_trail (client_id, env_id, created_at DESC);
        ALTER TABLE mc_center.audit_trail ADD COLUMN IF NOT EXISTS menu_code VARCHAR(100);
        ALTER TABLE mc_center.audit_trail ADD COLUMN IF NOT EXISTS menu_name VARCHAR(150);
      `);

      const menuResult = await queryPostgres(`
        UPDATE mc_center.sys_menus
        SET menu_name = $2,
            menu_icon = $3,
            menu_order = $4,
            route_tab = $5,
            sub_title = $6,
            content_html = '',
            is_custom = false,
            is_active = true,
            updated_at = CURRENT_TIMESTAMP
        WHERE menu_code = $1
        RETURNING menu_id
      `, ['TAB_AUDIT', 'Audit Trail', '📜', 7, 'tab-audit', 'Riwayat aktivitas sistem']);
      const menuId = menuResult.rows[0]?.menu_id || (await queryPostgres(`
        INSERT INTO mc_center.sys_menus
          (menu_code, menu_name, menu_icon, menu_order, route_tab, sub_title, content_html, is_custom, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, '', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING menu_id
      `, ['TAB_AUDIT', 'Audit Trail', '📜', 7, 'tab-audit', 'Riwayat aktivitas sistem'])).rows[0]?.menu_id;

      if (!menuId) throw new Error('Menu Audit Trail gagal dibuat.');

      await queryPostgres(`
        INSERT INTO mc_center.sys_role_menus (role_id, menu_id, can_view, can_create, can_update, can_delete)
        SELECT r.role_id, $1, true, false, false, false
        FROM mc_center.sys_roles r
        WHERE r.role_code IN ($2, $3)
        ON CONFLICT (role_id, menu_id) DO UPDATE SET
          can_view = true,
          can_create = false,
          can_update = false,
          can_delete = false
      `, [menuId, 'VIEWER', 'SUPERADMIN']);
    })().catch((err) => {
      infrastructurePromise = null;
      throw err;
    });
  }
  return infrastructurePromise;
}

function getPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getRequestValue(req, key, camelKey) {
  return req.body?.[key]
    || req.body?.[camelKey]
    || req.query?.[key]
    || req.query?.[camelKey]
    || req.params?.[key]
    || req.params?.[camelKey];
}

function getEndpoint(req) {
  const routePath = Array.isArray(req.route?.path)
    ? req.route.path[0]
    : req.route?.path;
  const path = routePath
    ? `${req.baseUrl || ''}${routePath}`
    : String(req.path || req.originalUrl || '/').split('?')[0];
  return path.slice(0, 500);
}

function getAction(req) {
  if (req.auditAction) return req.auditAction;
  switch (req.method) {
    case 'POST':
      return 'CREATE_OR_EXECUTE';
    case 'PUT':
    case 'PATCH':
      return 'UPDATE';
    case 'DELETE':
      return 'DELETE';
    default:
      return 'READ';
  }
}

async function recordRequest(req, res, durationMs) {
  const actor = req.auditActor || req.user;
  const actorUserId = getPositiveInteger(actor?.userId || actor?.user_id);
  const username = actor?.username || actor?.userName;
  if (!actorUserId && !username) return;

  const envId = getPositiveInteger(getRequestValue(req, 'env_id', 'envId') || actor?.envId);
  const clientId = getPositiveInteger(getRequestValue(req, 'client_id', 'clientId') || actor?.clientId);
  const role = actor.roleCode || actor.role_code || 'UNKNOWN';
  const menuCode = String(req.get('x-active-menu-code') || '').slice(0, 100) || null;
  const roleId = getPositiveInteger(actor.roleId || actor.role_id);
  await ensureAuditTrailInfrastructure();

  await queryPostgres(`
    WITH active_menu AS (
      SELECT m.menu_code, m.menu_name
      FROM mc_center.sys_menus m
      LEFT JOIN mc_center.sys_role_menus rm ON rm.menu_id = m.menu_id
      WHERE m.menu_code = $10
        AND m.is_active = true
        AND ($11 = 'SUPERADMIN' OR (rm.role_id = $12 AND rm.can_view = true))
      LIMIT 1
    )
    INSERT INTO mc_center.audit_trail (
      actor_user_id, actor_username, actor_role, action, http_method,
      endpoint, http_status, client_id, env_id, menu_code, menu_name,
      ip_address, user_agent, duration_ms
    )
    SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9,
           active_menu.menu_code, active_menu.menu_name, $13, $14, $15
    FROM (SELECT 1) AS request_row
    LEFT JOIN active_menu ON true
  `, [
    actorUserId,
    String(username).slice(0, 100),
    String(role).slice(0, 50),
    getAction(req),
    String(req.method).slice(0, 10),
    getEndpoint(req),
    res.statusCode,
    clientId,
    envId,
    menuCode,
    role,
    roleId,
    req.ip || null,
    String(req.get('user-agent') || '').slice(0, 500) || null,
    Math.max(0, Math.min(Date.now() - req.auditStartedAt, 2147483647)),
  ]);
}

function auditTrailMiddleware(req, res, next) {
  req.auditStartedAt = Date.now();
  res.once('finish', () => {
    if (req.auditSkip) return;
    recordRequest(req, res, Date.now() - req.auditStartedAt).catch((err) => {
      console.error('Gagal menyimpan audit trail:', err.message);
    });
  });
  next();
}

async function listAuditTrail({ user, search = '', limit = 50, offset = 0 }) {
  await ensureAuditTrailInfrastructure();
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
  const requestedOffset = Math.min(Math.max(Number.parseInt(offset, 10) || 0, 0), 2147483647);
  const conditions = [];
  const params = [];

  if (user.roleCode !== 'SUPERADMIN') {
    const envIds = Array.isArray(user.envIds) ? user.envIds.map(getPositiveInteger).filter(Boolean) : [];
    const clientIds = Array.isArray(user.clientIds) ? user.clientIds.map(getPositiveInteger).filter(Boolean) : [];
    if (envIds.length > 0) {
      params.push(envIds);
      conditions.push(`env_id = ANY($${params.length}::int[])`);
    } else if (clientIds.length > 0) {
      params.push(clientIds);
      conditions.push(`client_id = ANY($${params.length}::int[])`);
    } else {
      params.push(getPositiveInteger(user.userId));
      conditions.push(`actor_user_id = $${params.length}`);
    }
  }

  const cleanSearch = String(search).trim().slice(0, 100);
  if (cleanSearch) {
    params.push(`%${cleanSearch.replace(/[\\%_]/g, '\\$&')}%`);
    const searchParam = `$${params.length}`;
    conditions.push(`(
      actor_username ILIKE ${searchParam} ESCAPE '\\'
      OR actor_role ILIKE ${searchParam} ESCAPE '\\'
      OR menu_code ILIKE ${searchParam} ESCAPE '\\'
      OR menu_name ILIKE ${searchParam} ESCAPE '\\'
      OR action ILIKE ${searchParam} ESCAPE '\\'
      OR endpoint ILIKE ${searchParam} ESCAPE '\\'
    )`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await queryPostgres(
    `SELECT COUNT(*)::int AS total FROM mc_center.audit_trail ${whereClause}`,
    params
  );
  const total = countResult.rows[0]?.total || 0;
  const lastPageOffset = total === 0 ? 0 : Math.floor((total - 1) / safeLimit) * safeLimit;
  const safeOffset = Math.min(requestedOffset, lastPageOffset);
  const pageParams = [...params, safeLimit, safeOffset];
  const eventsResult = await queryPostgres(`
    SELECT audit_id, actor_user_id, actor_username, actor_role, action,
           http_method, endpoint, http_status, client_id, env_id, menu_code, menu_name,
           host(ip_address) AS ip_address, duration_ms, created_at
    FROM mc_center.audit_trail
    ${whereClause}
    ORDER BY created_at DESC, audit_id DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, pageParams);

  return {
    events: eventsResult.rows,
    total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function recordMenuVisit({ user, menuCode, envId, request }) {
  await ensureAuditTrailInfrastructure();
  const cleanMenuCode = typeof menuCode === 'string' ? menuCode.trim().slice(0, 100) : '';
  if (!/^[A-Za-z0-9_-]+$/.test(cleanMenuCode)) {
    throw new Error('Kode menu tidak valid.');
  }

  const roleCode = user.roleCode || user.role_code || 'UNKNOWN';
  const roleId = getPositiveInteger(user.roleId || user.role_id);
  const menuResult = await queryPostgres(`
    SELECT m.menu_code, m.menu_name
    FROM mc_center.sys_menus m
    LEFT JOIN mc_center.sys_role_menus rm ON rm.menu_id = m.menu_id AND rm.role_id = $2
    WHERE m.menu_code = $1
      AND m.is_active = true
      AND ($3 = 'SUPERADMIN' OR COALESCE(rm.can_view, false) = true)
    LIMIT 1
  `, [cleanMenuCode, roleId, roleCode]);
  const menu = menuResult.rows[0];
  if (!menu) throw new Error('Menu tidak ditemukan atau tidak memiliki izin akses.');

  const actorUserId = getPositiveInteger(user.userId || user.user_id);
  if (!actorUserId) throw new Error('Identitas pengguna tidak valid.');
  const username = String(user.username || user.userName || 'unknown').slice(0, 100);

  let scopedClientId = getPositiveInteger(user.clientId || user.client_id);
  let scopedEnvId = getPositiveInteger(user.envId || user.env_id);
  const requestedEnvId = getPositiveInteger(envId);
  if (requestedEnvId) {
    if (roleCode !== 'SUPERADMIN') {
      const assignedEnvIds = Array.isArray(user.envIds) ? user.envIds.map(getPositiveInteger).filter(Boolean) : [];
      const assignedClientIds = Array.isArray(user.clientIds) ? user.clientIds.map(getPositiveInteger).filter(Boolean) : [];
      if (assignedEnvIds.length > 0 && !assignedEnvIds.includes(requestedEnvId)) {
        throw new Error('Environment tidak termasuk assignment pengguna.');
      }
      if (assignedEnvIds.length === 0 && assignedClientIds.length > 0) {
        const assignedEnvironment = await queryPostgres(`
          SELECT client_id FROM mc_center.master_environment
          WHERE env_id = $1 AND client_id = ANY($2::int[])
        `, [requestedEnvId, assignedClientIds]);
        if (!assignedEnvironment.rows[0]) {
          throw new Error('Environment tidak termasuk assignment pengguna.');
        }
      } else if (assignedEnvIds.length === 0 && assignedClientIds.length === 0
        && requestedEnvId !== scopedEnvId) {
        throw new Error('Environment tidak termasuk assignment pengguna.');
      }
    }

    const environment = await queryPostgres(
      'SELECT client_id FROM mc_center.master_environment WHERE env_id = $1',
      [requestedEnvId]
    );
    if (!environment.rows[0]) throw new Error('Environment tidak ditemukan.');
    scopedEnvId = requestedEnvId;
    scopedClientId = getPositiveInteger(environment.rows[0].client_id);
  }

  request.auditSkip = true;
  await queryPostgres(`
    INSERT INTO mc_center.audit_trail (
      actor_user_id, actor_username, actor_role, action, http_method,
      endpoint, http_status, client_id, env_id, menu_code, menu_name,
      ip_address, user_agent, duration_ms
    ) VALUES ($1, $2, $3, 'MENU_OPEN', 'UI', $4, 200, $5, $6, $7, $8, $9, $10, 0)
  `, [
    actorUserId,
    username,
    String(roleCode).slice(0, 50),
    `/ui/menu/${menu.menu_code}`,
    scopedClientId,
    scopedEnvId,
    menu.menu_code,
    menu.menu_name,
    request.ip || null,
    String(request.get('user-agent') || '').slice(0, 500) || null,
  ]);
}

module.exports = {
  ensureAuditTrailInfrastructure,
  auditTrailMiddleware,
  listAuditTrail,
  recordMenuVisit,
};
