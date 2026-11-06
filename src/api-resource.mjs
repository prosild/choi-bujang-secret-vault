// Vercel의 동적 경로 변수와 URL이 일치해야 합니다. 쿼리 문자열로 자원을 고르지 않습니다.
export function resourcePath(request, resource) {
  if (!request.url) return true; // 직접 호출하는 기존 서버 단위 검사
  let url;
  try { url = new URL(request.url, 'https://local.invalid'); } catch { return false; }
  const id = request.query?.id;
  const expected = id === undefined ? `/api/${resource}` : `/api/${resource}/${id}`;
  if (url.pathname !== expected || !Object.keys(request.query ?? {}).every(key => key === 'id')) return false;
  // Vercel may copy the matched dynamic segment into the query string.
  // It cannot choose a different resource or operation: the path ID must agree.
  const entries = [...url.searchParams.entries()];
  return entries.length === 0 || id !== undefined && entries.length === 1
    && entries[0][0] === 'id' && entries[0][1] === id;
}
