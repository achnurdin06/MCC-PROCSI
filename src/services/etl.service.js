const fs = require('fs');
const path = require('path');
const { queryPostgres } = require('../config/postgres');
const sql = require('mssql');
const { Pool } = require('pg');
const { checkSqlServerConnection, getSqlServerPool, querySqlServer } = require('../config/sqlserver');
const { ensureTunnel } = require('../config/tunnel');

function sanitizeIdentifier(name) {
  if (!name || typeof name !== 'string') return null;
  const clean = name.replace(/[^a-zA-Z0-9_]/g, '');
  return clean.length > 0 ? clean : null;
}

const ALLOWED_CONFIG_TABLES = {
  migration_config: { pk: 'config_id', autoPk: true },
  migration_convert_rule: { pk: 'rule_id', autoPk: true },
  migration_target_config: { pk: 'target_config_id', autoPk: true },
  migration_lookup: { pk: 'lookup_name', autoPk: false },
};

// Fallback in-memory storage if remote DB is offline/unreachable
let inMemoryClients = [];
let inMemoryEnvironments = [];
let inMemoryConnections = [];

class EtlService {
  constructor() {
    this.tableInitAttempted = false;
  }

  /**
   * Pastikan tabel master pendukung (client, environment, connection, source_view) ada
   */
  async ensureMasterTablesExist() {
    if (this.tableInitAttempted) return;
    this.tableInitAttempted = true;

    try {
      await queryPostgres(`
        CREATE SCHEMA IF NOT EXISTS etl_antam;

        CREATE TABLE IF NOT EXISTS etl_antam.master_client (
          client_id SERIAL PRIMARY KEY,
          client_code VARCHAR(50) UNIQUE NOT NULL,
          client_name VARCHAR(150) NOT NULL,
          description TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS etl_antam.master_environment (
          env_id SERIAL PRIMARY KEY,
          client_id INTEGER REFERENCES etl_antam.master_client(client_id) ON DELETE CASCADE,
          env_code VARCHAR(30) NOT NULL,
          env_name VARCHAR(100) NOT NULL,
          description TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS etl_antam.master_connection (
          connection_id SERIAL PRIMARY KEY,
          env_id INTEGER REFERENCES etl_antam.master_environment(env_id) ON DELETE CASCADE,
          connection_name VARCHAR(100) NOT NULL,
          db_type VARCHAR(30) NOT NULL,
          db_role VARCHAR(30) NOT NULL,
          host VARCHAR(150) NOT NULL,
          port INTEGER NOT NULL,
          database_name VARCHAR(100) NOT NULL,
          db_schema VARCHAR(100) DEFAULT 'dbo',
          username VARCHAR(100) NOT NULL,
          password VARCHAR(255),
          use_ssh_tunnel BOOLEAN DEFAULT FALSE,
          ssh_host VARCHAR(150),
          ssh_port INTEGER DEFAULT 22,
          ssh_user VARCHAR(100),
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        ALTER TABLE etl_antam.master_source_view ADD COLUMN IF NOT EXISTS connection_id INTEGER;
        ALTER TABLE etl_antam.master_source_view ADD COLUMN IF NOT EXISTS description TEXT;
        CREATE TABLE IF NOT EXISTS etl_antam.master_source_view (
          view_id SERIAL PRIMARY KEY,
          client_id INTEGER,
          env_id INTEGER,
          schema_name VARCHAR(50) DEFAULT 'dbo',
          view_name VARCHAR(150) NOT NULL,
          query_sql TEXT NOT NULL,
          description TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          is_synced BOOLEAN DEFAULT TRUE,
          last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Master Connection and SSH Password column
        ALTER TABLE IF EXISTS etl_antam.master_connection ADD COLUMN IF NOT EXISTS ssh_password VARCHAR(255);

        -- Multi-Tenant columns on Config & Run tables
        ALTER TABLE IF EXISTS etl_antam.migration_config ADD COLUMN IF NOT EXISTS name_config VARCHAR(255);
        ALTER TABLE IF EXISTS etl_antam.migration_config ADD COLUMN IF NOT EXISTS client_id INTEGER;
        ALTER TABLE IF EXISTS etl_antam.migration_config ADD COLUMN IF NOT EXISTS env_id INTEGER;
        ALTER TABLE IF EXISTS etl_antam.migration_convert_rule ADD COLUMN IF NOT EXISTS client_id INTEGER;
        ALTER TABLE IF EXISTS etl_antam.migration_convert_rule ADD COLUMN IF NOT EXISTS env_id INTEGER;
        ALTER TABLE IF EXISTS etl_antam.migration_target_config ADD COLUMN IF NOT EXISTS client_id INTEGER;
        ALTER TABLE IF EXISTS etl_antam.migration_target_config ADD COLUMN IF NOT EXISTS env_id INTEGER;
        ALTER TABLE IF EXISTS etl_antam.migration_lookup ADD COLUMN IF NOT EXISTS client_id INTEGER;
        ALTER TABLE IF EXISTS etl_antam.migration_lookup ADD COLUMN IF NOT EXISTS env_id INTEGER;
        ALTER TABLE IF EXISTS etl_antam.migration_run ADD COLUMN IF NOT EXISTS client_id INTEGER;
        ALTER TABLE IF EXISTS etl_antam.migration_run ADD COLUMN IF NOT EXISTS env_id INTEGER;

        -- User Multi-Tenancy columns & tables
        ALTER TABLE IF EXISTS etl_antam.sys_users ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES etl_antam.master_client(client_id) ON DELETE SET NULL;
        ALTER TABLE IF EXISTS etl_antam.sys_users ADD COLUMN IF NOT EXISTS env_id INTEGER REFERENCES etl_antam.master_environment(env_id) ON DELETE SET NULL;

        CREATE TABLE IF NOT EXISTS etl_antam.sys_user_clients (
          user_id INTEGER REFERENCES etl_antam.sys_users(user_id) ON DELETE CASCADE,
          client_id INTEGER REFERENCES etl_antam.master_client(client_id) ON DELETE CASCADE,
          PRIMARY KEY (user_id, client_id)
        );

        CREATE TABLE IF NOT EXISTS etl_antam.sys_user_environments (
          user_id INTEGER REFERENCES etl_antam.sys_users(user_id) ON DELETE CASCADE,
          env_id INTEGER REFERENCES etl_antam.master_environment(env_id) ON DELETE CASCADE,
          PRIMARY KEY (user_id, env_id)
        );
      `);
    } catch (err) {
      console.warn('Postgres master tables init warning (using resilient storage):', err.message);
    }
  }

  /**
   * Cek status inisialisasi sistem (apakah sudah ada client & env terdaftar)
   */
  async getInitializationStatus() {
    await this.ensureMasterTablesExist();
    try {
      const res = await queryPostgres(`SELECT COUNT(*) AS total FROM etl_antam.master_client`);
      const total = parseInt(res.rows[0]?.total, 10) || 0;
      return {
        isInitialized: total > 0,
        totalClients: total,
      };
    } catch (err) {
      return {
        isInitialized: inMemoryClients.length > 0,
        totalClients: inMemoryClients.length,
      };
    }
  }

