import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from '../../src/verify-login.mjs';
import { ACCESS_COOKIE, readCookie } from '../../src/session-cookies.mjs';
import { resourcePath } from '../../src/api-resource.mjs';
import { requireApprovedDevice } from '../../src/device-auth.mjs';
import config from '../../aleph.config.json' with { type: 'json' };
let verifier;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'READ_ONLY_RESOURCE' });
  }
  const id = request.query?.id;
  if (!resourcePath(request, 'announcements') || typeof id !== 'string'
    || !/^[a-zA-Z0-9_-]{1,100}$/u.test(id)) return response.status(400).json({ error: 'INVALID_RESOURCE_PATH' });
  const cookie = readCookie(request, ACCESS_COOKIE);
  const authorization = request.headers?.authorization || (cookie ? `Bearer ${cookie}` : null);
  if (!authorization) return response.status(401).json({ error: 'UNAUTHORIZED' });
  const url = process.env.SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret || url.replace(/\/$/u, '') !== new URL(config.identityProvider.issuer).origin) {
    return response.status(503).json({ error: 'NOT_CONFIGURED' });
  }
  try {
    verifier ??= createLoginVerifier({ config, supabaseSecretKey: secret });
    const identity = await verifier(authorization);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });
    const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const device = await requireApprovedDevice(request, identity, db);
    if (!device.ok) return response.status(device.status).json({ error: device.error });
    const { data, error } = await db.from('vault_announcements').select('resource_id,title,content')
      .eq('resource_id', id).eq('published', true).maybeSingle();
    if (error) return response.status(502).json({ error: 'ANNOUNCEMENT_UNAVAILABLE' });
    if (!data) return response.status(404).json({ error: 'NOT_FOUND' });
    return response.status(200).json({ resourceId: `announcements:${data.resource_id}`, title: data.title, body: data.content });
  } catch { return response.status(502).json({ error: 'ANNOUNCEMENT_UNAVAILABLE' }); }
}
