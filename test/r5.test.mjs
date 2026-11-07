import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = {
  step: 2,
  judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
  sampleMarker: 'SAMPLE_NOTE_1',
  publicAppUrl: 'https://student-defense.vercel.app',
};
// 실제 네트워크 응답처럼 요청 주소(url)를 가진 응답을 만듭니다.
const networkResponse = (url, response) => Object.defineProperty(response, 'url', { value: String(url) });
const env = {
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'Student-A',
  VERCEL_GIT_REPO_SLUG: 'aleph-defense',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_URL: 'student-defense-123.vercel.app',
};

test('build identity uses Vercel Git and deployment metadata', () => {
  assert.deepEqual(deploymentIdentity(env, config), {
    schema: 'aleph.defense.deployment.v1',
    step: 2,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    commit: 'a'.repeat(40),
    publicAppUrl: 'https://student-defense-123.vercel.app',
    judgeIssuer: config.judgeIssuer,
    sampleMarker: config.sampleMarker,
  });
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_PROVIDER: undefined }, config));
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_COMMIT_SHA: 'short' }, config));
});

test('self-check records actual static/API exposure and does not turn failures into PASS', async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  let options;
  try {
    globalThis.fetch = async (url, init) => {
      requestUrls.push(String(url));
      options = init;
      return networkResponse(url, new Response(JSON.stringify({ sampleMarker: 'SAMPLE_NOTE_1', notes: [{ title: '가상', body: '합성 시험' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    };
    const [result, api] = await runAttackChecks(config);
    assert.deepEqual(requestUrls, ['https://student-defense.vercel.app/data.json',
      'https://student-defense.vercel.app/api/notes']);
    assert.equal(options.redirect, 'error');
    assert.match(result.observed, /^HTTP 200; .*가상 메모 확인 표시 노출$/u);
    assert.match(api.observed, /비로그인 메모 열람 가능/u);
    globalThis.fetch = async url => networkResponse(url, new Response('<html>not the data</html>', { status: 200 }));
    const [missing, uncertain] = await runAttackChecks(config);
    assert.match(missing.observed, /확인 표시 노출 없음/u);
    assert.match(uncertain.observed, /별도 확인 필요/u);
    globalThis.fetch = async url => networkResponse(url, Response.json({ error: 'UNAUTHORIZED' }, { status: 401 }));
    assert.match((await runAttackChecks(config))[1].observed, /JSON 오류로 비로그인 요청 거부/u);
    globalThis.fetch = async () => { throw new Error('fixture_network_failure'); };
    // 응답을 받지 못한 요청은 결과가 없으므로 not_run으로만 기록합니다.
    assert.ok((await runAttackChecks(config)).every(item => item.observed === 'not_run'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
