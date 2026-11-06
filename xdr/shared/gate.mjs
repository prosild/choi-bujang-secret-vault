import { decide as coreDecide, RULE_IDS as CORE_RULE_IDS } from '../../src/decider.mjs';
export const RULE_IDS = Object.freeze([...CORE_RULE_IDS, 'xdr_block']);
// Explicit adapter: source IP is NOT added to the 18-field decision contract.
// Verified routing context and persisted rules must come from the engine integration.
export async function decideWithXdr(request, { rules = [], now = Date.now(), verifiedDestination } = {}) {
  const base = await coreDecide(request);
  if (base.decision === 'deny') return base;
  const blocked = rules.some(rule => rule.subjectId === request.subjectId && rule.deviceId === request.deviceId
    && Date.parse(rule.createdAt) <= now && Date.parse(rule.expiresAt) > now
    && (!rule.destination || rule.destination === verifiedDestination));
  return blocked ? { schema: base.schema, requestId: base.requestId, decision: 'deny',
    reasonCode: 'xdr_blocked', ruleIds: ['xdr_block'] } : base;
}
