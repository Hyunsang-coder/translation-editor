# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**OddEyes.ai** - AI-powered translation editor built with Tauri (Rust) + React (TypeScript).
- Notion-style dual editor (TipTap) for Source/Target documents
- AI chat with LangChain (OpenAI + Anthropic)
- MCP integration (Confluence, Web Search)
- History snapshot workflow (save/compare/restore/rename, including snapshot↔snapshot diff)

**Core Philosophy**: Translator-led workflow. AI assists only when requested.

## Quick Reference

### Commands
```bash
npm install              # Install dependencies
npm run tauri:dev        # Dev server (frontend + Tauri)
npm run tauri:build      # Build release app
npx tsc --noEmit         # TypeScript type check
npm test                 # Vitest watch mode
npm run test:run         # Single test run
npm run test:e2e:web     # Playwright web E2E
npm run test:ci:local    # CI verify equivalent (typecheck+unit+web e2e+cargo test)
npm run test:tauri       # Full pre-deploy gate (typecheck+unit+e2e+rust+release)
npm run test:e2e         # Tauri smoke test (Playwright)
npm run tauri-testing-mcp:build  # Build MCP bridge server
npm run tauri-testing-mcp:start  # Start MCP bridge server (stdio)
cd src-tauri && cargo test  # Rust tests only
```

### Dev Environment Setup
```bash
# Keychain 암호 프롬프트 우회 (.gitignore 포함, 한 번만 설정)
# 기존 vault 호환: security find-generic-password -s "com.ite.app" -a "ite:master_key_v1" -w
# 새 환경: 아무 문자열 가능 (SHA-256 해싱)
echo 'ITE_DEV_MASTER_KEY=mypassword' > .env.local

# (선택) 테스트(vitest)에서만 API 키 fallback 사용
# 런타임 앱(Tauri)에서는 사용되지 않으며, 앱 설정/OS 보안저장소 키가 우선입니다.
echo 'OPENAI_API_KEY=...' >> .env.local
echo 'ANTHROPIC_API_KEY=...' >> .env.local
```

주의:
- `.env.local`은 로컬 전용 파일입니다. 실제 키를 저장소에 커밋하지 마세요.
- 테스트가 아닌 실제 앱 실행에서는 Settings에서 입력한 API 키(secure store)가 사용됩니다.

### Key Directories
```
src/ai/           # AI integration (chat.ts, translateDocument.ts, review/, modelCallOptions.ts, tools/)
src/editor/       # TipTap extensions
src/stores/       # Zustand stores (chatStore: 7 슬라이스)
src/components/   # React components
src/components/history/  # History snapshot UI (timeline/compare/restore/rename)
src-tauri/src/    # Rust backend (commands/, mcp/)
src/desktop/      # Claude Desktop bridge (oddeyesAppBridge.ts, translationPreviewActions.ts)
crates/tauri-plugin-testing/  # Tauri runtime testing bridge plugin
tauri-testing-mcp/            # MCP server for runtime control tools (dom/tauri/window/app)
oddeyes-desktop-mcp/          # Claude Desktop MCP extension (.mcpb bundle)
```

### Version Files (Keep in Sync)
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` (Cargo.toml 변경 시 `cargo check`로 자동 갱신)
- `src-tauri/tauri.conf.json`

## Documentation Structure

This `.claude/` directory contains:
- `architecture.md` - Tech stack, design decisions, security
- `patterns.md` - AI/Editor/MCP implementation patterns
- `gotchas.md` - Critical implementation warnings (150+ items)
- `review-audit.md` - Review feature code audit (13 issues, 10 strengths)
- `testing.md` - Testing, debugging, file organization

### 무엇을 어디에 쓰나

**이 파일은 문서가 아니라 매 세션 자동으로 실려가는 프롬프트입니다.** 그래서 판단 기준은 "정확한가"가 아니라 **"모든 작업에서 행동을 바꾸는가"** 입니다. 내용의 종류로 집을 정하고, 날짜로 쌓지 않습니다.

| 종류 | 집 |
|------|-----|
| 왜 그렇게 됐나 / 무엇을 버렸나 | `docs/adr/` ([README](../docs/adr/README.md)) — 되돌리기 비싼 결정(스키마, MCP breaking, 기능 폐기, 대안을 버린 선택) |
| 다시 밟으면 아픈 구현 함정 | `gotchas.md` — 주제별. 날짜순이 아니라 주제순이라 낡은 항목이 새 항목 옆에서 발각됩니다 |
| 현재 구조·계약 | `architecture.md` / `patterns.md` — **덧붙이지 말고 갈아끼웁니다** |
| 언제 무엇이 바뀌었나 | `git log` — 이 파일에 쓰지 않습니다 |

**변경 이력 금지 규칙**: 이 파일에 "Recent Updates" 류의 이력 섹션을 만들지 않습니다. 2026-07-30에 13개 날짜 섹션(~14.8k 토큰, 파일의 87%)을 걷어냈습니다 — 지운 이유는 낡은 항목이 사라지지 않아서입니다(4월 항목이 ADR-0012와 정면으로 모순된 상태로 남아 있었습니다). 지운 내용은 `git show 2f157b2:.claude/CLAUDE.md`에 있습니다.

**상한: 300줄.** 넘으면 무엇을 뺄지 결정합니다. 상한 없는 프롬프트는 반드시 자랍니다.

## Core Principles

1. **No Auto-Apply**: AI never modifies documents without user confirmation ([ADR-0003](../docs/adr/0003-no-auto-apply-preview-first.md))
2. **Preview-First**: Translation results shown in modal before applying ([ADR-0003](../docs/adr/0003-no-auto-apply-preview-first.md))
3. **TipTap JSON is Canonical**: Never bypass JSON format for document storage ([ADR-0002](../docs/adr/0002-tiptap-json-as-canonical-format.md))
4. **Markdown for AI**: Translation uses Markdown as intermediate format ([ADR-0002](../docs/adr/0002-tiptap-json-as-canonical-format.md))

## E2E Automation Testing (Tauri MCP Bridge)

### Architecture
```
Test Script (.mjs) → MCP Client (stdio) → MCP Server (tauri-testing-mcp)
    → WebSocket (JSON-RPC 2.0) → Tauri Plugin (tauri-plugin-testing)
    → bridge.js → DOM / Dialog / Tauri API
