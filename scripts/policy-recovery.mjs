import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const FILES = ['decider.mjs', 'allowed-routes.json', 'db-policy.json'];
const hash = text => createHash('sha256').update(text).digest('hex');

export async function backupPolicy(directory, { version, files }) {
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

export async function restoreTestPolicy({ backup, target, trustedManifestHash, reviewedChanges }) {
  // This utility only writes an explicit test-copy directory inside artifacts.
  const base = resolve(ROOT, 'artifacts') + '\\';
  const normalized = resolve(target);
  if (normalized !== resolve(ROOT, 'artifacts') && !normalized.startsWith(base)
      && !normalized.startsWith(resolve(ROOT, 'artifacts') + '/')) throw Error('test_copy_required');
  const plan = await planRecovery(backup, target, trustedManifestHash);
  if (JSON.stringify(plan.changes) !== JSON.stringify(reviewedChanges)) throw Error('policy_changed_after_review');
  for (const change of plan.changes) await writeFile(join(target, change.file), plan.files[change.file]);
  const verified = await planRecovery(backup, target, trustedManifestHash);
  if (verified.changes.length) throw Error('restore_verification_failed');
  return { version: plan.version, restoredFiles: plan.changes.map(c => c.file), verified: true };
}

async function demo() {
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
  await writeFile(join(target, 'decider.mjs'), files['decider.mjs'].replace('deviceRegistered === true', 'deviceRegistered !== false'));
  const plan = await planRecovery(backup, target, trustedManifestHash);
  console.log(JSON.stringify({ version, changes: plan.changes }, null, 2));
  const result = await restoreTestPolicy({ backup, target, trustedManifestHash, reviewedChanges: plan.changes });
  if (await readFile(join(target, 'audit.log'), 'utf8') !== 'fixture audit retained\n'
      || await readFile(join(target, 'other-service.json'), 'utf8') !== '{"preserve":true}\n') throw Error('unrelated_file_changed');
  await writeFile(join(directory, 'verification.json'), JSON.stringify({ ...result, trustedManifestHash, auditPreserved: true, otherServicePreserved: true }, null, 2));
  console.log(JSON.stringify({ ...result, artifact: directory }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'demo') throw Error('use_demo_for_test_copy_only');
  await demo();
}
