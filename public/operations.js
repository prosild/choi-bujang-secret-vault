import { deviceFetch } from '/device.js';
const state = document.querySelector('#operations-status');
const list = document.querySelector('#operations-list');
const refresh = document.querySelector('#operations-refresh');
let version = 0;
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
    const counts = data.counts;
    const entries = [
      ['서버 저장', `내 메모 ${counts.ownedNotes}건 · 백업 ${counts.snapshots}건`],
      ['복원 기록', `${counts.restores}건 · 마지막 정책 버전 ${counts.lastRestoreRevision ?? '기록 없음'}`],
      ['접속 기기', `서버 승인 기기 ${data.device.id} · ${new Date(data.device.approvedUntil).toLocaleString('ko-KR')}까지`],
      ['적용 규칙', data.policyRules.join(' · ')],
      ['자동 검사', data.validation.status === 'PASS'
        ? `로컬·모의 검사 ${data.validation.tests.passed}건 통과 (${data.validation.checkedAt})` : '검사 기록 없음'],
      ['운영 엔진', 'ALEPH SDP 엔진의 기기 승인·접속 회수·XDR 차단 연동 미완료 (자료실 서버 승인은 별도)'],
      ['심판 판정', '이번 변경은 미제출 · 점수 미확인'],
    ];
    for (const [title, value] of entries) {
      const item = document.createElement('li'), name = document.createElement('strong'), text = document.createElement('span');
      name.textContent = title; text.textContent = value; item.append(name, text); list.append(item);
    }
    state.textContent = `서버 확인 ${new Date(data.checkedAt).toLocaleString('ko-KR')} · 요청 ${data.requestId}`;
  } catch { if (current === version) state.textContent = '서버 기록을 가져오지 못했습니다. 다시 확인해 주세요.'; }
  finally { if (current === version) refresh.disabled = false; }
}
refresh.addEventListener('click', update);
window.addEventListener('vault-session-changed', update);
window.addEventListener('vault-device-changed', update);
update();
