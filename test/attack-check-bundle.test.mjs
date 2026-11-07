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

test('every observed result matches a request actually sent; unsent checks are not_run', async () => {
  const originalFetch = globalThis.fetch;
  const sent = [];
  try {
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      sent.push({ path, method: init?.method });
      const status = path === '/api/restore' ? 405 : path === '/data.json' ? 404 : 401;
      return Response.json({ error: 'FIXTURE' }, { status, headers: { 'x-request-id': `req-${sent.length}` } });
    };
    const attempts = await runAttackChecks(config);
    assert.ok(attempts.length >= 1 && attempts.length <= 20);
    assert.equal(new Set(attempts.map(item => item.attackId)).size, attempts.length);
    assert.ok(sent.every(item => item.method === 'GET'), 'GET만 보냄');
    const ran = attempts.filter(item => item.observed !== 'not_run');
    assert.equal(ran.length, sent.length, '요청 수와 실행 기록 수가 같아야 함');
    ran.forEach((item, index) => {
      assert.match(item.observed, /HTTP \d{3}/u, item.attackId);
      // 앱 요청은 받은 요청 ID를 그대로 적음 (원본 DB 요청은 X-Request-Id를 그대로 적음)
      assert.ok(item.observed.includes(`req-${index + 1}`), `${item.attackId}는 ${index + 1}번째 요청의 결과여야 함`);
    });
    assert.ok(attempts.some(item => item.attackId === 'cross_user_note_read' && item.observed === 'not_run'));
    assert.ok(attempts.some(item => item.attackId === 'anonymous_restore_post' && item.observed === 'not_run'));

    globalThis.fetch = async () => { throw new Error('fixture_network_failure'); };
    const failed = await runAttackChecks(config);
    assert.ok(failed.filter(item => item.observed !== 'not_run').every(item => item.observed.startsWith('요청 실패')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