  /**
   * Simpan inisialisasi awal melalui Wizard (Client + Environment + Multiple Connections)
   */
  async initWizard(payload) {
    await this.ensureMasterTablesExist();
    const { client, environment, connections = [] } = payload;

    if (!client || !client.client_code || !client.client_name) {
      throw new Error('Informasi Client (kode & nama) wajib diisi.');
    }
    if (!environment || !environment.env_code || !environment.env_name) {
      throw new Error('Informasi Environment (kode & nama) wajib diisi.');
    }

    try {
      // 1. Simpan Client
      const clientRes = await queryPostgres(`
        INSERT INTO etl_antam.master_client (client_code, client_name, description, is_active)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [client.client_code.toUpperCase().trim(), client.client_name.trim(), client.description || '', true]);
      const savedClient = clientRes.rows[0];

      // 2. Simpan Environment
      const envRes = await queryPostgres(`
        INSERT INTO etl_antam.master_environment (client_id, env_code, env_name, description, is_active)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [savedClient.client_id, environment.env_code.toUpperCase().trim(), environment.env_name.trim(), environment.description || '', true]);
      const savedEnv = envRes.rows[0];

      // 3. Simpan Multiple Connections
      const savedConnections = [];
      for (const conn of connections) {
        if (!conn.connection_name || !conn.host) continue;
        const connRes = await queryPostgres(`
          INSERT INTO etl_antam.master_connection (
            env_id, connection_name, db_type, db_role, host, port, database_name,
            db_schema, username, password, use_ssh_tunnel, ssh_host, ssh_port, ssh_user, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          RETURNING *
        `, [
          savedEnv.env_id,
          conn.connection_name,
          (conn.db_type || 'POSTGRESQL').toUpperCase(),
          (conn.db_role || 'SOURCE').toUpperCase(),
          conn.host,
          parseInt(conn.port, 10) || (conn.db_type === 'MSSQL' ? 1433 : 5432),
          conn.database_name || '',
          conn.db_schema || (conn.db_type === 'MSSQL' ? 'dbo' : 'public'),
          conn.username || '',
          conn.password || '',
          Boolean(conn.use_ssh_tunnel),
          conn.ssh_host || null,
          parseInt(conn.ssh_port, 10) || 22,
          conn.ssh_user || null,
          conn.is_active !== false,
        ]);
        savedConnections.push(connRes.rows[0]);
      }

      return {
        client: savedClient,
        environment: savedEnv,
        connections: savedConnections,
      };
    } catch (err) {
      // In-memory fallback jika database offline
      const newClient = {
        client_id: inMemoryClients.length + 1,
        client_code: client.client_code.toUpperCase().trim(),
        client_name: client.client_name.trim(),
        description: client.description || '',
        is_active: true,
        created_at: new Date().toISOString(),
      };
      inMemoryClients.push(newClient);

      const newEnv = {
        env_id: inMemoryEnvironments.length + 1,
        client_id: newClient.client_id,
        env_code: environment.env_code.toUpperCase().trim(),
        env_name: environment.env_name.trim(),
        description: environment.description || '',
        is_active: true,
        created_at: new Date().toISOString(),
      };
      inMemoryEnvironments.push(newEnv);

      const savedConns = connections.map((conn, idx) => ({
        connection_id: inMemoryConnections.length + idx + 1,
        env_id: newEnv.env_id,
        connection_name: conn.connection_name || `Koneksi #${idx + 1}`,
        db_type: (conn.db_type || 'POSTGRESQL').toUpperCase(),
        db_role: (conn.db_role || 'SOURCE').toUpperCase(),
        host: conn.host || 'localhost',
        port: parseInt(conn.port, 10) || 5432,
        database_name: conn.database_name || '',
        db_schema: conn.db_schema || 'dbo',
        username: conn.username || 'postgres',
        use_ssh_tunnel: Boolean(conn.use_ssh_tunnel),
        is_active: conn.is_active !== false,
        created_at: new Date().toISOString(),
      }));
      inMemoryConnections.push(...savedConns);

      return {
        client: newClient,
        environment: newEnv,
        connections: savedConns,
      };
    }
  }

  // ==========================================
  // CLIENT CRUD
  // ==========================================
  async getClients(user = null) {
    await this.ensureMasterTablesExist();
    try {
      const isSuperadmin = user && user.roleCode === 'SUPERADMIN';
      let whereClause = '';
      const params = [];

      if (user && !isSuperadmin) {
        if (Array.isArray(user.clientIds) && user.clientIds.length > 0) {
          params.push(user.clientIds.map(id => parseInt(id, 10)));
          whereClause = `WHERE c.client_id = ANY($1::int[])`;
        } else if (user.clientId) {
          params.push(parseInt(user.clientId, 10));
          whereClause = `WHERE c.client_id = $1`;
        }
      }

      const res = await queryPostgres(`
        SELECT 
          c.*,
          COUNT(e.env_id) AS total_environments,
          COALESCE(
            json_agg(
              json_build_object(
                'env_id', e.env_id,
                'env_code', e.env_code,
                'env_name', e.env_name,
                'description', e.description,
                'is_active', e.is_active
              )
            ) FILTER (WHERE e.env_id IS NOT NULL),
            '[]'::json
          ) AS environments
        FROM etl_antam.master_client c
        LEFT JOIN etl_antam.master_environment e ON c.client_id = e.client_id
        ${whereClause}
        GROUP BY c.client_id
        ORDER BY c.client_id
      `, params);
      return res.rows;
    } catch (err) {
      let filtered = inMemoryClients;
      if (user && user.roleCode !== 'SUPERADMIN') {
        if (Array.isArray(user.clientIds) && user.clientIds.length > 0) {
          filtered = filtered.filter(c => user.clientIds.map(String).includes(String(c.client_id)));
        } else if (user.clientId) {
          filtered = filtered.filter(c => c.client_id == user.clientId);
        }
      }
      return filtered.map(c => {
        const envs = inMemoryEnvironments.filter(e => e.client_id == c.client_id);
        return {
          ...c,
          total_environments: envs.length,
          environments: envs,
        };
      });
    }
  }

  async getEnvironmentWithConnections(envId) {
    await this.ensureMasterTablesExist();
    try {
      const envRes = await queryPostgres(`
        SELECT e.*, c.client_code, c.client_name 
        FROM etl_antam.master_environment e
        LEFT JOIN etl_antam.master_client c ON e.client_id = c.client_id
        WHERE e.env_id = $1
      `, [parseInt(envId, 10)]);

      if (!envRes.rows[0]) {
        throw new Error('Environment ID ' + envId + ' tidak ditemukan.');
      }

      const connRes = await queryPostgres(`
        SELECT * FROM etl_antam.master_connection 
        WHERE env_id = $1 
        ORDER BY connection_id
      `, [parseInt(envId, 10)]);

      const connections = connRes.rows;
      const sourceConn = connections.find(c => (c.db_role || '').toUpperCase() === 'SOURCE' && c.is_active !== false)
        || connections.find(c => (c.db_type || '').toUpperCase() === 'MSSQL' && c.is_active !== false)
        || null;

      const targetConn = connections.find(c => (c.db_role || '').toUpperCase() === 'TARGET' && c.is_active !== false)
        || connections.find(c => (c.db_type || '').toUpperCase() === 'POSTGRESQL' && c.is_active !== false)
        || null;

      const stagingConn = connections.find(c => (c.db_role || '').toUpperCase() === 'STAGING' && c.is_active !== false) || null;

      return {
        environment: envRes.rows[0],
        connections,
        sourceConnection: sourceConn,
        targetConnection: targetConn,
        stagingConnection: stagingConn,
      };
    } catch (err) {
      const env = inMemoryEnvironments.find(e => e.env_id == envId);
      if (!env) throw err;
      const client = inMemoryClients.find(c => c.client_id == env.client_id);
      const conns = inMemoryConnections.filter(c => c.env_id == envId);
      const sourceConn = conns.find(c => (c.db_role || '').toUpperCase() === 'SOURCE') || null;
      const targetConn = conns.find(c => (c.db_role || '').toUpperCase() === 'TARGET') || null;
      return {
        environment: { ...env, client_code: client?.client_code, client_name: client?.client_name },
        connections: conns,
        sourceConnection: sourceConn,
        targetConnection: targetConn,
        stagingConnection: null,
      };
    }
  }

