# OddEyes.ai Subagents

프로젝트 도메인별 전문 subagent 정의.

> **TRD 기준**: 전체 | **최종 업데이트**: 2025-01

## 사용법

Claude Code에서 작업 시 해당 도메인의 agent 파일을 참조하여 컨텍스트를 제공합니다.

```
@.claude/agents/tauri-bridge.md   # Tauri 커맨드 작업 시
@.claude/agents/mcp-connector.md  # MCP/외부 연동 작업 시
@.claude/agents/ai-chain.md       # AI/LangChain 작업 시
@.claude/agents/editor.md         # TipTap 에디터 작업 시
@.claude/agents/store-sync.md     # Zustand 상태 관리 시
@.claude/agents/review.md         # 번역 검수 작업 시
```

## Agent 목록

| Agent | 파일 | TRD | 담당 영역 |
|-------|------|-----|----------|
| **Tauri Bridge** | `tauri-bridge.md` | 4.1, 7.2, 7.3 | TS ↔ Rust IPC, SecretManager, MCP Registry |
| **MCP Connector** | `mcp-connector.md` | 3.2, 3.6, 7.2, 7.3 | Rust 네이티브 SSE, OAuth, SecretManager Vault |
| **AI Chain** | `ai-chain.md` | 3.1, 3.2, 7.1 | LangChain, Markdown 파이프라인, Tool Calling |
| **Editor** | `editor.md` | 2.1, 2.2, 3.9 | TipTap, SearchHighlight, ReviewHighlight, Markdown 변환 |
| **Store Sync** | `store-sync.md` | 3.9, 3.10, 4.1, 7.2 | Zustand, Race Condition, reviewStore, SecretManager Vault |
| **Review** | `review.md` | 3.9 | 번역 검수, 청크 기반 AI, 하이라이트, 제안 적용 |
| **Issue Tracker** | `issue-tracker.md` | - | 대규모 이슈 문서화, 세션 간 컨텍스트 지속 |
| **Issue Analyzer** | `issue-analyzer.md` | - | PR/Issue 분석, 관련 리소스 자동 추천 |

## 자동 활성화 트리거

각 agent는 특정 키워드나 파일 경로에 의해 자동으로 관련성이 인식됩니다:

### tauri-bridge
- 키워드: "tauri command", "invoke", "IPC", "secrets", "mcp registry"
- 경로: `src-tauri/src/commands/`, `src/tauri/`, `src-tauri/src/secrets/`, `src-tauri/src/mcp/`

### mcp-connector
- 키워드: "confluence", "notion", "mcp", "oauth", "connector", "SSE"
- 경로: `src-tauri/src/mcp/`, `connectorStore.ts`

### ai-chain
- 키워드: "prompt", "langchain", "tool calling", "번역", "markdown pipeline"
- 경로: `src/ai/` (review 제외)

### editor
- 키워드: "tiptap", "editor", "prosemirror", "문서", "highlight", "search"
- 경로: `src/editor/`, `src/components/editor/`

### store-sync
- 키워드: "store", "zustand", "상태", "persist", "race condition"
- 경로: `src/stores/`

### review
- 키워드: "검수", "review", "오역", "누락", "하이라이트"
- 경로: `src/ai/review/`, `src/components/review/`, `ReviewHighlight.ts`

### issue-tracker
- 키워드: "대규모", "리팩토링", "마이그레이션", "여러 세션", "이슈 정리"
- 조건: 예상 작업 ≥7단계, 관련 파일 ≥10개, 도메인 ≥3개
- 경로: `docs/issues/`

### issue-analyzer
- 키워드: "분석해줘", "관련 agent?", "어떤 문서?"
- 조건: PR 생성, Issue 분석, 복잡한 변경사항 리뷰

## 복합 작업

여러 도메인에 걸친 작업의 경우:

```
# 새 AI 도구 추가 (ai-chain + store-sync + tauri-bridge)
@.claude/agents/ai-chain.md
@.claude/agents/store-sync.md
@.claude/agents/tauri-bridge.md

# 새 MCP 커넥터 추가 (mcp-connector + store-sync + tauri-bridge)
@.claude/agents/mcp-connector.md
@.claude/agents/store-sync.md
@.claude/agents/tauri-bridge.md

# 검수 기능 수정 (review + editor + store-sync)
@.claude/agents/review.md
@.claude/agents/editor.md
@.claude/agents/store-sync.md

# 번역 기능 개선 (ai-chain + editor + store-sync)
@.claude/agents/ai-chain.md
@.claude/agents/editor.md
@.claude/agents/store-sync.md

# 대규모 이슈 작업 (issue-tracker + issue-analyzer + 도메인별 agent)
@.claude/agents/issue-tracker.md
@.claude/agents/issue-analyzer.md
# + 관련 도메인 agent (ai-chain, editor 등)

# 이전 이슈 이어서 작업
@docs/issues/ISSUE-001-제목.md
```

## Agent 확장

새 agent 추가 시 이 디렉토리에 `.md` 파일로 생성하고 다음 구조를 따릅니다:

```markdown
# [Agent Name]

[설명]

## Identity
[전문 분야 정의]

## Scope
[담당 파일/디렉토리]

## Core Patterns
[핵심 코드 패턴]

## Checklist
[작업 시 체크리스트]

## Common Issues
[자주 발생하는 문제와 해결책]

## Activation Triggers
[자동 활성화 조건]
```
