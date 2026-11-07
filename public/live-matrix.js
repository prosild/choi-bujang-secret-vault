// 12단계 제작 2: 1~11단계 정상·금지 요청을 실제 배포 API에 보내 결과를 한 표로 남깁니다.
// - 서버가 응답 헤더로 준 요청 ID(X-Request-Id)와 확인 시각을 기록합니다.
// - 실행하지 않은 시나리오는 통과로 세지 않습니다. 정상 요청은 서버 승인 기기에서만 실행합니다.
// - 시험용 가상 메모 한 건을 만들었다가 지우며, 결과에는 메모 본문·계정 정보·토큰을 넣지 않습니다.
import { createDevice, currentDevice, signedHeaders } from '/device.js';
import { summarize } from '/matrix-summary.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;
const maskPath = path => path.replace(UUID, ':id');
const FORGED_JWT = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJmb3JnZWQifQ.' + 'A'.repeat(86);
const json = value => JSON.stringify(value);

async function send(path, { method = 'GET', body, headers = {}, credentials = 'same-origin' } = {}) {
  const response = await fetch(path, { method, body, headers, credentials, cache: 'no-store', redirect: 'manual' });
  let error = null;
  try { error = (await response.clone().json())?.error ?? null; } catch { /* JSON이 아닌 응답(정적 404 등) */ }
  return { status: response.status, error, requestId: response.headers.get('X-Request-Id'), response };
}

const signed = (device, method, path, body, extra = {}) => signedHeaders(device, { method, path, body, ...extra });

