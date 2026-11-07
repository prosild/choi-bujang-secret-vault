// 학생 자기 점검 (npm run bundle이 실행). 심판 판정이 아닙니다.
// 규칙
// - 이 파일은 아무 모듈도 불러오지 않습니다(정적·동적 import 없음). 전역 fetch로 공개 HTTPS GET만 보냅니다.
//   POST·서명·하위 프로세스·파일 쓰기는 쓰지 않습니다.
// - 점검 하나당 요청 하나만 보내고, 그 요청에 점검 ID(X-Attack-Id)와 이번에 만든 요청 ID(X-Request-Id)를 붙입니다.
// - observed는 실제 네트워크 응답을 받은 경우에만 받은 상태·보낸 요청(메서드·경로)·보낸 요청 ID·응답 요청 ID를 적습니다.
//   실제 응답은 요청한 주소(response.url)를 가지고 있어야 합니다. 주소가 없거나 다른 응답(실행기가 만든 대체 응답 등)은
//   받은 결과로 보지 않습니다.
// - 응답을 받지 못했거나(전송 거부·네트워크 실패·시간 초과·대체 응답) 요청을 보내지 않는 점검은 observed를 정확히 'not_run'으로 적습니다.
//   없는 결과를 계산하거나 로컬 시험 결과로 채우지 않습니다.
const NOT_RUN = 'not_run';
const checkUrl = (app, path) => new URL(path, app);
// 존재 여부와 무관한 가상 메모 ID: 비로그인 개별 메모 조회가 소유자 확인 전에 막히는지만 봅니다.
const FIXTURE_NOTE_ID = '00000000-0000-4000-8000-000000000000';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,64}$/u;

function newRequestId() {
  try {
    const id = globalThis.crypto?.randomUUID?.();
    return typeof id === 'string' && SAFE_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

// 점검 하나의 GET 하나. 응답을 받지 못하면 sent:false (결과 없음 → not_run).
// 배포 주소의 요청은 경로만, 다른 주소(원본 DB)는 주소까지 observed에 적습니다.
async function send(attackId, url, app, headers = {}) {
  const requestId = newRequestId();
  const requestHeaders = { ...headers, 'X-Attack-Id': attackId, ...(requestId ? { 'X-Request-Id': requestId } : {}) };
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: requestHeaders,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { sent: false };
  }
  // 실제 네트워크 응답인지 확인: 상태 범위와, 요청한 주소와 같은 응답 주소.
  let responseUrl = null;
  try {
    responseUrl = typeof response?.url === 'string' && response.url ? new URL(response.url) : null;
  } catch {
    responseUrl = null;
  }
  const target = new URL(url);
  if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599
      || !responseUrl || responseUrl.origin !== target.origin || responseUrl.pathname !== target.pathname) {
    return { sent: false };
  }
  const serverRequestId = response.headers?.get?.('x-request-id') ?? null;
  let body = null;
  try {
    body = await response.json();
  } catch {
    // JSON이 아니거나 본문이 없을 수 있습니다.
  }
  return { sent: true, status: response.status, body, requestId, request: `GET ${target.origin === app.origin ? target.pathname : target.origin + target.pathname}`,
    serverRequestId: typeof serverRequestId === 'string' && SAFE_ID.test(serverRequestId) ? serverRequestId : null };
}

const ids = result => [
  result.requestId ? `보낸 요청 ID ${result.requestId}` : '보낸 요청 ID 없음',
  result.serverRequestId ? `응답 요청 ID ${result.serverRequestId}` : '응답 요청 ID 없음',
].join('; ');
const jsonError = result => typeof result.body?.error === 'string';

// 받은 응답을 그대로 적습니다. 판단 문구는 받은 상태·본문에서만 나옵니다.
function record(attackId, expected, result, verdict) {
  if (!result.sent) return { attackId, expected, observed: NOT_RUN };
  return { attackId, expected, observed: `HTTP ${result.status}; 요청 ${result.request}; ${ids(result)}; ${verdict(result)}` };
}

const statusVerdict = statuses => result =>
  `JSON 오류 ${jsonError(result) ? '있음' : '없음'}; ${statuses.includes(result.status) && jsonError(result) ? '기대와 일치' : '추가 확인 필요'}`;

const notRun = (attackId, expected, reason) => ({ attackId, expected: `${expected} (${reason})`, observed: NOT_RUN });

