import { createClient } from '@supabase/supabase-js';
import { serverContext } from '../src/server-context.mjs';
import { APPROVAL_TTL_MS, MAX_DEVICES, deviceIdFromJwk, loadApprovals, publicJwk, requireApprovedDevice,
  saveApprovals, statusOnly, verifyProofOfPossession } from '../src/device-auth.mjs';

// 11단계 기기 승인
// GET    : 이 기기의 서버 승인 상태 (승인된 기기는 서명까지 확인)
// POST   : { publicKey, password } — 개인키 보유 서명 + 비밀번호 재확인 후 서버가 승인 기록
// DELETE : 승인된 기기가 서명한 요청으로 자기 승인을 회수
// 브라우저가 보낸 deviceRegistered/approved/역할 값은 읽지 않습니다.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, DELETE');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  if (request.url && new URL(request.url, 'https://local.invalid').pathname !== '/api/device') {
    return response.status(400).json({ error: 'INVALID_RESOURCE_PATH' });
  }
  try {
    const context = await serverContext(request);
    if (context.error) return response.status(context.status).json({ error: context.error });
    const { identity, db } = context;
    const now = Date.now();

    if (request.method === 'GET') {
      const deviceId = statusOnly(request);
      if (!deviceId) return response.status(401).json({ error: 'DEVICE_SIGNATURE_REQUIRED' });
      const checked = await requireApprovedDevice(request, identity, db, { now });
      if (checked.ok) return response.status(200).json({ status: 'approved', deviceId, expiresAt: new Date(checked.expiresAt).toISOString() });
      if (checked.status === 403) return response.status(200).json({ status: 'not_approved', deviceId, canRequestApproval: identity.kind === 'student' });
      return response.status(checked.status).json({ error: checked.error });
    }

    if (request.method === 'DELETE') {
      const checked = await requireApprovedDevice(request, identity, db, { now });
      if (!checked.ok) return response.status(checked.status).json({ error: checked.error });
      const kept = (await loadApprovals(db, identity.userId)).filter(item => item.id !== checked.deviceId && item.expiresAt > now);
      await saveApprovals(db, identity.userId, kept);
      return response.status(200).json({ status: 'revoked', deviceId: checked.deviceId });
    }

    // POST: 승인 요청
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).sort().join(',') !== 'password,publicKey'
        || typeof body.password !== 'string' || !body.password || body.password.length > 1024) {
      return response.status(400).json({ error: 'INVALID_APPROVAL_REQUEST' });
    }
    const jwk = publicJwk(body.publicKey);
    if (!jwk) return response.status(400).json({ error: 'INVALID_DEVICE_KEY' });
    const proof = await verifyProofOfPossession(request, jwk, { now });
    if (!proof.ok) return response.status(proof.status).json({ error: proof.error });
    // 심판·외부 발급 토큰은 이 앱의 비밀번호 재확인을 할 수 없으므로 승인하지 않습니다.
    if (identity.kind !== 'student') return response.status(403).json({ error: 'DEVICE_APPROVAL_NOT_AVAILABLE' });
    const { data: userData, error: userError } = await db.auth.admin.getUserById(identity.userId);
    const email = userData?.user?.email;
    if (userError || typeof email !== 'string') return response.status(502).json({ error: 'DEVICE_APPROVAL_UNAVAILABLE' });
    const checker = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data: signIn, error: signInError } = await checker.auth.signInWithPassword({ email, password: body.password });
    if (signInError || signIn?.user?.id !== identity.userId) {
      if (signInError?.status === 429) return response.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });
      return response.status(401).json({ error: 'PASSWORD_RECHECK_FAILED' });
    }
    // 확인용으로 만든 세션은 바로 종료합니다(기존 로그인 세션은 유지).
    if (signIn.session?.access_token) await checker.auth.admin.signOut(signIn.session.access_token, 'local').catch(() => {});
    const expiresAt = now + APPROVAL_TTL_MS;
    const others = (await loadApprovals(db, identity.userId)).filter(item => item.id !== proof.deviceId && item.expiresAt > now);
    const list = [...others, { id: proof.deviceId, jwk, approvedAt: now, expiresAt }]
      .sort((a, b) => b.approvedAt - a.approvedAt).slice(0, MAX_DEVICES);
    await saveApprovals(db, identity.userId, list);
    return response.status(200).json({ status: 'approved', deviceId: deviceIdFromJwk(jwk), expiresAt: new Date(expiresAt).toISOString() });
  } catch { return response.status(502).json({ error: 'DEVICE_STATUS_UNAVAILABLE' }); }
}
