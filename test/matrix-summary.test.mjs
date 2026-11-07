import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MATRIX, summarize } from '../public/matrix-summary.js';

test('re-check summary counts only measured matches and never turns not-run or local-only rows into blocks', () => {
  assert.equal(MATRIX.length, 41);
  assert.deepEqual(MATRIX.map(row => row.no), Array.from({ length: 41 }, (_, i) => i + 1));
  const at = '2026-11-07T00:00:00.000Z';
  const results = [
    { no: 2, stage: 1, kind: 'forbidden', status: 'match', actual: 401, error: 'UNAUTHORIZED', at },
    { no: 41, stage: 11, kind: 'forbidden', status: 'match', actual: 401, error: 'DEVICE_SIGNATURE_REQUIRED', at },
    { no: 41, stage: 11, kind: 'forbidden', status: 'mismatch', actual: 200, error: null, at },
    { no: 12, stage: 4, kind: 'forbidden', status: 'not_run', actual: null, error: null, at },
    { no: 9, stage: 4, kind: 'normal', status: 'match', actual: 200, error: null, at },
    { no: 1, stage: 1, kind: 'forbidden', status: 'match', actual: 404, error: null, at },
  ];
  const summary = summarize(results);
  assert.equal(summary.blockedOf41, 2); // 1, 2만. 41은 불일치 포함, 12는 미실행
  assert.equal(summary.forbiddenBlocked, '3/4');
  assert.equal(summary.normalAllowed, '1/1');
  assert.equal(summary.notRun, 1);
  assert.equal(summary.rows.find(row => row.no === 41).state, 'live_mismatch');
  assert.equal(summary.rows.find(row => row.no === 12).state, 'local_only');
  assert.equal(summary.rows.find(row => row.no === 32).state, 'local_only');
  assert.equal(summary.denials['로그인 검증 (3단계)'], 1);
  assert.equal(summary.denials['요청 서명 필요 (11단계)'], 1);
  assert.equal(summary.matrix.liveMatch + summary.matrix.liveMismatch + summary.matrix.livePartial + summary.matrix.localOnly + summary.matrix.notRun, 41);
});
