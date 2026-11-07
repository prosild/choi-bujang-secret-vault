// 12단계 재검사 결과 요약 (브라우저·Node 공용, 외부 의존 없음). 실행하지 않은 항목은 통과로 세지 않습니다.
// docs/TEST_MATRIX.md의 41개 대표 시나리오: kind(정상/금지), 로컬 검사 파일(실측 아님)
export const MATRIX = [
  [1, 1, 'forbidden', '정적 data.json 비공개', null], [2, 1, 'forbidden', '비로그인 메모 API', null],
  [3, 2, 'forbidden', '공개 키의 원본 DB 직접 조회', 'npm run bundle (anonymous_original_note_read)'],
  [4, 2, 'forbidden', '익명 DB SELECT 권한', '실DB 메타데이터 (docs/db-policy-snapshot.json)'],
  [5, 3, 'normal', '정상 서버 로그인·쿠키', 'session-auth.test.mjs'], [6, 3, 'forbidden', '잘못된 서명', 'restore-api.test.mjs'],
  [7, 3, 'normal', '로그아웃', 'session-auth.test.mjs'], [8, 3, 'normal', '쿠키 갱신', 'session-auth.test.mjs'],
  [9, 4, 'normal', 'A 본인 메모 조회', 'notes-ownership.test.mjs'], [10, 4, 'normal', 'A 본인 메모 수정', 'notes-ownership.test.mjs'],
  [11, 4, 'normal', 'A 본인 메모 삭제', 'notes-ownership.test.mjs'], [12, 4, 'forbidden', 'B의 A 메모 조회', 'notes-ownership.test.mjs'],
  [13, 4, 'forbidden', 'B의 A 메모 수정', 'notes-ownership.test.mjs'], [14, 4, 'forbidden', 'B의 A 메모 삭제', 'notes-ownership.test.mjs'],
  [15, 4, 'forbidden', '본문 소유자 위조', 'notes-ownership.test.mjs'],
  [16, 5, 'forbidden', '일반 역할의 원본 DB 직접 권한', '실DB 메타데이터 (docs/db-policy-snapshot.json)'],
  [17, 6, 'normal', '등록 기기', 'decider.test.mjs'], [18, 6, 'forbidden', '미등록 기기', 'decider.test.mjs'],
  [19, 6, 'forbidden', '기기 값 누락', 'decider.test.mjs'], [20, 6, 'forbidden', '문자열 true 위조', 'decider.test.mjs'],
  [21, 7, 'forbidden', '복합 이상', 'decider.test.mjs'], [22, 7, 'normal', '외국 지역 단독', 'decider.test.mjs'],
  [23, 7, 'forbidden', '미상 출처', 'decider.test.mjs'], [24, 7, 'normal', '최근 재인증', 'decider.test.mjs'],
  [25, 7, 'forbidden', '만료·음수 재인증', 'decider.test.mjs'], [26, 8, 'normal', '개별 메모 경로', 'resource.test.mjs'],
  [27, 8, 'forbidden', '전체 목록 경로(엔진)', 'resource.test.mjs'], [28, 8, 'normal', '공지 GET', 'resource.test.mjs'],
  [29, 8, 'forbidden', '공지 쓰기', 'resource.test.mjs'], [30, 8, 'forbidden', '강사 자료', 'resource.test.mjs'],
  [31, 8, 'forbidden', '쿼리 기능 선택·경로 위조', 'resource.test.mjs'], [32, 9, 'normal', '10분 120건', 'detect.test.mjs'],
  [33, 9, 'forbidden', '10분 121건', 'detect.test.mjs'], [34, 9, 'normal', '다른 주체 합산 방지', 'detect.test.mjs'],
  [35, 9, 'normal', '10분 경계 밖', 'detect.test.mjs'], [36, 10, 'normal', '변조 정책 시험 사본 복원', 'policy-recovery.test.mjs'],
  [37, 10, 'forbidden', '백업 해시 불일치', 'policy-recovery.test.mjs'], [38, 10, 'normal', '서명된 B 한 건 복원', 'restore-api.test.mjs'],
  [39, 10, 'normal', '실DB 변조·삭제 후 복원', '실DB SQL 시험 기록 (verification/step10-db.json)'],
  [40, 11, 'forbidden', '승인 전 기기·승인 값 위조', 'device-approval.test.mjs'],
  [41, 11, 'forbidden', '서명 없음·서명 뒤 경로/본문 변경·위조 서명', 'device-approval.test.mjs'],
].map(([no, stage, kind, name, local]) => ({ no, stage, kind, name, local }));

const RULES = {
  UNAUTHORIZED: '로그인 검증 (3단계)', NOT_FOUND: '소유자 검사 (4·8단계)', INVALID_NOTE: '입력·소유자 위조 차단 (4단계)',
  INVALID_RESOURCE_PATH: '자원 경로·쿼리 차단 (8단계)', INVALID_ID: '자원 경로·쿼리 차단 (8단계)',
  READ_ONLY_RESOURCE: '공지 읽기 전용 (8단계)', DEVICE_SIGNATURE_REQUIRED: '요청 서명 필요 (11단계)',
  DEVICE_SIGNATURE_INVALID: '서명 불일치 (11단계)', DEVICE_NOT_APPROVED: '미승인 기기 (11단계)',
};

export function summarize(results) {
  const measured = results.filter(item => item.status === 'match' || item.status === 'mismatch');
  const denials = {};
  for (const item of measured.filter(entry => entry.actual >= 400)) {
    const rule = RULES[item.error] ?? (item.error ? item.error : `정적·없는 경로 (HTTP ${item.actual})`);
    denials[rule] = (denials[rule] ?? 0) + 1;
  }
  const rows = MATRIX.map(row => {
    const live = results.filter(item => item.no === row.no);
    const ran = live.filter(item => item.status === 'match' || item.status === 'mismatch');
    const bad = live.some(item => item.status === 'mismatch' || item.status === 'error');
    const state = bad ? 'live_mismatch' : ran.length && ran.length === live.length ? 'live_match'
      : ran.length ? 'live_partial' : row.local ? 'local_only' : 'not_run';
    return { ...row, state, liveCount: ran.length };
  });
  const forbidden = measured.filter(item => item.kind === 'forbidden');
  const normal = measured.filter(item => item.kind === 'normal');
  return {
    normalAllowed: `${normal.filter(item => item.status === 'match').length}/${normal.length}`,
    forbiddenBlocked: `${forbidden.filter(item => item.status === 'match').length}/${forbidden.length}`,
    notRun: results.filter(item => item.status === 'not_run').length,
    blockedOf41: rows.filter(row => row.kind === 'forbidden' && row.state === 'live_match').length,
    matrix: { liveMatch: rows.filter(row => row.state === 'live_match').length,
      liveMismatch: rows.filter(row => row.state === 'live_mismatch').length,
      livePartial: rows.filter(row => row.state === 'live_partial').length,
      localOnly: rows.filter(row => row.state === 'local_only').length, notRun: rows.filter(row => row.state === 'not_run').length },
    denials, rows,
  };
}
