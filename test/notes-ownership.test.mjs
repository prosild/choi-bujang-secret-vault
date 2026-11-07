import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import notes from '../api/notes.js';
import config from '../aleph.config.json' with { type: 'json' };
import { deviceFixture, adminUsersMock } from './device-fixture.mjs';

test('API uses verified owner for CRUD and hides another owner even with body/query/header spoofing', async t => {
  const originalFetch = globalThis.fetch;
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  t.after(() => { globalThis.fetch = originalFetch;
    for (const [key, value] of [['SUPABASE_URL', previous.url], ['SUPABASE_SECRET_KEY', previous.key]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const origin = new URL(config.identityProvider.issuer).origin;
  process.env.SUPABASE_URL = origin; process.env.SUPABASE_SECRET_KEY = 'fixture-only';
  const keys = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'ownership-test', alg: 'ES256', use: 'sig' };
  const owners = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const tokens = await Promise.all(owners.map(owner => new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).setIssuer(config.identityProvider.issuer)
    .setAudience('authenticated').setSubject(owner).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey)));
  const rows = new Map(); let writes = 0;
  const devices = [await deviceFixture(), await deviceFixture()];
  const approvals = new Map(owners.map((owner, index) => [owner, [devices[index].approval()]]));
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    if (u.pathname.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
    const admin = adminUsersMock(u, init, approvals); if (admin) return admin;
    assert.equal(u.pathname, '/rest/v1/study_notes');
    const method = init.method ?? 'GET';
    if (method === 'POST') {
      const row = JSON.parse(init.body); assert.equal(row.owner_id, owners[0]);
      rows.set(row.api_id, row); writes++; return new Response(null, { status: 201 });
    }
    const owner = u.searchParams.get('owner_id'); assert.ok(owners.some(value => owner === `eq.${value}`));
    const noteId = u.searchParams.get('api_id');
    const selected = [...rows.values()].filter(row => `eq.${row.owner_id}` === owner && (!noteId || `eq.${row.api_id}` === noteId));
    const result = selected.map(row => {
      if (method === 'PATCH') { Object.assign(row, JSON.parse(init.body)); writes++; }
      if (method === 'DELETE') { rows.delete(row.api_id); writes++; }
      return { id: row.api_id, title: row.title, content: row.content };
    });
    return Response.json(result);
  };
  async function call(method, ownerIndex, { individual = false, body, query, url } = {}) {
    let status, result;
    const target = url ?? (individual ? `/api/notes/${id}` : '/api/notes');
    const signed = await devices[ownerIndex].sign({ method, url: target, body });
    await notes({ method, url: target,
      query: query ?? (individual ? { id } : {}), body,
      headers: { authorization: `Bearer ${tokens[ownerIndex]}`, 'x-user-id': owners[0], 'x-role': 'instructor', ...signed } }, {
      setHeader() {}, status(code) { status = code; return this; }, json(value) { result = value; },
    });
    return { status, result };
  }
  assert.equal((await call('POST', 0, { body: { id, title: 'Fixture', body: 'Fictional test note' } })).status, 201);
  assert.equal((await call('GET', 0, { individual: true })).status, 200);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    assert.equal((await call(method, 1, { individual: true, body: { title: 'Changed', body: 'Fixture' } })).status, 404);
  }
  assert.deepEqual((await call('GET', 1)).result, { notes: [] });
  assert.equal(writes, 1);
  assert.equal((await call('PUT', 0, { individual: true, body: { title: 'Changed', body: 'Fixture', owner_id: owners[1] } })).status, 400);
  assert.equal((await call('GET', 1, { query: { owner_id: owners[0] } })).status, 400);
  assert.equal((await call('GET', 0, { url: `/api/notes?id=${id}`, query: { id } })).status, 400);
  assert.equal((await call('PUT', 0, { individual: true, body: { title: 'Changed', body: 'Fixture' } })).status, 200);
  assert.equal((await call('GET', 0, { individual: true })).result.title, 'Changed');
  assert.equal((await call('DELETE', 0, { individual: true })).status, 200);
  assert.equal((await call('GET', 0, { individual: true })).status, 404);
});
