# bpro 요구사항 정의서 v0

> 출처: CEO-Claude 대화 (2026-03-24~25)
> 정리일: 2026-03-25
> 총 요구사항: 89건

---

## 카테고리별 정리

### 1. 초기 컨셉 / 핵심 정체성

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-001 | 모델 비종속 아키텍처 | HIGH | WIP | Ollama 어댑터만 구현. 다른 프로바이더 미지원 |
| BR-002 | SLM 퍼스트 설계 | HIGH | DONE | qwen2.5:7b 기본, Ollama 기반 |
| BR-003 | CLI 도구 (터미널 명령어) | HIGH | DONE | click 기반 CLI 구현 완료 |
| BR-004 | MCP 서버 (프로토콜 레이어) | HIGH | TODO | Claude Code/Cursor/Codex에서 호출 가능한 MCP 인터페이스 |
| BR-005 | git처럼 밑에 깔리는 도구 | MEDIUM | WIP | .bpro/ 디렉토리 구조는 구현. 에이전트 통합은 미완 |
| BR-006 | AI의 관리자 (AI PMO) | HIGH | WIP | 감사/상태 기본 기능만 구현 |
| BR-007 | 사이드프로젝트를 프로덕션 수준으로 끌어올림 | HIGH | WIP | 핵심 비전. 도구 체계 부분 구현 |

### 2. 킥 포인트 A -- 역설계 (Snapshot)

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-010 | 코드에서 REQ 역설계 (snapshot) | HIGH | DONE | `bpro snapshot` 구현 완료 |
| BR-011 | 테스트 문서 자동 생성 | MEDIUM | TODO | snapshot 시 테스트 케이스 자동 생성 |
| BR-012 | E2E 추적성 매트릭스 자동 생성 | HIGH | DONE | matrix.yaml 자동 생성 구현 |
| BR-013 | 파일 배치 처리 (SLM 컨텍스트 제한 대응) | HIGH | DONE | MAX_BATCH_CHARS 기반 청크 분할 |
| BR-014 | scan include/exclude 패턴 설정 | MEDIUM | DONE | config.yaml의 scan 섹션 |

### 3. 킥 포인트 A' -- Forward (Plan)

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-020 | 기획문서 import | HIGH | DONE | `bpro plan import` 구현 |
| BR-021 | REQ ID로 분해 (SLM) | HIGH | DONE | `bpro plan decompose` 구현 |
| BR-022 | 기획자 컨펌 | HIGH | DONE | `bpro plan confirm` 구현 |
| BR-023 | 변경관리 -- add (신규 REQ 추가) | HIGH | TODO | plan change add |
| BR-024 | 변경관리 -- modify (기존 REQ 수정) | HIGH | TODO | plan change modify |
| BR-025 | 변경관리 -- deprecate (REQ 폐기) | MEDIUM | TODO | plan change deprecate |
| BR-026 | 변경관리 -- diff (변경 전후 비교) | MEDIUM | TODO | plan change diff |
| BR-027 | 변경관리 -- apply (변경 적용) | HIGH | TODO | plan change apply |
| BR-028 | 변경관리 -- impact (영향도 분석) | HIGH | TODO | 변경 시 관련 REQ/코드/테스트 영향 표시 |

### 4. 에이전트 거버넌스 (킥 포인트 B)

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-030 | 에이전트에게 작업범위 지정 | HIGH | TODO | 에이전트별 scope/boundary 정의 |
| BR-031 | 에이전트에게 업무매뉴얼 지정 | HIGH | TODO | 에이전트별 instruction set |
| BR-032 | --never 옵션 ("하지 말 것" 정의) | HIGH | TODO | 네거티브 규칙 정의 및 강제 |
| BR-033 | 에이전트 업무일지 자동 작성 | MEDIUM | TODO | 작업 로그 자동 생성 |
| BR-034 | 업무일지 관리/평가 (퍼포먼스 추적) | MEDIUM | TODO | 에이전트 성과 측정 |
| BR-035 | --collaborators 옵션 (에이전트 간 역할 분리) | MEDIUM | TODO | 다중 에이전트 협업 시 역할 경계 |
| BR-036 | ANDON 침범 감지 루프 | HIGH | TODO | define만이 아니라 detect + escalate 자동화 |
| BR-037 | Agent 프롬프트 starter template | LOW | TODO | 신규 에이전트 빠른 설정용 |
| BR-038 | 컨텍스트 80% 소진 시 자동 로그 강제 | MEDIUM | TODO | 토큰 소진 감지 + work-log 강제 트리거 |

