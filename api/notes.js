import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from '../src/verify-login.mjs';
import config from '../aleph.config.json' with { type: 'json' };

let verifier;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const authorization = request.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization) {
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret || url.replace(/\/$/u, '') !== new URL(config.identityProvider.issuer).origin) {
    return response.status(503).json({ error: 'NOT_CONFIGURED' });
  }

  try {
    verifier ??= createLoginVerifier({ config, supabaseSecretKey: secret });
    const identity = await verifier(authorization);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });
    const supabase = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase
      .from('study_notes')
      .select('title,content')
      .eq('sample_marker', 'SAMPLE_NOTE_1')
      .order('id', { ascending: true })
      .limit(4);
    if (error) return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    return response.status(200).json({ notes: data ?? [] });
  } catch {
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
