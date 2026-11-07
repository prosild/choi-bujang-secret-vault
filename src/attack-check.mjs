// 학생 자기 점검 (npm run bundle이 실행). 심판 판정이 아닙니다.
// 규칙
// - 이 파일은 아무 모듈도 불러오지 않습니다(정적·동적 import 없음). 제출 묶음 실행기가 불러오지 못하는 모듈 때문에
//   묶음 전체가 멈추지 않도록, 전역 fetch로 공개 HTTPS GET만 보냅니다. POST·서명·하위 프로세스는 쓰지 않습니다.
// - 요청을 실제로 보낸 점검은 실제로 받은 HTTP 상태(와 받은 경우 X-Request-Id)를 observed에 적습니다.
// - 요청을 보내지 않은 점검(로컬 가상 시험, 로그인·서명·쓰기가 필요한 시험)은 observed를 not_run으로만 적습니다.
//   그 결과는 npm run verify / npm run test:recovery 등 로컬 명령의 기록이며 제출 묶음의 결과로 쓰지 않습니다.
const NOT_RUN = 'not_run';
const checkUrl = (app, path) => new URL(path, app);
// 존재 여부와 무관한 가상 메모 ID: 비로그인 개별 메모 조회가 소유자 확인 전에 막히는지만 봅니다.
const FIXTURE_NOTE_ID = '00000000-0000-4000-8000-000000000000';

async function inspect(url, headers = {}) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers,
      signal: AbortSignal.timeout(10000),
    });
    const requestId = response.headers?.get?.('x-request-id') ?? null;
    let body = null;
    try {
      body = await response.json();
    } catch {
      // JSON이 아니거나 본문이 없을 수 있습니다.
    }
    return { status: response.status, body, requestId };
  } catch (error) {
    return { status: null, error: error?.message ?? '요청 실패' };
  }
}

const safeId = value => (typeof value === 'string' && /^[A-Za-z0-9._:-]{1,64}$/u.test(value) ? value : null);
const httpLine = result => `HTTP ${result.status}${safeId(result.requestId) ? `; 요청 ID ${result.requestId}` : ''}`;
const jsonError = result => typeof result.body?.error === 'string';