  /**
   * Health status spesifik untuk koneksi SOURCE dan TARGET milik environment tertentu
   */
  async getEnvironmentHealth(envId) {
    const details = await this.getEnvironmentWithConnections(envId);
    const sourceConn = details.sourceConnection;
    const targetConn = details.targetConnection;

    const [sourceHealth, targetHealth] = await Promise.all([
      sourceConn ? this.testConnection(sourceConn) : Promise.resolve({ success: false, error: 'Koneksi SOURCE belum dikonfigurasi' }),
      targetConn ? this.testConnection(targetConn) : Promise.resolve({ success: false, error: 'Koneksi TARGET belum dikonfigurasi' }),
    ]);

    return {
      environment: details.environment,
      source: {
        role: 'Source Database (MSSQL)',
        connection_id: sourceConn?.connection_id || null,
        connection_name: sourceConn?.connection_name || 'Tidak ada koneksi SOURCE',
        db_type: sourceConn?.db_type || 'MSSQL',
        database: sourceConn?.database_name || 'antam_scm',
        db_schema: sourceConn?.db_schema || 'dbo',
        host: sourceConn?.host || 'localhost',
        port: sourceConn?.port || 1433,
        connected: Boolean(sourceHealth.success),
        latencyMs: sourceHealth.latencyMs || 0,
        error: sourceHealth.error || null,
        version: sourceHealth.version || null,
      },
      target: {
        role: 'Target Database (PostgreSQL)',
        connection_id: targetConn?.connection_id || null,
        connection_name: targetConn?.connection_name || 'Tidak ada koneksi TARGET',
        db_type: targetConn?.db_type || 'POSTGRESQL',
        database: targetConn?.database_name || 'db_procsi',
        db_schema: targetConn?.db_schema || 'etl_antam',
        host: targetConn?.host || 'localhost',
        port: targetConn?.port || 5432,
        connected: Boolean(targetHealth.success),
        latencyMs: targetHealth.latencyMs || 0,
        error: targetHealth.error || null,
        version: targetHealth.version || null,
      },
      timestamp: new Date().toISOString(),
    };
  }

  async saveEnvironmentWithConnections(payload) {
    await this.ensureMasterTablesExist();
    const { client_id, env_id, env_code, env_name, description = '', is_active = true, connections = [] } = payload;
    if (!client_id) throw new Error('Client ID wajib dipilih.');
    if (!env_code || !env_name) throw new Error('Kode & Nama Environment wajib diisi.');

    try {
      let savedEnv;
      if (env_id) {
        const res = await queryPostgres(`
          UPDATE etl_antam.master_environment
          SET client_id = $1, env_code = $2, env_name = $3, description = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP
          WHERE env_id = $6
          RETURNING *
        `, [
          parseInt(client_id, 10),
          env_code.toUpperCase().trim(),
          env_name.trim(),
          description || '',
          Boolean(is_active),
          parseInt(env_id, 10),
        ]);
        savedEnv = res.rows[0];
      } else {
        const res = await queryPostgres(`
          INSERT INTO etl_antam.master_environment (client_id, env_code, env_name, description, is_active)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `, [
          parseInt(client_id, 10),
          env_code.toUpperCase().trim(),
          env_name.trim(),
          description || '',
          Boolean(is_active),
        ]);
        savedEnv = res.rows[0];
      }

      const currentEnvId = savedEnv.env_id;
      const savedConns = [];
      const keptConnIds = [];

      for (const conn of connections) {
        if (!conn.connection_name || !conn.host) continue;

        if (conn.connection_id) {
          const updateRes = await queryPostgres(`
            UPDATE etl_antam.master_connection
            SET env_id = $1,
                connection_name = $2,
                db_type = $3,
                db_role = $4,
                host = $5,
                port = $6,
                database_name = $7,
                db_schema = $8,
                username = $9,
                password = CASE WHEN $10 = '__UNCHANGED__' OR $10 = '' THEN password ELSE $10 END,
                use_ssh_tunnel = $11,
                ssh_host = $12,
                ssh_port = $13,
                ssh_user = $14,
                ssh_password = CASE WHEN $15 = '__UNCHANGED__' OR $15 = '' THEN ssh_password ELSE $15 END,
                is_active = $16,
                updated_at = CURRENT_TIMESTAMP
            WHERE connection_id = $17
            RETURNING *
          `, [
            currentEnvId,
            conn.connection_name.trim(),
            (conn.db_type || 'POSTGRESQL').toUpperCase().trim(),
            (conn.db_role || 'SOURCE').toUpperCase().trim(),
            conn.host.trim(),
            parseInt(conn.port, 10) || 5432,
            conn.database_name || '',
            conn.db_schema || 'dbo',
            conn.username || '',
            conn.password || '',
            Boolean(conn.use_ssh_tunnel),
            conn.ssh_host || null,
            parseInt(conn.ssh_port, 10) || 22,
            conn.ssh_user || null,
            conn.ssh_password || '',
            conn.is_active !== false,
            parseInt(conn.connection_id, 10),
          ]);
          if (updateRes.rows[0]) {
            savedConns.push(updateRes.rows[0]);
            keptConnIds.push(updateRes.rows[0].connection_id);
          }
        } else {
          const insertRes = await queryPostgres(`
            INSERT INTO etl_antam.master_connection (
              env_id, connection_name, db_type, db_role, host, port, database_name,
              db_schema, username, password, use_ssh_tunnel, ssh_host, ssh_port, ssh_user, ssh_password, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING *
          `, [
            currentEnvId,
            conn.connection_name.trim(),
            (conn.db_type || 'POSTGRESQL').toUpperCase().trim(),
            (conn.db_role || 'SOURCE').toUpperCase().trim(),
            conn.host.trim(),
            parseInt(conn.port, 10) || 5432,
            conn.database_name || '',
            conn.db_schema || 'dbo',
            conn.username || '',
            conn.password || '',
            Boolean(conn.use_ssh_tunnel),
            conn.ssh_host || null,
            parseInt(conn.ssh_port, 10) || 22,
            conn.ssh_user || null,
            conn.ssh_password || '',
            conn.is_active !== false,
          ]);
          if (insertRes.rows[0]) {
            savedConns.push(insertRes.rows[0]);
            keptConnIds.push(insertRes.rows[0].connection_id);
          }
        }
      }

      if (keptConnIds.length > 0) {
        await queryPostgres(`
          DELETE FROM etl_antam.master_connection
          WHERE env_id = $1 AND connection_id NOT IN (${keptConnIds.join(',')})
        `, [currentEnvId]);
      }

      return {
        environment: savedEnv,
        connections: savedConns,
      };
    } catch (err) {
      console.error('Error saving environment with connections:', err);
      throw err;
    }
  }

  // OLD_GET_CLIENTS_REPLACED

