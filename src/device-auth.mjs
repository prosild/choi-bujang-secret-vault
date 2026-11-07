// 11단계: 접속 앱의 기기 승인과 요청 서명 검증.
// - 기기 개인키는 브라우저가 "내보낼 수 없는" CryptoKey로 메모리에만 만들고 저장소에 넣지 않습니다.
// - 서버는 승인된 기기의 공개키만 Supabase Auth의 app_metadata(서버 키로만 쓰기 가능)에 기록합니다.
// - 보호 요청은 메서드·경로·본문 해시·시각·임의값·기기 ID에 대한 서명이 맞고,
//   그 기기가 같은 계정으로 서버 승인 기록에 있을 때만 통과합니다.
import { createHash, webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
export const SIGNATURE_VERSION = 'vault-device-v1';
export const MAX_CLOCK_SKEW_MS = 60_000;
export const APPROVAL_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_DEVICES = 5;
const B64URL = /^[A-Za-z0-9_-]+$/u;
const DEVICE_ID = /^[0-9a-f]{16}$/u;

const sha256Hex = text => createHash('sha256').update(text, 'utf8').digest('hex');
const header = (request, name) => {
  const value = request.headers?.[name];
  return typeof value === 'string' ? value : null;
};

export function publicJwk(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.kty !== 'EC' || value.crv !== 'P-256' || 'd' in value) return null;
  if (typeof value.x !== 'string' || typeof value.y !== 'string'
      || value.x.length !== 43 || value.y.length !== 43 || !B64URL.test(value.x) || !B64URL.test(value.y)) return null;
  return { kty: 'EC', crv: 'P-256', x: value.x, y: value.y };
}

// RFC 7638 JWK 지문의 앞 16자리(소문자 16진수)를 기기 ID로 씁니다. 개인키가 아닙니다.
export function deviceIdFromJwk(jwk) {
  const key = publicJwk(jwk);
  if (!key) return null;
  return sha256Hex(JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y })).slice(0, 16);
}

export function canonicalRequest({ method, path, bodyText, time, nonce, deviceId }) {
  return [SIGNATURE_VERSION, method, path, sha256Hex(bodyText), time, nonce, deviceId].join('\n');
}

// Vercel이 동적 경로 값을 ?id=로 붙이는 경우만 허용하고, 서명 대상은 실제 경로입니다.
export function signedPath(request) {
  if (typeof request.url !== 'string') return null;
  let url;
  try { url = new URL(request.url, 'https://local.invalid'); } catch { return null; }
  const entries = [...url.searchParams.entries()];
  const id = request.query?.id;
  if (entries.length && !(entries.length === 1 && entries[0][0] === 'id' && entries[0][1] === id)) return null;
  return url.pathname;
}

export function bodyText(request) {
  const body = request.body;
  if (body === undefined || body === null || body === '') return '';
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0
      && !/^[1-9]/u.test(header(request, 'content-length') ?? '')) return '';
  return JSON.stringify(body);
}

function signatureParts(request) {
  const deviceId = header(request, 'x-vault-device');
  const time = header(request, 'x-vault-time');
  const nonce = header(request, 'x-vault-nonce');
  const signature = header(request, 'x-vault-signature');
  if (!deviceId && !time && !nonce && !signature) return { missing: true };
  if (!DEVICE_ID.test(deviceId ?? '') || !/^\d{13}$/u.test(time ?? '')
      || !/^[A-Za-z0-9_-]{22}$/u.test(nonce ?? '') || !/^[A-Za-z0-9_-]{86}$/u.test(signature ?? '')) return { invalid: true };
  return { deviceId, time, nonce, signature };
}

async function verifySignature(jwk, parts, request, now) {
  const path = signedPath(request);
  if (!path || Math.abs(now - Number(parts.time)) > MAX_CLOCK_SKEW_MS) return false;
  const data = canonicalRequest({ method: request.method, path, bodyText: bodyText(request),
    time: parts.time, nonce: parts.nonce, deviceId: parts.deviceId });
  try {
    const key = await subtle.importKey('jwk', publicJwk(jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(parts.signature, 'base64url'), Buffer.from(data, 'utf8'));
  } catch { return false; }
}

// 서버 승인 기록: 같은 계정의 app_metadata.vault_devices (사용자는 이 값을 직접 바꿀 수 없음)
export async function loadApprovals(db, userId) {
  try {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error || !data?.user) return [];
    const list = data.user.app_metadata?.vault_devices;
    return Array.isArray(list) ? list.filter(item => DEVICE_ID.test(item?.id ?? '') && publicJwk(item.jwk)
      && Number.isSafeInteger(item.expiresAt)) : [];
  } catch { return []; }
}

export async function saveApprovals(db, userId, list) {
  const { error } = await db.auth.admin.updateUserById(userId, { app_metadata: { vault_devices: list } });
  if (error) throw Error('approval_store_failed');
}

// 보호 요청 검사. 결과의 status/error를 그대로 응답합니다.
export async function requireApprovedDevice(request, identity, db, { now = Date.now() } = {}) {
  const parts = signatureParts(request);
  if (parts.missing) return { ok: false, status: 401, error: 'DEVICE_SIGNATURE_REQUIRED' };
  if (parts.invalid) return { ok: false, status: 401, error: 'DEVICE_SIGNATURE_INVALID' };
  const approval = (await loadApprovals(db, identity.userId)).find(item => item.id === parts.deviceId && item.expiresAt > now);
  if (!approval) return { ok: false, status: 403, error: 'DEVICE_NOT_APPROVED', deviceId: parts.deviceId };
  if (!await verifySignature(approval.jwk, parts, request, now)) return { ok: false, status: 401, error: 'DEVICE_SIGNATURE_INVALID' };
  return { ok: true, deviceId: parts.deviceId, expiresAt: approval.expiresAt };
}

// 승인 요청: 요청에 담긴 공개키로 서명을 확인해 개인키 보유를 증명해야 합니다.
export async function verifyProofOfPossession(request, jwk, { now = Date.now() } = {}) {
  const parts = signatureParts(request);
  if (parts.missing) return { ok: false, status: 401, error: 'DEVICE_SIGNATURE_REQUIRED' };
  if (parts.invalid || deviceIdFromJwk(jwk) !== parts.deviceId) return { ok: false, status: 401, error: 'DEVICE_SIGNATURE_INVALID' };
  if (!await verifySignature(jwk, parts, request, now)) return { ok: false, status: 401, error: 'DEVICE_SIGNATURE_INVALID' };
  return { ok: true, deviceId: parts.deviceId };
}

export function statusOnly(request) {
  const parts = signatureParts(request);
  return parts.missing || parts.invalid ? null : parts.deviceId;
}
