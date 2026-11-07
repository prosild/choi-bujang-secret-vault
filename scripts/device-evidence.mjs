// 11단계 자체 점검: 제출 묶음을 만들 때 서버의 기기 서명 검사 함수를 가상 기기 키로 실제 실행합니다.
// 실제 계정·비밀번호·DB를 쓰지 않으며 심판 판정과 별도입니다.
import { randomBytes, webcrypto } from 'node:crypto';
import { APPROVAL_TTL_MS, bodyText, canonicalRequest, deviceIdFromJwk, requireApprovedDevice } from '../src/device-auth.mjs';

async function fixture() {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const { kty, crv, x, y } = await webcrypto.subtle.exportKey('jwk', keys.publicKey);
  const jwk = { kty, crv, x, y }, id = deviceIdFromJwk(jwk);
  const sign = async (method, url, body) => {
    const time = String(Date.now()), nonce = randomBytes(16).toString('base64url');
    const data = canonicalRequest({ method, path: url, bodyText: bodyText({ body, headers: {} }), time, nonce, deviceId: id });
    const signature = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, Buffer.from(data))).toString('base64url');
    return { 'x-vault-device': id, 'x-vault-time': time, 'x-vault-nonce': nonce, 'x-vault-signature': signature };
  };
  return { id, jwk, sign };
}

export async function runDeviceEvidence() {
  const approved = await fixture(), other = await fixture();
  let records = [];
  const db = { auth: { admin: { getUserById: async () => ({ data: { user: { app_metadata: { vault_devices: records } } }, error: null }) } } };
  const identity = { kind: 'student', userId: 'fixture-user' };
  const noteA = '/api/notes/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', noteB = '/api/notes/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const check = async (method, url, body, headers) => {
    const result = await requireApprovedDevice({ method, url, body, headers, query: {} }, identity, db);
    return result.ok ? 'allow' : `${result.status} ${result.error}`;
  };
  const before = await check('GET', '/api/notes', undefined, await approved.sign('GET', '/api/notes'));
  records = [{ id: approved.id, jwk: approved.jwk, approvedAt: Date.now(), expiresAt: Date.now() + APPROVAL_TTL_MS }];
  const after = await check('GET', '/api/notes', undefined, await approved.sign('GET', '/api/notes'));
  const unsigned = await check('GET', '/api/notes', undefined, {});
  const pathChanged = await check('GET', noteB, undefined, await approved.sign('GET', noteA));
  const body = { title: '가상', body: '시험' };
  const bodyChanged = await check('PUT', noteA, { ...body, body: '서명 뒤 변경' }, await approved.sign('PUT', noteA, body));
  const forged = await check('GET', '/api/notes', undefined, { ...await approved.sign('GET', '/api/notes'),
    'x-vault-signature': (await other.sign('GET', '/api/notes'))['x-vault-signature'] });
  return [
    { attackId: 'local_device_approval_gate',
      expected: '승인 전 기기는 보호 자료 거부, 서버 승인 기록이 생긴 같은 기기는 허용; 심판 판정과 별도',
      observed: `승인 전 ${before}; 승인 후 ${after}` },
    { attackId: 'local_device_unsigned_request', expected: '서명 없는 보호 요청 거부', observed: unsigned },
    { attackId: 'local_device_path_changed', expected: '서명 뒤 요청 경로를 바꾸면 거부', observed: pathChanged },
    { attackId: 'local_device_body_changed', expected: '서명 뒤 수정 본문을 바꾸면 거부', observed: bodyChanged },
    { attackId: 'local_device_forged_signature', expected: '다른 키로 만든 위조 서명 거부', observed: forged },
  ];
}
