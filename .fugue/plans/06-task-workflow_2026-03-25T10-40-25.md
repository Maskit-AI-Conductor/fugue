# Task Workflow — fugue 요구사항

> 도메인: 점진적 통제 + 요청자/작업자 분리 | 항목 수: 12건

| ID | Title | Priority | Status | Description |
|---|---|---|---|---|
| FR-110 | task new | HIGH | DONE | 신규 태스크. --requester 지정 |
| FR-111 | task import | HIGH | DONE | 기획문서 연결 |
| FR-112 | 기획문서 품질 검증 | MEDIUM | DONE | task validate — conductor가 모호성/누락 체크 |
| FR-113 | task decompose | HIGH | DONE | 태스크 단위 REQ 분해 |
| FR-114 | task confirm | HIGH | DONE | 요청자 컨펌 |
| FR-115 | task assign | HIGH | DONE | 작업자 배정 (사람/에이전트) |
| FR-116 | task done | HIGH | DONE | 완료 + 자동 검증 + 리포트 |
| FR-117 | task escalate | MEDIUM | DONE | 에스컬레이션 |
| FR-120 | 요청자(owner) 필드 | HIGH | DONE | task yaml requester |
| FR-121 | 작업자(assignee) 필드 | HIGH | DONE | task yaml assignees[] |
| FR-122 | 요청자→작업자 워크플로우 | HIGH | DONE | 상태 전이 체계 |
| FR-123 | 다른 PC에서 작업 | MEDIUM | WIP | git으로 .fugue/ 공유. 전용 동기화 미구현 |
