# BYTE BACK 방어전 R5 — 2단계

현재 단계: 자료를 코드 밖으로 옮깁니다. 학습용 가상 메모는 Supabase `public.study_notes`에 보관합니다.

- `/`: 화면이 `/api/notes`를 호출하여 가상 메모 4건을 카드로 표시합니다.
- `/api/notes`: Vercel 서버 함수가 `SUPABASE_URL`과 서버 전용 `SUPABASE_SECRET_KEY`를 환경변수에서 읽습니다. 서버에서 Supabase를 조회하며 제목·본문만 반환합니다.
- `/data.json`: 생성하지 않습니다. 빌드도 오래된 `public/data.json`을 제거합니다. 새 배포에서 404 또는 메모 없는 응답을 확인합니다.
- `/aleph.json`: Vercel의 저장소·커밋·배포 URL을 빌드할 때 생성합니다. `aleph.config.json`은 `step: 2`입니다.

**현재 약점:** `/api/notes`는 아직 로그인이나 권한 검사가 없는 **공개 주소**입니다. 서버 전용 키는 브라우저에 노출되지 않지만 이 API를 비로그인으로 호출하면 네 메모의 제목·본문을 읽을 수 있습니다. 이것은 다음 단계에서 해결할 문제이며 보호 완료로 보고하면 안 됩니다.

## 실행 및 확인

1. Supabase SQL Editor에서 학습용 메모 4건과 RLS를 확인합니다. `anon` 및 `authenticated`에는 SELECT 권한을 부여하지 않습니다.
2. Vercel 프로젝트의 Settings → Environment Variables에서 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 **서버 환경변수**로 직접 설정합니다. 값을 Git, 브라우저 코드, 로그, 답변에 입력하지 않습니다. 설정 후 Production으로 재배포합니다.
3. 화면에 네 카드가 나타나고 `/data.json`이 메모를 반환하지 않는지 확인합니다. `/aleph.json`에서 실제 저장소와 커밋을 대조합니다. `/api/notes`는 공개라는 사실을 유지하고, 심판 확인을 대신하지 않습니다.
4. 로컬 정적 빌드: `npm run build -- --local`. 실제 Vercel 함수 동작은 이 명령으로 검증되지 않습니다.

실제 학생 자료와 비밀키는 코드·Git·제출물에 넣지 않습니다. `AGENTS.md` 규칙을 따르며 다른 단계의 예제는 보존합니다. 과거 커밋이나 과거 배포에는 가상 메모가 남아 있을 수 있습니다.