  async createClient(data) {
    await this.ensureMasterTablesExist();
    const { client_code, client_name, description, is_active = true } = data;
    if (!client_code || !client_name) throw new Error('Kode & Nama Client wajib diisi.');

    try {
      const res = await queryPostgres(`
        INSERT INTO etl_antam.master_client (client_code, client_name, description, is_active)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [client_code.toUpperCase().trim(), client_name.trim(), description || '', Boolean(is_active)]);
      return res.rows[0];
    } catch (err) {
      const item = {
        client_id: inMemoryClients.length + 1,
        client_code: client_code.toUpperCase().trim(),
        client_name: client_name.trim(),
        description: description || '',
        is_active: Boolean(is_active),
        created_at: new Date().toISOString(),
      };
      inMemoryClients.push(item);
      return item;
    }
  }

  async updateClient(id, data) {
    const { client_code, client_name, description, is_active } = data;
    try {
      const res = await queryPostgres(`
        UPDATE etl_antam.master_client
        SET client_code = COALESCE($1, client_code),
            client_name = COALESCE($2, client_name),
            description = COALESCE($3, description),
            is_active = COALESCE($4, is_active),
            updated_at = CURRENT_TIMESTAMP
        WHERE client_id = $5
        RETURNING *
      `, [
        client_code ? client_code.toUpperCase().trim() : null,
        client_name ? client_name.trim() : null,
        description !== undefined ? description : null,
        is_active !== undefined ? Boolean(is_active) : null,
        parseInt(id, 10),
      ]);
      return res.rows[0];
    } catch (err) {
      const idx = inMemoryClients.findIndex((c) => c.client_id == id);
      if (idx !== -1) {
        inMemoryClients[idx] = { ...inMemoryClients[idx], ...data };
        return inMemoryClients[idx];
      }
      throw err;
    }
  }

  async deleteClient(id) {
    try {
      await queryPostgres(`DELETE FROM etl_antam.master_client WHERE client_id = $1`, [parseInt(id, 10)]);
      return { success: true, client_id: id };
    } catch (err) {
      inMemoryClients = inMemoryClients.filter((c) => c.client_id != id);
      return { success: true, client_id: id };
    }
  }

  // ==========================================
  // ENVIRONMENT CRUD
  // ==========================================
  async getEnvironments(clientId = null, user = null) {
    await this.ensureMasterTablesExist();
    try {
      const isSuperadmin = user && user.roleCode === 'SUPERADMIN';
      let targetClientId = clientId ? parseInt(clientId, 10) : null;

      let query = `
        SELECT e.*, c.client_name, c.client_code,
               COUNT(conn.connection_id)::int AS total_connections
        FROM etl_antam.master_environment e
        LEFT JOIN etl_antam.master_client c ON e.client_id = c.client_id
        LEFT JOIN etl_antam.master_connection conn ON e.env_id = conn.env_id
      `;
      const params = [];
      const conditions = [];

      if (user && !isSuperadmin) {
        // Client filtering
        if (targetClientId) {
          if (Array.isArray(user.clientIds) && user.clientIds.length > 0) {
            if (!user.clientIds.map(Number).includes(targetClientId)) {
              return []; // Client requested is outside assigned clients
            }
          } else if (user.clientId && user.clientId != targetClientId) {
            return [];
          }
          params.push(targetClientId);
          conditions.push(`e.client_id = $${params.length}`);
        } else if (Array.isArray(user.clientIds) && user.clientIds.length > 0) {
          params.push(user.clientIds.map(id => parseInt(id, 10)));
          conditions.push(`e.client_id = ANY($${params.length}::int[])`);
        } else if (user.clientId) {
          params.push(parseInt(user.clientId, 10));
          conditions.push(`e.client_id = $${params.length}`);
        }

        // Environment filtering
        if (Array.isArray(user.envIds) && user.envIds.length > 0) {
          params.push(user.envIds.map(id => parseInt(id, 10)));
          conditions.push(`e.env_id = ANY($${params.length}::int[])`);
        } else if (user.envId) {
          params.push(parseInt(user.envId, 10));
          conditions.push(`e.env_id = $${params.length}`);
        }
      } else {
        if (targetClientId) {
          params.push(targetClientId);
          conditions.push(`e.client_id = $${params.length}`);
        }
      }

      if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
      }

      query += ` GROUP BY e.env_id, c.client_name, c.client_code ORDER BY e.client_id, e.env_id`;
      const res = await queryPostgres(query, params);
      return res.rows;
    } catch (err) {
      let filtered = inMemoryEnvironments;
      if (user && user.roleCode !== 'SUPERADMIN') {
        if (clientId) {
          filtered = filtered.filter(e => e.client_id == clientId);
        } else if (Array.isArray(user.clientIds) && user.clientIds.length > 0) {
          filtered = filtered.filter(e => user.clientIds.map(String).includes(String(e.client_id)));
        } else if (user.clientId) {
          filtered = filtered.filter(e => e.client_id == user.clientId);
        }

        if (Array.isArray(user.envIds) && user.envIds.length > 0) {
          filtered = filtered.filter(e => user.envIds.map(String).includes(String(e.env_id)));
        } else if (user.envId) {
          filtered = filtered.filter(e => e.env_id == user.envId);
        }
      } else if (clientId) {
        filtered = filtered.filter(e => e.client_id == clientId);
      }
      return filtered;
    }
  }

  async createEnvironment(data) {
    await this.ensureMasterTablesExist();
    const { client_id, env_code, env_name, description, is_active = true } = data;
    if (!env_code || !env_name) throw new Error('Kode & Nama Environment wajib diisi.');

    try {
      const res = await queryPostgres(`
        INSERT INTO etl_antam.master_environment (client_id, env_code, env_name, description, is_active)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [client_id ? parseInt(client_id, 10) : null, env_code.toUpperCase().trim(), env_name.trim(), description || '', Boolean(is_active)]);
      return res.rows[0];
    } catch (err) {
      const item = {
        env_id: inMemoryEnvironments.length + 1,
        client_id: client_id ? parseInt(client_id, 10) : null,
        env_code: env_code.toUpperCase().trim(),
        env_name: env_name.trim(),
        description: description || '',
        is_active: Boolean(is_active),
        created_at: new Date().toISOString(),
      };
      inMemoryEnvironments.push(item);
      return item;
    }
  }

  async updateEnvironment(id, data) {
    const { client_id, env_code, env_name, description, is_active } = data;
    try {
      const res = await queryPostgres(`
        UPDATE etl_antam.master_environment
        SET client_id = COALESCE($1, client_id),
            env_code = COALESCE($2, env_code),
            env_name = COALESCE($3, env_name),
            description = COALESCE($4, description),
            is_active = COALESCE($5, is_active),
            updated_at = CURRENT_TIMESTAMP
        WHERE env_id = $6
        RETURNING *
      `, [
        client_id !== undefined ? parseInt(client_id, 10) : null,
        env_code ? env_code.toUpperCase().trim() : null,
        env_name ? env_name.trim() : null,
        description !== undefined ? description : null,
        is_active !== undefined ? Boolean(is_active) : null,
        parseInt(id, 10),
      ]);
      return res.rows[0];
    } catch (err) {
      const idx = inMemoryEnvironments.findIndex((e) => e.env_id == id);
      if (idx !== -1) {
        inMemoryEnvironments[idx] = { ...inMemoryEnvironments[idx], ...data };
        return inMemoryEnvironments[idx];
      }
      throw err;
    }
  }

  async deleteEnvironment(id) {
    try {
      await queryPostgres(`DELETE FROM etl_antam.master_environment WHERE env_id = $1`, [parseInt(id, 10)]);
      return { success: true, env_id: id };
    } catch (err) {
      inMemoryEnvironments = inMemoryEnvironments.filter((e) => e.env_id != id);
      return { success: true, env_id: id };
    }
  }

