// Fixture-specific evidence rules. No IO, imports, or calls to other services.
const PATTERNS = [
  {
    "name": "untrusted_autostart",
    "conditions": "서비스·예약 작업의 임시 실행 파일/서명 부재/반복 등록 또는 미등록 시작 프로그램",
    "evidence": "MITRE T1543/T1053: 서비스·예약 작업을 통한 반복 실행 및 지속성 확보.",
    "source": "https://attack.mitre.org/techniques/T1543/",
    "additionalSource": "https://attack.mitre.org/techniques/T1053/"
  },
  {
    "name": "unconfirmed_autostart_change",
    "conditions": "서명 미확인·단발 작업·설명 변경 등 불완전한 증거는 알림",
    "evidence": "T1543/T1053 관련 변경을 검토하되 서명된 기존 작업과 단순 조회를 차단하지 않음.",
    "source": "https://attack.mitre.org/techniques/T1053/"
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
  const path = typeof data.path === 'string' ? data.path : '';
  const temp = /[\\/]Temp[\\/]/i.test(path);
  const autostart = /서비스|예약 작업|시작 프로그램|시작 폴더/i.test(description);
  const deniedRegistration = /등록은 없습니다|읽기만|실행된 기록은 없습니다/i.test(description);
  const unsigned = /서명 없|서명이 없/i.test(description);
  const unknown = /처음 보는|평소 목록에 없는|임의 문자열|바뀌었/i.test(description);
  const startup = /[\\/]Startup[\\/]/i.test(path) && /평소 목록에 없는/.test(description);
  if (!deniedRegistration && autostart && ((temp && (unknown || unsigned || /함께 가리/.test(description)))
    || (unsigned && number(data.count) >= 3) || startup)) return result(.93, 'untrusted_autostart');
  const routine = /서명된 채|읽기만|기존 예약 작업.*마쳤|업데이트 예약.*그대로/.test(description);
  if (!routine && (autostart || /시작 항목|임시 폴더.*실행 파일/.test(description))
    && (number(alert?.rule?.level) >= 5 || unknown || temp)) return result(.6, 'unconfirmed_autostart_change');
  return result(.1, 'no_matching_pattern');
}
