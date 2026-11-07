import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import notes from '../api/notes.js';
import device from '../api/device.js';
import config from '../aleph.config.json' with { type: 'json' };
import { deviceFixture, adminUsersMock } from './device-fixture.mjs';

// 11단계: 승인 전에는 자료가 없고, 서버가 승인한 기기의 올바른 서명 요청만 기존 자료실에 닿습니다.
test('protected notes need a server-approved device signature bound to method, path and body', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
  process.env.SUPABASE_SECRET_KEY = 'fixture-only';
  const keys = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'device-fixture', alg: 'ES256', use: 'sig' };
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const noteId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', otherId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const token = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid })
    .setIssuer(config.identityProvider.issuer).setAudience('authenticated').setSubject(owner)
    .setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  const judgeToken = await new SignJWT({ aleph_role: 'judge', aleph_identity: 'a', aleph_run: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' })
    .setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).setSubject('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb').setIssuer(config.judgeIssuer)
    .setAudience(new URL(config.publicAppUrl).hostname).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  const approved = await deviceFixture(), stranger = await deviceFixture();
  const approvals = new Map([[owner, []], ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', []]]);
  let dbReads = 0, signIns = 0;
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    if (u.pathname.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
    const admin = adminUsersMock(u, init, approvals, { [owner]: 'fixture' + '@' + 'example.test' }); if (admin) return admin;
    if (u.pathname === '/auth/v1/token') {
      signIns++;
      const body = JSON.parse(init.body);
      if (body.password !== 'correct-fixture') return Response.json({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, { status: 400 });
      return Response.json({ access_token: 'recheck-fixture', refresh_token: 'r', token_type: 'bearer', expires_in: 60,
        user: { id: owner, aud: 'authenticated', role: 'authenticated' } });
    }
    if (u.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    assert.equal(u.pathname, '/rest/v1/study_notes');
    dbReads++;
    return Response.json([]);
  };
  async function call(handler, { method = 'GET', url = '/api/notes', query = {}, body, headers = {}, auth = token }) {
    let status, result;
    await handler({ method, url, query, body, headers: { authorization: `Bearer ${auth}`, ...headers } }, {
      setHeader() {}, status(value) { status = value; return this; }, json(value) { result = value; } });
    return { status, error: result?.error, result };
  }
  const signed = (fixture, request) => fixture.sign({ method: request.method ?? 'GET', url: request.url ?? '/api/notes', body: request.body });

  // 승인 전: 서명 없는 요청·승인 기록 없는 기기는 자료가 없습니다.
  assert.equal((await call(notes, {})).error, 'DEVICE_SIGNATURE_REQUIRED');
  assert.equal((await call(notes, { headers: { 'x-device-registered': 'true', 'x-approved': 'true' } })).error, 'DEVICE_SIGNATURE_REQUIRED');
  assert.equal((await call(notes, { headers: await signed(approved, {}) })).status, 403);
  assert.equal(dbReads, 0);

  // 승인 요청: 비밀번호 재확인과 개인키 보유 서명이 모두 필요합니다.
  const approve = (fixture, password, publicKey = fixture.publicKey) => {
    const body = { publicKey, password };
    return signed(fixture, { method: 'POST', url: '/api/device', body }).then(headers =>
      call(device, { method: 'POST', url: '/api/device', body, headers }));
  };
  assert.equal((await call(device, { method: 'POST', url: '/api/device', body: { deviceRegistered: true } })).status, 400);
  assert.equal((await approve(approved, 'wrong-fixture')).error, 'PASSWORD_RECHECK_FAILED');
  assert.equal((await approve(stranger, 'correct-fixture', approved.publicKey)).error, 'DEVICE_SIGNATURE_INVALID');
  assert.deepEqual(approvals.get(owner), []);
  const ok = await approve(approved, 'correct-fixture');
  assert.equal(ok.status, 200); assert.equal(ok.result.deviceId, approved.id);
  assert.equal(approvals.get(owner).length, 1);
  assert.equal(JSON.stringify(ok.result).includes('correct-fixture'), false);

  // 승인 뒤: 같은 기기의 올바른 서명은 기존 자료실을 엽니다.
  assert.equal((await call(notes, { headers: await signed(approved, {}) })).status, 200);
  const status = await call(device, { url: '/api/device', headers: await signed(approved, { url: '/api/device' }) });
  assert.equal(status.result.status, 'approved');

  // 공격 1: 서명 없는 보호 요청
  assert.equal((await call(notes, {})).status, 401);
  // 공격 2: 서명 뒤 요청 경로 변경
  const pathSigned = await signed(approved, { url: `/api/notes/${noteId}` });
  assert.equal((await call(notes, { url: `/api/notes/${otherId}`, query: { id: otherId }, headers: pathSigned })).error, 'DEVICE_SIGNATURE_INVALID');
  assert.equal((await call(notes, { url: `/api/notes/${noteId}`, query: { id: noteId }, headers: pathSigned })).status, 404);
  // 공격 3: 서명 뒤 수정 본문 변경
  const original_ = { title: 'Fixture', body: 'Fictional' };
  const bodySigned = await signed(approved, { method: 'PUT', url: `/api/notes/${noteId}`, body: original_ });
  assert.equal((await call(notes, { method: 'PUT', url: `/api/notes/${noteId}`, query: { id: noteId },
    body: { ...original_, body: 'Changed after signing' }, headers: bodySigned })).error, 'DEVICE_SIGNATURE_INVALID');
  // 메서드 변경·위조 서명·다른 기기의 ID 사칭·오래된 서명
  assert.equal((await call(notes, { method: 'DELETE', url: `/api/notes/${noteId}`, query: { id: noteId }, headers: pathSigned })).status, 401);
  const forged = { ...await signed(approved, {}), 'x-vault-signature': (await signed(stranger, {}))['x-vault-signature'] };
  assert.equal((await call(notes, { headers: forged })).error, 'DEVICE_SIGNATURE_INVALID');
  assert.equal((await call(notes, { headers: await stranger.sign({ method: 'GET', url: '/api/notes', deviceId: approved.id }) })).error, 'DEVICE_SIGNATURE_INVALID');
  assert.equal((await call(notes, { headers: await approved.sign({ method: 'GET', url: '/api/notes', time: Date.now() - 120_000 }) })).error, 'DEVICE_SIGNATURE_INVALID');
  // 다른 계정(심판 A)이 승인된 기기의 서명을 가져와도 그 계정의 승인 기록이 없으므로 거부
  assert.equal((await call(notes, { auth: judgeToken, headers: await signed(approved, {}) })).status, 403);
  const judgeApprove = await call(device, { method: 'POST', url: '/api/device', auth: judgeToken,
    body: { publicKey: approved.publicKey, password: 'x' }, headers: await signed(approved, { method: 'POST', url: '/api/device', body: { publicKey: approved.publicKey, password: 'x' } }) });
  assert.equal(judgeApprove.error, 'DEVICE_APPROVAL_NOT_AVAILABLE');

  // 만료·회수 뒤에는 다시 자료가 없습니다.
  approvals.set(owner, [approved.approval(Date.now() - 1)]);
  assert.equal((await call(notes, { headers: await signed(approved, {}) })).status, 403);
  approvals.set(owner, [approved.approval()]);
  const revoke = await call(device, { method: 'DELETE', url: '/api/device', headers: await signed(approved, { method: 'DELETE', url: '/api/device' }) });
  assert.equal(revoke.result.status, 'revoked');
  assert.equal(approvals.revocations.get(owner).count, 1);
  assert.equal((await call(notes, { headers: await signed(approved, {}) })).status, 403);
  assert.equal(signIns, 2); // 서명이 틀린 승인 요청은 비밀번호 확인 전에 거부
});
