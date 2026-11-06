// docs/DETECT_EVENTS.md의 검증된 사건만 받는 순수 탐지 함수입니다.
// 제안은 실제 엔진의 회수 집행을 대신하지 않습니다.
export function detect(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');
  const groups = new Map();
  for (const event of events) {
    const subject = event?.identity?.sub;
    if (event?.method !== 'GET' || typeof subject !== 'string' || !subject.trim()
        || typeof event.at !== 'string') continue;
    const time = Date.parse(event.at);
    if (!Number.isFinite(time)) continue;
    if (!groups.has(subject)) groups.set(subject, []);
    groups.get(subject).push(time);
  }
  for (const [subject, times] of groups) {
    times.sort((a, b) => a - b);
    let start = 0;
    for (let end = 0; end < times.length; end++) {
      while (times[end] - times[start] > 600_000) start++;
      if (end - start + 1 > 120) return { action: 'propose_revocation', reasonCode: 'burst_read', subject };
    }
  }
  return { action: 'observe' };
}
