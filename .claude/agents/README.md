# OddEyes.ai Agents

특수 목적 에이전트 정의. 일반 도메인 규칙은 `.claude/rules/`로 이동됨.

> **최종 업데이트**: 2025-01

## 구조 변경 안내

**기존 도메인별 agent → `.claude/rules/` 마이그레이션 완료**

| 기존 Agent | 새 위치 | 적용 방식 |
|-----------|---------|----------|
| ai-chain.md | `.claude/rules/ai-chain.md` | glob 기반 자동 적용 |
| editor.md | `.claude/rules/editor.md` | glob 기반 자동 적용 |
| tauri-bridge.md | `.claude/rules/tauri-bridge.md` | glob 기반 자동 적용 |
| store-sync.md | `.claude/rules/stores.md` | glob 기반 자동 적용 |
| review.md | `.claude/rules/review.md` | glob 기반 자동 적용 |
| mcp-connector.md | `.claude/rules/mcp-connector.md` | glob 기반 자동 적용 |

## 현재 Agent 목록

특수 목적 agent만 유지:

| Agent | 용도 | 주입된 Skills |
|-------|------|---------------|
| `langchain-agent-auditor.md` | LangChain agent 도구 사용 패턴 감사 | test-ai, typecheck |
| `issue-tracker.md` | 대규모 이슈 문서화, 세션 간 컨텍스트 지속 | typecheck, sync-types, tdd |
| `issue-analyzer.md` | PR/Issue 분석, 관련 리소스 자동 추천 | typecheck, sync-types |

### Skills 주입 원리

Agent의 `skills:` frontmatter에 명시된 skill들의 전체 내용이 agent context에 자동 로드됩니다:

```yaml
# .claude/agents/issue-tracker.md
---
skills:
  - typecheck      # /typecheck skill 지식 주입
  - sync-types     # /sync-types skill 지식 주입
  - tdd            # /tdd skill 지식 주입
---
```

→ Agent 실행 시 해당 skills의 워크플로우와 명령어를 알고 있음

## 사용법

### Rules (자동 적용)

`.claude/rules/` 파일들은 `paths` glob 패턴에 매칭되는 파일 작업 시 자동으로 로드됩니다:

```yaml
# .claude/rules/ai-chain.md
---
paths: ["src/ai/**/*"]
---
```

→ `src/ai/` 하위 파일 작업 시 해당 규칙 자동 적용

### Agents (명시적 호출)

특수 목적 agent는 Task tool 또는 명시적 참조로 사용:

```
# LangChain agent 감사
Task tool → subagent_type: langchain-agent-auditor

# 대규모 이슈 문서화
@.claude/agents/issue-tracker.md
```

## Rules 목록

| Rule | Paths | 용도 |
|------|-------|------|
| `ai-chain.md` | `src/ai/**/*` | AI/LangChain 작업 |
| `editor.md` | `src/editor/**/*`, `src/components/editor/**/*` | TipTap 에디터 |
| `tauri-bridge.md` | `src-tauri/src/commands/**/*`, `src/tauri/**/*` | TS ↔ Rust IPC |
| `stores.md` | `src/stores/**/*` | Zustand 상태 관리 |
| `review.md` | `src/ai/review/**/*`, `src/components/review/**/*` | 번역 검수 |
| `mcp-connector.md` | `src-tauri/src/mcp/**/*`, `connectorStore.ts` | MCP 연동 |
