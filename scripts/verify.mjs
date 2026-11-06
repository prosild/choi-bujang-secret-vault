import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const checkedAt = new Date().toISOString();
const testFiles = (await readdir(resolve(root, 'test'))).filter(name => name.endsWith('.test.mjs')).sort().map(name => `test/${name}`);
const commands = [ ['--test', '--test-reporter=tap', ...testFiles], ['scripts/decider-test.mjs'],
  ['scripts/fixture-7.mjs'], ['scripts/detect-test.mjs'], ['scripts/build-public.mjs', '--local'] ];
const checks = [];
let tests = null;
for (const [index, args] of commands.entries()) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  const stdout = result.stdout ?? '';
  if (index === 0) tests = { total: Number(/^# tests (\d+)/mu.exec(stdout)?.[1] ?? 0),
    passed: Number(/^# pass (\d+)/mu.exec(stdout)?.[1] ?? 0), failed: Number(/^# fail (\d+)/mu.exec(stdout)?.[1] ?? 0) };
  const status = result.status === 0 && (index !== 0 || tests.total > 0 && tests.total === tests.passed) ? 'PASS' : 'FAIL';
  checks.push({ command: index === 0 ? 'node --test test/*.test.mjs' : `node ${args.join(' ')}`, status });
  console.log(`${status} ${checks.at(-1).command}`);
  if (status === 'FAIL') console.error(stdout, result.stderr ?? '');
}
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', windowsHide: true })
  .trim().split(/\r?\n/u).filter(path => /^(api|src|public|scripts|test|xdr)\//u.test(path)).sort();
const digest = createHash('sha256');
for (const file of files) digest.update(file + '\0').update((await readFile(resolve(root, file), 'utf8')).replaceAll('\r\n', '\n'));
const report = { scope: 'local_and_mock', status: checks.every(c => c.status === 'PASS') ? 'PASS' : 'FAIL',
  checkedAt, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  sourceHash: digest.digest('hex'), tests, checks,
  notRun: ['live_engine_device_approval', 'live_engine_revocation', 'live_xdr_enforcement', 'live_database_tamper_delete_restore', 'judge_wave3'] };
await mkdir(resolve(root, 'verification'), { recursive: true });
await writeFile(resolve(root, 'verification/latest.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, tests }));
if (report.status !== 'PASS') process.exitCode = 1;
