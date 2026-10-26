const net = require('net');
const { Client } = require('ssh2');
require('dotenv').config();

let sshClient = null;
let netServer = null;
let isTunnelReady = false;
let initPromise = null;

const tunnelConfig = {
  enabled: process.env.MSSQL_USE_SSH_TUNNEL === 'true',
  sshHost: process.env.MSSQL_SSH_HOST || process.env.MSSQL_SERVER || 'HOST_REDACTED',
  sshPort: parseInt(process.env.MSSQL_SSH_PORT, 10) || 22,
  sshUser: process.env.MSSQL_SSH_USER || 'developer',
  sshPassword: process.env.MSSQL_SSH_PASSWORD || '',
  remoteHost: '127.0.0.1', // Dari perspektif SSH server
  remotePort: parseInt(process.env.MSSQL_PORT, 10) || 1433,
  localPort: parseInt(process.env.LOCAL_TUNNEL_PORT, 10) || 11433,
};

function createTunnel() {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    if (!tunnelConfig.enabled) {
      return resolve(null);
    }

    if (isTunnelReady && netServer && sshClient) {
      return resolve(tunnelConfig.localPort);
    }

    console.log(`🔌 Membuka SSH tunnel ke ${tunnelConfig.sshHost}:${tunnelConfig.sshPort} (user: ${tunnelConfig.sshUser})...`);

    const client = new Client();

    client.on('ready', () => {
      console.log('✓ SSH tunnel tersambung!');
      sshClient = client;

      // Jika netServer lama masih ada, bersihkan dulu
      if (netServer) {
        try { netServer.close(); } catch (e) {}
        netServer = null;
      }

      const server = net.createServer((socket) => {
        socket.on('error', (err) => {
          console.warn('Local tunnel client socket error:', err.message);
        });

        if (!sshClient) {
          socket.destroy();
          return;
        }

        try {
          client.forwardOut(
            '127.0.0.1',
            socket.remotePort,
            tunnelConfig.remoteHost,
            tunnelConfig.remotePort,
            (err, stream) => {
              if (err) {
                console.warn('SSH forwardOut error:', err.message);
                socket.destroy();
                return;
              }
              socket.pipe(stream).pipe(socket);
              socket.on('error', () => { try { stream.destroy(); } catch (e) {} });
              stream.on('error', () => { try { socket.destroy(); } catch (e) {} });
            }
          );
        } catch (fwdErr) {
          console.warn('SSH forwardOut catch error:', fwdErr.message);
          socket.destroy();
        }
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`ℹ️ Port lokal ${tunnelConfig.localPort} sudah digunakan, menggunakan listener yang ada.`);
          isTunnelReady = true;
          netServer = server;
          resolve(tunnelConfig.localPort);
        } else {
          console.error('Local tunnel net server error:', err.message);
          reject(err);
        }
      });

      server.listen(tunnelConfig.localPort, '127.0.0.1', () => {
        console.log(`✓ Port forward aktif di 127.0.0.1:${tunnelConfig.localPort} -> remote 1433`);
        isTunnelReady = true;
        netServer = server;
        resolve(tunnelConfig.localPort);
      });
    });

    client.on('error', (err) => {
      console.warn('SSH Connection warning/error:', err.message);
      closeTunnel().catch(() => {});
    });

    client.on('close', () => {
      console.log('SSH connection closed.');
      closeTunnel().catch(() => {});
    });

    try {
      client.connect({
        host: tunnelConfig.sshHost,
        port: tunnelConfig.sshPort,
        username: tunnelConfig.sshUser,
        password: tunnelConfig.sshPassword,
        readyTimeout: 30000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      });
    } catch (err) {
      initPromise = null;
      reject(err);
    }
  });

  return initPromise;
}

async function ensureTunnel() {
  if (!tunnelConfig.enabled) {
    return null;
  }
  if (!isTunnelReady || !sshClient) {
    await closeTunnel();
    return await createTunnel();
  }
  return tunnelConfig.localPort;
}

async function closeTunnel() {
  isTunnelReady = false;
  initPromise = null;
  if (netServer) {
    try {
      netServer.close();
    } catch (e) {}
    netServer = null;
  }
  if (sshClient) {
    try {
      sshClient.end();
      sshClient.destroy();
    } catch (e) {}
    sshClient = null;
  }
  console.log('✓ SSH tunnel ditutup / di-reset.');
}

function isTunnelActive() {
  return isTunnelReady && !!sshClient && !!netServer;
}

module.exports = {
  tunnelConfig,
  ensureTunnel,
  isTunnelActive,
  closeTunnel,
};