### 5. 모델 관리

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-040 | 모델 레지스트리 -- add | HIGH | TODO | `bpro model add` |
| BR-041 | 모델 레지스트리 -- list | HIGH | TODO | `bpro model list` |
| BR-042 | 모델 레지스트리 -- remove | MEDIUM | TODO | `bpro model remove` |
| BR-043 | 구독/API 선택 가능 (모든 모델) | HIGH | TODO | Ollama 외 OpenAI/Anthropic/Google 등 |
| BR-044 | conductor(지휘자) 선택 | HIGH | TODO | 어떤 모델이 오케스트레이션할지 지정 |
| BR-045 | aiops 자동 모델 배정 | MEDIUM | TODO | 작업 특성에 따른 자동 모델 라우팅 |
| BR-046 | 자동 모델 스캔 (`bpro init` 또는 `bpro setup`) | MEDIUM | TODO | 로컬/원격 사용 가능 모델 자동 탐지 |
| BR-047 | 한번에 가능한 것 다 등록 | MEDIUM | TODO | 스캔 결과 일괄 등록 |
| BR-048 | conductor에게 이름 붙이기 + @ 호출 | MEDIUM | TODO | 네이밍 + @멘션 호출 |
| BR-049 | Codex 별도 프로바이더 분리 | LOW | TODO | Codex를 독립 프로바이더로 취급 |
| BR-050 | 모델별 토큰 사용량 추적 | MEDIUM | TODO | `bpro model usage` |
| BR-051 | 예상 비용 계산 | LOW | TODO | 토큰 사용량 기반 비용 산출 |
| BR-052 | Model Adapter 하드캡 타임아웃 | HIGH | WIP | OllamaClient에 timeout 존재. 범용 어댑터 미구현 |
| BR-053 | Credential 헬스체크 | MEDIUM | TODO | API 키/토큰 유효성 사전 검증 |

### 6. 산출물 체계

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-060 | D.01~D.08 산출물 계층 | HIGH | DONE | status --deliverables에서 표시 |
| BR-061 | Gate 차단 규칙 (선행 산출물 없이 후행 착수 불가) | HIGH | WIP | audit --gate 판정 있으나, 실제 차단(block) 미구현 |
| BR-062 | `bpro status --deliverables` | HIGH | DONE | 산출물 트리 표시 구현 |

### 7. Snapshot 고급 옵션

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-070 | staging area (review/apply/discard) | HIGH | TODO | git 충돌 관리 차용한 REQ 스테이징 |
| BR-071 | --clean 옵션 (기존 REQ 초기화 후 스냅샷) | MEDIUM | TODO | snapshot 시 기존 DRAFT 제거 |
| BR-072 | --append 옵션 (기존 REQ에 추가) | MEDIUM | TODO | 기존 REQ 유지하면서 추가 |
| BR-073 | --keep-confirmed 옵션 | MEDIUM | TODO | CONFIRMED 이상은 보존 |
| BR-074 | --dry-run 옵션 (미리보기) | MEDIUM | TODO | 실제 저장 없이 결과 표시 |
| BR-075 | --stash 옵션 (임시 저장) | LOW | TODO | REQ 임시 보관 |
| BR-076 | --pick 옵션 (특정 REQ만 채택) | MEDIUM | TODO | 선택적 REQ 승인 |
| BR-077 | PROTECTED 상태 (CONFIRMED/DEV/DONE 보호) | HIGH | TODO | snapshot 시 기존 확정 REQ 덮어쓰기 방지 |
| BR-078 | 전체 작업계획 먼저 표시 + 스텝별 프로그레스바 | MEDIUM | WIP | Progress bar 있으나 작업계획 표시 없음 |
| BR-079 | 도메인 병렬 처리 (파일 겹침 없으면) | LOW | TODO | 독립 도메인 동시 분석 |
| BR-080 | 예상 소요시간 표시 | LOW | TODO | 배치 수 기반 시간 추정 |
| BR-081 | 대형 레포 청크 처리 | HIGH | WIP | MAX_BATCH_CHARS 기반 분할 있으나 대형 레포 최적화 미흡 |

### 8. 리포트

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-090 | HTML 리포트 (도메인/priority/status 필터, 상세보기, 검색) | MEDIUM | TODO | 인터랙티브 HTML 리포트 |
| BR-091 | 마크다운 리포트 | MEDIUM | TODO | 정적 마크다운 리포트 생성 |
| BR-092 | 요청자별 리포트 (--owner, --by-owner) | MEDIUM | TODO | 오너 기준 필터링 |
| BR-093 | 기획문서 단위 추적 (--plan) | MEDIUM | TODO | plan 소스 기준 그루핑 |

### 9. 알림

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-100 | Slack webhook 알림 (bpro notify) | MEDIUM | TODO | 상태 변경 시 Slack 알림 |
| BR-101 | 이메일 알림 | LOW | TODO | v0.3+ 예정 |
| BR-102 | 작업 완료 시 자동 리포팅 | MEDIUM | TODO | task done 시 자동 알림 발송 |

### 10. 점진적 통제 모드 (Task)

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-110 | `bpro task new` -- 신규 요구사항 단위로 시작 | HIGH | TODO | 전체 snapshot 없이 단건 등록 |
| BR-111 | `bpro task import` -- 기획문서 연결 | HIGH | TODO | 태스크에 기획문서 바인딩 |
| BR-112 | 기획문서 품질 검증 (부실할 경우 alert) | MEDIUM | TODO | SLM으로 기획문서 완성도 평가 |
| BR-113 | `bpro task decompose` -- REQ ID 분해 | HIGH | TODO | 태스크 단위 REQ 분해 |
| BR-114 | `bpro task confirm` -- 요청자 컨펌 | HIGH | TODO | 태스크 단위 확인 |
| BR-115 | `bpro task assign` -- 작업자 배정 | HIGH | TODO | 사람 또는 에이전트 배정 |
| BR-116 | `bpro task done` -- 작업 완료 + 전수 검증 + 리포트 | HIGH | TODO | 완료 처리 및 자동 검증 |
| BR-117 | `bpro task escalate` -- 에스컬레이션 | MEDIUM | TODO | 이슈 상위 보고 |

