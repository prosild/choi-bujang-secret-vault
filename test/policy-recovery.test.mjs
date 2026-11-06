import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { backupPolicy, planRecovery, restoreTestPolicy, prepareRecovery, inspectRecovery, applyRecovery } from '../scripts/policy-recovery.mjs';
test('policy recovery verifies backup, refuses changed plans, preserves audit and other services', async () => {
  const root = resolve(import.meta.dirname, '../artifacts'); await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, 'policy-test-'));
  const backup = join(folder, 'backup'), target = join(folder, 'copy');
  const files = { 'decider.mjs': 'verified policy', 'allowed-routes.json': '["GET /notes/:id"]', 'db-policy.json': '{"rls":true}' };
  const trustedManifestHash = await backupPolicy(backup, { version: 'fixture-version', files });
  await mkdir(target);
  for (const [name, value] of Object.entries(files)) await writeFile(join(target, name), value);
  await writeFile(join(target, 'audit.log'), 'preserve'); await writeFile(join(target, 'other-service'), 'preserve');
  await writeFile(join(target, 'decider.mjs'), 'tampered');
  const plan = await planRecovery(backup, target, trustedManifestHash);
  assert.equal(plan.changes.length, 1);
  await assert.rejects(restoreTestPolicy({ backup, target, trustedManifestHash, reviewedVersion: plan.version, reviewedChanges: [] }), /changed_after_review/u);
  await assert.rejects(restoreTestPolicy({ backup, target: resolve(import.meta.dirname, '../src'), trustedManifestHash, reviewedChanges: [] }), /test_copy_required/u);
  await assert.rejects(restoreTestPolicy({ backup, target, trustedManifestHash, reviewedVersion: 'wrong-version', reviewedChanges: plan.changes }), /version_changed_after_review/u);
  assert.equal(await readFile(join(target, 'decider.mjs'), 'utf8'), 'tampered');
  assert.equal((await restoreTestPolicy({ backup, target, trustedManifestHash, reviewedVersion: plan.version, reviewedChanges: plan.changes })).verified, true);
  assert.equal(await readFile(join(target, 'audit.log'), 'utf8'), 'preserve');
  assert.equal(await readFile(join(target, 'other-service'), 'utf8'), 'preserve');
  await assert.rejects(planRecovery(backup, target, null), /trusted_hash_required/u);
  await assert.rejects(planRecovery(join(folder, 'missing'), target, trustedManifestHash), /ENOENT/u);
  await writeFile(join(backup, 'decider.mjs'), 'corrupted backup');
  await assert.rejects(planRecovery(backup, target, trustedManifestHash), /backup_hash_mismatch/u);
});

test('restored current policy permits normal requests, rejects unregistered devices and preserves live policy', async () => {
  const livePath = resolve(import.meta.dirname, '../src/decider.mjs');
  const before = await readFile(livePath, 'utf8');
  const prepared = await prepareRecovery();
  const reviewed = await inspectRecovery(prepared.directory);
  assert.equal(reviewed.changes.length, 1);
  assert.equal(reviewed.changes[0].lines.length, 1);
  assert.equal(reviewed.changes[0].file, 'decider.mjs');
  await applyRecovery(prepared.directory);
  const { decide } = await import(pathToFileURL(join(prepared.directory, 'test-copy/decider.mjs')).href);
  const normal = { requestId: 'recovery-normal', deviceRegistered: true, service: 'notes', method: 'GET',
    route: 'GET /api/notes/:id', path: '/api/notes/fixture', queryLength: 0,
    signals: { source: 'judge_fixture', region: 'local', network: 'usual', hour: 12 }, recentEvents: [] };
  assert.equal((await decide(normal)).decision, 'allow');
  assert.equal((await decide({ ...normal, deviceRegistered: false })).decision, 'deny');
  assert.equal((await decide({ ...normal, path: '/api/notes/export' })).decision, 'deny');
  assert.equal(await readFile(livePath, 'utf8'), before);
  for (const file of ['decider.mjs', 'allowed-routes.json', 'db-policy.json']) {
    assert.equal(await readFile(join(prepared.directory, 'backup', file), 'utf8'),
      await readFile(join(prepared.directory, 'test-copy', file), 'utf8'));
  }
});

test('backup corruption and review tampering stop before writing the test policy', async () => {
  const prepared = await prepareRecovery();
  const target = join(prepared.directory, 'test-copy/decider.mjs');
  const before = await readFile(target, 'utf8');
  await writeFile(join(prepared.directory, 'backup/decider.mjs'), 'corrupted fixture');
  await assert.rejects(applyRecovery(prepared.directory), /backup_hash_mismatch/u);
  assert.equal(await readFile(target, 'utf8'), before);
  await writeFile(join(prepared.directory, 'review.json'), '{}');
  await assert.rejects(applyRecovery(prepared.directory), /review_hash_mismatch/u);
  assert.equal(await readFile(target, 'utf8'), before);
});
