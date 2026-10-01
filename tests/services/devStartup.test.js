import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { test } from 'node:test';

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function postWithHost(url, host, origin) {
  return new Promise((resolve, reject) => {
    // Node fetch controls Host itself. A raw HTTP request lets us emulate
    // the browser's real LAN Host while connecting on the loopback interface.
    const req = httpRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: host, Origin: origin },
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Proxy request timed out.')));
    req.end('{}');
  });
}

test('dev launcher serves authenticated APIs through the Vite proxy', { timeout: 30000 }, async () => {
  assert.equal(process.env.NODE_ENV, 'test', 'Run through npm run test:db with the guarded test database.');
  const apiPort = await availablePort();
  let clientPort = await availablePort();
  while (clientPort === apiPort) clientPort = await availablePort();
  const child = spawn(process.execPath, ['scripts/dev.js', '--port', String(clientPort), '--host', '127.0.0.1'], {
    cwd: new URL('../../', import.meta.url),
    env: {
      ...process.env,
      API_PORT: String(apiPort),
      PERSISTENCE_ENABLED: 'true',
      ALLOWED_ORIGINS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  let readyTimer;
  try {
    await new Promise((resolve, reject) => {
      readyTimer = setTimeout(() => reject(new Error(`Dev startup timed out: ${output}`)), 20000);
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Dev exited (${code}): ${output}`)));
      child.stderr.on('data', data => { output += data.toString(); });
      child.stdout.on('data', data => {
        output += data.toString();
        if (output.includes(`http://127.0.0.1:${apiPort}`)) resolve();
      });
    });
    clearTimeout(readyTimer);
    const base = `http://127.0.0.1:${clientPort}`;
    const request = (path, options = {}) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000), ...options });
    const me = await request('/api/auth/me');
    assert.equal(me.status, 401, 'Missing session must return an auth error, not the legacy server 404.');
    assert.equal((await me.json()).error.code, 'AUTH_REQUIRED');
    assert.equal((await request('/api/admin/overview')).status, 401);
    const login = await request('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}',
    });
    assert.equal(login.status, 400);
    assert.equal(typeof (await login.json()).error.message, 'string');
    const lanHost = `192.168.0.101:${clientPort}`;
    const lanRegister = await postWithHost(`${base}/api/auth/register`, lanHost, `http://${lanHost}`);
    // Invalid fields are expected, but an ordinary LAN request must reach
    // registration validation without an Origin rejection or creating a user.
    assert.equal(lanRegister.status, 400);
    assert.equal(lanRegister.body.error.code, 'AUTH_VALIDATION_ERROR');
    const foreignRegister = await postWithHost(`${base}/api/auth/register`, lanHost, 'http://foreign.example');
    assert.equal(foreignRegister.status, 403);
    assert.equal(foreignRegister.body.error.code, 'INVALID_ORIGIN');
    const admin = await request('/admin');
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /src\/features\/admin\/admin\.js/);
  } finally {
    clearTimeout(readyTimer);
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
});
