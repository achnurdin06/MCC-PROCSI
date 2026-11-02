const net = require('net');
const { Client } = require('ssh2');
require('./env');

const tunnels = new Map();
const pendingTunnels = new Map();

function openTunnel(connection, key) {
  return new Promise((resolve, reject) => {
    if (!connection.ssh_host || !connection.ssh_user || !connection.ssh_password) {
      reject(new Error('SSH tunnel aktif, tetapi host, user, atau password SSH belum dikonfigurasi di Master Connection.'));
      return;
    }

    const client = new Client();
    let server = null;
    let settled = false;
    const finishError = (err) => {
      if (settled) return;
      settled = true;
      if (server?.listening) server.close();
      client.destroy();
      reject(err);
    };

    client.once('ready', () => {
      server = net.createServer((socket) => {
        socket.on('error', (err) => {
          console.warn('Local tunnel client socket error:', err.message);
        });

        client.forwardOut(
          '127.0.0.1',
          socket.remotePort,
          connection.host,
          parseInt(connection.port, 10) || 1433,
          (err, stream) => {
            if (err) {
              console.warn('SSH forwardOut error:', err.message);
              socket.destroy();
              return;
            }
            socket.pipe(stream).pipe(socket);
            socket.on('error', () => stream.destroy());
            stream.on('error', () => socket.destroy());
          }
        );
      });

      server.on('error', (err) => {
        if (!settled) {
          finishError(err);
          return;
        }
        console.warn('Local tunnel server error:', err.message);
        closeTunnel(key).catch((closeErr) => {
          console.warn('Gagal menutup SSH tunnel setelah error:', closeErr.message);
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const tunnel = {
          client,
          server,
          localPort: server.address().port,
          key,
        };
        tunnels.set(key, tunnel);
        settled = true;
        resolve(tunnel);
      });
    });

    client.on('error', (err) => {
      if (!settled) {
        finishError(err);
        return;
      }
      console.warn('SSH tunnel connection error:', err.message);
      closeTunnel(key).catch((closeErr) => {
        console.warn('Gagal menutup SSH tunnel setelah error:', closeErr.message);
      });
    });
    client.once('close', () => {
      const tunnel = tunnels.get(key);
      if (tunnel?.client === client) {
        tunnel.server.close();
        tunnels.delete(key);
      }
      if (!settled) finishError(new Error('Koneksi SSH tunnel terputus sebelum siap.'));
    });

    client.connect({
      host: connection.ssh_host,
      port: parseInt(connection.ssh_port, 10) || 22,
      username: connection.ssh_user,
      password: connection.ssh_password,
      readyTimeout: 30000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    });
  });
}

async function ensureTunnel(connection, key = String(connection.connection_id || 'test')) {
  const existing = tunnels.get(key);
  if (existing?.client && existing?.server?.listening) return existing.localPort;
  if (pendingTunnels.has(key)) return pendingTunnels.get(key);
  const pending = openTunnel(connection, key)
    .then((tunnel) => tunnel.localPort)
    .finally(() => pendingTunnels.delete(key));
  pendingTunnels.set(key, pending);
  return pending;
}

async function closeTunnel(key = null) {
  const selected = key === null ? [...tunnels.values()] : [tunnels.get(String(key))].filter(Boolean);
  await Promise.all(selected.map(async (tunnel) => {
    tunnels.delete(tunnel.key);
    await new Promise((resolve) => {
      if (!tunnel.server.listening) return resolve();
      tunnel.server.close(resolve);
    });
    tunnel.client.end();
    tunnel.client.destroy();
  }));
  if (key === null) pendingTunnels.clear();
}

function isTunnelActive(key) {
  const tunnel = tunnels.get(String(key));
  return Boolean(tunnel?.client && tunnel?.server?.listening);
}

module.exports = {
  ensureTunnel,
  isTunnelActive,
  closeTunnel,
};
