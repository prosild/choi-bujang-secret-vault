import config from '../aleph.config.json' with { type: 'json' };

export const ACCESS_COOKIE = '__Host-vault-access';
export const REFRESH_COOKIE = '__Host-vault-refresh';

export function readCookie(request, name) {
  const header = request.headers?.cookie;
  if (typeof header !== 'string' || header.length > 16384) return null;
  const values = header.split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  try { return decodeURIComponent(values[0].slice(name.length + 1)); } catch { return null; }
}

export function sameOrigin(request) {
  return request.headers?.origin === new URL(config.publicAppUrl).origin;
}

export function setSessionCookies(response, session) {
  const attrs = 'Path=/; HttpOnly; Secure; SameSite=Strict';
  const age = Math.max(0, Math.min(Number(session.expires_in) || 3600, 86400));
  response.setHeader('Set-Cookie', [
    `${ACCESS_COOKIE}=${encodeURIComponent(session.access_token)}; ${attrs}; Max-Age=${age}`,
    `${REFRESH_COOKIE}=${encodeURIComponent(session.refresh_token)}; ${attrs}; Max-Age=604800`,
  ]);
}

export function clearSessionCookies(response) {
  const attrs = 'Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
  response.setHeader('Set-Cookie', [`${ACCESS_COOKIE}=; ${attrs}`, `${REFRESH_COOKIE}=; ${attrs}`]);
}
