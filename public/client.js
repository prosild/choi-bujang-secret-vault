import { currentDevice, deviceFetch } from '/device.js';
const status = document.querySelector('#device-status');
const refresh = document.querySelector('#device-refresh');
const approvalForm = document.querySelector('#device-form');
const approvalPassword = document.querySelector('#device-password');
const network = document.querySelector('#network-status');
const install = document.querySelector('#install-app');
let installPrompt;
let checkVersion = 0;
function connectivity() {
  network.hidden = navigator.onLine;
  network.textContent = navigator.onLine ? '' : '오프라인입니다. 연결이 돌아오면 다시 확인해 주세요.';
}
window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity); connectivity();
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event; install.hidden = false;
});
install.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt(); await installPrompt.userChoice;
  installPrompt = null; install.hidden = true;
});
window.addEventListener('appinstalled', () => { install.hidden = true; });
// 승인 여부는 서버 응답으로만 바뀝니다. 설치·버튼 클릭만으로 승인 상태를 만들지 않습니다.
const announce = approved => window.dispatchEvent(new CustomEvent('vault-device-changed', { detail: { approved } }));
async function checkDevice() {
  const current = ++checkVersion;
  refresh.disabled = true;
  try {
    const response = await deviceFetch('/api/device');
    if (current !== checkVersion) return;
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && data.error === 'UNAUTHORIZED') {
      approvalForm.hidden = true; status.textContent = '로그인 후 이 기기의 승인 상태를 확인합니다.'; return announce(false);
    }
    if (!response.ok) throw Error('device_unavailable');
    if (data.status === 'approved') {
      approvalForm.hidden = true;
      status.textContent = `이 기기(${data.deviceId})는 서버 승인 기기입니다 · ${new Date(data.expiresAt).toLocaleString('ko-KR')}까지`;
      return announce(true);
    }
    approvalForm.hidden = !data.canRequestApproval;
    status.textContent = `이 기기(${data.deviceId})는 아직 승인되지 않았습니다. 승인 전에는 자료를 표시하지 않습니다.`
      + (data.canRequestApproval ? ' 비밀번호를 다시 확인하면 서버가 이 기기를 승인합니다.' : '');
    announce(false);
  } catch {
    if (current === checkVersion) { status.textContent = '기기 상태를 불러오지 못했습니다. 연결을 확인하고 다시 눌러 주세요.'; announce(false); }
  } finally { if (current === checkVersion) refresh.disabled = false; }
}
refresh.addEventListener('click', checkDevice);
window.addEventListener('vault-session-changed', checkDevice);
approvalForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = approvalForm.querySelector('button');
  button.disabled = true;
  status.textContent = '서버에 승인을 요청하는 중입니다.';
  try {
    const { publicKey } = await currentDevice();
    const response = await deviceFetch('/api/device', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey, password: approvalPassword.value }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.status === 'approved') await checkDevice();
    else status.textContent = data.error === 'PASSWORD_RECHECK_FAILED' ? '비밀번호가 맞지 않아 승인하지 않았습니다.'
      : data.error === 'TOO_MANY_ATTEMPTS' ? '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' : '서버가 이 기기를 승인하지 않았습니다.';
  } catch { status.textContent = '승인 요청에 실패했습니다. 연결을 확인해 주세요.'; }
  finally { approvalPassword.value = ''; button.disabled = false; }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
checkDevice();
