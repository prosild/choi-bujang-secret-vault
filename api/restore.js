import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from '../src/verify-login.mjs';
import config from '../aleph.config.json' with { type: 'json' };
import { stampRequest } from '../src/request-id.mjs';
let verifier;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, private');
  stampRequest(response);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  if (request.url && request.url !== '/api/restore') return response.status(400).json({ error: 'INVALID_RESOURCE_PATH' });
  if (!request.headers?.authorization) return response.status(401).json({ error: 'UNAUTHORIZED' });
  const url = process.env.SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret || url.replace(/\/$/u, '') !== new URL(config.identityProvider.issuer).origin) {
    return response.status(503).json({ error: 'NOT_CONFIGURED' });
  }
  try {
    verifier ??= createLoginVerifier({ config, supabaseSecretKey: secret });
    const identity = await verifier(request.headers.authorization);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });
    if (identity.kind !== 'judge' || identity.identity !== 'b') return response.status(403).json({ error: 'RESTORE_SCOPE_DENIED' });
    const body = request.body;
    if (!body || Object.keys(body).length !== 1 || typeof body.id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(body.id)) {
      return response.status(400).json({ error: 'INVALID_RESTORE_TARGET' });
    }
    const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc('vault_restore_note', { p_run: identity.runId, p_owner: identity.userId, p_id: body.id });
    if (error) return response.status(409).json({ error: 'RESTORE_REJECTED' });
    if (!data || data.id?.toLowerCase() !== body.id.toLowerCase() || data.restored !== true
      || !Number.isSafeInteger(data.revision) || data.revision < 1
      || typeof data.contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(data.contentHash)) {
      return response.status(502).json({ error: 'RESTORE_RESULT_INVALID' });
    }
    return response.status(200).json({ id: data.id, restored: true, revision: data.revision, contentHash: data.contentHash });
  } catch { return response.status(502).json({ error: 'RESTORE_UNAVAILABLE' }); }
}
