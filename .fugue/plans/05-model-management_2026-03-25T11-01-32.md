# Model Management — fugue 요구사항

> 도메인: 모델 레지스트리 + conductor + aiops + 토큰 | 항목 수: 14건

| ID | Title | Priority | Status | Description |
|---|---|---|---|---|
| FR-040 | model add | HIGH | DONE | 대화형 프리셋 + 구독/API |
| FR-041 | model list | HIGH | DONE | 등록 모델 + conductor 표시 |
| FR-042 | model remove | MEDIUM | DONE | 모델 제거 |
| FR-043 | 구독/API 선택 | HIGH | DONE | 모든 모델에서 구독/API 선택 |
| FR-044 | conductor 선택 | HIGH | DONE | 대화형 선택 |
| FR-045 | aiops 자동 배정 | MEDIUM | DONE | 규칙 기반 역할별 배정 |
| FR-046 | 자동 모델 스캔 | MEDIUM | DONE | fugue setup |
| FR-047 | 일괄 등록 | MEDIUM | DONE | 체크박스 일괄 |
| FR-048 | conductor 이름 | MEDIUM | DONE | config set conductor-name |
| FR-049 | Codex 별도 프로바이더 | LOW | TODO | 현재 openai로 묶임 |
| FR-050 | 토큰 사용량 | MEDIUM | DONE | model usage |
| FR-051 | 비용 계산 | LOW | DONE | 가격표 기반 추정 |
| FR-052 | 하드캡 타임아웃 | HIGH | DONE | Ollama 300초 기본 |
| FR-053 | Credential 헬스체크 | MEDIUM | DONE | add 시 health check |
