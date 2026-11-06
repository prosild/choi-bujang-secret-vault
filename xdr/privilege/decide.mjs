// Fixture-specific evidence rules. No IO, imports, or calls to other services.
const PATTERNS = [
  {
    "name": "suspicious_admin_transition",
    "conditions": "관리자 그룹 추가·새 관리자 명령에 원격/처음 보는 주소·시간 이탈·반복·다른 계정 권한이 결합",
    "evidence": "MITRE T1068/T1078: 권한 상승 및 유효 계정 권한 악용; 단순 관리 업무와 구분.",
    "source": "https://attack.mitre.org/techniques/T1068/",
    "additionalSource": "https://attack.mitre.org/techniques/T1078/"
  },
  {
    "name": "unconfirmed_privilege_change",
    "conditions": "단발 권한 요청·취소·일반 그룹 변경·명령 실패는 알림",
    "evidence": "T1078 관련 계정 변경만으로 악용을 확정하지 않음.",
    "source": "https://attack.mitre.org/techniques/T1078/"
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
  const admin = data.group === 'administrators' || /관리자 명령|관리자 권한|방금 관리자/.test(description);
  const context = /원격|처음 보는|처음 봅니다|곧바로|방금 관리자|다른 계정의 권한|업무처럼 보이지|다시 관리자로/.test(description)
    || (data.group === 'administrators' && number(data.count) >= 3);
  const negative = /아닙니다|취소|실패|변경은 없습니다/.test(description);
  if (admin && context && !negative) return result(.94, 'suspicious_admin_transition');
  if (number(alert?.rule?.level) >= 5 && /권한|관리자|계정 종류|그룹/.test(description)) return result(.6, 'unconfirmed_privilege_change');
  return result(.1, 'no_matching_pattern');
}
