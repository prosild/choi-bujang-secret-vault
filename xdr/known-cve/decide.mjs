// Fixture-specific evidence rules. No IO, imports, or calls to other services.
const PATTERNS = [
  {
    "name": "remote_lookup_payload",
    "conditions": "요청 URL 또는 user-agent에 완전한 jndi 원격 조회 형태",
    "evidence": "Apache Log4j CVE-2021-44228: 공격자 제어 JNDI 조회가 위험한 입력 형태.",
    "source": "https://logging.apache.org/log4j/2.x/security.html"
  },
  {
    "name": "cve_reference_without_payload",
    "conditions": "CVE·jndi 언급, 도구 흔적 또는 잘린 조회 형태만 있으면 알림",
    "evidence": "MITRE T1190의 취약점 악용과 단순 문서 열람을 구분; 언급만으로 차단하지 않음.",
    "source": "https://attack.mitre.org/techniques/T1190/"
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
  const inputs = [data.url, data.useragent].filter(v => typeof v === 'string').map(v => v.slice(0,8192)).join(' ');
  if (/\$\{jndi:(?:ldap|ldaps|rmi|dns):\/\/[^\s}]+\}/i.test(inputs)) return result(.97, 'remote_lookup_payload');
  if (/CVE-|jndi|취약점|중괄호|점검 도구|라이브러리|조회 형태/i.test(description + ' ' + inputs)) return result(.6, 'cve_reference_without_payload');
  return result(.1, 'no_matching_pattern');
}
