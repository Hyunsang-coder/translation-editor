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

## E2E Testing (Playwright)

```bash
npm run test:e2e      # Run all E2E tests
npm run test:e2e:ui   # Playwright UI mode
npm run test:harness  # Editor test harness (manual testing)
```

- **Framework**: Playwright
- **Location**: `e2e/*.spec.ts`
- **Config**: `playwright.config.ts`
- **Test Harness**: `src/test-harness/` - Tauri/API 키 없이 에디터만 독립 테스트

### E2E Test Files

| File | Tests |
|------|-------|
| `e2e/paste-normalizer.spec.ts` | HTML 붙여넣기 정규화 (Confluence, XSS, 테이블 등) |

### Test Harness

`http://localhost:1421/test-harness.html`에서 붙여넣기 정규화를 실시간 테스트:
- Input HTML / Normalized HTML / Editor HTML / Editor JSON 비교
- Quick Test Cases 버튼으로 엣지 케이스 테스트
- 실제 TipTap 에디터와 동일한 설정 사용

### Test Files

| File | Tests |
|------|-------|
| `src/ai/prompt.test.ts` | `detectRequestType`, `buildBlockContextText` |
| `src/ai/review/parseReviewResult.test.ts` | `parseReviewResult`, `deduplicateIssues` |
| `src/ai/tools/buildAlignedChunks.test.ts` | `buildAlignedChunks`, `buildAlignedChunksAsync` |
| `src/stores/chatStore.selectors.test.ts` | Grouped Zustand selectors |
| `src/utils/normalizeForSearch.test.ts` | `normalizeForSearch`, Unicode normalization |
| `src/utils/imagePlaceholder.test.ts` | `extractImages`, `restoreImages`, token savings |
| `src/utils/wordCounter.test.ts` | `countWords`, MS Word style word counting |
| `src/utils/htmlContentExtractor.test.ts` | `extractContent`, Confluence HTML parsing |

## Backend Testing (Rust)

```bash
cd src-tauri && cargo test
```

- **Location**: `src-tauri/src/` with `#[cfg(test)]` modules

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
│   │   ├── ReviewHighlight.ts
│   │   └── SearchHighlight.ts
│   └── editorRegistry.ts
├── stores/           # Zustand stores
│   ├── projectStore.ts
│   ├── chatStore.ts
│   ├── chatStore.selectors.ts
│   ├── aiConfigStore.ts
│   ├── connectorStore.ts
│   ├── uiStore.ts
│   └── reviewStore.ts
├── components/
│   ├── panels/       # SettingsSidebar, FloatingChatPanel, Source/TargetPanel
│   ├── chat/         # ChatContent, ChatComposerEditor
│   ├── ui/           # FloatingChatButton, Select, UpdateModal
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

- **Branch Strategy**: `main` (stable), `alpha-1.0` (active development)
- **Commit Messages**: Use imperative mood (Korean preferred)
