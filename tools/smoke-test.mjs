import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const cwd = process.cwd();
const port = Number(process.env.SMOKE_TEST_PORT || 3311);
const host = '127.0.0.1';
const baseUrl = `http://${host}:${port}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(child, timeoutMs = 15000) {
  const startedAt = Date.now();
  let stdoutBuffer = '';
  let stderrBuffer = '';

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += String(chunk || '');
  });
  child.stderr.on('data', (chunk) => {
    stderrBuffer += String(chunk || '');
  });

  while (Date.now() - startedAt < timeoutMs) {
    if (stdoutBuffer.includes(`Solofleet auto monitor running at http://${host}:${port}`)) {
      return { stdoutBuffer, stderrBuffer };
    }
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}\nSTDOUT:\n${stdoutBuffer}\nSTDERR:\n${stderrBuffer}`);
    }
    await wait(150);
  }

  throw new Error(`Server did not start within ${timeoutMs} ms.\nSTDOUT:\n${stdoutBuffer}\nSTDERR:\n${stderrBuffer}`);
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { response, text, json };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: host,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(child);

    const indexResponse = await request('/');
    assert(indexResponse.response.status === 200, `Expected GET / => 200, got ${indexResponse.response.status}`);
    assert(String(indexResponse.response.headers.get('content-type') || '').includes('text/html'), 'Expected HTML content type for /.');
    assert(Boolean(indexResponse.response.headers.get('content-security-policy')), 'Expected Content-Security-Policy header for /.');
    assert(indexResponse.response.headers.get('x-frame-options') === 'DENY', 'Expected X-Frame-Options DENY for /.');
    assert(indexResponse.response.headers.get('x-content-type-options') === 'nosniff', 'Expected X-Content-Type-Options nosniff for /.');
    assert(Boolean(indexResponse.response.headers.get('referrer-policy')), 'Expected Referrer-Policy header for /.');

    const statusResponse = await request('/api/status');
    assert(statusResponse.response.status === 200, `Expected GET /api/status => 200, got ${statusResponse.response.status}`);
    assert(statusResponse.json && typeof statusResponse.json === 'object', 'Expected /api/status JSON payload.');
    assert(Array.isArray(statusResponse.json?.fleet?.rows) && statusResponse.json.fleet.rows.length === 0, 'Expected public /api/status to hide fleet rows.');

    const configResponse = await request('/api/config');
    assert(configResponse.response.status === 401, `Expected GET /api/config => 401, got ${configResponse.response.status}`);

    const loginGuardResponse = await request('/api/web-auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ username: 'nobody', password: 'wrong' }),
    });
    assert(loginGuardResponse.response.status === 403, `Expected cross-site login => 403, got ${loginGuardResponse.response.status}`);

    const manifestResponse = await request('/manifest.webmanifest');
    assert(manifestResponse.response.status === 200, `Expected GET /manifest.webmanifest => 200, got ${manifestResponse.response.status}`);

    const indexHtml = await readFile(path.join(cwd, 'web-dist', 'index.html'), 'utf8');
    const assetMatch = indexHtml.match(/\/assets\/[^\"]+\.js/);
    assert(assetMatch, 'Expected built index.html to reference a JS asset.');

    const assetResponse = await request(assetMatch[0], {
      headers: {
        'Accept-Encoding': 'gzip',
      },
    });
    assert(assetResponse.response.status === 200, `Expected built asset => 200, got ${assetResponse.response.status}`);
    assert(String(assetResponse.response.headers.get('cache-control') || '').includes('immutable'), 'Expected immutable cache-control for built asset.');
    assert(['gzip', 'br', ''].includes(String(assetResponse.response.headers.get('content-encoding') || '')), 'Unexpected content-encoding for built asset.');
    const assetEtag = assetResponse.response.headers.get('etag');
    assert(Boolean(assetEtag), 'Expected ETag header for built asset.');

    const cachedAssetResponse = await request(assetMatch[0], {
      headers: {
        'If-None-Match': assetEtag,
      },
    });
    assert(cachedAssetResponse.response.status === 304, `Expected conditional asset request => 304, got ${cachedAssetResponse.response.status}`);

    console.log('Smoke test passed.');
    console.log(JSON.stringify({
      baseUrl,
      checks: {
        index: indexResponse.response.status,
        status: statusResponse.response.status,
        csp: Boolean(indexResponse.response.headers.get('content-security-policy')),
        xFrameOptions: indexResponse.response.headers.get('x-frame-options'),
        xContentTypeOptions: indexResponse.response.headers.get('x-content-type-options'),
        configUnauthorized: configResponse.response.status,
        crossSiteLoginRejected: loginGuardResponse.response.status,
        manifest: manifestResponse.response.status,
        assetCacheControl: assetResponse.response.headers.get('cache-control'),
        assetContentEncoding: assetResponse.response.headers.get('content-encoding') || '',
        assetEtag,
        assetConditional: cachedAssetResponse.response.status,
      },
    }, null, 2));
  } finally {
    child.kill('SIGTERM');
    await wait(200);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});



