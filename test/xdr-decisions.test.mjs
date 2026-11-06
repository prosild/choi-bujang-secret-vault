import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { readAlerts, redact } from '../xdr/shared/read-alerts.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { decideWithXdr } from '../xdr/shared/gate.mjs';

const modules = ['brute-force', 'web-injection', 'known-cve', 'persistence', 'privilege', 'exfiltration'];
// Local review of the supplied evidence, not official judge labels.
const expected = {
  'brute-force': { block: 10, alert: 9, record: 9 },
  'web-injection': { block: 8, alert: 9, record: 9 },
  'known-cve': { block: 8, alert: 8, record: 8 },
  persistence: { block: 8, alert: 8, record: 8 },
  privilege: { block: 9, alert: 8, record: 9 },
  exfiltration: { block: 10, alert: 10, record: 10 },
};
for (const key of modules) test(`${key}: independent decisions, normal false-block=0 and expiry-scoped adapter`, async () => {
  const { decide } = await import(`../xdr/${key}/decide.mjs`);
  const { respond } = await import(`../xdr/${key}/respond.mjs`);
  const file = new URL(`../xdr/fixtures/${key}.json`, import.meta.url);
  const fixture = JSON.parse(await readFile(file, 'utf8'));
  assert.equal((await readAlerts(file)).length, fixture.alerts.length);
  const source = await readFile(new URL(`../xdr/${key}/decide.mjs`, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\b|\bfetch\s*\(|\brequire\s*\(/mu);
  const counts = { block: 0, alert: 0, record: 0 };
  const { normal } = fixtureRequests();
  const rules = [], audits = [], now = Date.now();
  for (const alert of fixture.alerts) {
    const decision = decide(alert); counts[decision.action]++;
    assert.deepEqual(Object.keys(decision).sort(), ['action', 'confidence', 'reason']);
    assert.equal(decision.action, decision.confidence >= .85 ? 'block' : decision.confidence >= .5 ? 'alert' : 'record');
    if (alert.rule.level <= 3) assert.equal(decision.action, 'record', alert.id);
    // Changing IDs and document addresses cannot change classification.
    assert.deepEqual(decide({ ...alert, id: 'unseen-id', data: { ...alert.data, srcip: '192.0.2.200' } }), decision);
    const output = await respond(alert, { now,
      resolveBinding: async () => ({ subjectId: normal.subjectId, deviceId: normal.deviceId, destination: alert.data?.dstip }),
      putRule: async rule => rules.push(rule), appendAudit: async entry => audits.push(entry) });
    assert.equal(Boolean(output.rule), decision.action === 'block');
  }
  assert.deepEqual(counts, expected[key]);
  assert.equal(rules.length, counts.block); assert.equal(audits.length, counts.block + counts.alert);
  assert.equal(decide({ rule: { level: 15, description: '정상 화면 조회' } }).action, 'record');
  for (const value of [null, {}, [], { data: { count: 'not a number' } }]) assert.equal(decide(value).action, 'record');
  const context = { rules, now, verifiedDestination: rules[0].destination };
  assert.equal((await decideWithXdr(normal, context)).decision, 'deny');
  assert.equal((await decideWithXdr({ ...normal, subjectId: 'unrelated-normal-user' }, context)).decision, 'allow');
  assert.equal((await decideWithXdr(normal, { ...context, now: now + 900_001 })).decision, 'allow');
  if (key === 'exfiltration') assert.equal((await decideWithXdr(normal, { ...context, verifiedDestination: '192.0.2.222' })).decision, 'allow');
  const unbound = await respond(fixture.alerts[0], { appendAudit: async () => {} });
  assert.equal(unbound.status, 'unbound_candidate'); assert.equal(unbound.rule, null);
});

test('redaction and read projection omit credentials and raw payload fields', () => {
  for (const secret of ['password=fake-value', 'token=example-value', 'Bearer example-value', 'sb_secret_example-value']) {
    assert.equal(redact(secret).includes('value'), false);
  }
  assert.equal(redact('safe\ntext'), 'safe text');
});
