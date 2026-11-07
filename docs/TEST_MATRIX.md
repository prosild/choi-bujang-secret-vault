# 1~11단계 재검사표

이 표는 구현을 다시 점검하기 위한 대표 41개 시나리오입니다. 심판의 내부 시험 목록이나 점수표가 아닙니다. 로컬·모의 검사 결과는 `verification/latest.json`의 실행 시각·명령·통과 건수로 확인합니다. 실제 HTTP 점검은 `artifacts/live-check.json`에 요청 식별자·시각·기대값·응답 상태를 기록합니다. 단위 검사의 외부 요청 ID는 없으며 임의로 만들지 않습니다. 운영 엔진 경유 41개 심판 공격의 이번 버전 결과는 모두 **NOT_RUN**입니다.

| 번호 | 단계 | 시나리오 | 기대 결과 | 확인 근거/남은 작업 |
|---|---:|---|---|---|
| 1 | 1 | 정적 data.json 비공개 | 404/본문 없음 | 실배포 점검 예정 |
| 2 | 1 | 비로그인 메모 API | 401 JSON | API/배포 점검 |
| 3 | 2 | 공개 키의 원본 DB 직접 조회 | 메모 반환 없음 | 원본 직접 점검 |
| 4 | 2 | 익명 DB SELECT 권한 | false | 실DB 메타데이터 확인 |
| 5 | 3 | 정상 서버 로그인·쿠키 | HttpOnly/Secure/SameSite | session-auth.test.mjs |
| 6 | 3 | 잘못된 서명 | 401 | restore-api.test.mjs |
| 7 | 3 | 로그아웃 | 쿠키 만료 | session-auth.test.mjs |
| 8 | 3 | 쿠키 갱신 | 서버 refresh 후 새 쿠키 | session-auth.test.mjs |
| 9 | 4 | A 본인 메모 조회 | 200 | notes-ownership.test.mjs |
| 10 | 4 | A 본인 메모 수정 | 200·재조회 변경 | notes-ownership.test.mjs |
| 11 | 4 | A 본인 메모 삭제 | 200·재조회 404 | notes-ownership.test.mjs |
| 12 | 4 | B의 A 메모 조회 | 404 | notes-ownership.test.mjs |
| 13 | 4 | B의 A 메모 수정 | 404·변경 없음 | notes-ownership.test.mjs |
| 14 | 4 | B의 A 메모 삭제 | 404·보존 | notes-ownership.test.mjs |
| 15 | 4 | 본문 소유자 위조 | 400 | notes-ownership.test.mjs |
| 16 | 5 | 일반 역할의 원본 DB 직접 권한 | false | 실DB 메타데이터 확인 |
| 17 | 6 | 등록 기기 | 정상 자원 allow | decider.test.mjs |
| 18 | 6 | 미등록 기기 | deny | decider.test.mjs |
| 19 | 6 | 기기 값 누락 | deny | decider.test.mjs |
| 20 | 6 | 문자열 true 위조 | deny | decider.test.mjs |
| 21 | 7 | 복합 이상 | step_up | decider.test.mjs |
| 22 | 7 | 외국 지역 단독 | allow | decider.test.mjs |
| 23 | 7 | 미상 출처 | step_up | decider.test.mjs |
| 24 | 7 | 최근 재인증 | allow | decider.test.mjs |
| 25 | 7 | 만료·음수 재인증 | step_up | decider.test.mjs |
| 26 | 8 | 개별 메모 경로 | allow | resource.test.mjs |
| 27 | 8 | 전체 목록 경로 | deny | resource.test.mjs |
| 28 | 8 | 공지 GET | allow | resource.test.mjs |
| 29 | 8 | 공지 쓰기 | deny/405 | resource.test.mjs |
| 30 | 8 | 강사 자료 | deny | resource.test.mjs |
| 31 | 8 | 쿼리 기능 선택·경로 위조 | deny/400 | resource.test.mjs |
| 32 | 9 | 10분 120건 | observe | detect.test.mjs |
| 33 | 9 | 10분 121건 | propose_revocation | detect.test.mjs |
| 34 | 9 | 다른 주체 합산 방지 | observe | detect.test.mjs |
| 35 | 9 | 10분 경계 밖 | observe | detect.test.mjs |
| 36 | 10 | 변조 정책 시험 사본 | 해시 일치 복원 | policy-recovery.test.mjs |
| 37 | 10 | 백업 해시 불일치 | 중단 | policy-recovery.test.mjs |
| 38 | 10 | 서명된 B 한 건 복원 | 모의 RPC 허용 | restore-api.test.mjs |
| 39 | 10 | 실DB 변조·삭제 후 복원 | 원본 해시 일치 | 실DB SQL 시험 PASS (2026-11-06, verification/step10-db.json) |
| 40 | 11 | 승인 전 기기·브라우저 승인 값 위조 | 403/401, 자료 없음 | device-approval.test.mjs, operations.test.mjs |
| 41 | 11 | 서명 없는 요청·서명 뒤 경로/본문 변경·위조 서명 | 401 거부, 승인 기기 정상 서명만 200 | device-approval.test.mjs; 실제 배포의 승인 기기 화면은 사용자 확인 필요 |
