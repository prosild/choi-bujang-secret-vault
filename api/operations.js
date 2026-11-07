import { serverContext } from '../src/server-context.mjs';
import { requireApprovedDevice, loadDeviceRecord } from '../src/device-auth.mjs';
import { stampRequest } from '../src/request-id.mjs';
import { RULE_IDS } from '../src/decider.mjs';
import config from '../aleph.config.json' with { type: 'json' };
import validation from '../verification/latest.json' with { type: 'json' };

// 12단계 탈환 작전실: 로그인·승인 기기 요청에만 서버 기록 요약을 돌려줍니다.
// 메모 본문·제목·계정 ID·토큰·기기 공개키는 반환하지 않고, 기기 ID는 앞 4자리만 보입니다.
// source: server_record = 이번 요청에서 서버 기록을 실제 조회 / local_test = 저장소 자동 검사 / not_connected = 연결 없음(미실행)
const mask = id => `${id.slice(0, 4)}…`;
const iso = value => (Number.isSafeInteger(value) ? new Date(value).toISOString() : null);

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const requestId = stampRequest(response);
  if (request.method !== 'GET') return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  try {
    const context = await serverContext(request);
    if (context.error) return response.status(context.status).json({ error: context.error });
    if (request.url && new URL(request.url, 'https://local.invalid').pathname !== '/api/operations') {
      return response.status(400).json({ error: 'INVALID_RESOURCE_PATH' });
    }
    const device = await requireApprovedDevice(request, context.identity, context.db);
    if (!device.ok) return response.status(device.status).json({ error: device.error });
    const { data, error } = await context.db.rpc('vault_operation_summary', { p_owner: context.identity.userId });
    if (error) return response.status(502).json({ error: 'SUMMARY_UNAVAILABLE' });
    const record = await loadDeviceRecord(context.db, context.identity.userId);
    const now = Date.now();
    const active = record.approvals.filter(item => item.expiresAt > now);
    const localTests = validation.status === 'PASS' ? 'PASS' : 'FAIL';
    return response.status(200).json({ requestId, checkedAt: new Date(now).toISOString(),
      source: 'server_database', step: config.step, policyRules: RULE_IDS,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      counts: data, validation,
      device: { id: mask(device.deviceId), approvedUntil: iso(device.expiresAt), source: 'server_approval_record' },
      summary: {
        rules: { source: 'local_test', file: 'src/decider.mjs', ids: RULE_IDS, localTests,
          engineDecisions: 'not_connected' },
        detection: { source: 'local_test', file: 'src/detect.mjs', rule: '같은 주체 GET 10분 120건 초과 시 회수 제안',
          localTests, liveEvents: 'not_connected' },
        revocation: { source: 'server_record', activeDevices: active.length,
          devices: active.map(item => ({ id: mask(item.id), approvedUntil: iso(item.expiresAt), current: item.id === device.deviceId })),
          revocations: record.revocations.count, lastRevokedAt: iso(record.revocations.lastAt),
          engineRevocation: 'not_connected' },
        recovery: { source: 'server_record', snapshots: data?.snapshots ?? null, restores: data?.restores ?? null,
          lastRestoreRevision: data?.lastRestoreRevision ?? null, lastRestoreAt: data?.lastRestoreAt ?? null },
      },
      engine: { deviceApproval: 'NOT_CONNECTED', revocation: 'NOT_CONNECTED', xdr: 'NOT_CONNECTED' },
      judge: { status: 'NOT_RUN', score: null },
    });
  } catch { return response.status(502).json({ error: 'SUMMARY_UNAVAILABLE' }); }
}
