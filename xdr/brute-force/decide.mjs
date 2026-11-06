// Fixture-specific evidence rules. No IO, imports, or calls to other services.
const PATTERNS = [
  {
    "name": "repeated_login_failure",
    "conditions": "로그인 실패가 15회 이상이거나 8개 이상 계정에 반복되는 비밀번호 추측",
    "evidence": "MITRE T1110: 반복적인 암호 추측 및 여러 계정에 대한 password spraying.",
    "source": "https://attack.mitre.org/techniques/T1110/"
  },
  {
    "name": "limited_login_failure",
    "conditions": "3~14회 실패는 추가 확인, 성공 1회·단발 오타는 기록",
    "evidence": "MITRE T1110의 반복 추측을 구분하기 위한 자체 관찰 임계값이며 공격 확정값이 아님.",
    "source": "https://attack.mitre.org/techniques/T1110/"
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
  const count = number(data.count);
  const failures = /실패|비밀번호.*(?:연속|반복)|password.*(?:guess|spray)|failed.*login/i.test(description);
  const accounts = typeof data.accounts === 'string' ? new Set(data.accounts.split(',').filter(Boolean)).size : 0;
  if (failures && (count >= 15 || accounts >= 8)) return result(.95, 'repeated_login_failure');
  if (failures && (count >= 3 || accounts >= 2)) return result(.65, 'limited_login_failure');
  return result(.1, 'no_matching_pattern');
}
