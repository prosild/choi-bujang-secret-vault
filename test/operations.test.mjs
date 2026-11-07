import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import operations from '../api/operations.js';
import device from '../api/device.js';
import config from '../aleph.config.json' with { type: 'json' };
import { deviceFixture, adminUsersMock } from './device-fixture.mjs';
test('dashboard binds counts to verified owner and keeps unknown engine state separate from local passes', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
  process.env.SUPABASE_SECRET_KEY = 'fixture-only';
  const keys = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'operations-fixture', alg: 'ES256', use: 'sig' };
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const token = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid })
    .setIssuer(config.identityProvider.issuer).setAudience('authenticated').setSubject(owner).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  const fixture = await deviceFixture();
  const approvals = new Map([[owner, [fixture.approval()]]]);
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
    const admin = adminUsersMock(url, init, approvals); if (admin) return admin;
    assert.equal(url.pathname, '/rest/v1/rpc/vault_operation_summary');
    assert.deepEqual(JSON.parse(init.body), { p_owner: owner });
    return Response.json({ ownedNotes: 2, snapshots: 0, restores: 0, lastRestoreRevision: null, lastRestoreAt: null });
  };
  async function call(handler, method, authorized = true, signed = true) {
    let status, result; const headers = {};
    const url = handler === device ? '/api/device' : '/api/operations';
    const body = { deviceRegistered: true };
    const signature = signed ? await fixture.sign({ method, url, body }) : {};
    await handler({ method, url, headers: authorized ? { authorization: `Bearer ${token}`, 'x-role': 'admin', ...signature } : {},
      query: { owner: 'forged-user' }, body }, {
      setHeader(key, value) { headers[key] = value; }, status(value) { status = value; return this; }, json(value) { result = value; },
    });
    return { status, result, headers };
  }
  assert.equal((await call(operations, 'GET', false)).status, 401);
  assert.equal((await call(operations, 'POST')).status, 405);
  const summary = await call(operations, 'GET');
  assert.equal(summary.status, 200); assert.equal(summary.result.counts.ownedNotes, 2);
  assert.equal(summary.result.engine.deviceApproval, 'NOT_CONNECTED');
  assert.equal(summary.result.judge.score, null); assert.equal(summary.result.judge.status, 'NOT_RUN');
  assert.equal(JSON.stringify(summary.result).includes(owner), false);
  assert.equal(JSON.stringify(summary.result).includes(token), false);
  assert.equal(summary.headers['Cache-Control'], 'no-store, private');
  assert.equal(summary.result.device.id, fixture.id);
  assert.equal((await call(operations, 'GET', true, false)).result.error, 'DEVICE_SIGNATURE_REQUIRED');
  approvals.set(owner, []);
  assert.equal((await call(operations, 'GET')).status, 403);
  const state = await call(device, 'GET');
  assert.equal(state.result.status, 'not_approved'); assert.equal(state.result.deviceId, fixture.id);
  // 본문의 deviceRegistered/approved 값으로는 승인되지 않습니다.
  const approval = await call(device, 'POST');
  assert.equal(approval.status, 400); assert.deepEqual(approvals.get(owner), []);
});
