import { promises as fsp } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const { readFile, writeFile, mkdir, realpath, readdir } = fsp;

const ROOT = resolve(import.meta.dirname, '..');
const FILES = ['decider.mjs', 'allowed-routes.json', 'db-policy.json'];
const hash = text => createHash('sha256').update(text).digest('hex');

export async function backupPolicy(directory, { version, files }) {
  if (typeof version !== 'string' || !version.trim()) throw Error('version_required');
  if (FILES.some(name => typeof files[name] !== 'string')) throw Error('incomplete_policy');
  await mkdir(directory, { recursive: true });
  const manifest = { version, hashes: {} };
  for (const name of FILES) {
    await writeFile(join(directory, name), files[name], { flag: 'wx' });
    manifest.hashes[name] = hash(files[name]);
  }
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(join(directory, 'manifest.json'), serialized, { flag: 'wx' });
  return hash(serialized); // Keep this trusted digest separately from the backup.
}

export async function planRecovery(backup, target, trustedManifestHash) {
  if (!/^[a-f0-9]{64}$/u.test(trustedManifestHash ?? '')) throw Error('trusted_hash_required');
  const serialized = await readFile(join(backup, 'manifest.json'), 'utf8');
  if (hash(serialized) !== trustedManifestHash) throw Error('manifest_hash_mismatch');
  const manifest = JSON.parse(serialized);
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) throw Error('version_required');
  const changes = [], files = {};
  for (const name of FILES) {
    const saved = await readFile(join(backup, name), 'utf8');
    if (hash(saved) !== manifest.hashes[name]) throw Error(`backup_hash_mismatch:${name}`);
    const current = await readFile(join(target, name), 'utf8');
    files[name] = saved;
    if (current !== saved) {
      const left = current.split('\n'), right = saved.split('\n');
      changes.push({ file: name, beforeHash: hash(current), afterHash: hash(saved),
        lines: Array.from({ length: Math.max(left.length, right.length) }, (_, i) =>
          left[i] === right[i] ? null : { line: i + 1, before: left[i] ?? '', after: right[i] ?? '' }).filter(Boolean) });
    }
  }
  return { version: manifest.version, changes, files };
}

export async function restoreTestPolicy({ backup, target, trustedManifestHash, reviewedVersion, reviewedChanges }) {
  // This utility only writes an explicit test-copy directory inside artifacts.
  const base = await realpath(resolve(ROOT, 'artifacts'));
  const normalized = await realpath(target);
  const within = relative(base, normalized);
  if (!within || within.startsWith('..') || isAbsolute(within)) throw Error('test_copy_required');
  for (const name of FILES) {
    if (await realpath(join(normalized, name)) !== join(normalized, name)) throw Error('test_copy_required');
  }
  const plan = await planRecovery(backup, target, trustedManifestHash);
  if (!reviewedVersion || plan.version !== reviewedVersion) throw Error('version_changed_after_review');
  if (JSON.stringify(plan.changes) !== JSON.stringify(reviewedChanges)) throw Error('policy_changed_after_review');
  for (const change of plan.changes) await writeFile(join(target, change.file), plan.files[change.file]);
  const verified = await planRecovery(backup, target, trustedManifestHash);
  if (verified.changes.length) throw Error('restore_verification_failed');
  return { version: plan.version, restoredFiles: plan.changes.map(c => c.file), verified: true };
}

