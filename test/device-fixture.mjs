// 테스트 전용: 가상 기기 키로 요청에 서명하고, 서버 승인 기록(app_metadata)을 흉내 냅니다.
import { randomBytes, webcrypto } from 'node:crypto';
import { bodyText, canonicalRequest, deviceIdFromJwk, APPROVAL_TTL_MS } from '../src/device-auth.mjs';

export async function deviceFixture() {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const { kty, crv, x, y } = await webcrypto.subtle.exportKey('jwk', keys.publicKey);
  const publicKey = { kty, crv, x, y };
  const id = deviceIdFromJwk(publicKey);
  async function sign({ method, url, body, headers = {}, time = Date.now(), nonce = randomBytes(16).toString('base64url'), deviceId = id }) {
    const path = new URL(url, 'https://local.invalid').pathname;
    const data = canonicalRequest({ method, path, bodyText: bodyText({ body, headers }), time: String(time), nonce, deviceId });
    const signature = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, Buffer.from(data))).toString('base64url');
    return { 'x-vault-device': deviceId, 'x-vault-time': String(time), 'x-vault-nonce': nonce, 'x-vault-signature': signature };
  }
  const approval = (expiresAt = Date.now() + APPROVAL_TTL_MS) => ({ id, jwk: publicKey, approvedAt: Date.now(), expiresAt });
  return { id, publicKey, sign, approval };
}

// Supabase Auth 관리 API 모의 응답. approvals: Map(userId -> 기기 목록)
export function adminUsersMock(url, init, approvals, emails = {}) {
  const match = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/u.exec(url.pathname);
  if (!match) return null;
  const userId = match[1];
  if (!approvals.has(userId)) return Response.json({ msg: 'User not found' }, { status: 404 });
  approvals.revocations ??= new Map();
  if ((init.method ?? 'GET') === 'PUT') {
    const meta = JSON.parse(init.body).app_metadata;
    approvals.set(userId, meta.vault_devices);
    if (meta.vault_device_revocations) approvals.revocations.set(userId, meta.vault_device_revocations);
  }
  return Response.json({ id: userId, aud: 'authenticated', role: 'authenticated', email: emails[userId] ?? null,
    app_metadata: { provider: 'email', vault_devices: approvals.get(userId),
      ...(approvals.revocations.has(userId) ? { vault_device_revocations: approvals.revocations.get(userId) } : {}) } });
}
