import { randomUUID } from 'node:crypto';

// 12단계: 모든 API 응답에 서버가 만든 요청 ID를 붙여 재검사 표의 실측 결과와 서버 기록을 대조합니다.
export function stampRequest(response) {
  const id = randomUUID();
  response.setHeader('X-Request-Id', id);
  return id;
}
