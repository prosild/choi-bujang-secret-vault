
import { readFile } from 'node:fs/promises';

const checkUrl = (app, path) => new URL(path, app);

async function inspect(url, headers = {}) {
  try {
    const response = await fetch(url, {
      redirect: 'error',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      // JSON이 아니거나 본문이 없을 수 있습니다.
    }

    return { status: response.status, body };
  } catch (error) {
    return {
      status: null,
      error: error?.message ?? '요청 실패',
    };
  }
}

export async function runAttackChecks(config) {
  if (![2, 3, 4, 5].includes(config.step)) {
    throw new Error('이 공격 점검은 2~5단계 전용입니다.');
  }

  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error(
      'aleph.config.json의 실제 배포 주소를 확인해 주세요.'
    );
  }

  if (
    app.protocol !== 'https:' ||
    app.username ||
    app.password ||
    app.search ||
    app.hash ||
    app.pathname !== '/' ||
    app.hostname.endsWith('.example')
  ) {
    throw new Error(
      'aleph.config.json의 실제 배포 주소를 확인해 주세요.'
    );
  }

  const data = await inspect(checkUrl(app, '/data.json'));
  const api = await inspect(checkUrl(app, '/api/notes'));

  const marker = config.sampleMarker;
  const dataExposed =
    data.body?.sampleMarker === marker &&
    Array.isArray(data.body?.notes) &&
    data.body.notes.length > 0;

  const apiExposed =
    api.status === 200 &&
    Array.isArray(api.body?.notes) &&
    api.body.notes.length > 0 &&
    api.body.notes.some(
      (note) =>
        typeof note?.title === 'string' &&
        (typeof note?.content === 'string' || typeof note?.body === 'string')
    );

  const attempts = [
    {
      attackId: 'anonymous_static_note_read',
      expected: '비로그인 요청에서 /data.json의 가상 메모가 노출되지 않아야 함',
      observed:
        data.status === null
          ? `요청 실패: ${data.error}`
          : dataExposed
            ? `가상 메모 확인 표시 노출 (HTTP ${data.status})`
            : `확인 표시 노출 없음 (HTTP ${data.status})`,
    },
    {
      attackId: 'anonymous_api_note_read',
      expected: '비로그인 요청에서 /api/notes의 메모 본문을 읽을 수 없어야 함',
      observed:
        api.status === null
          ? `요청 실패: ${api.error}`
          : apiExposed
            ? `공개 API 약점 잔존: 비로그인 메모 열람 가능 (HTTP ${api.status})`
            : [401, 403].includes(api.status) && typeof api.body?.error === 'string'
              ? `JSON 오류로 비로그인 요청 거부 (HTTP ${api.status})`
              : `비로그인 메모 열람 미확인; 요청 거부 여부 별도 확인 필요 (HTTP ${api.status})`,
    },
  ];
  if (config.step === 5) {
    const original = new URL(config.originalApiUrl);
    const issuer = new URL(config.identityProvider.issuer);
    if (original.protocol !== 'https:' || original.origin !== issuer.origin
        || original.pathname !== '/rest/v1/study_notes' || original.search || original.hash
        || original.username || original.password) {
      throw new Error('원본 자료 API 주소를 확인해 주세요.');
    }
    const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
    const key = html.match(/['"](sb_publishable_[A-Za-z0-9_-]+)['"]/u)?.[1];
    if (key) {
      const result = await inspect(original, { apikey: key });
      attempts.push({
        attackId: 'anonymous_original_note_read',
        expected: '공개 키로 원본 자료를 직접 읽을 수 없어야 함',
        observed: result.status === null ? `요청 실패: ${result.error}`
          : Array.isArray(result.body) ? `배열 응답 ${result.body.length}건 (HTTP ${result.status})`
            : `오류 또는 비배열 응답 (HTTP ${result.status})`,
      });
    }
  }
  return attempts;
}
