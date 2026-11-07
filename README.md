# BYTE BACK 방어전 R5 — 11단계 저장점: 나만의 접속 앱을 완성합니다

현재 제출 단계는 **11단계**입니다(`aleph.config.json`의 `step: 11`). 1~10단계의 서버 로그인·본인 메모 CRUD·기기 등록 판정·재인증·자원 구역·폭주 탐지·백업 복원은 유지합니다. 과거 단계별 기록은 [docs/HISTORY.md](docs/HISTORY.md)에 있으며 현재 동작 설명이 아닙니다.

## 11단계: 설치형 접속 앱과 기기 승인

따로 설치하는 접속 프로그램은 없습니다. 지금 배포 중인 자료실이 설치형 웹앱(`public/manifest.webmanifest`, 앱 이름 「BYTE BACK 내 자료실」, 오프라인 안내 `public/offline.html`)입니다. **앱을 설치했다는 표시는 기기 확인이 아닙니다.** 보호 자료는 서버가 승인한 기기의 서명 요청에만 열립니다.

| 확인 항목 | 근거 | 결과 |
| --- | --- | --- |
| 승인 전에는 자료가 없음 | `api/notes.js`·`api/announcements/[id].js`·`api/operations.js` → `src/device-auth.mjs` | 서명 없음 401 `DEVICE_SIGNATURE_REQUIRED`, 승인 기록 없는 기기 403 `DEVICE_NOT_APPROVED`, 화면은 자료 대신 승인 안내 |
| 승인한 기기에서 기존 화면이 열림 | `POST /api/device` 승인 → 같은 기기의 서명 요청 | 로컬·모의 PASS: 승인 뒤 메모 목록·수정·작전실 200 |
| 서명 없는 보호 요청 | `test/device-approval.test.mjs`, 제출 묶음 `local_device_unsigned_request` | 401 거부 |
| 서명 뒤 요청 경로 변경 | 같은 검사, `local_device_path_changed` | 401 `DEVICE_SIGNATURE_INVALID` |
| 서명 뒤 수정 본문 변경 | 같은 검사, `local_device_body_changed` | 401 `DEVICE_SIGNATURE_INVALID` |
| 위조 서명·다른 기기 사칭·만료·회수 | 같은 검사, `local_device_forged_signature` | 401/403 거부 |
| 실제 배포에서 승인 기기 화면 | 사용자 브라우저 | 사용자 확인 필요(비밀번호는 사용자만 입력) |

### 동작 방식

1) **기기 키:** 화면이 열릴 때 브라우저 WebCrypto로 ECDSA P-256 키를 `extractable: false`로 만들어 **이 페이지의 메모리에만** 둡니다. localStorage·sessionStorage·IndexedDB·쿠키에 기기 키를 넣지 않습니다. 새로고침하면 새 기기 키가 생기므로 다시 승인받습니다. 기기 ID는 공개키 지문(RFC 7638 SHA-256)의 앞 16자리이며 개인키가 아닙니다. 로그인 토큰은 기존대로 HttpOnly 쿠키에만 있습니다.
2) **요청 서명:** 보호 요청마다 `vault-device-v1`, 메서드, 경로, 본문 SHA-256, 시각(ms), 임의값, 기기 ID를 줄바꿈으로 이어 서명하고 `X-Vault-Device`·`X-Vault-Time`·`X-Vault-Nonce`·`X-Vault-Signature` 헤더로 보냅니다(`public/device.js`). 서버는 서버 승인 기록의 공개키로 다시 계산해 검증하므로 경로·메서드·본문을 바꾸면 거부됩니다. 시각 차이는 60초까지 허용합니다.
3) **승인 요청:** 로그인한 화면의 「접속 기기」에서 비밀번호를 다시 입력하고 「이 기기 승인 요청」을 누릅니다. 서버는 ① 요청에 담긴 공개키로 서명을 확인해 개인키 보유를 증명하고 ② 같은 계정의 비밀번호를 서버에서 다시 확인한 뒤(확인용 세션은 즉시 종료) ③ Supabase Auth의 `app_metadata.vault_devices`(서버 키로만 쓸 수 있음)에 기기 ID·공개키·만료(12시간)를 기록합니다. 계정당 최근 5대까지 유지합니다. 버튼 클릭, 설치 여부, 브라우저가 보낸 `deviceRegistered`·`approved`·역할 값으로는 승인되지 않습니다.
4) **상태·회수:** `GET /api/device`는 이 기기의 승인 상태를 돌려주고, 로그아웃할 때 `DELETE /api/device`로 이 기기의 승인을 먼저 회수합니다. 심판·외부 발급 토큰은 비밀번호 재확인을 할 수 없어 이 앱에서 기기 승인을 받지 않습니다.
5) **판정기와의 관계:** ALEPH SDP 엔진을 거치는 요청은 엔진이 확인한 `deviceRegistered`를 6단계 `device_registered` 규칙이 판정합니다(`src/decider.mjs`, 변경 없음). 엔진의 기기 승인 API 계약은 제공되지 않아 연동하지 않았고, 위 승인은 자료실 서버의 기록입니다.

