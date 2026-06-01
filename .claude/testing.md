# Testing & Debugging

## Frontend Testing (Vitest + Testing Library)

```bash
npm test              # Watch mode (development)
npm run test:run      # Single run (CI)
npm run test:ui       # Browser UI
npm run test:coverage # Coverage report
```

- **Framework**: Vitest with jsdom environment
- **Location**: Test files co-located with source (`*.test.ts`, `*.spec.ts`)
- **Setup**: `src/test/setup.ts` (Tauri mocking, DOM APIs)
- **Config**: `vitest.config.ts`
- **TDD Skill**: `/tdd` for Red-Green-Refactor workflow

### Test Env API Key Fallback

- `vitest.config.ts`가 테스트 실행 시 `.env.local`의 `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`를 `test.env`로 주입합니다.
- `getAiConfig()`는 **테스트 런타임에서만** `process.env` fallback을 허용합니다.
- 런타임 앱(Tauri)에서는 fallback을 사용하지 않고, 설정 화면/secure store 키를 사용합니다.

## Pre-Deploy Test Gate

```bash
npm run test:tauri    # ⭐ Full gate: lint + unit + e2e + rust + release check
```

Runs sequentially: `lint` → `test:run` → `test:e2e` → `cargo test` → `cargo check --release`

## E2E Testing (Tauri Smoke + Playwright)

```bash
npm run test:e2e          # Tauri smoke test (default, builds debug app)
npm run test:e2e:web      # Web harness (Playwright, optional)
npm run test:e2e:web:ui   # Playwright UI mode
npm run test:harness      # Editor test harness (manual testing)
```

- **Default (`test:e2e`)**: Tauri smoke test — `node scripts/tauri-smoke.mjs` (빌드 + 실행 검증)
- **Web (`test:e2e:web`)**: Playwright web harness — `playwright.web.config.ts`
- **Location**: `e2e/*.spec.ts`
- **Test Harness**: `src/test-harness/` - Tauri/API 키 없이 에디터만 독립 테스트

### Tauri Runtime Automation (Testing Plugin + MCP)

Tauri 런타임을 AI/MCP로 제어하려면 아래 2개를 함께 실행:

```bash
# 1) 앱 실행 (testing feature + env)
TAURI_TESTING_ENABLED=1 \
TAURI_TEST_TOKEN=tauri-testing-token \
TAURI_TEST_PORT=9988 \
npx tauri dev --features testing --no-watch --config src-tauri/tauri.conf.json --config '{"build":{"beforeDevCommand":""}}'

# 2) MCP 서버 실행 (다른 터미널)
TAURI_TEST_TOKEN=tauri-testing-token TAURI_TEST_PORT=9988 npm run tauri-testing-mcp:start
```

구성:
- Runtime bridge plugin: `crates/tauri-plugin-testing/`
- MCP server: `tauri-testing-mcp/`

주요 도구:
- DOM: `tauri_dom_query_selector`, `tauri_dom_click`, `tauri_dom_click_by_text`, `tauri_dom_fill`, `tauri_dom_fill_by_placeholder`, `tauri_dom_type_contenteditable`, `tauri_dom_type_contenteditable_by_selector`, `tauri_dom_wait_for_selector`, `tauri_dom_wait_for_text`
- Dialog: `tauri_dialog_get_state`, `tauri_dialog_set_auto_response`, `tauri_dialog_push_response`, `tauri_dialog_clear`

워크플로우 검증 스크립트:
- 실행: `npm run test:e2e:tauri:mcp:workflow`
- 파일: `scripts/tauri-testing-mcp-workflow.mjs`
- 검증 기준:
  - 원문 에디터에 5줄 계층형 bullet(`-`) 한국어 입력
  - 타깃 언어를 영어로 명시 선택(선택 실패 시 즉시 실패)
  - 채팅 패널에서 `번여문 내용 간략히 요약해줘` 전송
  - assistant 메시지가 새로 생성되고 오류(`⚠️`)가 아닌 응답인지 확인

### E2E Test Files

| File | Tests |
|------|-------|
| `e2e/user-story.spec.ts` | 프로젝트 생성, 문서 입력, 번역/리뷰 UI, 히스토리, 컨텍스트 메뉴 (7 TC) |
| `e2e/paste-normalizer.spec.ts` | HTML 붙여넣기 정규화 (Confluence, XSS, 테이블 등) |

### Test Harness

`http://localhost:1421/test-harness.html`에서 붙여넣기 정규화를 실시간 테스트:
- Input HTML / Normalized HTML / Editor HTML / Editor JSON 비교
- Quick Test Cases 버튼으로 엣지 케이스 테스트
- 실제 TipTap 에디터와 동일한 설정 사용

### Unit Test Files (as of 2026-06-01: 36 test files; table below lists the main ones)

