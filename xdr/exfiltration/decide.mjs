// Fixture-specific evidence rules. No IO, imports, or calls to other services.
const PATTERNS = [
  {
    "name": "large_unusual_transfer",
    "conditions": "50MB 이상 전송에 새 목적지·시간 이탈·반복·다수 파일·명령 통로가 결합",
    "evidence": "MITRE T1041/T1048: C2 또는 대체 프로토콜을 통한 자료 전송; 용량 기준은 자체 기준.",
    "source": "https://attack.mitre.org/techniques/T1041/",
    "additionalSource": "https://attack.mitre.org/techniques/T1048/"
  },
  {
    "name": "unconfirmed_transfer",
    "conditions": "소규모 새 목적지·압축 준비·일회성 용량 증가·실패 전송은 알림",
    "evidence": "T1041/T1048 관련 징후를 기록하되 평소 자료실의 작은 정상 요청은 차단하지 않음.",
    "source": "https://attack.mitre.org/techniques/T1048/"
  }
];
const number = value => { const n = typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN; return Number.isFinite(n) && n >= 0 ? n : 0; };
function result(confidence, name) {
  const reason = PATTERNS.some(pattern => pattern.name === name) ? name : 'no_matching_pattern';
  return { action: confidence >= .85 ? 'block' : confidence >= .5 ? 'alert' : 'record', confidence, reason };
}
export function decide(alert) {
  const data = alert?.data && typeof alert.data === 'object' ? alert.data : {};
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0,8192) : '';
  const bytes = number(data.bytes);
  const unusual = /처음 보는|시간 밖|쓰지 않던|반복|연속|자료실 전체|명령 통로/.test(description)
    || number(data.count) >= 5 || number(data.files) >= 60;
  if (typeof data.dstip === 'string' && bytes >= 50_000_000 && unusual) return result(.95, 'large_unusual_transfer');
  if (number(alert?.rule?.level) >= 5 && /전송|파일|목적지|주소로|자료 이름/.test(description)) return result(.6, 'unconfirmed_transfer');
  return result(.1, 'no_matching_pattern');
}
