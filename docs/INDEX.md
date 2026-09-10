# 문서 네비게이션 (Documentation Index)

## 핵심 문서 (Source of Truth)

| 문서 | 경로 | 설명 |
|------|------|------|
| **CLAUDE.md** | `/.claude/CLAUDE.md` | AI Agent 지침 및 개발 환경 가이드 (세션 프롬프트) |
| **ADR** | `/docs/adr/` | 아키텍처 결정 기록 — **왜 그렇게 됐고 무엇을 버렸는지** (`README.md`가 인덱스) |
| **Architecture** | `/.claude/architecture.md` | 기술 스택, 시스템 아키텍처, SQLite 스키마, 보안 |
| **Patterns** | `/.claude/patterns.md` | AI / Editor / MCP 구현 패턴 및 불변식 |
| **Gotchas** | `/.claude/gotchas.md` | 과거 이슈에서 축적된 주제별 구현 함정 목록 |
| **Testing** | `/.claude/testing.md` | 테스트 전략, Vitest 유닛 테스트, E2E 및 Tauri 런타임 제어 |

> **ADR**: 되돌리기 비싼 결정(스키마 변경, MCP breaking, 대안을 버린 선택, 기능 폐기)을 할 때는 ADR을 함께 커밋합니다.

## 진행 중인 태스크

| 문서 | 경로 | 설명 |
|------|------|------|
| **검수 이슈 양 패널 위치 이동** | `/docs/review-issue-dual-panel-navigation-plan.md` | 검수 이슈 선택 시 원문·번역문 패널과 검수 카드 공동 이동 — 단계 1–3 구현 완료 (단계 4 사용자 확인 대기) |
| **웹 버전 이행 조사** | `/docs/web-migration-research-2026-09-04.md` | 데스크톱 유지 + 웹 추가 시의 구조·비용·기능 정리 — 조사 완료, 미착수 |

## 테스트/배포 운영

| 문서 | 경로 | 설명 |
|------|------|------|
| **Tauri 테스트 가이드** | `/docs/TAURI_TESTING.md` | Tauri 중심 테스트 명령 및 릴리즈 전 스모크 절차 |
| **Tauri Testing Plugin 명세** | `/docs/TAURI_TESTING_PLUGIN.md` | Tauri 테스트 플러그인 + MCP 브리지 구현 명세 |
| **OddEyes Desktop MCP** | `/docs/ODDEYES_DESKTOP_MCP.md` | Claude Desktop extension(.mcpb) 구조, bridge 연결 전략, preview flow |

## 완료된 문서 (Archive)

- **보관소**: `/docs/archive/` — 완료된 기능 계획서, 이전 코드 리뷰, 스펙 및 마이그레이션 분석 문서 일체 보관.

## Claude Code 설정

| 경로 | 설명 |
|------|------|
| `/.claude/agents/` | 전문 Agent 정의 |
| `/.claude/commands/` | 커스텀 명령어 |
| `/.claude/skills/` | 스킬 정의 |

---

## Agent를 위한 빠른 참조

### 작업 시작 전
1. `.claude/CLAUDE.md` 읽기 (필수)
2. ADR 및 관련 패턴/함정 확인 (`.claude/patterns.md`, `.claude/gotchas.md`)

### 코드 위치
- Frontend: `src/`
- Backend: `src-tauri/src/`
- 상태 관리: `src/stores/`
- AI 연동: `src/ai/`
- 에디터: `src/editor/`

### 주요 원칙
- **TipTap JSON is Canonical**: 문서 저장은 SQLite `blocks`/`segments` 테이블 기반 TipTap JSON 표준 준수
- **No Auto-Apply & Preview-First**: AI는 사용자 확인 없이 문서를 직접 수정하지 않으며, 항상 Preview 후 적용
