// 접속 앱의 기기 키와 서명 요청.
// 개인키는 내보낼 수 없는(extractable: false) CryptoKey로 이 페이지의 메모리에만 있습니다.
// localStorage·sessionStorage·IndexedDB·쿠키에 기기 키를 저장하지 않으므로, 새로고침하면 새 기기 키가 만들어지고
// 다시 서버 승인을 받아야 합니다. 승인 여부는 서버 기록으로만 정해집니다.
const VERSION = 'vault-device-v1';
const encoder = new TextEncoder();
let devicePromise;

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async text => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

async function createDevice() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const publicKey = { kty, crv, x, y };
  const id = (await sha256Hex(JSON.stringify({ crv, kty, x, y }))).slice(0, 16);
  return { id, publicKey, privateKey: keys.privateKey };
}

export function currentDevice() {
  devicePromise ??= createDevice();
  return devicePromise;
}

// 메서드·경로·본문 해시·시각·임의값·기기 ID에 서명합니다. 경로나 본문이 바뀌면 서버 검증이 실패합니다.
export async function deviceFetch(path, { method = 'GET', headers = {}, body } = {}) {
  const device = await currentDevice();
  const target = new URL(path, location.origin);
  const time = String(Date.now());
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const text = typeof body === 'string' ? body : '';
  const data = [VERSION, method, target.pathname, await sha256Hex(text), time, nonce, device.id].join('\n');
  const signature = b64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, device.privateKey, encoder.encode(data)));
  return fetch(target.pathname, { method, body, cache: 'no-store', headers: { ...headers,
    'X-Vault-Device': device.id, 'X-Vault-Time': time, 'X-Vault-Nonce': nonce, 'X-Vault-Signature': signature } });
}
