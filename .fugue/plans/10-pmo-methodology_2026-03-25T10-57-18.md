# PMO Methodology Integration — fugue 요구사항

> 도메인: PMO 방법론 체계 반영 | 항목 수: 20건
> 출처: ~/Documents/pmo/methodology/ (ch01~ch16)

## 핵심 원칙
- PMO = 납품/보고 체계. 산출물이 "완성됨"을 판정하고 요청자에게 정식 납품.
- 프로젝트 사이즈에 따라 방법론 무게가 달라짐 (XS는 가볍게, XL은 풀세트)
- 사이즈가 커지면 자동 감지 → 다음 방법론으로 업그레이드

| ID | Title | Priority | Status | Description | Source |
|---|---|---|---|---|---|
| FR-200 | T-shirt Sizing 진단 | HIGH | TODO | init 시 프로젝트 규모 판정 (XS/S/M/L/XL). REQ 수, LOC, 에이전트 수 기반 | ch02 |
| FR-201 | 규모별 방법론 매핑 | HIGH | TODO | XS=최소 산출물, M=Crosscheck 필수, XL=풀 감리. 자동 적용 | ch02+ch13 |
| FR-202 | 사이즈 모니터링 + 업그레이드 알림 | HIGH | TODO | REQ/LOC 증가 시 사이즈 재책정. "M→L 전환 필요" 알림 | ch02 |
| FR-203 | 인테이크 프로토콜 4단계 | HIGH | TODO | 소크라테스식 질문 (Why→What→How→Confirm). 프로젝트 딕셔너리 생성 | ch14 |
| FR-204 | Landing Playbook 6단계 | MEDIUM | TODO | Discovery→Sizing→TeamSetup→Spec→Assembly→Execution | ch11 |
| FR-205 | Phase Gate 점수표 | HIGH | TODO | P1→P2: 80점+절대기준. P2→P3: 기능완료+테스트통과 | ch04 |
| FR-206 | Phase 전환 판정 (fugue gate) | HIGH | TODO | Phase Gate 점수 자동 계산 + CEO 승인 요청 | ch04 |
| FR-207 | 3-Phase 라이프사이클 | MEDIUM | TODO | ISP(기획)→SI(구축)→SM(운영) 단계별 PM 역할 전환 | ch01+ch10 |
| FR-208 | Crosscheck Loop 전체 8단계 | HIGH | TODO | SUBMIT→AUDIT→REWORK→SYNC→ACK→RESOLVE→ESCALATE→GATE PASS | ch15 |
| FR-209 | 에스컬레이션 프레임워크 | MEDIUM | TODO | CEO 4대 영역 + PM 5 Guards + 자동 에스컬레이션 트리거 | ch16 |
| FR-210 | 에이전트 5차원 퍼포먼스 | MEDIUM | TODO | D1완수율+D2품질+D3SLA+D4효율+D5협업 = 종합점수 | ch09 |
| FR-211 | 에이전트 용량 관리 | MEDIUM | TODO | 컨텍스트 예산제. Task당 1500줄 제한. 도메인당 30K LOC | ch07 |
| FR-212 | 디자인 패턴 카탈로그 | MEDIUM | TODO | 프로젝트 유형(NB/LR/FA/PL) × 규모 = 패턴 자동 선정 | ch13 |
| FR-213 | CSR 프로세스 (변경요청) | MEDIUM | TODO | Cat-1(PM승인) / Cat-2(CEO승인) / Cat-3(수용불가) | ch10 |
| FR-214 | 산출물 납품 판정 | HIGH | TODO | 산출물 세트 완성 → Gate PASS → 요청자에게 정식 납품 | ch05 |
| FR-215 | 납품 리포트 생성 | HIGH | TODO | 산출물 목록 + Gate 결과 + 추적성 커버리지 = 납품 보고서 | pmo-reporting |
| FR-216 | PMO 독립 감사 체크리스트 | MEDIUM | TODO | Phase Gate 시 PMO가 독립 감사. 산출물 완성도 5항목 | pmo-reporting |
| FR-217 | 정기 보고 (주간/격주) | MEDIUM | TODO | PM→PMO 정기 보고. 진행률+이슈+리스크 | pmo-reporting |
| FR-218 | ANDON/HANDOFF/VOICE 프로토콜 | HIGH | TODO | 에이전트 간 판단요청/인수인계/피드백 정식 구현 | ch16+agent-protocol |
| FR-219 | 정책 이탈 프로토콜 | MEDIUM | TODO | 에이전트 자의 판단 금지. 정의서 벗어나면 자동 ANDON | ch05 |
