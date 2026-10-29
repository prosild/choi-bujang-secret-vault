import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from '../src/verify-login.mjs';
import { ACCESS_COOKIE, REFRESH_COOKIE, readCookie, sameOrigin, setSessionCookies, clearSessionCookies } from '../src/session-cookies.mjs';
import config from '../aleph.config.json' with { type: 'json' };

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, DELETE');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  if (request.method !== 'GET' && !sameOrigin(request)) return response.status(403).json({ error: 'INVALID_ORIGIN' });
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret || url.replace(/\/$/u, '') !== new URL(config.identityProvider.issuer).origin) {
    return response.status(503).json({ error: 'NOT_CONFIGURED' });
  }
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    if (request.method === 'DELETE') {
      clearSessionCookies(response);
      let token = readCookie(request, ACCESS_COOKIE);
      const refresh = readCookie(request, REFRESH_COOKIE);
      if (!token && refresh) {
        const { data, error } = await client.auth.refreshSession({ refresh_token: refresh });
        if (error || !data.session) return response.status(502).json({ error: 'LOCAL_SIGNOUT_ONLY' });
        token = data.session.access_token;
      }
      if (token) {
        const { error } = await client.auth.admin.signOut(token, 'local');
        if (error) return response.status(502).json({ error: 'LOCAL_SIGNOUT_ONLY' });
      }
      return response.status(200).json({ ok: true });
    }
    if (request.method === 'POST') {
      const body = request.body;
      if (!body || typeof body.email !== 'string' || typeof body.password !== 'string'
          || body.email.length > 320 || body.password.length > 1024) {
        return response.status(400).json({ error: 'INVALID_INPUT' });
      }
      const { data, error } = await client.auth.signInWithPassword({ email: body.email, password: body.password });
      if (error) {
        if (error.code === 'invalid_credentials') return response.status(401).json({ error: '이메일 또는 비밀번호를 확인해 주세요.' });
        if (error.code === 'email_not_confirmed') return response.status(401).json({ error: '이메일 인증을 완료해 주세요.' });
        if (error.status === 429) return response.status(429).json({ error: '로그인 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
        return response.status(502).json({ error: '인증 서비스를 이용할 수 없습니다.' });
      }
      if (!data.session || !data.user) return response.status(401).json({ error: '로그인 정보를 확인할 수 없습니다.' });
      const verified = await createLoginVerifier({ config, supabaseSecretKey: secret })(`Bearer ${data.session.access_token}`);
      if (!verified || verified.userId !== data.user.id || verified.kind !== 'student') return response.status(401).json({ error: '로그인 정보를 확인할 수 없습니다.' });
      setSessionCookies(response, data.session);
      return response.status(200).json({ user: { id: data.user.id, email: data.user.email ?? null } });
    }
    let token = readCookie(request, ACCESS_COOKIE);
    const verify = createLoginVerifier({ config, supabaseSecretKey: secret });
    let identity = token ? await verify(`Bearer ${token}`) : null;
    if (!identity) {
      const refresh = readCookie(request, REFRESH_COOKIE);
      if (!refresh) return response.status(401).json({ error: 'UNAUTHORIZED' });
      const { data, error } = await client.auth.refreshSession({ refresh_token: refresh });
      if (error || !data.session) { clearSessionCookies(response); return response.status(401).json({ error: 'UNAUTHORIZED' }); }
      token = data.session.access_token;
      identity = await verify(`Bearer ${token}`);
      if (!identity || identity.kind !== 'student') { clearSessionCookies(response); return response.status(401).json({ error: 'UNAUTHORIZED' }); }
      setSessionCookies(response, data.session);
    }
    if (identity.kind !== 'student') return response.status(401).json({ error: 'UNAUTHORIZED' });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user || data.user.id !== identity.userId) return response.status(401).json({ error: 'UNAUTHORIZED' });
    return response.status(200).json({ user: { id: data.user.id, email: data.user.email ?? null } });
  } catch {
    return response.status(502).json({ error: '인증 서비스를 이용할 수 없습니다.' });
  }
}
