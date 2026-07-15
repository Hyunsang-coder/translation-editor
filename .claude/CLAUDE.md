# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

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

## Core Principles

1. **No Auto-Apply**: AI never modifies documents without user confirmation
2. **Preview-First**: Translation results shown in modal before applying
3. **TipTap JSON is Canonical**: Never bypass JSON format for document storage
4. **Markdown for AI**: Translation uses Markdown as intermediate format

## Recent Updates (2026-07-15)

- **Translator Persona 제거**: Settings UI / suggest tool / 프리셋 / Desktop MCP `translatorPersona` 필드 삭제. 기존 프로젝트 값은 hydrate 시 `translationRules` 앞에 흡수하고 DB에는 빈 문자열로 저장. 톤·문체 지시는 Rules로 통합.
- **Desktop MCP A+B (`oddeyes-desktop-mcp` v0.7.0, 19 tools)**: persona 제거; glossary entry CRUD + project link/unlink. 관리 UI 생성 시 자동 연결 제거, Settings에서 연결 해제(✕). 배포 시 `.mcpb` 재번들 + `npm publish` 필요.

### Previous (2026-07-03)

- **릴리스 빌드 시간 최적화**: 태그 빌드가 캐시를 전혀 복원하지 못하던 문제(태그 ref 캐시는 다른 태그에서 접근 불가) 해결. ① `warm-cache.yml` — main push(src-tauri/crates 변경 시)/주간 cron에서 릴리스 프로필 빌드로 rust-cache+sccache 워밍, ② `ci.yml` — main push마다 unit+cargo test 실행 및 verify 캐시 저장, ③ `build.yml` — `build`가 `verify`를 기다리지 않고 병렬 실행(publish에서 게이트), 캐시는 `shared-key`로 main 캐시 복원 전용(`save-if: false`), ④ `Cargo.toml` — `lto = "thin"` 전환으로 링크 시간 단축. 기대: 릴리스 벽시계 ~24분 → ~8–10분(warm cache 기준).
- **코드 리뷰 수정 계획 F1–F13 구현 완료** (`docs/code-review-fix-plan.md`): 검수 적용 안전성(F1–F3), 선택 적용 병합(F4/F5), 따옴표 처리(F6), Tauri AI 옵션 통합(F7/F8), 채팅 스크롤(F9/F10), 진단성/위생(F11/F12), 출력 토큰 상향(F13). 상세는 계획 문서 및 아래 항목 참조.
- **검수 적용 안전성 (F1–F3)**: `reviewApply.ts` — 세그먼트 범위 fuzzy 매칭, 다중 매치 모호 시 교체 포기, 블록 경계 교체 차단. `SearchHighlight.ts` — find/replace도 동일 가드.
- **선택 적용 병합 (F4/F5)**: 전체 선택 시 `mergeDocBySelection` 우회(full apply). `docBlockDiff` — 평탄 텍스트 블록만 문장 단위 diff, 중첩 구조는 swap 단위.
- **따옴표 처리 (F6)**: parse 시 보존, apply 시 `resolveReplacementText`로 문서 컨텍스트 기반 조건부 벗김. `getWrappingQuotePair`로 균형 인용만 strip.
- **AI 모델 호출 옵션 통합 (F7/F8)**: `src/ai/modelCallOptions.ts` — `resolveModelCallOptions(cfg, useFor)`가 LangChain(`client.ts`)과 Tauri(`backendCompletion.ts` → Rust `ai.rs`)의 temperature/adaptive thinking/effort를 일원화. Sonnet 5 temperature 400 방지 포함.
- **출력 토큰 상향 (F13)**: `REVIEW_MAX_TOKENS` 16384, `DEFAULT_CHAT_MAX_TOKENS` 8192 (thinking 토큰이 max_tokens 예산을 잠식하는 무음 truncation 방지).
- **채팅 스크롤 (F9/F10)**: `useChatScroll` — smooth 자동 스크롤 중간 프레임이 stick-to-bottom을 해제하지 않도록 `isAutoScrolling` 플래그. `ChatContent.sendCurrent`에서 본인 전송 시 `scrollToBottom()`.
- **프로젝트 전환 후 검수 적용 실패 수정**: `EditorCanvasTipTap`은 프로젝트로 remount되지 않아 TipTap 인스턴스가 재사용되는데, `switchProjectById`의 `clearEditors()`만 호출되어 `editorStore.targetEditor`가 null로 방치되던 버그. `project?.id` 변경 시 살아있는 에디터를 스토어에 재등록하는 effect 추가.

### Previous (2026-06-30)