| File | Tests | Description |
|------|-------|-------------|
| `src/ai/prompt.test.ts` | 19 | `detectRequestType`, `buildBlockContextText` |
| `src/ai/review/parseReviewResult.test.ts` | 32 | `parseReviewResult`, `deduplicateIssues` |
| `src/ai/review/runReview.test.ts` | 11 (3 skip) | Review pipeline, chunk processing |
| `src/ai/translateDocument.test.ts` | 28 (5 skip) | `isTimeoutError`, `isRetryableTranslationError`, `formatTranslationError` |
| `src/ai/config.test.ts` | 3 | 테스트 환경 API 키 fallback 우선순위 검증 |
| `src/ai/tools/buildAlignedChunks.test.ts` | 8 | `buildAlignedChunks`, `buildAlignedChunksAsync` |
| `src/components/review/reviewApply.test.ts` | 8 | Review suggestion apply logic |
| `src/editor/extensions/ReviewHighlight.test.ts` | 6 | ReviewHighlight decoration |
| `src/editor/extensions/SearchHighlight.test.ts` | 5 | SearchHighlight normalization |
| `src/stores/aiConfigStore.test.ts` | 3 | Key loading latch, concurrent call prevention |
| `src/stores/chatStore.selectors.test.ts` | 7 | Grouped Zustand selectors |
| `src/stores/chatStore.integration.test.ts` | 10 (3 skip) | Session/message CRUD integration |
| `src/stores/historyStore.test.ts` | 12 | History store snapshot create/list race/rename/createSnapshotIfChanged behavior |
| `src/components/settings/ConnectorsSection.test.tsx` | 4 | Connector selector/render optimization |
| `src/stores/reviewStore.test.ts` | 2 | ReviewPanel selector optimization |
| `src/stores/uiStore.test.ts` | 5 | syncChatPanels 복구 로직, toggleChatVisibility 양방향 토글 |
| `src/utils/normalizeForSearch.test.ts` | 31 | `normalizeForSearch`, Unicode normalization |
| `src/utils/imagePlaceholder.test.ts` | 27 | `extractImages`, `restoreImages`, token savings |
| `src/utils/wordCounter.test.ts` | 79 | `countWords`, MS Word style word counting |
| `src/utils/htmlContentExtractor.test.ts` | 25 | `extractContent`, Confluence HTML parsing |
| `src/utils/markdownConverter.test.ts` | varies | TipTap ↔ Markdown conversion |
| `src/utils/cleanSuggestionContent.test.ts` | 12 | Suggestion content cleanup |
| `src/utils/adfParser.test.ts` | 54 | ADF document parsing, section extraction |
| `src/ai/tools/notionTools.test.ts` | 9 | Notion token verification, error handling |
| `src/stores/chatStore.helpers.test.ts` | 10 | Chat store pure helper functions |
| `src/stores/layoutResolver.test.ts` | 13 | Layout resolver responsive breakpoints |
| `src/components/history/HistoryCompareModal.test.tsx` | 2 | History compare modal diff display |
| `src/components/history/HistoryTimeline.test.tsx` | 10 | History timeline snapshot list/modified badge |
| `src/components/history/HistoryRestoreDialog.autoSnapshot.test.tsx` | 2 | Auto-snapshot before restore |
| `src/components/editor/TranslatePreviewModal.history.test.tsx` | 2 | Auto-snapshot before translation apply |
| `src/components/review/ReviewPanel.test.tsx` | 3 | ReviewPanel empty document validation |
| `src/desktop/oddeyesAppBridge.test.ts` | 10 | Desktop bridge: method routing, getStatus/getSource, `setReviewIssues`(정규화/드롭/projectId 가드), `setTranslationContext`(replace/append/빈문자열/projectId 가드) |

## Backend Testing (Rust)

```bash
cd src-tauri && cargo test
```

- **Location**: `src-tauri/src/` with `#[cfg(test)]` modules
- **Current focus**: `db/mod.rs` snapshot lifecycle test (create/list/get/delete + rename + legacy null filtering)

## Integration Testing

- Test full workflows: load project → edit → save → AI chat
- Manual testing recommended for complex UI interactions

## Debugging Tips

### Frontend Issues

```bash
# Check Vite console for build errors
npm run dev

# Inspect Zustand state
# Use React DevTools → Components → find store hooks
```

### Backend Issues

```bash
# Rust compilation errors
cd src-tauri && cargo check

# Runtime errors
# Check Tauri console logs in dev mode
```

### AI Integration Issues

- **LangChain Errors**: Check `src/ai/client.ts` model initialization
- **Tool Call Failures**: Verify tool schemas match function signatures
- **Token Limit**: Reduce context size (glossary, context blocks, attachments)

### MCP Connection Issues

- **OAuth Failures**: Verify redirect URIs in MCP server config
- **SSE Connection Drops**: Check network logs for event stream errors

### Tauri Testing Bridge Issues

- **`Method not found: dom.*`**
  - 원인: Rust RPC 허용 목록 누락
  - 확인: `crates/tauri-plugin-testing/src/lib.rs`의 `handle_rpc_request` match arm

- **`failed to bind websocket server: Address already in use`**
  - 원인: 포트 충돌
  - 해결: `TAURI_TEST_PORT`를 다른 포트로 변경 (앱/MCP 동일 값 사용)

