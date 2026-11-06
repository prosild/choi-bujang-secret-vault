import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { resourcePath } from '../src/api-resource.mjs';
import announcements from '../api/announcements/[id].js';

test('resource rules allow single notes and read-only announcements, regardless of arbitrary ID shape', async () => {
  const { normal } = fixtureRequests();
  for (const service of ['notes', 'announcements']) for (const prefix of ['', '/api']) {
    for (const method of service === 'notes' ? ['GET', 'PUT', 'DELETE'] : ['GET']) {
      assert.equal((await decide({ ...normal, service, method, path: `${prefix}/${service}/sample-note`,
        route: `${method} ${prefix}/${service}/:id` })).decision, 'allow');
    }
  }
});

test('deny collections, instructor resources, query operations, reserved paths and route spoofing', async () => {
  const { normal } = fixtureRequests();
  const denied = [
    { path: '/notes', route: 'GET /notes' }, { path: '/notes/' }, { path: '/notes/export' },
    { path: '/notes/demo/extra' }, { path: '/notes/..' }, { path: '/notes/%2e%2e' },
    { path: '/notes/demo?export=true' }, { path: '/notes/demo\\more' },
    { queryLength: 1 }, { service: 'instructor' }, { service: 'unknown' },
    { route: 'GET /notes' }, { method: 'POST', route: 'POST /notes/:id' },
    ...['POST', 'PUT', 'PATCH', 'DELETE'].map(method => ({ service: 'announcements', method,
      path: '/announcements/sample', route: `${method} /announcements/:id` })),
  ];
  for (const change of denied) assert.equal((await decide({ ...normal, ...change })).decision, 'deny', JSON.stringify(change));
});

test('API path and dynamic ID must agree; query selector and foreign resource are rejected', () => {
  assert.equal(resourcePath({ url: '/api/notes/a', query: { id: 'a' } }, 'notes'), true);
  for (const url of ['/api/notes?id=a', '/api/notes/a?operation=export', '/api/announcements/a', '/api/notes/b']) {
    assert.equal(resourcePath({ url, query: { id: 'a' } }, 'notes'), false);
  }
});

test('announcement direct writes fail before trusting caller role or contacting DB', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    let status, body;
    await announcements({ method, body: { role: 'instructor' }, query: { id: 'sample' } }, {
      setHeader() {}, status(value) { status = value; return this; }, json(value) { body = value; },
    });
    assert.equal(status, 405);
    assert.equal(body.error, 'READ_ONLY_RESOURCE');
  }
});
