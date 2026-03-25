# Snapshot & Reverse — fugue 요구사항

> 도메인: 역설계 + Snapshot 고급 옵션 | 항목 수: 17건

| ID | Title | Priority | Status | Description |
|---|---|---|---|---|
| FR-010 | 코드→REQ 역설계 | HIGH | DONE | conductor가 분석 후 에이전트가 REQ 추출 |
| FR-011 | 테스트 문서 자동 생성 | MEDIUM | TODO | snapshot 시 REQ별 테스트 케이스 초안 |
| FR-012 | E2E 추적성 매트릭스 | HIGH | DONE | matrix.yaml 자동 생성 |
| FR-013 | 파일 배치 처리 | HIGH | DONE | MAX_BATCH_CHARS 기반 청크 분할 |
| FR-014 | scan include/exclude | MEDIUM | DONE | config.yaml의 scan 섹션 |
| FR-070 | staging area | HIGH | DONE | review → apply/discard |
| FR-071 | --clean 옵션 | MEDIUM | DONE | DRAFT 삭제 후 새로 분석 |
| FR-072 | --append 옵션 | MEDIUM | TODO | 기존 유지 + 새 것만 추가 |
| FR-073 | --keep-confirmed | MEDIUM | DONE | CONFIRMED 이상 보호 |
| FR-074 | --dry-run | MEDIUM | TODO | 저장 없이 미리보기 |
| FR-075 | --stash | LOW | TODO | 임시 저장 후 새로 분석 |
| FR-076 | --pick | MEDIUM | TODO | 특정 REQ만 선택 채택 |
| FR-077 | PROTECTED 상태 | HIGH | DONE | snapshot으로 덮어쓰기 방지 |
| FR-078 | 작업계획+프로그레스바 | MEDIUM | DONE | 4단계 + 경과 시간 |
| FR-079 | 도메인 병렬 처리 | LOW | TODO | 독립 도메인 동시 분석 |
| FR-080 | 예상 소요시간 | LOW | TODO | 남은 시간 추정 |
| FR-081 | 대형 레포 청크 처리 | HIGH | WIP | 파일 제한 있으나 디렉토리 단위 미구현 |