  // ==========================================
  // CONNECTION CRUD & TEST PING
  // ==========================================
  async getConnections(envId = null, clientId = null) {
    await this.ensureMasterTablesExist();
    try {
      let query = `
        SELECT c.*, e.env_name, e.env_code, cl.client_name, cl.client_code, cl.client_id
        FROM etl_antam.master_connection c
        LEFT JOIN etl_antam.master_environment e ON c.env_id = e.env_id
        LEFT JOIN etl_antam.master_client cl ON e.client_id = cl.client_id
      `;
      const params = [];
      const conditions = [];
      if (envId) {
        params.push(parseInt(envId, 10));
        conditions.push(`c.env_id = $${params.length}`);
      }
      if (clientId) {
        params.push(parseInt(clientId, 10));
        conditions.push(`cl.client_id = $${params.length}`);
      }
      if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
      }
      query += ` ORDER BY cl.client_id NULLS LAST, c.env_id NULLS LAST, c.connection_id`;
      const res = await queryPostgres(query, params);
      return res.rows;
    } catch (err) {
      let list = [...inMemoryConnections];
      if (envId) list = list.filter((c) => c.env_id == envId);
      return list;
    }
  }

  async createConnection(data) {
    await this.ensureMasterTablesExist();
    const {
      env_id, connection_name, db_type = 'POSTGRESQL', db_role = 'SOURCE',
      host, port, database_name, db_schema = 'dbo', username, password,
      use_ssh_tunnel = false, ssh_host, ssh_port = 22, ssh_user, ssh_password, is_active = true,
    } = data;

    if (!connection_name || !host) throw new Error('Nama Koneksi dan Host wajib diisi.');
    if (!env_id) throw new Error('Environment wajib dipilih.');

    try {
      const res = await queryPostgres(`
        INSERT INTO etl_antam.master_connection (
          env_id, connection_name, db_type, db_role, host, port, database_name,
          db_schema, username, password, use_ssh_tunnel, ssh_host, ssh_port, ssh_user, ssh_password, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *
      `, [
        parseInt(env_id, 10),
        connection_name.trim(),
        (db_type || 'POSTGRESQL').toUpperCase().trim(),
        (db_role || 'SOURCE').toUpperCase().trim(),
        host.trim(),
        parseInt(port, 10) || (db_type === 'MSSQL' ? 1433 : 5432),
        database_name ? database_name.trim() : '',
        db_schema || (db_type === 'MSSQL' ? 'dbo' : 'public'),
        username ? username.trim() : '',
        password || '',
        Boolean(use_ssh_tunnel),
        ssh_host ? ssh_host.trim() : null,
        parseInt(ssh_port, 10) || 22,
        ssh_user ? ssh_user.trim() : null,
        ssh_password || '',
        Boolean(is_active),
      ]);
      return res.rows[0];
    } catch (err) {
      const item = {
        connection_id: inMemoryConnections.length + 1,
        env_id: env_id ? parseInt(env_id, 10) : null,
        connection_name: connection_name.trim(),
        db_type: db_type.toUpperCase().trim(),
        db_role: db_role.toUpperCase().trim(),
        host: host.trim(),
        port: parseInt(port, 10) || 5432,
        database_name: database_name || '',
        db_schema: db_schema || 'dbo',
        username: username || '',
        use_ssh_tunnel: Boolean(use_ssh_tunnel),
        is_active: Boolean(is_active),
        created_at: new Date().toISOString(),
      };
      inMemoryConnections.push(item);
      return item;
    }
  }

  async updateConnection(id, data) {
    const {
      env_id, connection_name, db_type, db_role, host, port, database_name,
      db_schema, username, password, use_ssh_tunnel, ssh_host, ssh_port, ssh_user, ssh_password, is_active,
    } = data;

    try {
      const res = await queryPostgres(`
        UPDATE etl_antam.master_connection
        SET env_id = COALESCE($1, env_id),
            connection_name = COALESCE($2, connection_name),
            db_type = COALESCE($3, db_type),
            db_role = COALESCE($4, db_role),
            host = COALESCE($5, host),
            port = COALESCE($6, port),
            database_name = COALESCE($7, database_name),
            db_schema = COALESCE($8, db_schema),
            username = COALESCE($9, username),
            password = COALESCE($10, password),
            use_ssh_tunnel = COALESCE($11, use_ssh_tunnel),
            ssh_host = COALESCE($12, ssh_host),
            ssh_port = COALESCE($13, ssh_port),
            ssh_user = COALESCE($14, ssh_user),
            ssh_password = COALESCE($15, ssh_password),
            is_active = COALESCE($16, is_active),
            updated_at = CURRENT_TIMESTAMP
        WHERE connection_id = $17
        RETURNING *
      `, [
        env_id ? parseInt(env_id, 10) : null,
        connection_name ? connection_name.trim() : null,
        db_type ? db_type.toUpperCase().trim() : null,
        db_role ? db_role.toUpperCase().trim() : null,
        host ? host.trim() : null,
        port ? parseInt(port, 10) : null,
        database_name !== undefined ? database_name.trim() : null,
        db_schema !== undefined ? db_schema : null,
        username !== undefined ? username.trim() : null,
        password !== undefined ? password : null,
        use_ssh_tunnel !== undefined ? Boolean(use_ssh_tunnel) : null,
        ssh_host !== undefined ? ssh_host : null,
        ssh_port !== undefined ? parseInt(ssh_port, 10) : null,
        ssh_user !== undefined ? ssh_user : null,
        ssh_password !== undefined ? ssh_password : null,
        is_active !== undefined ? Boolean(is_active) : null,
        parseInt(id, 10),
      ]);
      return res.rows[0];
    } catch (err) {
      const idx = inMemoryConnections.findIndex((c) => c.connection_id == id);
      if (idx !== -1) {
        inMemoryConnections[idx] = { ...inMemoryConnections[idx], ...data };
        return inMemoryConnections[idx];
      }
      throw err;
    }
  }

  async deleteConnection(id) {
    try {
      await queryPostgres(`DELETE FROM etl_antam.master_connection WHERE connection_id = $1`, [parseInt(id, 10)]);
      return { success: true, connection_id: id };
    } catch (err) {
      inMemoryConnections = inMemoryConnections.filter((c) => c.connection_id != id);
      return { success: true, connection_id: id };
    }
  }

  async testConnection(data) {
    const { db_type = 'POSTGRESQL', host, port, database_name, username, password } = data;
    const startTime = Date.now();

    if (db_type.toUpperCase() === 'MSSQL') {
      const isAntamHost = !host || host === 'HOST_REDACTED' || host === process.env.MSSQL_SERVER || host === process.env.MSSQL_SSH_HOST || host === '127.0.0.1' || host === 'localhost';
      const isAntamDb = !database_name || database_name === process.env.MSSQL_DATABASE || database_name === 'antam_scm';
      const isAntamUser = !username || username === process.env.MSSQL_USER || username === 'sa';

      // 1. Jika ini koneksi default ANTAM (HOST_REDACTED / antam_scm / sa), gunakan managed connection pool langsung
      if (isAntamHost && isAntamDb && isAntamUser) {
        try {
          const sqlResult = await checkSqlServerConnection();
          if (sqlResult.connected) {
            return {
              success: true,
              latencyMs: sqlResult.latencyMs,
              message: 'Koneksi ke SQL Server berhasil (via SSH Tunnel)!',
              version: sqlResult.version,
            };
          } else {
            return {
              success: false,
              latencyMs: sqlResult.latencyMs,
              error: sqlResult.error || 'Gagal terhubung ke SQL Server via SSH Tunnel',
            };
          }
        } catch (err) {
          return {
            success: false,
            latencyMs: Date.now() - startTime,
            error: err.message,
          };
        }
      }

      // 2. Jika koneksi custom MSSQL: cek apakah membutuhkan SSH tunnel
      let targetServer = host || 'localhost';
      let targetPort = parseInt(port, 10) || 1433;

      const requiresTunnel = (process.env.MSSQL_USE_SSH_TUNNEL === 'true' && isAntamHost) || host === 'HOST_REDACTED';
      if (requiresTunnel) {
        try {
          await ensureTunnel();
          targetServer = '127.0.0.1';
          targetPort = parseInt(process.env.LOCAL_TUNNEL_PORT, 10) || 11433;
        } catch (tunnelErr) {
          return {
            success: false,
            latencyMs: Date.now() - startTime,
            error: `SSH Tunnel Error: ${tunnelErr.message}`,
          };
        }
      }

      const config = {
        server: targetServer,
        port: targetPort,
        user: username || process.env.MSSQL_USER || 'sa',
        password: password || process.env.MSSQL_PASSWORD || '',
        database: database_name || process.env.MSSQL_DATABASE || 'antam_scm',
        options: {
          encrypt: process.env.MSSQL_ENCRYPT === 'true',
          trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false',
          enableArithAbort: true,
        },
        connectionTimeout: parseInt(process.env.MSSQL_CONNECTION_TIMEOUT, 10) || 15000,
      };

      try {
        const pool = await new sql.ConnectionPool(config).connect();
        const res = await pool.request().query('SELECT @@VERSION AS version');
        await pool.close();
        return {
          success: true,
          latencyMs: Date.now() - startTime,
          message: 'Koneksi ke SQL Server berhasil!',
          version: res.recordset[0]?.version?.split('\n')[0],
        };
      } catch (err) {
        return {
          success: false,
          latencyMs: Date.now() - startTime,
          error: err.message,
        };
      }
    } else {
      // PostgreSQL
      const pool = new Pool({
        host: host || process.env.PG_HOST || 'localhost',
        port: parseInt(port, 10) || parseInt(process.env.PG_PORT, 10) || 5432,
        user: username || process.env.PG_USER || 'postgres',
        password: password || process.env.PG_PASSWORD || '',
        database: database_name || process.env.PG_DATABASE || 'postgres',
        connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT_MILLIS, 10) || 10000,
      });

      try {
        const res = await pool.query('SELECT version()');
        await pool.end();
        return {
          success: true,
          latencyMs: Date.now() - startTime,
          message: 'Koneksi ke PostgreSQL berhasil!',
          version: res.rows[0]?.version?.split(' ')[0] + ' ' + (res.rows[0]?.version?.split(' ')[1] || ''),
        };
      } catch (err) {
        try { await pool.end(); } catch (e) {}
        return {
          success: false,
          latencyMs: Date.now() - startTime,
          error: err.message,
        };
      }
    }
  }

  // ==========================================
  // MASTER CONFIGS & UNIVERSAL CONFIG CRUD
  // ==========================================
  async getMasterConfigs(filters = {}) {
    await this.ensureMasterTablesExist();
    const { clientId, envId } = filters;
    const cid = clientId ? parseInt(clientId, 10) : null;
    const eid = envId ? parseInt(envId, 10) : null;

    let cfgWhere = '';
    const cfgParams = [];
    if (cid && eid) {
      cfgWhere = 'WHERE client_id = $1 AND env_id = $2';
      cfgParams.push(cid, eid);
    } else if (cid) {
      cfgWhere = 'WHERE client_id = $1';
      cfgParams.push(cid);
    } else if (eid) {
      cfgWhere = 'WHERE env_id = $1';
      cfgParams.push(eid);
    }

    const [configsRes, rulesRes, lookupRes, targetConfigsRes] = await Promise.all([
      queryPostgres(`SELECT * FROM etl_antam.migration_config ${cfgWhere} ORDER BY exec_order, config_id`, cfgParams),
      queryPostgres(`SELECT * FROM etl_antam.migration_convert_rule ${cfgWhere} ORDER BY config_id, rule_id`, cfgParams),
      queryPostgres(`SELECT * FROM etl_antam.migration_lookup ${cfgWhere} ORDER BY lookup_name`, cfgParams),
      queryPostgres(`SELECT * FROM etl_antam.migration_target_config ${cfgWhere} ORDER BY exec_order, target_config_id`, cfgParams),
    ]);

    return {
      migration_config: configsRes.rows,
      migration_convert_rule: rulesRes.rows,
      migration_lookup: lookupRes.rows,
      migration_target_config: targetConfigsRes.rows,
      totals: {
        configs: configsRes.rows.length,
        rules: rulesRes.rows.length,
        lookups: lookupRes.rows.length,
        targetConfigs: targetConfigsRes.rows.length,
      },
    };
  }

  /**
   * Helper untuk generate otomatis compare_columns dan src_precheck_sql
   */
  async generateMigrationConfigDefaults(params = {}) {
    const srcSchema = sanitizeIdentifier(params.src_schema) || 'dbo';
    const srcView = sanitizeIdentifier(params.src_view);
    const stgTable = sanitizeIdentifier(params.stg_table);
    const rawPk = params.pk_columns ? String(params.pk_columns).split(',')[0].trim() : 'id';
    const pkCol = sanitizeIdentifier(rawPk) || 'id';

    let columns = [];
    if (srcView) {
      try {
        const colRes = await querySqlServer(`
          SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = '${srcSchema}' AND TABLE_NAME = '${srcView}'
          ORDER BY ORDINAL_POSITION
        `);
        if (colRes?.recordset?.length > 0) {
          columns = colRes.recordset.map((r) => r.COLUMN_NAME);
        }
      } catch (err) {
        console.warn(`[generateDefaults] Gagal query columns dari SQL Server (${srcSchema}.${srcView}):`, err.message);
      }
    }

    if (columns.length === 0 && stgTable) {
      try {
        const pgColRes = await queryPostgres(`
          SELECT column_name
          FROM information_schema.columns
          WHERE (table_schema = 'stg_antam' OR table_schema = 'public')
            AND table_name = $1
          ORDER BY ordinal_position
        `, [stgTable]);
        if (pgColRes?.rows?.length > 0) {
          columns = pgColRes.rows
            .map((r) => r.column_name)
            .filter((c) => !['id', 'created_at', 'updated_at', 'is_updated', 'fields_before'].includes(c));
        }
      } catch (err) {
        console.warn(`[generateDefaults] Gagal query columns dari PostgreSQL staging (${stgTable}):`, err.message);
      }
    }

    const compareColumns = columns.length > 0 ? columns.join(', ') : '';

    let srcPrecheckSql = '';
    if (srcView) {
      const targetIdCol = (columns.length > 0 ? columns.find((c) => c.toLowerCase() === pkCol.toLowerCase()) : null)
        || (columns.length > 0 ? columns.find((c) => c.toLowerCase().endsWith('_id') || ['uuid', 'code', 'id'].includes(c.toLowerCase())) : null)
        || (columns.length > 0 ? columns[0] : null)
        || pkCol;

      const cleanTargetIdCol = sanitizeIdentifier(targetIdCol) || 'id';

      srcPrecheckSql = `SELECT
  -- 1. Cek potensi duplikasi record
  (SELECT COUNT(*) FROM (
     SELECT [${cleanTargetIdCol}]
     FROM [${srcSchema}].[${srcView}]
     GROUP BY [${cleanTargetIdCol}]
     HAVING COUNT(*) > 1
   ) d)
  -- 2. Cek apakah ada record dengan identifier NULL
  + (SELECT COUNT(*) FROM [${srcSchema}].[${srcView}]
     WHERE [${cleanTargetIdCol}] IS NULL) AS n`;
    }

    return {
      compare_columns: compareColumns,
      src_precheck_sql: srcPrecheckSql,
      columns,
    };
  }

  async autoPopulateMigrationConfigFields(data, id = null) {
    let currentRecord = null;
    if (id) {
      try {
        const curRes = await queryPostgres('SELECT * FROM etl_antam.migration_config WHERE config_id = $1', [id]);
        currentRecord = curRes.rows[0];
      } catch (e) {
        console.warn('[autoPopulateMigrationConfigFields] Gagal ambil existing record:', e.message);
      }
    }

    const srcSchema = data.src_schema || currentRecord?.src_schema || 'dbo';
    const srcView = data.src_view || currentRecord?.src_view;
    const stgTable = data.stg_table || currentRecord?.stg_table;
    const pkCol = data.pk_columns || currentRecord?.pk_columns || 'id';

    const needCompare = data.compare_columns === undefined || data.compare_columns === null || String(data.compare_columns).trim() === '';
    const needPrecheck = data.src_precheck_sql === undefined || data.src_precheck_sql === null || String(data.src_precheck_sql).trim() === '';

    if (!needCompare && !needPrecheck) {
      return;
    }

    const defaults = await this.generateMigrationConfigDefaults({
      src_schema: srcSchema,
      src_view: srcView,
      stg_table: stgTable,
      pk_columns: pkCol,
    });

    if (needCompare && defaults.compare_columns) {
      data.compare_columns = defaults.compare_columns;
    }
    if (needPrecheck && defaults.src_precheck_sql) {
      data.src_precheck_sql = defaults.src_precheck_sql;
    }
  }

  async createConfigRecord(tableName, data) {
    const meta = ALLOWED_CONFIG_TABLES[tableName];
    if (!meta) throw new Error(`Tabel "${tableName}" tidak diizinkan untuk operasi konfigurasi.`);

    if (tableName === 'migration_config') {
      await this.autoPopulateMigrationConfigFields(data);
    }

    const keys = Object.keys(data).filter((k) => meta.autoPk ? k !== meta.pk : true);
    if (keys.length === 0) throw new Error('Tidak ada data kolom yang dikirim.');

    const values = keys.map((k) => (typeof data[k] === "string" && data[k].trim() === "" ? null : data[k]));
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const colNames = keys.map((k) => `"${k}"`).join(', ');

    const query = `
      INSERT INTO etl_antam.${tableName} (${colNames})
      VALUES (${placeholders})
      RETURNING *
    `;

    const res = await queryPostgres(query, values);
    return res.rows[0];
  }

  async updateConfigRecord(tableName, id, data) {
    const meta = ALLOWED_CONFIG_TABLES[tableName];
    if (!meta) throw new Error(`Tabel "${tableName}" tidak diizinkan untuk operasi konfigurasi.`);

    if (tableName === 'migration_config') {
      await this.autoPopulateMigrationConfigFields(data, id);
    }

    const keys = Object.keys(data).filter((k) => k !== meta.pk);
    if (keys.length === 0) throw new Error('Tidak ada kolom yang diubah.');

    const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
    const values = keys.map((k) => (typeof data[k] === "string" && data[k].trim() === "" ? null : data[k]));
    values.push(id);

    const query = `
      UPDATE etl_antam.${tableName}
      SET ${setClauses}
      WHERE "${meta.pk}" = $${values.length}
      RETURNING *
    `;

    const res = await queryPostgres(query, values);
    if (res.rows.length === 0) throw new Error(`Record dengan ID ${id} tidak ditemukan di tabel ${tableName}.`);
    return res.rows[0];
  }

  async deleteConfigRecord(tableName, id) {
    const meta = ALLOWED_CONFIG_TABLES[tableName];
    if (!meta) throw new Error(`Tabel "${tableName}" tidak diizinkan untuk operasi konfigurasi.`);

    const query = `DELETE FROM etl_antam.${tableName} WHERE "${meta.pk}" = $1 RETURNING *`;
    const res = await queryPostgres(query, [id]);
    if (res.rows.length === 0) throw new Error(`Record dengan ID ${id} tidak ditemukan di tabel ${tableName}.`);
    return { success: true, deleted: res.rows[0] };
  }

  // ==========================================
  // ETL EXECUTION & LOG MONITORING
  // ==========================================
  async getEtlOverview(filters = {}) {
    const { clientId, envId } = filters;
    const cid = clientId ? parseInt(clientId, 10) : null;
    const eid = envId ? parseInt(envId, 10) : null;

    const whereConditions = [];
    const params = [];
    if (eid) {
      params.push(eid);
      whereConditions.push(`env_id = $${params.length}`);
    }
    if (cid) {
      params.push(cid);
      whereConditions.push(`client_id = $${params.length}`);
    }
    const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const whereSqlJoin = whereConditions.length > 0 ? `WHERE ${whereConditions.map(w => 'r.' + w).join(' AND ')}` : '';

    const errorCountQuery = whereConditions.length > 0
      ? `SELECT COUNT(*) AS total_errors FROM etl_antam.migration_error_log e JOIN etl_antam.migration_run r ON e.run_id = r.run_id ${whereSqlJoin}`
      : `SELECT COUNT(*) AS total_errors FROM etl_antam.migration_error_log`;

    const [runsSummary, errorsCount, latestRun] = await Promise.all([
      queryPostgres(`
        SELECT 
          COUNT(*) AS total_runs,
          COUNT(*) FILTER (WHERE UPPER(status) IN ('SUCCESS', 'COMPLETED', 'OK')) AS success_runs,
          COUNT(*) FILTER (WHERE UPPER(status) IN ('FAILED', 'ERROR')) AS failed_runs,
          COUNT(*) FILTER (WHERE UPPER(status) IN ('RUNNING', 'STARTED')) AS running_runs
        FROM etl_antam.migration_run
        ${whereSql}
      `, params),
      queryPostgres(errorCountQuery, params),
      queryPostgres(`SELECT * FROM etl_antam.migration_run ${whereSql} ORDER BY run_id DESC LIMIT 1`, params),
    ]);

    return {
      totalRuns: parseInt(runsSummary.rows[0]?.total_runs, 10) || 0,
      successRuns: parseInt(runsSummary.rows[0]?.success_runs, 10) || 0,
      failedRuns: parseInt(runsSummary.rows[0]?.failed_runs, 10) || 0,
      runningRuns: parseInt(runsSummary.rows[0]?.running_runs, 10) || 0,
      totalErrors: parseInt(errorsCount.rows[0]?.total_errors, 10) || 0,
      latestRun: latestRun.rows[0] || null,
    };
  }

  async getMigrationRuns(options = {}) {
    const { limit = 50, page = 1, status, clientId, envId, sortBy = 'run_id', sortDir = 'DESC' } = options;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const offset = (pageNum - 1) * limitNum;

    const whereConditions = [];
    const params = [];

    if (status) {
      params.push(status.toUpperCase());
      whereConditions.push(`UPPER(r.status) = $${params.length}`);
    }
    if (envId) {
      params.push(parseInt(envId, 10));
      whereConditions.push(`r.env_id = $${params.length}`);
    }
    if (clientId) {
      params.push(parseInt(clientId, 10));
      whereConditions.push(`r.client_id = $${params.length}`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const countRes = await queryPostgres(
      `SELECT COUNT(*) AS total FROM etl_antam.migration_run r ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.total, 10) || 0;

    params.push(limitNum);
    params.push(offset);

    const ALLOWED_SORTS = {
      run_id: 'r.run_id',
      run_ts: 'r.run_ts',
      start_time: 'r.start_time',
      end_time: 'r.end_time',
      status: 'r.status',
      main_workflow: 'r.main_workflow',
      config_id: 'r.config_id',
      duration_seconds: 'duration_seconds',
      client_code: 'mc.client_code',
      env_code: 'me.env_code',
    };
    const sortColumn = ALLOWED_SORTS[sortBy] || 'r.run_id';
    const sortDirection = String(sortDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const runsRes = await queryPostgres(
      `
      SELECT 
        r.run_id,
        r.run_ts,
        r.start_time,
        r.end_time,
        r.status,
        r.hop_host,
        r.note,
        r.main_workflow,
        r.config_id,
        r.client_id,
        r.env_id,
        mc.client_code,
        mc.client_name,
        me.env_code,
        me.env_name,
        r.is_posted,
        r.posted_at,
        r.post_type,
        r.is_rolled_back,
        r.rolled_back_at,
        ROUND(EXTRACT(EPOCH FROM (r.end_time - r.start_time))::numeric, 2) AS duration_seconds
      FROM etl_antam.migration_run r
      LEFT JOIN etl_antam.master_client mc ON r.client_id = mc.client_id
      LEFT JOIN etl_antam.master_environment me ON r.env_id = me.env_id
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
      params
    );

    return {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      runs: runsRes.rows,
    };
  }

  async getStepLogs(options = {}) {
    const { runId, clientId, envId, page = 1, limit = 50, status, sortBy, sortDir } = options;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let fromJoin = `FROM etl_antam.migration_step_log s`;
    const params = [];
    const whereConditions = [];

    if (envId || clientId) {
      fromJoin += ` JOIN etl_antam.migration_run r ON s.run_id = r.run_id`;
      if (envId) {
        params.push(parseInt(envId, 10));
        whereConditions.push(`r.env_id = $${params.length}`);
      }
      if (clientId) {
        params.push(parseInt(clientId, 10));
        whereConditions.push(`r.client_id = $${params.length}`);
      }
    }
    if (runId) {
      params.push(parseInt(runId, 10));
      whereConditions.push(`s.run_id = $${params.length}`);
    }
    if (status) {
      params.push(String(status).trim().toUpperCase());
      whereConditions.push(`s.status = $${params.length}`);
    } else {
      // Optimasi Proses Detail (Bug #2): Keluarkan log transisi sesaat START, internal router, dan log progres mikro (Batch/Direct)
      whereConditions.push(`s.status <> 'START'`);
      whereConditions.push(`s.step_name NOT IN ('LOOP_CHECK')`);
      whereConditions.push(`s.message NOT LIKE 'tabel target %: % baris diposting'`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const countRes = await queryPostgres(
      `SELECT COUNT(*)::int AS total ${fromJoin} ${whereClause}`,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    const ALLOWED_SORTS = {
      log_id: 's.log_id',
      run_id: 's.run_id',
      config_id: 's.config_id',
      step_name: 's.step_name',
      status: 's.status',
      rows_src: 's.rows_src',
      rows_stg: 's.rows_stg',
      rows_new: 's.rows_new',
      rows_changed: 's.rows_changed',
      rows_deleted: 's.rows_deleted',
      duration_seconds: 'duration_seconds',
      start_time: 's.start_time',
      end_time: 's.end_time',
    };
    const sortColumn = ALLOWED_SORTS[sortBy] || 's.log_id';
    const sortDirection = String(sortDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const dataParams = [...params, limitNum, offset];

    const dataRes = await queryPostgres(
      `
      SELECT 
        s.log_id,
        s.run_id,
        s.config_id,
        s.step_name,
        s.status,
        s.rows_src,
        s.rows_stg,
        s.rows_new,
        s.rows_changed,
        s.rows_deleted,
        s.start_time,
        s.end_time,
        s.message,
        ROUND(EXTRACT(EPOCH FROM (s.end_time - s.start_time))::numeric, 2) AS duration_seconds
      ${fromJoin}
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection}
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
      `,
      dataParams
    );

    return {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      stepLogs: dataRes.rows,
    };
  }

  async getErrorLogs(options = {}) {
    const { runId, clientId, envId, page = 1, limit = 50, sortBy, sortDir } = options;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let fromJoin = `FROM etl_antam.migration_error_log e`;
    const params = [];
    const whereConditions = [];

    if (envId || clientId) {
      fromJoin += ` JOIN etl_antam.migration_run r ON e.run_id = r.run_id`;
      if (envId) {
        params.push(parseInt(envId, 10));
        whereConditions.push(`r.env_id = $${params.length}`);
      }
      if (clientId) {
        params.push(parseInt(clientId, 10));
        whereConditions.push(`r.client_id = $${params.length}`);
      }
    }
    if (runId) {
      params.push(parseInt(runId, 10));
      whereConditions.push(`e.run_id = $${params.length}`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const countRes = await queryPostgres(
      `SELECT COUNT(*)::int AS total ${fromJoin} ${whereClause}`,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    const ALLOWED_SORTS = {
      error_id: 'e.error_id',
      run_id: 'e.run_id',
      config_id: 'e.config_id',
      step_name: 'e.step_name',
      pipeline_name: 'e.pipeline_name',
      transform_name: 'e.transform_name',
      error_time: 'e.error_time',
      error_code: 'e.error_code',
    };
    const sortColumn = ALLOWED_SORTS[sortBy] || 'e.error_id';
    const sortDirection = String(sortDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const dataParams = [...params, limitNum, offset];

    const dataRes = await queryPostgres(
      `
      SELECT 
        e.error_id,
        e.run_id,
        e.config_id,
        e.step_name,
        e.pipeline_name,
        e.transform_name,
        e.error_time,
        e.error_code,
        e.error_message,
        e.error_detail,
        e.error_field,
        e.row_data
      ${fromJoin}
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection}
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
      `,
      dataParams
    );

    return {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      errorLogs: dataRes.rows,
    };
  }

  /**
   * ==========================================
   * SYNC & EXPORT KE APACHE HOP CONFIG
   * ==========================================
   * Mengonversi database connection & environment data ke file JSON Apache Hop
   * path: /Users/macbookair/Documents/Projects/hop-projects/hop-project/config/<client_code>_<env_code>-config.json
   */
  async generateHopConfig(envId) {
    await this.ensureMasterTablesExist();
    if (!envId) throw new Error('Environment ID wajib ditentukan.');

    // 1. Ambil data environment dan parent client
    const envRes = await queryPostgres(`
      SELECT 
        e.env_id,
        e.client_id,
        e.env_code,
        e.env_name,
        e.description AS env_desc,
        e.is_active,
        c.client_code,
        c.client_name,
        c.description AS client_desc
      FROM etl_antam.master_environment e
      JOIN etl_antam.master_client c ON e.client_id = c.client_id
      WHERE e.env_id = $1
    `, [parseInt(envId, 10)]);

    if (!envRes.rows || envRes.rows.length === 0) {
      throw new Error(`Master Environment dengan ID ${envId} tidak ditemukan.`);
    }

    const env = envRes.rows[0];
    const clientCode = (env.client_code || 'CLIENT').toUpperCase();
    const envCode = (env.env_code || 'ENV').toUpperCase();

    // 2. Ambil semua koneksi database aktif untuk environment ini
    const connRes = await queryPostgres(`
      SELECT *
      FROM etl_antam.master_connection
      WHERE env_id = $1
      ORDER BY connection_id ASC
    `, [parseInt(envId, 10)]);

    const connections = connRes.rows || [];

    // Prioritaskan koneksi SOURCE (MSSQL) dan TARGET (PostgreSQL)
    const sourceConn = connections.find(c => (c.db_role || '').toUpperCase() === 'SOURCE') 
      || connections.find(c => (c.db_type || '').toUpperCase() === 'MSSQL') 
      || {};

    const targetConn = connections.find(c => (c.db_role || '').toUpperCase() === 'TARGET') 
      || connections.find(c => (c.db_type || '').toUpperCase() === 'POSTGRESQL') 
      || {};

    // 3. Susun variabel Hop 100% inline dengan Apache Hop dev-config.json
    const hopConfig = {
      variables: [
        { name: "CLIENT_ID", value: String(env.client_id || ''), description: "ID Master Client" },
        { name: "CLIENT_CODE", value: clientCode, description: "Kode Klien Master" },
        { name: "CLIENT_NAME", value: String(env.client_name || ''), description: "Nama Resmi Klien" },
        { name: "CLIENT_DESC", value: String(env.client_desc || ''), description: "Deskripsi Klien" },
        { name: "ENV_ID", value: String(env.env_id || ''), description: "ID Master Environment" },
        { name: "ENV_CODE", value: envCode, description: "Kode Environment" },
        { name: "ENV_NAME", value: String(env.env_name || ''), description: "Nama Environment Master" },
        { name: "ENV_DESC", value: String(env.env_desc || ''), description: "Deskripsi Environment" },
        { name: "PG_HOST", value: String(targetConn.host || 'HOST_REDACTED'), description: "" },
        { name: "PG_PORT", value: String(targetConn.port || 5433), description: "" },
        { name: "PG_DB", value: String(targetConn.database_name || 'db_procsi'), description: "" },
        { name: "PG_USER", value: String(targetConn.username || 'procsi'), description: "" },
        { name: "PG_PASSWORD", value: String(targetConn.password || '***REDACTED***'), description: "" },
        { name: "MSSQL_HOST", value: String(sourceConn.host || 'localhost'), description: "" },
        { name: "MSSQL_PORT", value: String(sourceConn.port || 1433), description: "" },
        { name: "MSSQL_DB", value: String(sourceConn.database_name || 'antam_scm'), description: "" },
        { name: "MSSQL_USER", value: String(sourceConn.username || 'sa'), description: "" },
        { name: "MSSQL_PASSWORD", value: String(sourceConn.password || '***REDACTED***'), description: "" },
        { name: "MSSQL_USER_SSH", value: String(sourceConn.ssh_user || 'developer'), description: "" },
        { name: "MSSQL_PASSWORD_SSH", value: String(sourceConn.ssh_password || '***REDACTED***'), description: "" },
        { name: "MSSQL_PORT_SSH", value: String(sourceConn.ssh_port || 22), description: "" },
        { name: "MSSQL_HOST_SSH", value: String(sourceConn.ssh_host || sourceConn.host || 'HOST_REDACTED'), description: "" },
      ]
    };

    const fileName = `${clientCode}_${envCode}-config.json`;
    const hopConfigDir = '/Users/macbookair/Documents/Projects/hop-projects/hop-project/config';
    const hopConfigPath = path.join(hopConfigDir, fileName);

    // Backup lokal di workspace Command Center
    const localConfigDir = path.join(__dirname, '../../config/hop-configs');
    const localConfigPath = path.join(localConfigDir, fileName);

    const writtenPaths = [];

    // Tulis ke proyek Apache Hop jika foldernya ada / bisa dibuat
    try {
      if (!fs.existsSync(hopConfigDir)) {
        fs.mkdirSync(hopConfigDir, { recursive: true });
      }
      fs.writeFileSync(hopConfigPath, JSON.stringify(hopConfig, null, 2), 'utf-8');
      writtenPaths.push(hopConfigPath);

      // Jika envCode === 'DEV', perbarui juga dev-config.json
      if (envCode === 'DEV') {
        const devConfigPath = path.join(hopConfigDir, 'dev-config.json');
        fs.writeFileSync(devConfigPath, JSON.stringify(hopConfig, null, 2), 'utf-8');
        writtenPaths.push(devConfigPath);
      }
    } catch (fsErr) {
      console.warn(`Gagal menulis config ke hop-projects directory: ${fsErr.message}`);
    }

    // Tulis backup ke lokal mig-antam
    try {
      if (!fs.existsSync(localConfigDir)) {
        fs.mkdirSync(localConfigDir, { recursive: true });
      }
      fs.writeFileSync(localConfigPath, JSON.stringify(hopConfig, null, 2), 'utf-8');
      writtenPaths.push(localConfigPath);
    } catch (locErr) {
      console.warn(`Gagal menulis config ke local backup: ${locErr.message}`);
    }

    return {
      success: true,
      envId: env.env_id,
      clientCode,
      envCode,
      clientName: env.client_name,
      envName: env.env_name,
      fileName,
      filePath: hopConfigPath,
      writtenPaths,
      variablesCount: hopConfig.variables.length,
      message: `File config Hop berhasil di-generate untuk environment ${envCode} (${clientCode})`
    };
  }
}

module.exports = new EtlService();
