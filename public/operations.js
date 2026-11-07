import { deviceFetch } from '/device.js';
import { runLiveMatrix } from '/live-matrix.js';
const state = document.querySelector('#operations-status');
const list = document.querySelector('#operations-list');
const refresh = document.querySelector('#operations-refresh');
const runButton = document.querySelector('#matrix-run');
const saveButton = document.querySelector('#matrix-save');
const matrixStatus = document.querySelector('#matrix-status');
const matrixSummary = document.querySelector('#matrix-summary');
const table = document.querySelector('#matrix-table');
const events = document.querySelector('#matrix-events');
let version = 0, approved = false, lastRun = null;
const SOURCE = { server_record: '서버 기록 실측', local_test: '저장소 자동 검사 (실측 아님)', not_connected: '미연결·미실행' };
const when = value => (value ? new Date(value).toLocaleString('ko-KR') : '기록 없음');
function item(title, value) {
  const li = document.createElement('li'), name = document.createElement('strong'), text = document.createElement('span');
  name.textContent = title; text.textContent = value; li.append(name, text); return li;
}
async function update() {
  const current = ++version; refresh.disabled = true; list.replaceChildren();
  state.textContent = '서버 기록을 확인하는 중입니다.';
  try {
    const response = await deviceFetch('/api/operations');
    if (current !== version) return;
    const problem = response.ok ? null : await response.clone().json().catch(() => ({}));
    if (String(problem?.error).startsWith('DEVICE_')) { state.textContent = '이 기기가 서버 승인을 받은 뒤 작전실 기록을 볼 수 있습니다.'; return; }
    if (response.status === 401) { state.textContent = '로그인하면 내 자료의 저장·복원 기록을 확인할 수 있습니다.'; return; }
    if (!response.ok) throw Error('summary_unavailable');
    const data = await response.json(); if (current !== version) return;
    const { rules, detection, revocation, recovery } = data.summary;
    list.append(
      item(`판정기 규칙 · ${SOURCE[rules.source]}`, `${rules.ids.join(' · ')} — 자동 검사 ${rules.localTests} (${when(data.validation.checkedAt)}) · 엔진 판정 기록 ${SOURCE[rules.engineDecisions]}`),
      item(`탐지 사건 · ${SOURCE[detection.source]}`, `${detection.rule} — 자동 검사 ${detection.localTests} · 실제 사건 수집 ${SOURCE[detection.liveEvents]}`),
      item(`회수 상태 · ${SOURCE[revocation.source]}`, `승인 기기 ${revocation.activeDevices}대 (${revocation.devices.map(d => `${d.id}${d.current ? '(이 기기)' : ''} ${when(d.approvedUntil)}까지`).join(', ') || '없음'}) · 기기 승인 회수 ${revocation.revocations}건 (마지막 ${when(revocation.lastRevokedAt)}) · 엔진 접속 회수 ${SOURCE[revocation.engineRevocation]}`),
      item(`복구 버전 · ${SOURCE[recovery.source]}`, `백업 ${recovery.snapshots}건 · 복원 ${recovery.restores}건 · 마지막 복원 버전 ${recovery.lastRestoreRevision ?? '기록 없음'} (${when(recovery.lastRestoreAt)})`),
      item('서버 저장 · 서버 기록 실측', `내 메모 ${data.counts.ownedNotes}건 (본문은 표시하지 않음)`),
      item('심판 총공세', '결과 없음 (미실행) — 아래 자체 재검사는 심판 판정이 아닙니다'),
    );
    state.textContent = `서버 확인 ${when(data.checkedAt)} · 요청 ${data.requestId} · 커밋 ${(data.commit ?? '확인 불가').slice(0, 7)}`;
  } catch { if (current === version) state.textContent = '서버 기록을 가져오지 못했습니다. 다시 확인해 주세요.'; }
  finally { if (current === version) refresh.disabled = false; }
}
const LABEL = { match: '일치', mismatch: '불일치', error: '요청 오류', not_run: '미실행' };
function addRow(result) {
  table.hidden = false;
  const tr = document.createElement('tr');
  for (const value of [result.no ?? '추가', result.stage, result.kind === 'normal' ? '정상' : '금지',
    result.method ? `${result.method} ${result.path}` : result.name, result.expected ?? '-',
    result.actual === null ? '-' : `${result.actual}${result.error ? ` ${result.error}` : ''}`,
    LABEL[result.status] + (result.reason ? ` (${result.reason})` : ''), result.requestId ?? '-', when(result.at)]) {
    const td = document.createElement('td'); td.textContent = String(value); tr.append(td);
  }
  table.tBodies[0].append(tr);
  const line = document.createElement('li');
  line.textContent = `${result.at} ${result.method ?? ''} ${result.path ?? result.name} → ${result.actual ?? '미실행'}${result.error ? ` ${result.error}` : ''} [${LABEL[result.status]}] ${result.requestId ? `요청 ${result.requestId.slice(0, 8)}` : ''}`;
  events.prepend(line);
  while (events.children.length > 50) events.lastElementChild.remove();
}
runButton.addEventListener('click', async () => {
  // 정상 요청 허용과 금지 요청 거부를 함께 실측해야 하므로, 로그인한 승인 기기에서만 실행합니다.
  if (!approved) { matrixStatus.textContent = '로그인하고 이 기기의 서버 승인을 받은 뒤 실행해 주세요.'; return; }
  runButton.disabled = true; saveButton.disabled = true;
  table.tBodies[0].replaceChildren(); events.replaceChildren(); matrixSummary.replaceChildren();
  matrixStatus.textContent = '재검사 중입니다. 끝날 때까지 이 화면을 닫지 마세요.';
  try {
    const { results, summary } = await runLiveMatrix({ approved, onResult: addRow });
    const identity = await fetch('/aleph.json', { cache: 'no-store' }).then(r => r.json()).catch(() => ({}));
    lastRun = { schema: 'vault.live-matrix.v1', origin: location.origin, commit: identity.commit ?? null,
      runAt: new Date().toISOString(), deviceApproved: approved, summary, results };
    const ul = document.createElement('ul');
    ul.append(
      item('자체 재검사 막음', `${summary.blockedOf41} / 41 — 금지 시나리오를 실측해 모두 기대대로 거부된 재검사표 번호 수 (로컬 검사·미실행은 세지 않음)`),
      item('실측 요약', `정상 요청 허용 ${summary.normalAllowed} · 금지 요청 거부 ${summary.forbiddenBlocked} · 미실행 ${summary.notRun}건`),
      item('재검사표 41종', `실측 일치 ${summary.matrix.liveMatch} · 실측 불일치 ${summary.matrix.liveMismatch} · 일부만 실측 ${summary.matrix.livePartial} · 로컬 검사만 ${summary.matrix.localOnly} · 미실행 ${summary.matrix.notRun}`),
      item('규칙별 거부 수 (실측)', Object.entries(summary.denials).map(([rule, count]) => `${rule} ${count}`).join(' · ') || '없음'),
    );
    matrixSummary.replaceChildren(ul);
    matrixStatus.textContent = `재검사 완료 ${when(lastRun.runAt)} · 커밋 ${(lastRun.commit ?? '확인 불가').slice(0, 7)}`;
    saveButton.disabled = false;
    void update();
  } catch { matrixStatus.textContent = '재검사를 끝내지 못했습니다. 다시 실행해 주세요.'; }
  finally { runButton.disabled = false; }
});
saveButton.addEventListener('click', () => {
  if (!lastRun) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`${JSON.stringify(lastRun, null, 2)}\n`], { type: 'application/json' }));
  link.download = `live-matrix-${lastRun.runAt.replace(/[:.]/gu, '-')}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
refresh.addEventListener('click', update);
window.addEventListener('vault-session-changed', update);
window.addEventListener('vault-device-changed', event => { approved = event.detail?.approved === true; void update(); });
update();
