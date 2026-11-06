const status = document.querySelector('#device-status');
const refresh = document.querySelector('#device-refresh');
const approval = document.querySelector('#device-request');
const network = document.querySelector('#network-status');
const install = document.querySelector('#install-app');
let installPrompt;
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
async function checkDevice() {
  refresh.disabled = true; approval.disabled = true;
  try {
    const response = await fetch('/api/device', { cache: 'no-store' });
    if (response.status === 401) { status.textContent = '로그인 후 기기 상태를 확인해 주세요.'; return; }
    if (!response.ok) throw Error('device_unavailable');
    const data = await response.json();
    if (data.status === 'not_connected') status.textContent = '기기 승인 정보를 아직 연결하지 못했습니다. 승인 요청은 현재 사용할 수 없습니다.';
    else status.textContent = '기기 상태를 확인하지 못했습니다.';
    // Approval is enabled only after an actual, documented engine integration exists.
  } catch { status.textContent = '기기 상태를 불러오지 못했습니다. 연결을 확인하고 다시 눌러 주세요.'; }
  finally { refresh.disabled = false; }
}
refresh.addEventListener('click', checkDevice);
window.addEventListener('vault-session-changed', checkDevice);
approval.addEventListener('click', async () => {
  approval.disabled = true;
  status.textContent = '운영 엔진 연결 후 승인 요청을 사용할 수 있습니다.';
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
checkDevice();
