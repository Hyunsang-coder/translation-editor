# AGENTS.md

This file provides guidance to Codex when working with this repository.

## Project Overview

**OddEyes.ai** - AI-powered translation editor built with Tauri (Rust) + React (TypeScript).
- Notion-style dual editor (TipTap) for Source/Target documents
- AI chat with LangChain (OpenAI + Anthropic)
- MCP integration (Confluence, Notion, Web Search)
- History snapshot workflow (save/compare/restore/rename, including snapshot↔snapshot diff)

**Core Philosophy**: Translator-led workflow. AI assists only when requested.

## Quick Reference

### Commands
```bash
npm install              # Install dependencies
npm run tauri:dev        # Dev server (frontend + Tauri)
npm run tauri:build      # Build release app
npm run lint             # ESLint
npm test                 # Vitest watch mode
npm run test:run         # Single test run
npm run test:e2e:web     # Playwright web E2E
npm run test:ci:local    # CI verify equivalent (lint+unit+web e2e+cargo test)
npm run test:tauri       # Full pre-deploy gate (lint+unit+e2e+rust+release)
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
src/ai/           # AI integration (chat.ts, translateDocument.ts, review/)
src/editor/       # TipTap extensions
src/stores/       # Zustand stores (chatStore: 7 슬라이스)
src/components/   # React components
src/components/history/  # History snapshot UI (timeline/compare/restore/rename)
src-tauri/src/    # Rust backend (commands/, mcp/)
crates/tauri-plugin-testing/  # Tauri runtime testing bridge plugin
tauri-testing-mcp/            # MCP server for runtime control tools
```

### Version Files (Keep in Sync)
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` (Cargo.toml 변경 시 `cargo check`로 자동 갱신)
- `src-tauri/tauri.conf.json`

## Documentation Structure

This `.Codex/` directory contains:
- `architecture.md` - Tech stack, design decisions, security
- `patterns.md` - AI/Editor/MCP implementation patterns
- `gotchas.md` - Critical implementation warnings (141 items)
- `review-audit.md` - Review feature code audit (13 issues, 10 strengths)
- `testing.md` - Testing, debugging, file organization

## Core Principles

1. **No Auto-Apply**: AI never modifies documents without user confirmation
2. **Preview-First**: Translation results shown in modal before applying
3. **TipTap JSON is Canonical**: Never bypass JSON format for document storage
4. **Markdown for AI**: Translation uses Markdown as intermediate format

## Recent Updates (2026-03-05)

- **자동저장 버그 수정**: `acceptDocDiff`, `splitBlock`, `mergeBlocks`, `addSegment`, `createNewProject`에서 `lastChangeAt` 미갱신 → autoSave/autoSnapshot debounce 무력화 버그 수정.
- **autoSnapshotStatus 제거**: Toolbar 저장 배지 제거 (히스토리 타임라인으로 확인). `historyStore`에서 `AutoSnapshotStatus` 타입·상태·타이머 전부 삭제.
- **검수 패널 "무시" → "확인"**: `review.ignore` i18n 키 변경 (EN: "Done").

### Tauri Testing Bridge Notes
- 이 브리지는 **Playwright 전체 엔진 대체가 아니라**, Tauri 런타임 내부 제어를 위한 RPC 레이어입니다.
- Native dialog는 DOM에 나타나지 않을 수 있으므로 `dialog.*` 도구를 먼저 사용해 응답 정책을 설정하세요.
- WebSocket 서버는 localhost 단일 클라이언트 + 토큰 인증 방식입니다.

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