### 직접 확인

```bash
npm install
npm run verify                 # 전체 검사 39개 (기기 승인·서명 공격 검사 포함)
node --test test/device-approval.test.mjs
```

화면에서: 배포 주소 접속 → 로그인 → 메모 자리에 「이 기기가 서버 승인을 받기 전에는 자료를 표시하지 않습니다」가 보이면 정상입니다. 「접속 기기」에서 비밀번호를 다시 입력해 승인 요청 → 「서버 승인 기기입니다」 표시 뒤 기존 메모·작전실이 열리면 정상입니다. 비밀번호가 틀리면 「비밀번호가 맞지 않아 승인하지 않았습니다」, 새로고침 뒤에는 다시 승인 안내가 나와야 합니다.

남은 한계: 60초 안의 같은 서명 재전송(재생)은 따로 막지 않습니다. `POST /api/restore`는 10단계 심판 B 전용 경로로 기기 서명을 요구하지 않지만, 11단계부터 `/api/notes`는 승인 기기의 서명이 필요하므로 승인 기기가 없는 심판 계정은 메모를 새로 만들거나 읽을 수 없습니다. 운영 엔진 경유 재공격과 실제 배포에서의 승인 기기 화면은 아직 실행하지 않았습니다.

# 10단계 기록: 백업에서 자료실을 되살립니다

## 한눈에 보기

| 확인 항목 | 근거 | 결과 |
| --- | --- | --- |
| 사전 백업을 복원 직전에 다시 읽어 해시로 검증 | `npm run restore`, `scripts/policy-recovery.mjs` | 로컬 PASS: manifest·파일 해시 재검증 후 시험 사본 복원, 사본과 3/3 일치 |
| 손댄 백업 거부 | `test/policy-recovery.test.mjs`, 제출 묶음 `local_tampered_backup_rejected` | 로컬 PASS: `backup_hash_mismatch`로 중단 |
| B 메모 한 건 복원(ID·소유자·내용 해시 대조) | `POST /api/restore`, `scripts/verify-restore-db.sql` | 실제 Supabase SQL 시험 PASS (2026-11-06, `verification/step10-db.json`) |
| 복구 뒤 1~9단계 정상·금지 요청 재시험 | `npm run test:recovery`, 제출 묶음 `local_post_restore_regression` | 로컬·모의 PASS: 판정기 4/4, 회귀 38/38 |
| 비로그인 복원 요청 거부 | 배포 주소 `GET`/`POST /api/restore` | 배포 확인: GET 405, POST 401 JSON 오류 |
| 실제 서명된 B의 복원 HTTP 왕복, 운영 엔진 재공격 | — | **미실행** (심판 시험 계정이 필요) |

`npm run bundle`은 제출 묶음을 만들 때 위의 사본 재검증·변조 백업 거부·복구 후 재시험을 **그 자리에서 실제로 다시 실행**하고 결과를 `attackAttempts`에 기록합니다. 이 결과는 학생 자체 점검이며 심판 판정이 아닙니다.

