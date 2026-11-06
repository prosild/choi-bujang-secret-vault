import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function redact(value) {
  if (value === undefined || value === null) return null;
  return String(value).replace(/[\r\n\t]/gu, ' ').slice(0, 1000)
    .replace(/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*/giu, '[REDACTED]')
    .replace(/\b(?:Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_secret_[\w-]+|sk-[\w-]{16,})/giu, '[REDACTED]')
    .replace(/(?:password|passwd|token|secret|api[_-]?key|비밀번호|토큰)\s*[:=]\s*[^\s,;]+/giu, '[REDACTED]');
}
export async function readAlerts(url) {
  const fixture = JSON.parse(await readFile(url, 'utf8'));
  if (fixture.schema !== 'aleph.xdr.fixture.v1' || !Array.isArray(fixture.alerts)) throw Error('invalid_fixture');
  return fixture.alerts.map(alert => ({ timestamp: redact(alert.timestamp), source: redact(alert.data?.srcip),
    account: redact(alert.data?.srcuser), level: typeof alert.rule?.level === 'number' ? alert.rule.level : null,
    description: redact(alert.rule?.description) }));
}
export async function printAlertsIfMain(moduleUrl, read) {
  if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
    for (const row of await read()) process.stdout.write(JSON.stringify(row) + '\n');
  }
}
