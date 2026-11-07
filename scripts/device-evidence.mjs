// 11단계 자체 점검 (제출 묶음용).
// 제출 묶음은 node:crypto 중 randomUUID·sha256만 쓸 수 있는 격리 환경에서도 실행됩니다.
// 그래서 ECDSA 키 생성·서명이 필요 없는 검사만 서버 검사 함수로 실제 실행하고,
// 서명이 필요한 검사는 not_run으로 남깁니다(같은 검사는 test/device-approval.test.mjs에서 npm run verify로 실행).
import { requireApprovedDevice } from '../src/device-auth.mjs';

export async function runDeviceEvidence() {
  const db = { auth: { admin: { getUserById: async () => ({ data: { user: { app_metadata: { vault_devices: [] } } }, error: null }) } } };
  const identity = { kind: 'student', userId: 'fixture-user' };
  const check = async headers => {
    const result = await requireApprovedDevice({ method: 'GET', url: '/api/notes', headers, query: {} }, identity, db);
    return result.ok ? 'allow' : `${result.status} ${result.error}`;
  };
  // 형식만 맞춘 가상 서명 헤더: 서버 승인 기록에 없는 기기이므로 서명 검증 전에 거부되어야 합니다.
  const unapprovedHeaders = { 'x-vault-device': '0123456789abcdef', 'x-vault-time': String(Date.now()),
    'x-vault-nonce': 'A'.repeat(22), 'x-vault-signature': 'A'.repeat(86) };
  const notRun = (attackId, expected) => ({ attackId, expected: `${expected} (ECDSA 서명이 필요해 제출 묶음에서는 실행하지 않음)`, observed: 'not_run' });
  return [
    { attackId: 'local_device_unsigned_request', expected: '서명 없는 보호 요청 거부', observed: await check({}) },
    { attackId: 'local_device_unapproved', expected: '서버 승인 기록이 없는 기기의 요청 거부', observed: await check(unapprovedHeaders) },
    notRun('local_device_approved_allow', '서버 승인 기기의 올바른 서명 요청 허용'),
    notRun('local_device_path_changed', '서명 뒤 요청 경로를 바꾸면 거부'),
    notRun('local_device_body_changed', '서명 뒤 수정 본문을 바꾸면 거부'),
    notRun('local_device_forged_signature', '다른 키로 만든 위조 서명 거부'),
  ];
}
