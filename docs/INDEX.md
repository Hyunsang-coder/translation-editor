# 문서 네비게이션 (Documentation Index)

## 핵심 문서 (Source of Truth)

| 문서 | 경로 | 설명 |
|------|------|------|
| **PRD** | `/prd.md` | 제품 비전, UX 원칙, 성공 지표 |
| **TRD** | `/docs/trd/` | 아키텍처, 기술 명세, API 구조 (README.md가 인덱스) |
| **CLAUDE.md** | `/CLAUDE.md` | AI Agent 지침 (코드 작업 시 필수) |

## 진행 중인 태스크

| 문서 | 경로 | 설명 |
|------|------|------|
| 검수 적용 기능 | `/docs/review-apply-suggestion.md` | 추천 문장 클릭 시 번역문 반영 ✅ |
| 진행 현황 | `/docs/review-apply-suggestion-progress.md` | 체크리스트 (검색 정규화 완료) |
| **적용 개선 분석** | `/docs/review-apply-improvement-analysis.md` | 누락/검색 실패 원인 분석 및 개선 방안 |

## 구현 태스크

| 문서 | 경로 | 설명 |
|------|------|------|
| Tasks 개요 | `/tasks/README.md` | Phase별 현황 요약 |
| Phase 1 | `/tasks/phase-1.md` | 기반 구축 ✅ |
| Phase 2 | `/tasks/phase-2.md` | AI 연동 ✅ |
| Phase 3 | `/tasks/phase-3.md` | 데이터 관리 ✅ |
| Phase 4 | `/tasks/phase-4.md` | 용어집 & Context ✅ |
| Phase 5 | `/tasks/phase-5.md` | Tools 시스템 🚧 |
| Phase 6 | `/tasks/phase-6.md` | 외부 연동 ✅ |
| Phase 7 | `/tasks/phase-7.md` | UX 개선 🚧 |

## 테스트/배포 운영

| 문서 | 경로 | 설명 |
|------|------|------|
| **Tauri 테스트 가이드** | `/docs/TAURI_TESTING.md` | Tauri 중심 테스트 명령 및 릴리즈 전 스모크 절차 |
| **Tauri Testing Plugin 명세** | `/docs/TAURI_TESTING_PLUGIN.md` | Tauri 테스트 플러그인 + MCP 브리지 MVP 구현 명세 |
| **OddEyes Desktop MCP** | `/docs/ODDEYES_DESKTOP_MCP.md` | Claude Desktop extension(.mcpb) 구조, bridge.json 연결 전략, preview flow |

## 코드 리뷰

| 문서 | 경로 | 설명 |
|------|------|------|
| **리뷰 v3** | `/docs/CODE_REVIEW_2026-02-09.md` | 전체 코드베이스 리뷰 (v1.6.2, 23개 이슈) |
| 리뷰 v2 | `/docs/CODE_REVIEW_2026-01-21_v2.md` | 이전 리뷰 (beta-1.0) |

## 완료된 스펙 (Archive)

| 문서 | 경로 | 설명 |
|------|------|------|
| 요약 | `/docs/archive/COMPLETED.md` | 완료된 스펙 요약 |
| 검수 개선 | `/docs/archive/review_tool_improvement.md` | 번역 검수 기능 |
| Secret Manager | `/docs/archive/secret_manager.md` | 보안 저장소 |
| 시스템 이슈 | `/docs/archive/issues.md` | 채팅/에디터/검수/번역 연동 분석 (13개 이슈) |
| 이슈 진행 | `/docs/archive/issues_progress.md` | 이슈 수정 체크리스트 ✅ (13/13 완료) |

## MCP 스펙

| 문서 | 경로 | 설명 |
|------|------|------|
| MCP 스펙 | `/tasks/mcp-specs.md` | Rovo MCP (Confluence) 연동 |

## Claude Code 설정

| 경로 | 설명 |
|------|------|
| `/.claude/agents/` | 전문 Agent 정의 (ai-chain, editor, mcp 등) |
| `/.claude/commands/` | 커스텀 명령어 (commit, update-docs) |
| `/.claude/skills/` | 스킬 정의 (dev, typecheck 등) |

---

## Agent를 위한 빠른 참조

### 작업 시작 전
1. `CLAUDE.md` 읽기 (필수)
2. 관련 Phase 문서 확인
3. PRD/TRD에서 요구사항 확인

### 코드 위치
- Frontend: `src/`
- Backend: `src-tauri/src/`
- 상태: `src/stores/`
- AI: `src/ai/`
- 에디터: `src/editor/`

### 주요 원칙
- **Document-First**: TipTap JSON이 표준 포맷
- **Non-Intrusive AI**: 자동 적용 금지, 항상 Preview → Apply
- **Source of Truth**: PRD/TRD 우선