export async function runLiveMatrix({ approved, onResult = () => {} } = {}) {
  const results = [];
  const record = async (spec, run) => {
    const at = new Date().toISOString();
    if (spec.normal && !approved) {
      const item = { ...spec, kind: 'normal', at, status: 'not_run', actual: null, error: null, requestId: null,
        reason: '이 기기가 서버 승인 전이라 정상 요청은 실행하지 않음' };
      results.push(item); onResult(item); return null;
    }
    try {
      const out = await run();
      const ok = spec.expect.includes(out.status) && (spec.check ? await spec.check(out) : true);
      const item = { no: spec.no, stage: spec.stage, kind: spec.normal ? 'normal' : 'forbidden', name: spec.name,
        method: spec.method, path: maskPath(spec.path), expected: spec.expect.join('/'), actual: out.status,
        error: out.error, requestId: out.requestId, at, status: ok ? 'match' : 'mismatch' };
      results.push(item); onResult(item); return out;
    } catch (error) {
      const item = { no: spec.no, stage: spec.stage, kind: spec.normal ? 'normal' : 'forbidden', name: spec.name,
        method: spec.method, path: maskPath(spec.path), expected: spec.expect.join('/'), actual: null,
        error: error.name, requestId: null, at, status: 'error' };
      results.push(item); onResult(item); return null;
    }
  };
  const device = await currentDevice();
  const stranger = await createDevice(); // 서버 승인 기록이 없는 새 기기 키(메모리 전용)
  const foreign = crypto.randomUUID();   // 이 계정이 소유하지 않은 메모 ID
  let noteId = null;
  const note = { title: '[12단계 재검사] 가상 메모', body: '재검사용 가상 내용' };
  const changed = { title: '[12단계 재검사] 가상 메모 수정', body: '재검사용 가상 내용 수정' };

  await record({ no: 1, stage: 1, name: '비로그인 /data.json', method: 'GET', path: '/data.json', expect: [404] },
    () => send('/data.json', { credentials: 'omit' }));
  await record({ no: 2, stage: 1, name: '비로그인 메모 목록', method: 'GET', path: '/api/notes', expect: [401] },
    () => send('/api/notes', { credentials: 'omit' }));
  await record({ no: 6, stage: 3, name: '위조 로그인 토큰', method: 'GET', path: '/api/notes', expect: [401] },
    () => send('/api/notes', { credentials: 'omit', headers: { Authorization: `Bearer ${FORGED_JWT}` } }));
  await record({ no: 5, stage: 3, name: '로그인 세션 확인', normal: true, method: 'GET', path: '/api/session', expect: [200] },
    () => send('/api/session'));
  await record({ no: 40, stage: 11, name: '이 기기 승인 상태', normal: true, method: 'GET', path: '/api/device', expect: [200],
    check: async out => (await out.response.json()).status === 'approved' },
  async () => send('/api/device', { headers: await signed(device, 'GET', '/api/device') }));
  await record({ no: 40, stage: 11, name: '승인 기록 없는 기기의 메모 요청', method: 'GET', path: '/api/notes', expect: [403] },
    async () => send('/api/notes', { headers: await signed(stranger, 'GET', '/api/notes') }));
  await record({ no: 41, stage: 11, name: '서명 없는 보호 요청', method: 'GET', path: '/api/notes', expect: [401] },
    () => send('/api/notes'));

  // 정상: 가상 메모 생성·조회 (승인 기기만)
  const createBody = json(note);
  const created = await record({ no: 9, stage: 4, name: '본인 가상 메모 생성', normal: true, method: 'POST', path: '/api/notes', expect: [201] },
    async () => send('/api/notes', { method: 'POST', body: createBody,
      headers: { 'Content-Type': 'application/json', ...await signed(device, 'POST', '/api/notes', createBody) } }));
  if (created) noteId = (await created.response.json()).id;
  const own = noteId ? `/api/notes/${noteId}` : null;
  if (!own) {
    // 가상 메모를 만들지 못하면 그 메모가 필요한 시나리오는 미실행으로 남깁니다(통과로 세지 않음).
    for (const [no, stage, kind, name] of [[9, 4, 'normal', '본인 메모 조회'], [26, 8, 'normal', '개별 메모 경로'],
      [41, 11, 'forbidden', '서명 뒤 경로 변경'], [41, 11, 'forbidden', '서명 뒤 수정 본문 변경'], [41, 11, 'forbidden', '서명 뒤 메서드 변경'],
      [41, 11, 'forbidden', '위조 서명'], [41, 11, 'forbidden', '오래된 서명(2분 전)'], [15, 4, 'forbidden', '본문 소유자 위조'],
      [31, 8, 'forbidden', '쿼리 기능 선택'], [10, 4, 'normal', '본인 메모 수정'], [10, 4, 'normal', '수정 뒤 재조회'],
      [11, 4, 'normal', '본인 메모 삭제'], [11, 4, 'normal', '삭제 뒤 재조회']]) {
      const item = { no, stage, kind, name, at: new Date().toISOString(), status: 'not_run', actual: null, error: null,
        requestId: null, reason: '시험용 가상 메모가 없어 실행하지 않음' };
      results.push(item); onResult(item);
    }
  }
  try {
    if (own) {
      await record({ no: 9, stage: 4, name: '본인 메모 조회', normal: true, method: 'GET', path: own, expect: [200] },
        async () => send(own, { headers: await signed(device, 'GET', own) }));
      await record({ no: 26, stage: 8, name: '개별 메모 경로', normal: true, method: 'GET', path: own, expect: [200] },
        async () => send(own, { headers: await signed(device, 'GET', own) }));
      await record({ no: 41, stage: 11, name: '서명 뒤 경로 변경', method: 'GET', path: `/api/notes/${foreign}`, expect: [401] },
        async () => send(`/api/notes/${foreign}`, { headers: await signed(device, 'GET', own) }));
      const bodyA = json(changed), bodyB = json({ ...changed, body: '서명 뒤 바뀐 본문' });
      await record({ no: 41, stage: 11, name: '서명 뒤 수정 본문 변경', method: 'PUT', path: own, expect: [401] },
        async () => send(own, { method: 'PUT', body: bodyB, headers: { 'Content-Type': 'application/json', ...await signed(device, 'PUT', own, bodyA) } }));
      await record({ no: 41, stage: 11, name: '서명 뒤 메서드 변경', method: 'DELETE', path: own, expect: [401] },
        async () => send(own, { method: 'DELETE', headers: await signed(device, 'GET', own) }));
      await record({ no: 41, stage: 11, name: '위조 서명', method: 'GET', path: own, expect: [401] },
        async () => send(own, { headers: { ...await signed(device, 'GET', own), 'X-Vault-Signature': 'A'.repeat(86) } }));
      await record({ no: 41, stage: 11, name: '오래된 서명(2분 전)', method: 'GET', path: own, expect: [401] },
        async () => send(own, { headers: await signed(device, 'GET', own, undefined, { time: Date.now() - 120_000 }) }));
      const spoof = json({ ...changed, owner_id: foreign });
      await record({ no: 15, stage: 4, name: '본문 소유자 위조', method: 'PUT', path: own, expect: [400] },
        async () => send(own, { method: 'PUT', body: spoof, headers: { 'Content-Type': 'application/json', ...await signed(device, 'PUT', own, spoof) } }));
      await record({ no: 31, stage: 8, name: '쿼리 기능 선택', method: 'GET', path: `${own}?select=*`, expect: [400] },
        async () => send(`${own}?select=*`, { headers: await signed(device, 'GET', own) }));
      const put = json(changed);
      await record({ no: 10, stage: 4, name: '본인 메모 수정', normal: true, method: 'PUT', path: own, expect: [200] },
        async () => send(own, { method: 'PUT', body: put, headers: { 'Content-Type': 'application/json', ...await signed(device, 'PUT', own, put) } }));
      await record({ no: 10, stage: 4, name: '수정 뒤 재조회', normal: true, method: 'GET', path: own, expect: [200],
        check: async out => (await out.response.json()).title === changed.title },
      async () => send(own, { headers: await signed(device, 'GET', own) }));
    }
    const other = `/api/notes/${foreign}`;
    await record({ no: 12, stage: 4, name: '소유하지 않은 메모 조회', method: 'GET', path: other, expect: [404] },
      async () => send(other, { headers: await signed(device, 'GET', other) }));
    const otherBody = json(changed);
    await record({ no: 13, stage: 4, name: '소유하지 않은 메모 수정', method: 'PUT', path: other, expect: [404] },
      async () => send(other, { method: 'PUT', body: otherBody, headers: { 'Content-Type': 'application/json', ...await signed(device, 'PUT', other, otherBody) } }));
    await record({ no: 14, stage: 4, name: '소유하지 않은 메모 삭제', method: 'DELETE', path: other, expect: [404] },
      async () => send(other, { method: 'DELETE', headers: await signed(device, 'DELETE', other) }));
    await record({ no: 31, stage: 8, name: '목록에 소유자 쿼리 주입', method: 'GET', path: `/api/notes?owner_id=${foreign}`, expect: [400] },
      async () => send(`/api/notes?owner_id=${foreign}`, { headers: await signed(device, 'GET', '/api/notes') }));
    await record({ no: 28, stage: 8, name: '공지 읽기', normal: true, method: 'GET', path: '/api/announcements/class-notice', expect: [200] },
      async () => send('/api/announcements/class-notice', { headers: await signed(device, 'GET', '/api/announcements/class-notice') }));
    await record({ no: 29, stage: 8, name: '공지 쓰기', method: 'PUT', path: '/api/announcements/class-notice', expect: [405] },
      () => send('/api/announcements/class-notice', { method: 'PUT', body: '{}', headers: { 'Content-Type': 'application/json' } }));
    await record({ no: 30, stage: 8, name: '강사 자료 경로', method: 'GET', path: '/api/instructor', expect: [404] },
      () => send('/api/instructor'));
    await record({ no: null, stage: 10, name: '학생 쿠키로 심판 B 복원 경로', method: 'POST', path: '/api/restore', expect: [401] },
      () => send('/api/restore', { method: 'POST', body: json({ id: foreign }), headers: { 'Content-Type': 'application/json' } }));
    await record({ no: null, stage: 12, name: '서명 없는 작전실 요청', method: 'GET', path: '/api/operations', expect: [401] },
      () => send('/api/operations'));
  } finally {
    if (own) {
      await record({ no: 11, stage: 4, name: '본인 메모 삭제', normal: true, method: 'DELETE', path: own, expect: [200] },
        async () => send(own, { method: 'DELETE', headers: await signed(device, 'DELETE', own) }));
      await record({ no: 11, stage: 4, name: '삭제 뒤 재조회', normal: true, method: 'GET', path: own, expect: [404] },
        async () => send(own, { headers: await signed(device, 'GET', own) }));
    }
  }
  return { results, summary: summarize(results) };
}

