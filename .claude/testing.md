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

### E2E Test Files

| File | Tests |
|------|-------|
| `e2e/user-story.spec.ts` | 프로젝트 생성, 문서 입력, 번역/리뷰 UI 검증 (6 TC) |
| `e2e/paste-normalizer.spec.ts` | HTML 붙여넣기 정규화 (Confluence, XSS, 테이블 등) |

### Test Harness

`http://localhost:1421/test-harness.html`에서 붙여넣기 정규화를 실시간 테스트:
- Input HTML / Normalized HTML / Editor HTML / Editor JSON 비교
- Quick Test Cases 버튼으로 엣지 케이스 테스트
- 실제 TipTap 에디터와 동일한 설정 사용

### Unit Test Files (24 files, 391 tests, 22 skipped)

| File | Tests | Description |
|------|-------|-------------|
| `src/ai/prompt.test.ts` | 19 | `detectRequestType`, `buildBlockContextText` |
| `src/ai/review/parseReviewResult.test.ts` | 32 | `parseReviewResult`, `deduplicateIssues` |
| `src/ai/review/runReview.test.ts` | 11 (8 skip) | Review pipeline, chunk processing |
| `src/ai/translateDocument.test.ts` | 28 (11 skip) | `isTimeoutError`, `isRetryableTranslationError`, `formatTranslationError` |
| `src/ai/tools/buildAlignedChunks.test.ts` | 8 | `buildAlignedChunks`, `buildAlignedChunksAsync` |
| `src/components/review/reviewApply.test.ts` | 8 | Review suggestion apply logic |
| `src/editor/extensions/ReviewHighlight.test.ts` | 6 | ReviewHighlight decoration |
| `src/editor/extensions/SearchHighlight.test.ts` | 5 | SearchHighlight normalization |
| `src/stores/aiConfigStore.test.ts` | 3 | Key loading latch, concurrent call prevention |
| `src/stores/chatStore.selectors.test.ts` | 7 | Grouped Zustand selectors |
| `src/stores/chatStore.integration.test.ts` | 10 (3 skip) | Session/message CRUD integration |
| `src/stores/historyStore.test.ts` | 3 | History store snapshot create/list race/rename behavior |
| `src/stores/connectorStore.test.ts` | 4 | ConnectorsSection selector optimization |
| `src/stores/reviewStore.test.ts` | 2 | ReviewPanel selector optimization |
| `src/stores/uiStore.test.ts` | 3 | UI state management |
| `src/utils/normalizeForSearch.test.ts` | 31 | `normalizeForSearch`, Unicode normalization |
| `src/utils/imagePlaceholder.test.ts` | 27 | `extractImages`, `restoreImages`, token savings |
| `src/utils/wordCounter.test.ts` | 79 | `countWords`, MS Word style word counting |
| `src/utils/htmlContentExtractor.test.ts` | 25 | `extractContent`, Confluence HTML parsing |
| `src/utils/markdownConverter.test.ts` | varies | TipTap ↔ Markdown conversion |
| `src/utils/cleanSuggestionContent.test.ts` | 12 | Suggestion content cleanup |

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
