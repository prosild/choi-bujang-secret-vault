// 신원·기기·경로 검증은 ALEPH SDP 엔진이 담당합니다.
// 브라우저의 임의 헤더나 추가 필드를 신뢰하지 않습니다.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required']);

function needsStepUp(request) {
  const signals = request.signals;
  // 현재 실제 엔진은 위치·네트워크 자료를 제공하지 않습니다. 미상은 정상 증거가 아닙니다.
  const known = signals?.source === 'judge_fixture'
    && ['local', 'foreign'].includes(signals.region)
    && ['usual', 'unusual'].includes(signals.network)
    && Number.isInteger(signals.hour) && signals.hour >= 0 && signals.hour <= 23;
  if (!known) return true;
  const overnight = signals.hour < 6 || signals.hour >= 23;
  const burst = Array.isArray(request.recentEvents) && request.recentEvents.some(event =>
    ['risk_signal', 'burst_read'].includes(event?.kind)
    && Number.isFinite(event.ageSeconds) && event.ageSeconds >= 0 && event.ageSeconds <= 600
    && Number.isInteger(event.count) && event.count >= 20);
  return overnight && signals.network === 'unusual' && burst;
}

export async function decide(request) {
  const registered = request?.deviceRegistered === true;
  const fresh = request?.stepUp?.verified === true
    && Number.isFinite(request.stepUp.authAgeSeconds)
    && request.stepUp.authAgeSeconds >= 0 && request.stepUp.authAgeSeconds <= 300;
  const additional = registered && needsStepUp(request) && !fresh;
  return {
    schema: 'aleph.decision.v1',
    requestId: request?.requestId,
    decision: !registered ? 'deny' : additional ? 'step_up' : 'allow',
    reasonCode: !registered ? 'device_not_registered' : additional ? 'step_up_required' : 'approved',
    ruleIds: !registered ? ['device_registered'] : ['device_registered', 'step_up_required'],
  };
}
