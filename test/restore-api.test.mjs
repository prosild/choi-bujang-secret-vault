import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import restore from '../api/restore.js';
import notes from '../api/notes.js';
import config from '../aleph.config.json' with { type: 'json' };

test('restore accepts only verified B and binds RPC owner and run to signed claims', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  const keys = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'restore-fixture', alg: 'ES256', use: 'sig' };
  process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
  process.env.SUPABASE_SECRET_KEY = 'fixture-only';
  const owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', run = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const noteId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const token = async (identity, signingKey = keys.privateKey, extra = {}) => new SignJWT({
    aleph_role: 'judge', aleph_identity: identity, aleph_run: run, ...extra,
  }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).setSubject(owner).setIssuer(config.judgeIssuer)
    .setAudience(new URL(config.publicAppUrl).hostname).setIssuedAt().setExpirationTime('5m').sign(signingKey);
  const tokens = { b: await token('b'), a: await token('a'), bad: await token('b', (await generateKeyPair('ES256')).privateKey) };
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `${config.judgeIssuer}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    const body = JSON.parse(init.body); calls.push({ path: url.pathname, body });
    assert.equal(body.p_owner, owner); assert.equal(body.p_run, run); assert.equal(body.p_id, noteId);
    if (url.pathname === '/rest/v1/rpc/vault_create_restore_note') return Response.json({ id: noteId });
    assert.equal(url.pathname, '/rest/v1/rpc/vault_restore_note');
    return Response.json({ id: noteId, restored: true, revision: 1, contentHash: 'a'.repeat(64) });
  };
  async function call(handler, method, auth, body, url) {
    let status, result;
    await handler({ method, headers: { authorization: auth ? `Bearer ${auth}` : null }, body, query: {}, url }, {
      setHeader() {}, status(value) { status = value; return this; }, json(value) { result = value; },
    });
    return { status, result };
  }
  assert.equal((await call(restore, 'GET', tokens.b)).status, 405);
  assert.equal((await call(restore, 'POST', null, { id: noteId })).status, 401);
  assert.equal((await call(restore, 'POST', tokens.a, { id: noteId })).status, 403);
  assert.equal((await call(restore, 'POST', tokens.bad, { id: noteId })).status, 401);
  for (const body of [{}, { id: 'wrong' }, { id: noteId, owner_id: owner }, { id: noteId, content: 'replacement' }]) {
    assert.equal((await call(restore, 'POST', tokens.b, body)).status, 400);
  }
  assert.equal(calls.length, 0);
  assert.equal((await call(notes, 'POST', tokens.b, { id: noteId, title: 'Fixture', body: 'Fictional' }, '/api/notes')).status, 201);
  assert.equal(calls[0].path, '/rest/v1/rpc/vault_create_restore_note');
  const restored = await call(restore, 'POST', tokens.b, { id: noteId }, '/api/restore');
  assert.equal(restored.status, 200); assert.equal(restored.result.restored, true);
  assert.equal(JSON.stringify(restored.result).includes(owner), false);
  assert.equal(JSON.stringify(restored.result).includes(tokens.b), false);
});
