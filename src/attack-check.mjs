
const checkUrl = (app, path) => new URL(path, app);

async function inspect(url, headers = {}, method = 'GET') {
  try {
    const response = await fetch(url, {
      redirect: 'error',
      headers,
      method,
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
  if (!Number.isInteger(config.step) || config.step < 2 || config.step > 12) {
    throw new Error('이 공격 점검은 2~12단계 전용입니다.');
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
  if (config.step >= 5) {
    const original = new URL(config.originalApiUrl);
    const issuer = new URL(config.identityProvider.issuer);
    if (original.protocol !== 'https:' || original.origin !== issuer.origin
        || original.pathname !== '/rest/v1/study_notes' || original.search || original.hash
        || original.username || original.password) {
      throw new Error('원본 자료 API 주소를 확인해 주세요.');
    }
    // This is the project's public key; it is used only by this server-side self-check.
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_QdAl9tMSE8PtVL5YhFjzmw_IUtYENXz';
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
  if (config.step >= 6) {
    const { decide, RULE_IDS } = await import('./decider.mjs');
    const { checkDecider } = await import('../scripts/decider-test.mjs');
    const results = await checkDecider({ decide, ruleIds: RULE_IDS });
    attempts.push({ attackId: 'local_decider_contract',
      expected: '가상 정상 요청 허용 및 미등록 기기 거부; 심판 판정과 별도',
      observed: `가상 요청 ${results.filter(item => item.passed).length}/${results.length} 통과` });
  }
  if (config.step >= 10) {
    if (config.restoreRoute !== '/api/restore') throw new Error('복원 경로 설정을 확인해 주세요.');
    for (const [method, expectedStatus] of [['GET', 405], ['POST', 401]]) {
      const result = await inspect(checkUrl(app, config.restoreRoute), {}, method);
      attempts.push({ attackId: `anonymous_restore_${method.toLowerCase()}`,
        expected: `${method} 복원 요청이 HTTP ${expectedStatus} JSON 오류로 거부되어야 함`,
        observed: result.status === null ? `요청 실패: ${result.error}`
          : `HTTP ${result.status}; JSON 오류 ${typeof result.body?.error === 'string' ? '있음' : '없음'}; `
            + (result.status === expectedStatus && typeof result.body?.error === 'string' ? '기대와 일치' : '추가 확인 필요') });
    }
    // 사전 백업 재검증·변조 백업 거부·복구 후 재시험을 이번 실행에서 실제로 돌린 결과입니다.
    const { runRecoveryEvidence } = await import('../scripts/recovery-evidence.mjs');
    attempts.push(...await runRecoveryEvidence());
  }
  return attempts;
}
