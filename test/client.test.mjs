import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import device from '../api/device.js';
import { ACCESS_COOKIE } from '../src/session-cookies.mjs';

test('device status cannot be forged with caller headers or body approval', async () => {
  async function call(method, headers, body) {
    let code, result;
    await device({ method, headers, body }, { setHeader() {},
      status(value) { code = value; return this; }, json(value) { result = value; } });
    return { code, result };
  }
  for (const method of ['GET', 'POST']) {
    const response = await call(method, { 'x-device-registered': 'true', 'x-role': 'admin' }, { deviceRegistered: true, approved: true });
    assert.equal(response.code, 401);
    assert.equal(response.result.error, 'UNAUTHORIZED');
  }
  assert.equal((await call('POST', { cookie: `${ACCESS_COOKIE}=fixture`, origin: 'https://evil.example' }, {})).code, 403);
});

test('offline worker never caches API responses or private note content', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(source, /cache\.add\(OFFLINE\)/u);
  assert.doesNotMatch(source, /cache\.put|cache\.addAll/u);
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.start_url, '/'); assert.equal(manifest.display, 'standalone');
});