- **`unauthorized` / 연결 직후 종료**
  - 원인: 토큰 불일치
  - 해결: 앱 실행 env의 `TAURI_TEST_TOKEN`과 MCP 실행 env를 동일하게 맞춤

- **버튼/텍스트를 못 찾음**
  - 단일 CSS selector보다 `tauri_dom_click_by_text` + `selector` 범위 지정 사용
  - 다수 매치 시 `tauri_dom_query_selector`로 후보 수 확인 후 `index` 지정
  - 동적 렌더링 UI는 `tauri_dom_wait_for_selector` 또는 `tauri_dom_wait_for_text` 선행

- **확인 팝업 처리 실패**
  - DOM에 안 보이는 native dialog일 수 있음
  - `tauri_dialog_set_auto_response`로 기본 응답 정책 설정 후 실행
  - 필요 시 `tauri_dialog_push_response`로 다음 confirm/prompt 1회 응답 주입
  - 발생 이벤트는 `tauri_dialog_get_state`로 확인

## File Organization

### Feature Co-location
Related files grouped by feature (e.g., `ai/`, `editor/`, `stores/`)

### Key Directories

```
src/
├── ai/               # AI integration
│   ├── chat.ts       # Chat mode with tool calling
│   ├── translateDocument.ts
│   ├── client.ts     # LangChain model initialization
│   ├── prompt.ts     # Prompt construction
│   ├── review/       # Review feature
│   │   ├── runReview.ts
│   │   └── parseReviewResult.ts
│   └── tools/        # LangChain tools
│       └── confluenceTools.ts  # Confluence word count
├── editor/           # TipTap extensions
│   ├── extensions/
│   │   └── ReviewHighlight.ts
│   ├── utils/
│   │   └── replaceDocContent.ts  # ProseMirror 트랜잭션 기반 콘텐츠 교체
│   └── plugins/
│       └── pluginKeys.ts       # Plugin Key 중앙화
├── stores/           # Zustand stores
│   ├── projectStore.ts
│   ├── chatStore.ts          # 메인 컴포지션 (7개 슬라이스)
│   ├── chatStore.types.ts
│   ├── chatStore.helpers.ts
│   ├── chatStore.persist.ts
│   ├── chatStore.session.ts
│   ├── chatStore.ai.ts
│   ├── chatStore.settings.ts
│   ├── chatStore.selectors.ts
│   ├── aiConfigStore.ts
│   ├── connectorStore.ts
│   ├── editorStore.ts        # TipTap 에디터 인스턴스 관리
│   ├── uiStore.ts
│   └── reviewStore.ts
├── components/
│   ├── panels/       # SettingsSidebar, DockedChatPanel, Source/TargetPanel
│   ├── chat/         # ChatContent, ChatComposerEditor
│   ├── ui/           # Modal, Select, UpdateModal
│   ├── editor/       # TipTapMenuBar, SearchBar
│   └── review/       # ReviewPanel, ReviewResultsTable
├── utils/
│   ├── markdownConverter.ts      # TipTap ↔ Markdown
│   ├── imagePlaceholder.ts       # Image extraction/restoration
│   ├── imageResize.ts            # Canvas API resizing
│   ├── normalizeForSearch.ts     # Markdown normalization
│   ├── htmlNormalizer.ts         # HTML sanitization
│   ├── wordCounter.ts            # MS Word style word counting
│   ├── htmlContentExtractor.ts   # Confluence HTML content extraction
│   ├── hash.ts
│   └── diff.ts
├── hooks/
│   └── useAutoUpdate.ts
├── tauri/            # TypeScript wrappers for Tauri commands
├── types/
│   └── index.ts      # Shared interfaces
└── i18n/
    └── locales/
        ├── ko.json
        └── en.json

src-tauri/src/
├── commands/         # Tauri commands
│   ├── secure_store.rs
│   └── confluence.rs   # MCP tool direct invocation
├── mcp/
│   ├── client.rs     # Confluence SSE client
│   └── notion_client.rs
└── utils/
    └── mod.rs        # Path validation
```

## Version Management

### Version Files (Must Stay in Sync)
- `package.json` → `"version": "x.y.z"`
- `src-tauri/Cargo.toml` → `version = "x.y.z"`
- `src-tauri/tauri.conf.json` → `"version": "x.y.z"`

### SemVer Guidelines

| Type | When | Example |
|------|------|---------|
| **major** | Breaking changes, DB schema changes | 1.0.0 → 2.0.0 |
| **minor** | New features, UI improvements | 1.0.0 → 1.1.0 |
| **patch** | Bug fixes, docs, refactoring | 1.0.0 → 1.0.1 |

### Version Update Command
```
/bump-version          # Analyze changes, suggest version type
/bump-version patch    # Update to patch version
```

## Git Hooks

- **pre-commit**: Runs `npx tsc --noEmit` for type checking
- Location: `.git/hooks/pre-commit` (not version-controlled)
- No external dependency (husky removed)

## Version Control

- **Branch Strategy**: `main` (단일 브랜치, 직접 커밋)
- **Commit Messages**: Use imperative mood (Korean preferred)
