import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { prepareRecovery, inspectRecovery, applyRecovery } from './policy-recovery.mjs';

const root = resolve(import.meta.dirname, '..');
const prepared = await prepareRecovery();
console.log(JSON.stringify({ phase: 'review', ...await inspectRecovery(prepared.directory) }, null, 2));
const restored = await applyRecovery(prepared.directory);
// Run normal/forbidden requests after restoring, including A/B API ownership checks.
const regression = spawnSync(process.execPath, ['scripts/verify.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true });
process.stdout.write(regression.stdout ?? '');
process.stderr.write(regression.stderr ?? '');
const report = {
  scope: 'local_policy_and_mock_api', checkedAt: new Date().toISOString(), policyVersion: prepared.version,
  policyArtifact: relative(root, prepared.directory).replaceAll('\\', '/'),
  trustedManifestHash: prepared.trustedManifestHash, changedFiles: restored.restoredFiles,
  policyRestored: restored.verified, regression: regression.status === 0 ? 'PASS' : 'FAIL',
  notRun: ['live_signed_B_restore_http', 'live_engine_attacks_after_restore', 'judge_resubmission'],
};
await writeFile(resolve(root, 'verification/step10.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (regression.status !== 0) process.exitCode = 1;