### 11. 작업 요청자/작업자 분리

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-120 | 요청자(owner) 필드 | HIGH | TODO | REQ에 owner 메타데이터 추가 |
| BR-121 | 작업자(assignee) 필드 | HIGH | TODO | 사람 또는 에이전트, 1명 또는 여럿 |
| BR-122 | 요청자에서 작업자로의 작업 흐름 | HIGH | TODO | 요청-배정-수행-완료 플로우 |
| BR-123 | 요청자가 비개발자일 수 있음 (CLI 안 씀) | MEDIUM | TODO | 비CLI 인터페이스 고려 (MCP/웹 등) |

### 12. Crosscheck Loop (품질 검증)

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-130 | SUBMIT - AUDIT - REWORK 기본 루프 | HIGH | TODO | 3단계 기본 품질 검증 |
| BR-131 | 확장 시 8단계 검증 루프 | LOW | TODO | SUBMIT-REVIEW-AUDIT-REWORK-VERIFY-APPROVE-DEPLOY-MONITOR |

### 13. MCP 서버

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-140 | Claude Code에서 @이름으로 bpro 호출 | HIGH | TODO | MCP tool 인터페이스 |
| BR-141 | Cursor에서 @이름으로 bpro 호출 | MEDIUM | TODO | MCP tool 인터페이스 |
| BR-142 | Codex에서 @이름으로 bpro 호출 | MEDIUM | TODO | MCP tool 인터페이스 |
| BR-143 | bpro 안에서 에이전트 호출 가능 | MEDIUM | TODO | bpro가 외부 에이전트를 invoke |

### 14. 프로젝트 초기화 / 설정

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-150 | `bpro init` 프로젝트 초기화 | HIGH | DONE | .bpro/ 디렉토리 구조 생성 |
| BR-151 | .bpro/.gitignore 자동 생성 | HIGH | DONE | credentials 보호 |
| BR-152 | `bpro setup` (모델 스캔 + 일괄 등록) | MEDIUM | TODO | init과 별도의 모델 설정 명령어 |

### 15. 감사 (Audit)

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-160 | Quick audit (파일 기반, SLM 없이) | HIGH | DONE | `bpro audit --quick` |
| BR-161 | Gate 판정 (PASS/CONDITIONAL/FAIL) | HIGH | DONE | `bpro audit --gate` |
| BR-162 | 감사 결과 YAML 리포트 저장 | HIGH | DONE | .bpro/reports/audit-*.yaml |
| BR-163 | SLM 기반 심층 감사 | MEDIUM | TODO | --deep 옵션 등으로 SLM 활용 감사 |

### 16. SLM 컨텍스트 관리

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-170 | SLM 컨텍스트 절삭 트레이드오프 명시 | MEDIUM | TODO | 요약 손실/정확도 감소 사용자에게 경고 |
| BR-171 | JSON 파싱 복원력 (SLM quirks 대응) | HIGH | DONE | parse_json_response 구현 완료 |

### 17. 상태 관리 / 워크플로우

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-180 | REQ 상태 흐름 (DRAFT-CONFIRMED-DEV-DONE-DEPRECATED) | HIGH | DONE | 상태값 정의 및 전이 |
| BR-181 | STALE 상태 감지 | HIGH | DONE | audit에서 코드 파일 누락 시 STALE 판정 |
| BR-182 | `bpro status` 프로젝트 개요 | HIGH | DONE | 진행률 바 + 상태 요약 |

### 18. 기타

| ID | Title | Priority | Status | 비고 |
|---|---|---|---|---|
| BR-190 | bpro 자신을 bpro로 관리 (dog-fooding) | HIGH | TODO | 자기 참조 프로젝트 관리 |
| BR-191 | 프로젝트명 음악 컨셉 검토 | LOW | TODO | 미결정. 네이밍 후보 탐색 |

---

## 요약 통계

| Status | 건수 |
|--------|------|
| DONE | 22 |
| WIP | 8 |
| TODO | 59 |
| **합계** | **89** |

| Priority | 건수 |
|----------|------|
| HIGH | 43 |
| MEDIUM | 34 |
| LOW | 12 |

---

## 구현 우선순위 참고 (대화에서 합의된 순서)

1. **v0.2 (현재)**: snapshot, plan import/decompose/confirm, status, audit -- 완료
2. **v0.3 목표**: 모델 레지스트리, 변경관리, snapshot 고급 옵션, task 워크플로우
3. **v0.4 이후**: MCP 서버, 알림, HTML 리포트, Crosscheck Loop 확장, 비용 추적