```

### Prerequisites
MCP 테스트 실행 전, `--features testing` 플래그로 앱을 먼저 띄워야 합니다:
```bash
TAURI_TESTING_ENABLED=1 \
TAURI_TEST_TOKEN=tauri-testing-token \
TAURI_TEST_PORT=9988 \
npx tauri dev --features testing --no-watch --config src-tauri/tauri.conf.json --config '{"build":{"beforeDevCommand":""}}'
```
별도 터미널에서 MCP 서버 실행:
```bash
TAURI_TEST_TOKEN=tauri-testing-token TAURI_TEST_PORT=9988 npm run tauri-testing-mcp:start
```

### Quick Commands
```bash
npm run test:e2e:tauri:mcp:workflow     # Full workflow (번역+리뷰+채팅)
npm run test:e2e:tauri:mcp:new-project  # 프로젝트 생성 smoke test
npm run test:e2e:tauri:mcp:chat-selection # SelectionContext 카드 shortcut
npx playwright test -c playwright.web.config.ts e2e/selection-editing.spec.ts
node scripts/tauri-testing-mcp-<name>.mjs  # Custom scenario
```

### Scenario Skills
```
/e2e-scenario 프로젝트 생성 후 번역해봐            # 새 시나리오 자동 생성
/e2e-scenario --dry-run 히스토리 저장/복원 테스트   # 구조만 미리보기
/e2e-scenario --attach-to-running 채팅 테스트       # 실행 중인 앱에 연결
```

### Available MCP Tools (36개)
- **DOM**: `query_selector`, `click`, `click_by_text`, `fill`, `fill_by_placeholder`, `type_contenteditable`, `type_contenteditable_by_selector`, `get_text`, `get_value`, `get_all`, `get_page_content`, `select`, `keyboard`, `scroll_to`, `wait_for_selector`, `wait_for_text`, `wait_for_hidden`
- **Dialog**: `get_state`, `set_auto_response`, `push_response`, `clear`
- **Tauri**: `invoke`, `emit`
- **Window**: `get_title`, `get_size`, `set_size`, `list`, `maximize`, `minimize`, `close`, `screenshot`
- **App**: `ping`, `quit`

### Scenario Patterns
| Pattern | Flow | Use Case |
|---------|------|----------|
| A. Full Workflow | 프로젝트→설정→번역→리뷰→채팅 | CI 회귀 테스트 |
| B. Translation | 프로젝트→원문→번역→확인 | 번역 기능 검증 |
| C. Chat | 프로젝트→번역→채팅 다양한 질문 | 채팅/프롬프트 검증 |
| D. Settings | 프로젝트→앱 설정→프로젝트 설정 | 설정 UI 검증 |
| E. History | 프로젝트→번역→저장→수정→비교/복원 | 히스토리 기능 |
| F. Edge Case | 빈 문서, 긴 문서, 특수문자 등 | 안정성 테스트 |

### Gotchas
- **TipTap**: `fill`은 Source 초기 입력만 가능, 이후는 `type_contenteditable_by_selector` 사용
- **DebouncedTextarea**: 설정 필드 입력 후 700ms 대기 필요
- **언어 선택**: 시스템 언어에 따라 한/영 두 가지 시도
- **Dialog**: 삭제 확인 등 네이티브 팝업은 `dialog.setAutoResponse` 선행 필수
- **단일 클라이언트**: WebSocket은 동시에 1개 연결만 허용

### Related Skills
- `/e2e-scenario` — 자연어로 E2E 시나리오 자동 생성
- `/record-demo` — E2E 시나리오를 데모 영상으로 녹화
- `/tdd` — 유닛 테스트 TDD 워크플로우
- `/test-ai` — AI 페이로드 dry-run 검증

## Adding New Features

1. Update relevant Zustand store(s)
2. Add Tauri command if backend logic needed
3. Create/update UI components
4. Add i18n keys to both `ko.json` and `en.json`
5. Test with real AI API calls
6. Verify SQLite persistence across sessions
7. (Optional) `/e2e-scenario`로 E2E 자동화 시나리오 추가
