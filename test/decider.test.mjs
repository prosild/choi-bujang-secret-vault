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
