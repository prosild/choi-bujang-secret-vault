import { randomUUID } from 'node:crypto';
import { serverContext } from '../src/server-context.mjs';
import { requireApprovedDevice } from '../src/device-auth.mjs';
import { RULE_IDS } from '../src/decider.mjs';
import config from '../aleph.config.json' with { type: 'json' };
import validation from '../verification/latest.json' with { type: 'json' };
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  try {
    const context = await serverContext(request);
    if (context.error) return response.status(context.status).json({ error: context.error });
    if (request.url && new URL(request.url, 'https://local.invalid').pathname !== '/api/operations') {
      return response.status(400).json({ error: 'INVALID_RESOURCE_PATH' });
    }
    const device = await requireApprovedDevice(request, context.identity, context.db);
    if (!device.ok) return response.status(device.status).json({ error: device.error });
    const { data, error } = await context.db.rpc('vault_operation_summary', { p_owner: context.identity.userId });
    if (error) return response.status(502).json({ error: 'SUMMARY_UNAVAILABLE' });
    return response.status(200).json({ requestId: randomUUID(), checkedAt: new Date().toISOString(),
      source: 'server_database', step: config.step, policyRules: RULE_IDS,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      counts: data, validation,
      device: { id: device.deviceId, approvedUntil: new Date(device.expiresAt).toISOString(), source: 'server_approval_record' },
      engine: { deviceApproval: 'NOT_CONNECTED', revocation: 'NOT_CONNECTED', xdr: 'NOT_CONNECTED' },
      judge: { status: 'NOT_RUN', score: null },
    });
  } catch { return response.status(502).json({ error: 'SUMMARY_UNAVAILABLE' }); }
}
