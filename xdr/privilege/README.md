# XDR privilege

1) 실행: `npm run xdr:run -- privilege`. 읽기 확인: `node xdr/privilege/read-alerts.mjs`.
2) 패턴 근거와 자체 임계값은 patterns.json에 기록했습니다. decide.mjs는 단독 실행하며 다른 파일·네트워크를 사용하지 않습니다. 원본 경보와 ID 순서를 판정 기준으로 사용하지 않습니다.
3) respond.mjs는 block 후보만 만료 15분의 규칙으로 연결하고 알림을 xdr/alerts.log에 추가합니다. 기존 판정기는 유지합니다. 서버가 검증한 주체·기기 연결이 없으면 unbound_candidate로 남고 차단을 실행했다고 표시하지 않습니다.
4) 가상 경보의 정상 이벤트 차단 0건, 만료 후 허용·다른 주체 허용을 로컬 테스트에서 확인했습니다. 실제 운영 엔진 연결과 심판 평가는 미실행입니다.
