import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from './verify-login.mjs';
import { ACCESS_COOKIE, readCookie, sameOrigin } from './session-cookies.mjs';
import config from '../aleph.config.json' with { type: 'json' };
let verifier;
export async function serverContext(request) {
  const bearer = request.headers?.authorization;
  const cookie = bearer ? null : readCookie(request, ACCESS_COOKIE);
  if (!bearer && !cookie) return { status: 401, error: 'UNAUTHORIZED' };
  if (cookie && request.method !== 'GET' && !sameOrigin(request)) return { status: 403, error: 'INVALID_ORIGIN' };
  const url = process.env.SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret || url.replace(/\/$/u, '') !== new URL(config.identityProvider.issuer).origin) {
    return { status: 503, error: 'NOT_CONFIGURED' };
  }
  verifier ??= createLoginVerifier({ config, supabaseSecretKey: secret });
  const identity = await verifier(bearer || `Bearer ${cookie}`);
  if (!identity) return { status: 401, error: 'UNAUTHORIZED' };
  return { identity, db: createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) };
}