export async function runAttackChecks(config) {
  if (!Number.isInteger(config.step) || config.step < 2 || config.step > 12) {
    throw new Error('이 공격 점검은 2~12단계 전용입니다.');
  }

  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 확인해 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 확인해 주세요.');
  }

  const attempts = [];
  const marker = config.sampleMarker;

  // 1) 무인증 조회: 정적 자료 → 메모 목록 (같은 실행에서 연속 전송)
  {
    const attackId = 'anonymous_static_note_read';
    const result = await send(attackId, checkUrl(app, '/data.json'), app);
    attempts.push(record(attackId, '비로그인 요청에서 /data.json의 가상 메모가 노출되지 않아야 함', result, data => {
      const exposed = data.body?.sampleMarker === marker && Array.isArray(data.body?.notes) && data.body.notes.length > 0;
      return exposed ? '가상 메모 확인 표시 노출' : '확인 표시 노출 없음';
    }));
  }
  {
    const attackId = 'anonymous_api_note_read';
    const result = await send(attackId, checkUrl(app, '/api/notes'), app);
    attempts.push(record(attackId, '비로그인 요청에서 /api/notes의 메모 본문을 읽을 수 없어야 함', result, api => {
      const exposed = api.status === 200 && Array.isArray(api.body?.notes) && api.body.notes.length > 0
        && api.body.notes.some(note => typeof note?.title === 'string'
          && (typeof note?.content === 'string' || typeof note?.body === 'string'));
      if (exposed) return '공개 API 약점 잔존: 비로그인 메모 열람 가능';
      return [401, 403].includes(api.status) && jsonError(api)
        ? 'JSON 오류로 비로그인 요청 거부'
        : '비로그인 메모 열람 미확인; 요청 거부 여부 별도 확인 필요';
    }));
  }
  if (config.step < 3) return attempts;

  // 2) 개별 메모 조회: 비로그인은 실제 GET, 다른 사람 메모 조회는 로그인 토큰이 필요해 보내지 않음
  {
    const attackId = 'anonymous_note_by_id_read';
    attempts.push(record(attackId, '비로그인 개별 메모 GET /api/notes/:id 가 HTTP 401 JSON 오류로 거부되어야 함',
      await send(attackId, checkUrl(app, `/api/notes/${FIXTURE_NOTE_ID}`), app), statusVerdict([401])));
  }
  attempts.push(notRun('cross_user_note_read',
    '로그인한 A가 B의 메모 ID로 GET /api/notes/:id 를 보내면 404(존재 숨김)로 거부되어야 함',
    '로그인 토큰을 제출 묶음에 넣지 않으므로 보내지 않음; 로컬 test/notes-ownership.test.mjs'));

  if (config.step >= 5) {
    const original = new URL(config.originalApiUrl);
    const issuer = new URL(config.identityProvider.issuer);
    if (original.protocol !== 'https:' || original.origin !== issuer.origin
        || original.pathname !== '/rest/v1/study_notes' || original.search || original.hash
        || original.username || original.password) {
      throw new Error('원본 자료 API 주소를 확인해 주세요.');
    }
    // 프로젝트 공개(publishable) 키입니다. 서버 전용 키가 아닙니다.
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_QdAl9tMSE8PtVL5YhFjzmw_IUtYENXz';
    const attackId = 'anonymous_original_note_read';
    attempts.push(record(attackId, '공개 키로 원본 자료를 직접 읽을 수 없어야 함',
      await send(attackId, original, app, { apikey: key }),
      result => (Array.isArray(result.body) ? `배열 응답 ${result.body.length}건` : '오류 또는 비배열 응답')));
  }
  if (config.step >= 6) {
    attempts.push(notRun('local_decider_contract',
      '가상 정상 요청 허용 및 미등록 기기 거부; 심판 판정과 별도',
      'HTTP 요청이 아닌 로컬 가상 시험이라 제출 묶음에서는 실행하지 않음; npm run decider:test'));
  }
  if (config.step >= 10) {
    if (config.restoreRoute !== '/api/restore') throw new Error('복원 경로 설정을 확인해 주세요.');
    const attackId = 'anonymous_restore_get';
    attempts.push(record(attackId, 'GET 복원 요청이 HTTP 405 JSON 오류로 거부되어야 함',
      await send(attackId, checkUrl(app, config.restoreRoute), app), statusVerdict([405])));
    attempts.push(notRun('anonymous_restore_post',
      'POST 복원 요청이 HTTP 401 JSON 오류로 거부되어야 함',
      '쓰기 요청이라 제출 묶음에서는 보내지 않음'));
    attempts.push(notRun('local_policy_recovery',
      '사전 백업 재검증·변조 백업 거부·시험 사본 복원 뒤 회귀 검사 통과',
      'HTTP 요청이 아닌 로컬 시험이라 제출 묶음에서는 실행하지 않음; npm run test:recovery'));
  }
  if (config.step >= 11) {
    const attackId = 'anonymous_device_status';
    attempts.push(record(attackId, '비로그인 기기 상태 요청이 HTTP 401 JSON 오류로 거부되어야 함',
      await send(attackId, checkUrl(app, '/api/device'), app), statusVerdict([401])));
    attempts.push(notRun('local_device_signature',
      '서명 없음·미승인 기기·서명 뒤 경로/본문 변경·위조 서명 거부, 승인 기기 허용',
      '로그인과 기기 서명이 필요해 제출 묶음에서는 보내지 않음; node --test test/device-approval.test.mjs'));
  }
  if (config.step >= 12) {
    const attackId = 'anonymous_operations_summary';
    attempts.push(record(attackId, '비로그인 작전실 요청이 HTTP 401 JSON 오류로 거부되어 서버 기록이 보이지 않아야 함',
      await send(attackId, checkUrl(app, '/api/operations'), app),
      result => (result.status === 401 && jsonError(result) && !result.body?.counts ? '기대와 일치' : '추가 확인 필요')));
  }
  return attempts;
}
