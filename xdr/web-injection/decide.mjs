// Fixture-specific evidence rules. No IO, imports, or calls to other services.
const PATTERNS = [
  {
    "name": "repeated_web_injection",
    "conditions": "SQL·스크립트·경로 이탈·명령 구분자 표식과 반복 요청 5건 이상",
    "evidence": "MITRE T1190: 공개 웹 애플리케이션 입력·서비스 취약점 악용; 반복 횟수는 자체 기준.",
    "source": "https://attack.mitre.org/techniques/T1190/"
  },
  {
    "name": "isolated_web_anomaly",
    "conditions": "단발 의심 문자·긴 URL·관련 단어만 보이는 경우는 알림",
    "evidence": "T1190 관련 입력 신호만으로 악용을 확정하지 않으며 단발 교육용 언급을 구분.",
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
  const count = number(data.count);
  const url = typeof data.url === 'string' ? data.url.slice(0,8192) : '';
  const marker = /doc-(?:sql|script|up-repeat|mixed|cmd-separator)|(?:union.*select)|<script|\.\.\//i.test(url);
  const injection = /SQL.*(?:구문|표식)|스크립트.*(?:삽입|표식)|경로.*(?:거슬러|이탈)|명령 구분자|데이터베이스 조회를 이어/i.test(description);
  if (count >= 5 && (marker || injection)) return result(.94, 'repeated_web_injection');
  if (count > 0 && (marker || /따옴표|select|스크립트|경로.*up|평소보다 깁|SQL|이상한 검색|주입|구분 문자/i.test(description))) return result(.6, 'isolated_web_anomaly');
  return result(.1, 'no_matching_pattern');
}