// 실제로 보낸 GET 하나의 결과를 기대 상태와 비교해 적습니다.
async function getCheck(attackId, expected, url, expectedStatuses, headers = {}) {
  const result = await inspect(url, headers);
  if (result.status === null) return { attackId, expected, observed: `요청 실패: ${result.error}` };
  const matched = expectedStatuses.includes(result.status) && jsonError(result);
  return { attackId, expected,
    observed: `${httpLine(result)}; JSON 오류 ${jsonError(result) ? '있음' : '없음'}; ${matched ? '기대와 일치' : '추가 확인 필요'}` };
}

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

  // 1) 무인증 조회: 정적 자료 → 메모 목록 (같은 실행에서 연속 전송)
  const data = await inspect(checkUrl(app, '/data.json'));
  const api = await inspect(checkUrl(app, '/api/notes'));

  const marker = config.sampleMarker;
  const dataExposed = data.body?.sampleMarker === marker && Array.isArray(data.body?.notes) && data.body.notes.length > 0;
  const apiExposed = api.status === 200 && Array.isArray(api.body?.notes) && api.body.notes.length > 0
    && api.body.notes.some(note => typeof note?.title === 'string'
      && (typeof note?.content === 'string' || typeof note?.body === 'string'));

  const attempts = [
    {
      attackId: 'anonymous_static_note_read',
      expected: '비로그인 요청에서 /data.json의 가상 메모가 노출되지 않아야 함',
      observed: data.status === null
        ? `요청 실패: ${data.error}`
        : dataExposed
          ? `가상 메모 확인 표시 노출 (${httpLine(data)})`
          : `확인 표시 노출 없음 (${httpLine(data)})`,
    },
    {
      attackId: 'anonymous_api_note_read',
      expected: '비로그인 요청에서 /api/notes의 메모 본문을 읽을 수 없어야 함',
      observed: api.status === null
        ? `요청 실패: ${api.error}`
        : apiExposed
          ? `공개 API 약점 잔존: 비로그인 메모 열람 가능 (${httpLine(api)})`
          : [401, 403].includes(api.status) && jsonError(api)
            ? `JSON 오류로 비로그인 요청 거부 (${httpLine(api)})`
            : `비로그인 메모 열람 미확인; 요청 거부 여부 별도 확인 필요 (${httpLine(api)})`,
    },
  ];
  if (config.step < 3) return attempts;

  // 2) 개별 메모 조회: 비로그인은 실제 GET, 다른 사람 메모 조회는 로그인 토큰이 필요해 보내지 않음
  attempts.push(await getCheck('anonymous_note_by_id_read',
    '비로그인 개별 메모 GET /api/notes/:id 가 HTTP 401 JSON 오류로 거부되어야 함',
    checkUrl(app, `/api/notes/${FIXTURE_NOTE_ID}`), [401]));
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
    const result = await inspect(original, { apikey: key });
    attempts.push({ attackId: 'anonymous_original_note_read',
      expected: '공개 키로 원본 자료를 직접 읽을 수 없어야 함',
      observed: result.status === null ? `요청 실패: ${result.error}`
        : Array.isArray(result.body) ? `배열 응답 ${result.body.length}건 (${httpLine(result)})`
          : `오류 또는 비배열 응답 (${httpLine(result)})` });
  }
  if (config.step >= 6) {
    attempts.push(notRun('local_decider_contract',
      '가상 정상 요청 허용 및 미등록 기기 거부; 심판 판정과 별도',
      'HTTP 요청이 아닌 로컬 가상 시험이라 제출 묶음에서는 실행하지 않음; npm run decider:test'));
  }
  if (config.step >= 10) {
    if (config.restoreRoute !== '/api/restore') throw new Error('복원 경로 설정을 확인해 주세요.');
    attempts.push(await getCheck('anonymous_restore_get',
      'GET 복원 요청이 HTTP 405 JSON 오류로 거부되어야 함',
      checkUrl(app, config.restoreRoute), [405]));
    attempts.push(notRun('anonymous_restore_post',
      'POST 복원 요청이 HTTP 401 JSON 오류로 거부되어야 함',
      '쓰기 요청이라 제출 묶음에서는 보내지 않음'));
    attempts.push(notRun('local_policy_recovery',
      '사전 백업 재검증·변조 백업 거부·시험 사본 복원 뒤 회귀 검사 통과',
      'HTTP 요청이 아닌 로컬 시험이라 제출 묶음에서는 실행하지 않음; npm run test:recovery'));
  }
  if (config.step >= 11) {
    attempts.push(await getCheck('anonymous_device_status',
      '비로그인 기기 상태 요청이 HTTP 401 JSON 오류로 거부되어야 함',
      checkUrl(app, '/api/device'), [401]));
    attempts.push(notRun('local_device_signature',
      '서명 없음·미승인 기기·서명 뒤 경로/본문 변경·위조 서명 거부, 승인 기기 허용',
      '로그인과 기기 서명이 필요해 제출 묶음에서는 보내지 않음; node --test test/device-approval.test.mjs'));
  }
  if (config.step >= 12) {
    const result = await inspect(checkUrl(app, '/api/operations'));
    attempts.push({ attackId: 'anonymous_operations_summary',
      expected: '비로그인 작전실 요청이 HTTP 401 JSON 오류로 거부되어 서버 기록이 보이지 않아야 함',
      observed: result.status === null ? `요청 실패: ${result.error}`
        : `${httpLine(result)}; ${result.status === 401 && jsonError(result) && !result.body?.counts ? '기대와 일치' : '추가 확인 필요'}` });
  }
  return attempts;
}