## 설치와 실행

```bash
npm install
npm run backup     # 안전 정책 사본 + SHA-256 해시 + Git 버전 저장, 시험 사본 한 줄만 일부러 변경
npm run restore    # 사본을 다시 읽어 해시 검증 → 바뀔 항목 표시 → 시험 사본만 복원 → 사본과 재대조
npm run test:recovery   # 위 과정 + 1~9단계 정상·금지 요청 재시험 (verification/step10.json 기록)
```

- 정상 결과: `npm run restore` 출력에 `phase: before_restore`와 바뀔 파일·줄이 먼저 나오고, 마지막에 `"verified": true`. `npm run test:recovery` 마지막 줄 `"regression": "PASS"`.
- 거부되어야 할 결과: 백업 파일이나 manifest를 손대면 `backup_hash_mismatch` / `manifest_hash_mismatch`로 **쓰기 전에** 중단. 확인 후 정책이 바뀌면 `policy_changed_after_review`, 버전이 다르면 `version_changed_after_review`. 운영 정책 경로를 대상으로 주면 `test_copy_required`.
- `npm run restore`는 폴더를 생략하면 가장 최근 `npm run backup` 결과(`artifacts/policy-<번호>`)를 사용합니다. 특정 폴더는 `npm run restore -- artifacts/policy-<번호>`. 복원만 보지 않고 차이만 보려면 `node scripts/policy-recovery.mjs inspect artifacts/policy-<번호>`.

