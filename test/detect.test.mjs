import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detect } from '../src/detect.mjs';
const start = Date.UTC(2026, 10, 6);
const event = (offset, sub = 'fixture-a', method = 'GET') => ({
  at: new Date(start + offset).toISOString(), method, identity: { sub },
});
const repeated = count => Array.from({ length: count }, (_, i) => event(i));

test('strict count threshold with inclusive 10-minute boundary and outside-window exclusion', () => {
  assert.deepEqual(detect(repeated(120)), { action: 'observe' });
  assert.deepEqual(detect([...repeated(120), event(600_000)]), {
    action: 'propose_revocation', reasonCode: 'burst_read', subject: 'fixture-a',
  });
  assert.deepEqual(detect([...repeated(120), event(600_001)]), { action: 'observe' });
});

test('finds any window in unsorted events without mutating the evidence', () => {
  const events = [event(2_000_000), ...repeated(121).reverse(), event(-2_000_000)];
  const original = structuredClone(events);
  assert.equal(detect(events).action, 'propose_revocation');
  assert.deepEqual(events, original);
});

test('separates subjects and ignores writes or malformed events', () => {
  const events = [...repeated(100), ...repeated(100).map(e => ({ ...e, identity: { sub: 'fixture-b' } })),
    ...repeated(100).map(e => ({ ...e, method: 'POST' })), null, {},
    { ...event(0), at: 'invalid' }, { ...event(0), identity: { sub: '' } }];
  assert.deepEqual(detect(events), { action: 'observe' });
  assert.throws(() => detect(null), /invalid_detection_events/u);
});

test('large spread-out input never becomes a lifetime-count revocation', () => {
  assert.deepEqual(detect(Array.from({ length: 10_000 }, (_, i) => event(i * 6000))), { action: 'observe' });
});
