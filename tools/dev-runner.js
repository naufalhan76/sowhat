const { spawn } = require('child_process');
const http = require('http');
const net = require('net');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const nodeCmd = process.execPath;
const uiPort = process.env.UI_PORT || '3000';
const apiPort = process.env.API_PORT || '3001';
const apiTarget = 'http://127.0.0.1:' + apiPort;
const children = [];
let shuttingDown = false;

function quoteArg(value) {
  const text = String(value);
  if (!/[\s"]/g.test(text)) {
    return text;
  }
  return '"' + text.replace(/"/g, '\\"') + '"';
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => {
      if (error && error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      resolve(false);
    });
    server.listen(Number(port), '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

function probeJson(urlPath, port) {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port: Number(port),
      path: urlPath,
      timeout: 1500,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(response.statusCode >= 200 && response.statusCode < 300 && payload && payload.ok !== false);
        } catch (_error) {
          resolve(false);
        }
      });
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

function probeHtml(port) {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port: Number(port),
      path: '/',
      timeout: 1500,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(response.statusCode >= 200 && response.statusCode < 500 && /vite|solofleet|html/i.test(body));
      });
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

function run(command, args, extraEnv) {
  const options = {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv,
    },
    shell: isWindows,
  };
  const child = isWindows
    ? spawn([command, ...args].map(quoteArg).join(' '), options)
    : spawn(command, args, options);

  children.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    for (const other of children) {
      if (other !== child && !other.killed) {
        other.kill('SIGTERM');
      }
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code || 0);
  });
  return child;
}

function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(0), 250).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  console.log('Starting Solofleet local web...');
  console.log('UI  : http://127.0.0.1:' + uiPort);
  console.log('API : http://127.0.0.1:' + apiPort);

  const apiPortFree = await isPortFree(apiPort);
  if (apiPortFree) {
    console.log('API status: starting local backend on port ' + apiPort);
    run(nodeCmd, ['server.js'], { PORT: apiPort });
  } else {
    const apiHealthy = await probeJson('/api/status', apiPort);
    if (!apiHealthy) {
      console.error('API port ' + apiPort + ' is already in use by another process. Stop that process or run with a different API_PORT.');
      process.exit(1);
      return;
    }
    console.log('API status: reusing existing backend on port ' + apiPort);
  }

  const uiPortFree = await isPortFree(uiPort);
  if (uiPortFree) {
    console.log('UI status: starting Vite on port ' + uiPort);
    run(npmCmd, ['run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', uiPort], {
      UI_PORT: uiPort,
      API_PROXY_TARGET: apiTarget,
    });
    return;
  }

  const uiHealthy = await probeHtml(uiPort);
  if (!uiHealthy) {
    console.error('UI port ' + uiPort + ' is already in use by another process. Stop that process or run with a different UI_PORT.');
    process.exit(1);
    return;
  }

  console.log('UI status: reusing existing dev server on port ' + uiPort);
  console.log('Nothing new needed. Existing local services look healthy.');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
