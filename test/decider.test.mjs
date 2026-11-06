import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, RULE_IDS } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

test('registered device receives the five-field decision contract', async () => {
  const { normal } = fixtureRequests();
  const response = await decide(normal);
  assert.deepEqual(Object.keys(response).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
  assert.equal(response.schema, normal.schema);
  assert.equal(response.requestId, normal.requestId);
  assert.equal(response.decision, 'allow');
  assert.ok(response.ruleIds.every(id => RULE_IDS.includes(id)));
});

test('missing, false and truthy non-boolean registration never grant access', async () => {
  for (const value of [undefined, false, null, 'true', 'false', 1, {}, []]) {
    const { normal } = fixtureRequests();
    const result = await decide({ ...normal, deviceRegistered: value });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reasonCode, 'device_not_registered');
  }
});

test('decider does not consult fields outside the request contract', async () => {
  const { normal } = fixtureRequests();
  const permitted = new Set(Object.keys(normal));
  const guarded = new Proxy(normal, { get(target, key) {
    assert.ok(permitted.has(key), `uncontracted request field: ${String(key)}`);
    return target[key];
  } });
  assert.equal((await decide(guarded)).decision, 'allow');
});

test('compound anomaly requests step-up, then accepts only fresh verified authentication', async () => {
  const { suspicious } = fixtureRequests();
  assert.equal((await decide(suspicious)).decision, 'step_up');
  for (const age of [0, 60, 300]) {
    assert.equal((await decide({ ...suspicious, stepUp: { verified: true, authAgeSeconds: age } })).decision, 'allow');
  }
  for (const age of [-1, 301, 900, null, '60', NaN, Infinity]) {
    assert.equal((await decide({ ...suspicious, stepUp: { verified: true, authAgeSeconds: age } })).decision, 'step_up');
  }
  assert.equal((await decide({ ...suspicious, stepUp: { verified: 'true', authAgeSeconds: 60 } })).decision, 'step_up');
  assert.equal((await decide({ ...suspicious, deviceRegistered: false, stepUp: { verified: true, authAgeSeconds: 0 } })).decision, 'deny');
});

test('a foreign region alone does not deny and old or absent events do not make a compound anomaly', async () => {
  const { normal, suspicious } = fixtureRequests();
  assert.equal((await decide({ ...normal, signals: { ...normal.signals, region: 'foreign' } })).decision, 'allow');
  for (const events of [[], [{ kind: 'risk_signal', ageSeconds: 601, count: 20 }],
    [{ kind: 'risk_signal', ageSeconds: -1, count: 20 }], [{ kind: 'risk_signal', ageSeconds: 0, count: 19 }]]) {
    assert.equal((await decide({ ...suspicious, recentEvents: events })).decision, 'allow');
  }
});

test('missing and unverified signal sources remain uncertain until fresh step-up', async () => {
  const { normal } = fixtureRequests();
  for (const signals of [undefined, null, { source: 'none', region: 'unknown', network: 'unknown', hour: 14 },
    { ...normal.signals, source: 'browser' }, { ...normal.signals, hour: 24 }]) {
    assert.equal((await decide({ ...normal, signals })).decision, 'step_up');
    assert.equal((await decide({ ...normal, signals, stepUp: { verified: true, authAgeSeconds: 60 } })).decision, 'allow');
  }
});
