import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact } from './read-alerts.mjs';
const LOG = fileURLToPath(new URL('../alerts.log', import.meta.url));
const textId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/u.test(value);
const writeAudit = async entry => {
  await mkdir(dirname(LOG), { recursive: true });
  await appendFile(LOG, JSON.stringify(entry) + '\n');
};

// Binding and rule store are supplied by the server/engine, never by a browser body.
// Without that verified mapping the result is only an unbound candidate.
export async function respondToAlert(moduleKey, alert, decision, {
  now = Date.now(), ttlMs = 15 * 60_000, resolveBinding, putRule, appendAudit = writeAudit,
} = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 3600_000) throw Error('invalid_expiry');
  if (!textId(alert?.id) || !['block', 'alert', 'record'].includes(decision?.action)
      || !Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) throw Error('invalid_decision');
  const expected = decision.confidence >= .85 ? 'block' : decision.confidence >= .5 ? 'alert' : 'record';
  if (decision.action !== expected) throw Error('inconsistent_confidence');
  if (decision.action === 'record') return { status: 'recorded', rule: null };
  let rule = null;
  if (decision.action === 'block' && typeof resolveBinding === 'function' && typeof putRule === 'function') {
    const binding = await resolveBinding({ source: alert.data?.srcip, account: alert.data?.srcuser,
      destination: moduleKey === 'exfiltration' ? alert.data?.dstip : undefined });
    if (textId(binding?.subjectId) && /^[a-f0-9]{16}$/u.test(binding?.deviceId ?? '')
        && (moduleKey !== 'exfiltration' || typeof binding.destination === 'string' && binding.destination === alert.data?.dstip)) {
      rule = { id: `${moduleKey}:${alert.id}`, moduleKey, evidenceAlertId: alert.id,
        subjectId: binding.subjectId, deviceId: binding.deviceId,
        ...(moduleKey === 'exfiltration' ? { destination: binding.destination } : {}),
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };
      await putRule(rule);
    }
  }
  const status = decision.action === 'alert' ? 'alerted' : rule ? 'rule_added' : 'unbound_candidate';
  await appendAudit({ at: new Date(now).toISOString(), moduleKey, evidenceAlertId: alert.id,
    action: decision.action, confidence: decision.confidence, reason: redact(decision.reason), status,
    expiresAt: rule?.expiresAt ?? null });
  return { status, rule };
}
