# BYTE BACK 방어전 R5 — 2단계

현재 단계: 자료를 코드 밖으로 옮깁니다. 1단계의 공개 메모 정적 파일을 제거하고 빌드에서 재생성하지 않습니다.

- `/`: 공개 메모 없는 자료실 안내 페이지
- `/data.json`: 배포 결과물에서 제거 (404 또는 비공개 응답 확인 필요)
- `/aleph.json`: Vercel 빌드에서 저장소·커밋·배포 정보를 기록
- `npm run build -- --local`: 로컬 빌드 (배포/심판 판정이 아님)

별도로 제공된 `step2_supabase_notes.sql`을 학습용 Supabase SQL Editor에서 실행해야 메모 네 건이 DB에 삽입됩니다. `owner_id`는 UUID이며 `auth.users` 외래키가 없습니다. RLS가 활성화되고 anon/authenticated에게 SELECT 권한은 없습니다. 실제 학생 자료나 키는 사용하지 마세요.

주의: GitHub 과거 커밋과 과거 Vercel 배포에는 공개 가상 메모가 남아 있을 수 있습니다. 다른 단계의 예제와 코드는 보존합니다. `AGENTS.md`의 규칙을 따릅니다.