- **Chat clipboard image paste (Tauri)**: 채팅 컴포저 Cmd+V 이미지 붙여넣기 지원. WKWebView `clipboardData` 미노출 시 `tauri-plugin-clipboard-manager` `readImage()` fallback. macOS `validate_path`가 `/private/var/folders/` 임시 업로드 경로를 차단하던 버그 수정.

### Previous (2026-06-10)

- **Target Polishing workflow (v2.6.0)**: 에디터 패널 상단에 `번역 → 검수 → 폴리싱` 액션 추가. 폴리싱은 ReviewPanel 결과와 무관하게 현재 Target 문서만 입력으로 받아 원어민 관점의 어색한 collocation, 표현, 문장 구조를 다듬는 target-only 재번역 워크플로우입니다. 결과는 기존 번역과 동일하게 Preview modal에서 확인 후 적용합니다.
- **Review prompt scope expanded**: 대조 검수에서도 누락/오역/왜곡/일관성뿐 아니라 원어민이 보기에 어색한 collocation, 표현, 문장 구조를 검수 기준에 명시합니다.
- **Secure API key persistence fix (v2.6.1)**: SecretManager 초기화가 한 번 실패해도 다음 API 키 저장/읽기 시 Keychain 초기화를 재시도합니다. 설정 화면은 보안 저장 실패 시 generic warning만이 아니라 안전한 실패 원인 메시지도 표시합니다.
- **Release verified**: `v2.6.1` GitHub Actions `Build` run succeeded for verify, macOS universal DMG, and Windows NSIS artifacts.

### Previous (2026-06-01)

- **Desktop Bridge MCP 쓰기 도구 추가 (`oddeyes-desktop-mcp` v0.2.0)**: 외부 Claude가 실행 중인 앱에 쓰는 도구 2종 추가 — `oddeyes_set_review_issues`(검수 결과 주입 → `reviewStore.ingestExternalReview`), `oddeyes_set_translation_context`(rules/projectContext 주입 → `chatStore` 세터, replace|append; persona 필드는 이후 제거됨). bridge는 기존 store 세터만 호출(신규 store 액션 없음). 상세는 `patterns.md`의 "Desktop Bridge MCP".
- **MCP 배포 동기화 주의**: 도구 추가 시 `oddeyes-desktop-mcp`의 ① `package.json`/`manifest.template.json` 버전 bump ② manifest `tools` 배열 ③ `.mcpb` 재번들 + `npm publish`(npx 경로)까지 함께 해야 클라이언트가 새 도구를 인식. npm `oddeyes-desktop-mcp@0.2.0` 게시 완료.

### Previous (2026-04-28)

- **모델 마이그레이션 (v2.4.5)**: GPT-5.4 → GPT-5.5, Claude Opus 4.6 → 4.7. `aiConfigStore` v8 → v9 자동 rename. `gpt-5.4-mini`는 chat 저비용 옵션으로 유지.
- **Opus 4.7 sampling 파라미터 가드**: `client.ts`에서 `claude-opus-4-7+` 모델 호출 시 `temperature` 미전달 (Anthropic 400 에러 방지). 정규식 `/^claude-opus-4-(7|[89]|\d{2,})/`로 향후 버전 자동 대응.
- **`migrateAiConfig` export**: `aiConfigStore`의 마이그레이션 함수를 분리 export하여 단위 테스트 가능. 기존 closure 내부 정의는 제거.

### Previous (2026-04-07)

- **MCP 정리**: `tauri-testing-mcp`에서 `oddeyes_*` semantic tools 8개 제거, `desktop_mcp.rs`에서 미사용 `load_confluence_page` 커맨드 제거, AppSettingsModal Claude Desktop 섹션 간소화.
- **테스트 타입 수정**: `adfToTipTap.test.ts`에 `AdfNode` 타입 적용, `confluenceTools.test.ts` 미사용 헬퍼 제거.
- **Rust 미사용 import 정리**: 4개 파일에서 `tracing::{debug, error}` 미사용 import 제거.

### Previous (2026-04-06)
- **ADF→TipTap Converter**: ADF(Atlassian Document Format) → TipTap JSON 변환기 추가 (`adfToTipTap.ts`). `oddeyes_set_source_document`에서 `format: "adf"` 지원.
- **ResizableProjectSidebar**: ProjectSidebar 너비 160–300px 범위에서 드래그 리사이즈 가능.
- **Atlassian MCP SSE→Streamable HTTP 마이그레이션**: SSE 방식에서 Streamable HTTP로 전환.

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

### Available MCP Tools (33개)
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