배포는 기존 Vercel 연결 저장소를 그대로 사용하고 서버 환경변수는 기존 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`입니다. 새 키를 만들지 않았고 값은 코드·Git·제출 묶음에 없습니다.

## 1. 안전 정책 사본과 검증 (`npm run backup` / `npm run restore`)

1) 안전 정책은 1~9단계 접근 규칙 세 가지입니다: `src/decider.mjs`(판정 규칙), `aleph.config.json`의 `allowedRoutes`, `docs/db-policy-snapshot.json`(RLS 활성, 본인 소유자 정책 4개, 익명·일반 역할 직접 조회 차단 — 2026-11-06 실제 메타데이터 재조회와 일치).
2) `npm run backup`은 세 파일을 `artifacts/policy-<번호>/backup`에 쓰기 전용(`wx`)으로 저장하고, 파일별 SHA-256과 Git 버전을 `manifest.json`에 적습니다. manifest 자체의 해시와 확인 계획(`review.json`)의 해시는 사본 밖 `trust.json`에 따로 둡니다. 그다음 `test-copy/decider.mjs`의 기기 등록 규칙 한 줄(`deviceRegistered === true` → `!== false`)을 바꿔 침공을 흉내 내고, **복원할 버전·바뀐 파일·줄·변경 전후 해시**를 출력합니다.
3) `npm run restore`는 복원 직전에 `trust.json` → `review.json` → `manifest.json` → 사본 파일 순으로 **다시 읽어 해시를 대조**합니다. 사본 누락·해시 불일치·버전 불일치·확인 후 변경 중 하나라도 있으면 아무것도 쓰지 않고 중단합니다. 대상 경로가 `artifacts` 하위의 실제 시험 사본인지(링크 우회 포함) 확인한 뒤 바뀐 파일만 되돌리고, 복원 후 사본과 **다시 대조해 차이 0건**이어야 성공입니다.
4) 운영 정책(`src/`, `aleph.config.json`)과 DB 정책은 쓰지 않습니다. 같은 폴더의 `audit.log`(감사 이력)와 `other-service.json`(다른 서비스 규칙)은 내용이 그대로인지 확인하고, 결과를 `verification.json`에 남깁니다.

## 2. B 메모 한 건 복원 (`POST /api/restore`)

1) 자료 서비스: `notes`. 복원 경로: **`POST /api/restore`**, 본문 `{ "id": "대상 UUID" }`. `aleph.config.json`의 `restoreRoute`와 같습니다.
2) 허용 주체: 서명을 검증한 **심판 시험 계정 B**의 실행 ID·소유자만. 익명은 401, GET은 405, 본문으로 소유자·내용을 지정할 수 없습니다.
3) 사본: B가 `/api/notes`로 처음 만든 메모 한 건을 같은 DB 트랜잭션에서 비공개 `vault_private.note_snapshots`에 revision 1로 보관합니다. 이후 수정·삭제로 사본을 덮어쓰지 않습니다.
4) 복원 대상 ID: SQL 재현용 가상 B 메모 **`b6000000-0000-4000-8000-000000000010`**. 심판 실행에서는 그 실행의 B 생성 응답 ID가 대상입니다.
5) 복원 시 사본을 다시 읽어 **ID·소유자·내용 해시**를 확인하고(없음·해시 불일치·소유자 불일치면 중단), 대상 한 건만 되돌린 뒤 DB에서 다시 읽어 세 값이 사본과 같은지 대조합니다. 다르면 예외로 트랜잭션을 롤백합니다. 다른 메모는 바꾸지 않고, 기존 감사 기록은 보존하며 복원 성공 기록만 추가합니다. API는 `{ id, restored, revision, contentHash }`만 반환하고 형식이 틀리면 502로 거부합니다. 본문·소유자·토큰은 반환하지 않습니다.
6) 실제 DB 시험(`scripts/verify-restore-db.sql`, 2026-11-06 Supabase 실행): 가상 B 한 건의 **변조 복구·삭제 복구 PASS**, ID·소유자·내용 해시 일치, 잘못된 해시·소유자·대상 거부, 다른 메모와 기존 감사 기록 불변, 시험 변경 롤백. 재조회 결과 기존 메모 5건, 사본·감사 0건, 시험 대상 없음. 결과: `verification/step10-db.json`.

## 3. 복구 뒤 1~9단계 재시험 순서

`npm run test:recovery` 한 줄로 아래 순서를 실행하고 `verification/step10.json`, `verification/latest.json`에 기록합니다.

1. 안전 정책 백업 → 시험 사본 변조 → 차이 확인 → 해시 재검증 후 복원 → 사본과 재대조
2. `node --test test/*.test.mjs` — 정상: A 본인 메모 CRUD, 서명된 B 한 건 복원. 거부: 미등록 기기(6), 복합 이상 재인증 없이 접근(7), 전체 목록·쿼리 우회·공지 쓰기(8), B의 A 메모 GET/PUT/DELETE(4·8), 위조 서명·소유자·경로(3·5·10), 120건 초과 조회(9)
3. `npm run decider:test` — 복원된 판정기의 정상 허용·미등록 거부·재인증
4. `npm run fixture:7` — 정상 allow / 복합 이상 step_up
5. `npm run detect:test` — 10분 120건 경계·다른 주체·분산 사건
6. `npm run build -- --local`

10단계 재검증 당시 결과: 회귀 **38/38 PASS**, 판정기 4/4, fixture 2종, 탐지 6/6, 빌드 PASS (로컬·모의). 운영 엔진을 거친 재공격과 실제 서명된 B의 HTTP 왕복은 **미실행**입니다. 대표 시나리오 목록은 `docs/TEST_MATRIX.md`.

## 보존한 다른 기능 (12단계 작업분, XDR)

- 12단계: 로그인한 사용자의 메모·백업·복원 건수만 서버에서 집계하는 작전실. 본문·계정 ID·토큰은 반환하지 않습니다.
- XDR 6종: 가상 경보 158건 block/alert/record 53/52/53, 정상 이벤트 차단 0건(로컬 검토). 운영 엔진 연결이 없으면 차단 집행을 표시하지 않습니다. 각 `xdr/*/README.md` 참고.

## 되돌리기

코드 변경은 저장점 diff를 확인하고 필요한 커밋만 되돌린 뒤 재배포합니다. `git reset --hard`와 전체 DB 복원은 쓰지 않습니다. 신원·기기·경로 검증 기반은 **ALEPH SDP 엔진**입니다.
