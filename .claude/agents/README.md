# OddEyes.ai Subagents

프로젝트 도메인별 전문 subagent 정의.

## 사용법

Claude Code에서 작업 시 해당 도메인의 agent 파일을 참조하여 컨텍스트를 제공합니다.

```
@.claude/agents/tauri-bridge.md   # Tauri 커맨드 작업 시
@.claude/agents/mcp-connector.md  # MCP/외부 연동 작업 시
@.claude/agents/ai-chain.md       # AI/LangChain 작업 시
@.claude/agents/editor.md         # TipTap 에디터 작업 시
@.claude/agents/store-sync.md     # Zustand 상태 관리 시
```

## Agent 목록

| Agent | 파일 | 담당 영역 |
|-------|------|----------|
| **Tauri Bridge** | `tauri-bridge.md` | TS ↔ Rust IPC, 타입 동기화 |
| **MCP Connector** | `mcp-connector.md` | 외부 API, OAuth, Sidecar |
| **AI Chain** | `ai-chain.md` | LangChain, 프롬프트, Tool Calling |
| **Editor** | `editor.md` | TipTap, ProseMirror, 문서 구조 |
| **Store Sync** | `store-sync.md` | Zustand, 영속성, 상태 동기화 |

## 자동 활성화 트리거

각 agent는 특정 키워드나 파일 경로에 의해 자동으로 관련성이 인식됩니다:

### tauri-bridge
- 키워드: "tauri command", "invoke", "IPC"
- 경로: `src-tauri/src/commands/`, `src/tauri/`

### mcp-connector
- 키워드: "confluence", "notion", "mcp", "oauth"
- 경로: `src-tauri/src/mcp/`, `connectorStore`

### ai-chain
- 키워드: "prompt", "langchain", "tool calling", "번역"
- 경로: `src/ai/`

### editor
- 키워드: "tiptap", "editor", "prosemirror", "문서"
- 경로: `src/editor/`, `src/components/editor/`

### store-sync
- 키워드: "store", "zustand", "상태", "persist"
- 경로: `src/stores/`

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
