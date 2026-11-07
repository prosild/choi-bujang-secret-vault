// 10단계 자체 점검: 제출 묶음을 만들 때 실제로 실행한 로컬 결과만 돌려줍니다.
// 심판 판정·운영 엔진·실제 DB 시험과는 별도입니다. 운영 정책 파일(src, aleph.config.json)은 쓰지 않습니다.
import { spawnSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareRecovery, inspectRecovery, restoreTestPolicy } from './policy-recovery.mjs';
import { checkDecider } from './decider-test.mjs';

const root = resolve(import.meta.dirname, '..');
const POLICY_FILES = ['decider.mjs', 'allowed-routes.json', 'db-policy.json'];

async function tamperedBackupRejected() {
  const prepared = await prepareRecovery();
  await writeFile(join(prepared.directory, 'backup', 'decider.mjs'), '// tampered backup fixture\n');
  try {
    await inspectRecovery(prepared.directory);
    return '변조된 백업을 거부하지 못함';
  } catch (error) {
    return /backup_hash_mismatch/u.test(error.message) ? '변조된 백업 거부 (backup_hash_mismatch)' : `다른 오류로 중단: ${error.message}`;
  }
}

export async function runRecoveryEvidence() {
  const attempts = [];

  // 1) 사전 백업 재검증 → 차이 확인 → 시험 사본만 복원 → 사본과 재대조
  const prepared = await prepareRecovery();
  const reviewed = await inspectRecovery(prepared.directory);
  const target = join(prepared.directory, 'test-copy');
  const restored = await restoreTestPolicy({ backup: join(prepared.directory, 'backup'), target,
    trustedManifestHash: reviewed.trustedManifestHash, reviewedVersion: reviewed.version, reviewedChanges: reviewed.changes });
  let identical = 0;
  for (const file of POLICY_FILES) {
    if (await readFile(join(prepared.directory, 'backup', file), 'utf8') === await readFile(join(target, file), 'utf8')) identical += 1;
  }
  const preserved = await readFile(join(target, 'audit.log'), 'utf8') === 'fixture audit retained\n'
    && await readFile(join(target, 'other-service.json'), 'utf8') === '{"preserve":true}\n';
  attempts.push({ attackId: 'local_policy_backup_reverify',
    expected: '복원 직전 사본 manifest·파일 해시를 다시 읽어 검증하고 시험 사본만 복원; 복원 뒤 사본과 일치',
    observed: `버전 ${reviewed.version.slice(0, 12)}; 실행 전 변경 ${reviewed.changes.map(c => `${c.file} ${c.lines.length}줄`).join(', ') || '없음'}; `
      + `복원 ${restored.restoredFiles.join(',') || '없음'}; 사본 일치 ${identical}/${POLICY_FILES.length}; 재검증 ${restored.verified ? '통과' : '실패'}; `
      + `감사·다른 서비스 파일 ${preserved ? '보존' : '변경됨'}` });

  // 2) 손댄 백업은 거부되어야 함
  attempts.push({ attackId: 'local_tampered_backup_rejected',
    expected: '해시가 맞지 않는 백업 사본은 복원 전에 거부되어야 함',
    observed: await tamperedBackupRejected() });

  // 3) 복원된 정책으로 1~9단계 정상·금지 요청 재시험 (판정기 + 모의 API 소유자·경로 검사)
  const { decide, RULE_IDS } = await import(pathToFileURL(join(target, 'decider.mjs')).href);
  const decider = await checkDecider({ decide, ruleIds: RULE_IDS });
  const tests = (await readdir(join(root, 'test'))).filter(name => name.endsWith('.test.mjs')).sort().map(name => `test/${name}`);
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...tests], { cwd: root, encoding: 'utf8', windowsHide: true });
  const count = key => Number(new RegExp(`^# ${key} (\\d+)`, 'mu').exec(run.stdout ?? '')?.[1] ?? 0);
  attempts.push({ attackId: 'local_post_restore_regression',
    expected: '복원된 정책에서 정상 요청 허용·미등록 기기·B의 A 자료 요청·위조 경로 거부 유지; 심판 판정과 별도',
    observed: `복원 판정기 가상 요청 ${decider.filter(item => item.passed).length}/${decider.length} 통과; `
      + `1~9단계 포함 전체 회귀 검사 ${count('pass')}/${count('tests')} 통과 (exit ${run.status})` });
  return attempts;
}
