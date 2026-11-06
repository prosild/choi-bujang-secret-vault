import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import config from '../aleph.config.json' with { type: 'json' };
const base = new URL(config.publicAppUrl);
const checks = [
  { name: '메모 목록 비로그인', path: '/api/notes', expected: 401 },
  { name: '메모 개별 비로그인', path: '/api/notes/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expected: 401 },
  { name: '기기 정보 비로그인', path: '/api/device', expected: 401 },
  { name: '작전실 비로그인', path: '/api/operations', expected: 401 },
  { name: '복원 비로그인', path: '/api/restore', method: 'POST', expected: 401 },
  { name: '공지 직접 쓰기', path: '/api/announcements/test', method: 'PUT', expected: 405 },
  { name: '과거 공개 자료', path: '/data.json', expected: 404, json: false },
  { name: '설치 manifest', path: '/manifest.webmanifest', expected: 200, errorBody: false },
  { name: '배포 식별', path: '/aleph.json', expected: 200, errorBody: false },
];
const results = [];
for (const check of checks) {
  const requestId = randomUUID(), at = new Date().toISOString();
  try {
    const response = await fetch(new URL(check.path, base), { method: check.method ?? 'GET', redirect: 'error',
      headers: { 'X-Self-Check-Id': requestId }, signal: AbortSignal.timeout(15_000) });
    const text = await response.text(); let body;
    try { body = JSON.parse(text); } catch { /* HTML is never an API success. */ }
    const jsonRequired = check.json !== false;
    const errorRequired = jsonRequired && check.errorBody !== false;
    const passed = response.status === check.expected && (!jsonRequired || body && typeof body === 'object')
      && (!errorRequired || typeof body?.error === 'string') && !body?.notes;
    results.push({ name: check.name, method: check.method ?? 'GET', path: check.path, requestId, at,
      expected: check.expected, actual: response.status, status: passed ? 'PASS' : 'FAIL',
      ...(check.path === '/aleph.json' ? { deployedCommit: body?.commit ?? body?.commitSha ?? null } : {}) });
  } catch (error) {
    results.push({ name: check.name, method: check.method ?? 'GET', path: check.path, requestId, at,
      expected: check.expected, actual: null, status: 'ERROR', reason: error.name });
  }
}
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('../artifacts/live-check.json', import.meta.url), JSON.stringify({ origin: base.origin, results }, null, 2));
for (const result of results) console.log(`${result.status} ${result.name}: ${result.actual ?? result.reason}`);
if (results.some(result => result.status !== 'PASS')) process.exitCode = 1;
