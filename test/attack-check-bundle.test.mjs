import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));

test('self-check file loads without any module import', () => {
  const source = readFileSync(new URL('../src/attack-check.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/mu);
  assert.doesNotMatch(source, /\bimport\s*\(/u);
  assert.doesNotMatch(source, /\brequire\s*\(/u);
});

test('each observed result is the response to the request sent for that same attackId', async () => {
  const originalFetch = globalThis.fetch;
  const sent = [];
  try {
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      const headers = init?.headers ?? {};
      sent.push({ path, method: init?.method, attackId: headers['X-Attack-Id'], requestId: headers['X-Request-Id'] });
      const status = path === '/api/restore' ? 405 : path === '/data.json' ? 404 : 401;
      return Response.json({ error: 'FIXTURE' }, { status, headers: { 'x-request-id': `srv-${sent.length}` } });
    };
    const attempts = await runAttackChecks(config);
    assert.ok(attempts.length >= 1 && attempts.length <= 20);
    assert.equal(new Set(attempts.map(item => item.attackId)).size, attempts.length);
    assert.ok(sent.every(item => item.method === 'GET'), 'GET만 보냄');
    assert.equal(new Set(sent.map(item => item.attackId)).size, sent.length, '점검 하나당 요청 하나');

    const ran = attempts.filter(item => item.observed !== 'not_run');
    assert.equal(ran.length, sent.length, '요청 수와 실행 기록 수가 같아야 함');
    for (const item of ran) {
      const request = sent.find(entry => entry.attackId === item.attackId);
      assert.ok(request, `${item.attackId}로 보낸 요청이 있어야 함`);
      assert.match(request.requestId, /^[0-9a-f-]{36}$/u);
      assert.match(item.observed, /^HTTP \d{3}; /u, item.attackId);
      assert.ok(item.observed.includes(`보낸 요청 ID ${request.requestId}`), item.attackId);
      assert.ok(item.observed.includes(`응답 요청 ID srv-${sent.indexOf(request) + 1}`), item.attackId);
    }
    for (const id of ['cross_user_note_read', 'anonymous_restore_post', 'local_decider_contract',
      'local_policy_recovery', 'local_device_signature']) {
      assert.equal(attempts.find(item => item.attackId === id)?.observed, 'not_run', id);
      assert.ok(!sent.some(item => item.attackId === id), `${id}는 요청을 보내지 않음`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a request that gets no HTTP response is recorded as not_run, never as a result', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('blocked_by_runner'); };
    const attempts = await runAttackChecks(config);
    assert.ok(attempts.every(item => item.observed === 'not_run'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
