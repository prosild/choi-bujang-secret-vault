// 신원·기기·경로 검증은 ALEPH SDP 엔진이 담당합니다.
// 브라우저의 임의 헤더나 추가 필드를 신뢰하지 않습니다.
export const RULE_IDS = Object.freeze(['device_registered']);

export async function decide(request) {
  const registered = request?.deviceRegistered === true;
  return {
    schema: 'aleph.decision.v1',
    requestId: request?.requestId,
    decision: registered ? 'allow' : 'deny',
    reasonCode: registered ? 'approved' : 'device_not_registered',
    ruleIds: ['device_registered'],
  };
}