export async function prepareRecovery() {
  const directory = join(ROOT, 'artifacts', `policy-${Date.now()}`);
  const backup = join(directory, 'backup'), target = join(directory, 'test-copy');
  const config = JSON.parse(await readFile(join(ROOT, 'aleph.config.json'), 'utf8'));
  const files = { 'decider.mjs': await readFile(join(ROOT, 'src/decider.mjs'), 'utf8'),
    'allowed-routes.json': JSON.stringify(config.allowedRoutes, null, 2) + '\n',
    'db-policy.json': await readFile(join(ROOT, 'docs/db-policy-snapshot.json'), 'utf8') };
  const version = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
  const trustedManifestHash = await backupPolicy(backup, { version, files });
  await mkdir(target, { recursive: true });
  for (const name of FILES) await writeFile(join(target, name), files[name]);
  await writeFile(join(target, 'audit.log'), 'fixture audit retained\n');
  await writeFile(join(target, 'other-service.json'), '{"preserve":true}\n');
  const tampered = files['decider.mjs'].replace('deviceRegistered === true', 'deviceRegistered !== false');
  if (tampered === files['decider.mjs']) throw Error('fixture_rule_not_found');
  await writeFile(join(target, 'decider.mjs'), tampered);
  const plan = await planRecovery(backup, target, trustedManifestHash);
  const review = JSON.stringify({ version: plan.version, changes: plan.changes }, null, 2) + '\n';
  await writeFile(join(directory, 'review.json'), review, { flag: 'wx' });
  // Outside the deliberately mutable backup/test-copy directories.
  await writeFile(join(directory, 'trust.json'), JSON.stringify({ trustedManifestHash, reviewHash: hash(review) }, null, 2) + '\n', { flag: 'wx' });
  return { directory, version, changes: plan.changes, trustedManifestHash };
}

export async function inspectRecovery(directory) {
  const { trustedManifestHash, reviewHash } = JSON.parse(await readFile(join(directory, 'trust.json'), 'utf8'));
  const review = await readFile(join(directory, 'review.json'), 'utf8');
  if (hash(review) !== reviewHash) throw Error('review_hash_mismatch');
  const reviewed = JSON.parse(review);
  const plan = await planRecovery(join(directory, 'backup'), join(directory, 'test-copy'), trustedManifestHash);
  if (reviewed.version !== plan.version || JSON.stringify(reviewed.changes) !== JSON.stringify(plan.changes)) {
    throw Error('policy_changed_after_review');
  }
  return { version: plan.version, changes: plan.changes, trustedManifestHash };
}

export async function applyRecovery(directory) {
  const backup = join(directory, 'backup'), target = join(directory, 'test-copy');
  const reviewed = await inspectRecovery(directory);
  console.log(JSON.stringify({ phase: 'before_restore', version: reviewed.version, changes: reviewed.changes }, null, 2));
  const result = await restoreTestPolicy({ backup, target, trustedManifestHash: reviewed.trustedManifestHash,
    reviewedVersion: reviewed.version, reviewedChanges: reviewed.changes });
  if (await readFile(join(target, 'audit.log'), 'utf8') !== 'fixture audit retained\n'
      || await readFile(join(target, 'other-service.json'), 'utf8') !== '{"preserve":true}\n') throw Error('unrelated_file_changed');
  await writeFile(join(directory, 'verification.json'), JSON.stringify({ ...result, trustedManifestHash: reviewed.trustedManifestHash, auditPreserved: true, otherServicePreserved: true }, null, 2));
  return { ...result, artifact: directory };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, given] = process.argv.slice(2);
  let directory = given;
  if (!directory && (command === 'inspect' || command === 'restore')) {
    // `npm run restore`처럼 폴더를 생략하면 가장 최근 `npm run backup` 결과를 사용합니다.
    const latest = (await readdir(join(ROOT, 'artifacts')).catch(() => []))
      .filter(name => /^policy-\d+$/u.test(name)).sort((a, b) => Number(b.slice(7)) - Number(a.slice(7)))[0];
    if (!latest) throw Error('backup_not_found: run npm run backup first');
    directory = join(ROOT, 'artifacts', latest);
  }
  if (command === 'prepare') console.log(JSON.stringify(await prepareRecovery(), null, 2));
  else if (command === 'inspect' && directory) console.log(JSON.stringify(await inspectRecovery(resolve(directory)), null, 2));
  else if (command === 'restore' && directory) console.log(JSON.stringify(await applyRecovery(resolve(directory)), null, 2));
  else if (command === 'demo') {
    const prepared = await prepareRecovery();
    console.log(JSON.stringify(await applyRecovery(prepared.directory), null, 2));
  } else throw Error('use_prepare_then_inspect_then_restore_or_demo');
}
