// Vercel의 동적 경로 변수와 URL이 일치해야 합니다. 쿼리 문자열로 자원을 고르지 않습니다.
export function resourcePath(request, resource) {
  if (!request.url) return true; // 직접 호출하는 기존 서버 단위 검사
  let url;
  try { url = new URL(request.url, 'https://local.invalid'); } catch { return false; }
  if (url.search) return false;
  const id = request.query?.id;
  const expected = id === undefined ? `/api/${resource}` : `/api/${resource}/${id}`;
  return url.pathname === expected && Object.keys(request.query ?? {}).every(key => key === 'id');
}
