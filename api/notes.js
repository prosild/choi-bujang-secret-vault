import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from '../src/verify-login.mjs';
import config from '../aleph.config.json' with { type: 'json' };
import { randomUUID } from 'node:crypto';
import { ACCESS_COOKIE, readCookie, sameOrigin } from '../src/session-cookies.mjs';
import { resourcePath } from '../src/api-resource.mjs';
import { requireApprovedDevice } from '../src/device-auth.mjs';
import { stampRequest } from '../src/request-id.mjs';

let verifier;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, private');
  stampRequest(response);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!resourcePath(request, 'notes')) return response.status(400).json({ error: 'INVALID_RESOURCE_PATH' });
  const id = request.query?.id;
  const individual = id !== undefined;
  const methods = individual ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
  if (!methods.includes(request.method)) {
    response.setHeader('Allow', methods.join(', '));
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const bearer = request.headers?.authorization;
  const cookieToken = bearer ? null : readCookie(request, ACCESS_COOKIE);
  if (cookieToken && request.method !== 'GET' && !sameOrigin(request)) {
    return response.status(403).json({ error: 'INVALID_ORIGIN' });
  }
  const authorization = bearer || (cookieToken ? `Bearer ${cookieToken}` : null);
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
    // 11단계: 서버가 승인한 기기의 서명 요청만 보호 자료에 닿습니다.
    const device = await requireApprovedDevice(request, identity, supabase);
    if (!device.ok) return response.status(device.status).json({ error: device.error });
    if (individual && (typeof id !== 'string' || !uuid.test(id))) {
      return response.status(400).json({ error: 'INVALID_ID' });
    }
    const body = request.body;
    if (request.method === 'POST' || request.method === 'PUT') {
      if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some(key => !(request.method === 'POST'
            ? ['id', 'title', 'body'] : ['title', 'body']).includes(key))
          || typeof body.title !== 'string' || !body.title.trim()
          || typeof body.body !== 'string' || !body.body.trim()
          || body.title.length > 200 || body.body.length > 10000
          || (request.method === 'POST' && body.id !== undefined
              && (typeof body.id !== 'string' || !uuid.test(body.id)))) {
        return response.status(400).json({ error: 'INVALID_NOTE' });
      }
    }
    const notes = supabase.from('study_notes');
    if (!individual && request.method === 'POST') {
      const noteId = body.id ?? randomUUID();
      if (identity.kind === 'judge' && identity.identity === 'b') {
        const { error } = await supabase.rpc('vault_create_restore_note', {
          p_run: identity.runId, p_owner: identity.userId, p_id: noteId, p_title: body.title, p_content: body.body,
        });
        if (error) return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
        return response.status(201).json({ id: noteId });
      }
      const { error } = await notes.insert({ api_id: noteId, title: body.title,
        content: body.body, owner_id: identity.userId, sample_marker: 'SAMPLE_NOTE_1' });
      if (error) return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
      return response.status(201).json({ id: noteId });
    }
    if (!individual) {
      const { data, error } = await notes.select('id:api_id,title,content')
        .eq('owner_id', identity.userId).order('id', { ascending: true });
      if (error) return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
      return response.status(200).json({ notes: (data ?? []).map(note => ({
        id: note.id, title: note.title, body: note.content,
      })) });
    }
    let query;
    if (request.method === 'PUT') query = notes.update({ title: body.title, content: body.body });
    else if (request.method === 'DELETE') query = notes.delete();
    else query = notes.select('id:api_id,title,content');
    if (request.method !== 'GET') query = query.select('id:api_id,title,content');
    const { data, error } = await query.eq('api_id', id)
      .eq('owner_id', identity.userId).maybeSingle();
    if (error) return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    if (!data) return response.status(404).json({ error: 'NOT_FOUND' });
    if (request.method === 'DELETE') return response.status(200).json({ id: data.id });
    return response.status(200).json({ id: data.id, title: data.title, body: data.content });
  } catch {
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
