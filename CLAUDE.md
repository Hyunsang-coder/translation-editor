# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OddEyes.ai** (internal codename: Integrated Translation Editor / ITE) is a professional translation workstation built with Tauri (Rust) and React (TypeScript). It features a Notion-style document editor powered by TipTap, integrated AI chat with LangChain, and MCP (Model Context Protocol) server integration for external knowledge sources.

**Core Philosophy**: "AI를 동료로, 번역을 예술로" - Translator-led workflow where AI assists only when requested. The translator maintains full control over the translation process.

## Essential Documentation

**Source of Truth**: `prd.md` (Product Requirements) and `docs/trd/` (Technical Requirements) are the authoritative documents. When conflicts arise between code and documentation, align with PRD/TRD.

**TRD 문서 구조** (세부 스펙은 해당 파일 참조):
- `docs/trd/README.md` - 개요 및 인덱스
- `docs/trd/01-architecture.md` - 아키텍처
- `docs/trd/02-editor.md` - 에디터 엔진
- `docs/trd/03-ai-interaction.md` - AI 상호작용
- `docs/trd/04-chat-ux.md` - Chat UX
- `docs/trd/05-review.md` - 번역 검수
- `docs/trd/06-attachments.md` - 첨부 파일
- `docs/trd/07-concurrency.md` - 동시성 패턴
- `docs/trd/08-storage.md` - 데이터 저장
- `docs/trd/09-specialized.md` - 특화 기능
- `docs/trd/10-dev-tools.md` - 개발 도구
- `docs/trd/11-api-keys.md` - API Key 관리
- `docs/trd/12-i18n.md` - 다국어 지원

## Development Commands

### Development
```bash
# Install dependencies
npm install

# Start dev server (frontend + Tauri)
npm run tauri:dev

# Start frontend only (Vite)
npm run dev

# Build frontend
npm run build
```

### Tauri/Rust Commands
```bash
# Build release app
npm run tauri:build

# Build sidecar binary (MCP connector)
npm run build:sidecar
```

### Project Structure
```bash
# Frontend testing - no test suite configured yet
# Backend testing
cd src-tauri && cargo test
```

### Git Hooks (Husky)
- **pre-commit**: Runs `npx tsc --noEmit` for type checking before commit
- **post-merge**: Auto-runs `npm install` when `package-lock.json` changes after `git pull`
- Setup: `npm install -D husky && npx husky init`

## Architecture Overview

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Editor**: TipTap (ProseMirror) - dual instances for Source/Target documents
- **State Management**: Zustand with persistence
- **AI Integration**: LangChain.js (OpenAI + Anthropic multi-provider)
- **UI Layout**: Hybrid Panel Layout (Settings sidebar + Floating Chat with react-rnd)
- **Backend**: Tauri 2 + Rust
- **Storage**: SQLite (`.ite` project files)
- **i18n**: i18next (Korean/English UI)

### Key Design Decisions

#### 1. TipTap Document-First Approach
- **Two Editor Instances**: Source (left, editable) and Target (right, editable)
- **Storage Format**: TipTap JSON stored in SQLite `documents` table
- **Supported Formats**: Headings (H1-H6), lists, bold, italic, strike, blockquote, links, tables, images
- **Editor-only Formats**: Underline, Highlight, Subscript, Superscript (lost during Markdown conversion)
- **Notion-Style UX**: Pretendard font, 16px, line-height 1.8, max-width 800px
- Both editors are editable; Focus Mode can hide Source panel

#### 2. AI Interaction Model
- **Translation Mode** (`translateDocument.ts`):
  - Full Source document → **Markdown** → LLM → **Markdown** → TipTap JSON → Preview modal → Apply to Target
  - No chat history in payload
  - Output enforced as **Markdown only** (with `---TRANSLATION_START/END---` markers)
  - Uses: System Prompt + Translation Rules + Project Context + Glossary
  - **Markdown Pipeline**: Uses `tiptap-markdown` for TipTap ↔ Markdown conversion
    - Token-efficient: No JSON structure overhead
    - Simplified chunking: Context-aware text splitting (respects code blocks, lists)
  - **Dynamic max_tokens**: Calculated based on input document size (GPT-5 400k context)
  - **Image Placeholder**: Base64 images replaced with placeholders before translation, restored after (saves 99%+ tokens)
  - **Truncation Detection**: Detects unclosed code blocks, incomplete links at document end (conservative to avoid false positives)
  - **Retry on Error**: Preview modal shows retry button for recoverable errors

- **Chat/Question Mode** (`chat.ts`):
  - User-initiated Q&A with chat history (max 20 messages, configurable via `VITE_AI_MAX_RECENT_MESSAGES`)
  - **On-demand document access**: Documents NOT included in initial payload
  - Uses Tool Calling to fetch Source/Target when needed
  - Prevents unnecessary token consumption

- **Request Type Detection**: `prompt.ts` → `detectRequestType()` analyzes user message (used for analytics, not for blocking)

- **Review Mode** (`ReviewPanel.tsx` + `runReview.ts`):
  - AI-assisted translation review for error, omission, distortion, consistency issues
  - Document split into chunks → sequential AI review → JSON result parsing
  - Results displayed in table with checkboxes, action buttons (Apply/Copy/Ignore)
  - Checked issues highlighted in Target editor via TipTap Decoration
  - **Apply Suggestion**: Click "적용" to replace targetExcerpt with suggestedFix in editor
  - **Copy for Omission**: Omission type shows "복사" button (clipboard copy) instead of Apply
  - Non-intrusive: no automatic document modification
  - **Dedicated Review API** (`src/ai/review/runReview.ts`): Bypasses chat infrastructure for faster response
    - No tool calling overhead (single API call per chunk)
    - Uses `useFor: 'translation'` to disable Responses API
    - Streaming with `onToken` callback for real-time progress

#### 3. Tool Calling Architecture
Implemented in `src/ai/chat.ts` with LangChain tools:
- `get_source_document`: Fetch Source document **as Markdown** - proactively called for document-related questions
- `get_target_document`: Fetch Target document **as Markdown** - proactively called for translation quality questions
- `suggest_translation_rule`: AI proposes new translation rules
- `suggest_project_context`: AI proposes context additions

**Document Tools Return Markdown**: When TipTap JSON is available, document tools convert to Markdown preserving formatting (headings, lists, bold, etc.). Falls back to plain text if conversion fails.

**Proactive Tool Usage Policy**: AI is instructed to call document tools first rather than guessing. Tool calling loop allows up to 6 steps (max 12) to support complex queries.

User confirms before suggestions are added (no automatic application).

#### 4. MCP Integration (Sidecar Pattern)
- **Confluence Search**: `mcp-rovo-confluence-server` runs as sidecar binary (Node.js packaged with `pkg`)
- **Notion Integration**: Direct API calls via Integration Token
- **Web Search**: Brave Search API + OpenAI Web Search
- **OAuth Flow**: Lazy authentication - toggle enables tool, "Connect" button initiates OAuth
- No external Node.js dependency; all bundled as binaries

#### 5. State Management (Zustand Stores)
Critical stores in `src/stores/`:
- `projectStore.ts`: Project metadata, Source/Target documents, glossary, attachments
  - **`sourceDocJson` / `targetDocJson`**: TipTap JSON cache for AI tools (initialized on project load)
- `chatStore.ts`: Multi-tab chat sessions, messages, tool call tracking
- `aiConfigStore.ts`: AI provider enable flags (`openaiEnabled`/`anthropicEnabled`), model selection, system prompts
- `connectorStore.ts`: MCP connector states (Confluence, Notion, web search)
- `uiStore.ts`: Layout state, Focus Mode, panel positions/sizes, sidebar width, floating button position
- `reviewStore.ts`: Translation review state (chunks, results, check states, highlight)

#### 6. Security
- **API Key Storage**: OS keychain (macOS Keychain, Windows Credential Manager, Linux keyring)
  - Unified JSON bundle, no environment variable fallbacks
  - Commands: `src-tauri/src/commands/secure_store.rs`
- **XSS Prevention**: DOMPurify sanitization for pasted HTML content
  - URL protocol validation (blocks `javascript:`, `data:`, `vbscript:`)
  - Allowlist-based tag/attribute filtering
  - Implementation: `src/utils/htmlNormalizer.ts`
- **Path Traversal Prevention**: Rust-side path validation for file imports
  - Blocks system directories (`/etc`, `/System`, `C:\Windows`, etc.)
  - Applied to CSV/Excel glossary imports
  - Implementation: `src-tauri/src/utils/mod.rs` → `validate_path()`
- **DoS Prevention**: Input length limits enforced in UI and backend
  - Translation Rules: 10,000 chars, Context: 30,000 chars, Glossary: 30,000 chars

## Critical Implementation Patterns

### TipTap Integration
```typescript
// Editor instances: src/components/panels/SourcePanel.tsx, TargetPanel.tsx
// Document builders: src/editor/sourceDocument.ts, targetDocument.ts
// TipTap JSON ↔ SQLite: projectStore.ts → loadProject/saveProject
// Review highlight: src/editor/extensions/ReviewHighlight.ts (Decoration-based, non-persistent)
// Search/Replace: src/editor/extensions/SearchHighlight.ts + src/components/editor/SearchBar.tsx
```

**Key Principle**: TipTap JSON is the canonical format. Never bypass JSON format when saving/loading.

### AI Payload Construction
```typescript
// Chat mode: src/ai/prompt.ts → buildLangChainMessages()
//   Uses ChatPromptTemplate with MessagesPlaceholder
//   Documents accessed via Tool Calling (on-demand)

// Translation mode: src/ai/translateDocument.ts
//   Uses Markdown pipeline: TipTap JSON → Markdown → LLM → Markdown → TipTap JSON
//   Direct message array: SystemMessage + HumanMessage
//   Full Source document converted to Markdown string
//   No chat history
```

**Token Limits** (GPT-5 400k context window):
- Translation Rules: 10,000 chars
- Project Context: 30,000 chars
- Glossary: 30,000 chars
- Documents: 100,000 chars (chat mode uses on-demand fetch)
- Attachments (per file): 30,000 chars
- Attachments (total): 100,000 chars
- Chat images: max 10 images, 10MB each

### Tauri Commands Pattern
```rust
// Commands: src-tauri/src/commands/*.rs
// Invocation: src/tauri/*.ts (TypeScript wrappers)

// Example pattern:
// Rust: #[tauri::command] async fn load_project(...)
// TS: export async function loadProject(...) { return invoke('load_project', ...) }
```

All async Tauri commands use `async fn`. State is passed via Tauri's State management.

### SQLite Schema
- `projects`: Project metadata (id, name, domain, languages, settings)
- `documents`: Source/Target TipTap JSON blobs
- `chat_sessions`: Chat tabs with metadata
- `chat_messages`: Messages with tool calls, parent references
- `glossary`: Term pairs (source/target)
- `attachments`: Reference documents

**Auto-save**: Changes trigger `isDirty` flag → periodic save to SQLite.

## Development Workflow

### Adding New AI Features
1. Define system prompt in `src/ai/prompt.ts`
2. Add tool definition if needed (LangChain DynamicStructuredTool)
3. Update `buildLangChainMessages()` or create new prompt builder
4. Handle response in `src/ai/chat.ts` or dedicated module
5. Update UI component to trigger new workflow

### Adding MCP Servers
1. Server config in `src-tauri/src/mcp/` (Rust)
2. Frontend store in `connectorStore.ts`
3. Sidecar build script in `scripts/build-sidecar.mjs` (if Node.js based)
4. UI toggle in Settings panel
5. Tool integration in chat composer (`+` menu)

### Modifying Editor Behavior
1. TipTap extensions: `src/editor/` directory
2. Document builders: `sourceDocument.ts`, `targetDocument.ts`
3. Store updates: `projectStore.ts` → setSourceDoc/setTargetDoc
4. UI components: `SourcePanel.tsx`, `TargetPanel.tsx`

## Important Constraints

### UI/UX Rules
- **No Auto-Apply**: AI never modifies documents without user confirmation
- **Preview-First**: Translation results shown in modal before applying
- **Keyboard-First**: All core actions have shortcuts (Cmd+L for Add to Chat, etc.)
- **Focus Mode**: Source panel can be hidden (3-panel → 2-panel)
- **Hybrid Panel Layout**:
  - Settings/Review sidebar: Fixed right sidebar with draggable width (280-600px)
  - Floating Chat panel: Draggable/resizable via react-rnd (min 320×400px)
  - Floating Chat button: Draggable FAB, double-click to reset position
  - **Chat Pin Feature**: Pin button in header prevents auto-minimize on outside click (minimize button always works)
- **Chat Composer**:
  - `+` button (bottom-left) for attachments/web search toggle
  - Send button (bottom-right) as arrow icon
  - Enter to send, Shift+Enter for newline

### Translation Workflow
1. User writes Source document
2. User clicks "Translate" button
3. AI generates translation → Preview modal with diff view
4. If error occurs → Retry button shown in modal (recoverable errors only)
5. User reviews and clicks "Apply" → Target document replaced entirely
6. User manually edits Target if needed

### Context Limits
- Translation Rules max 10,000 chars (App Settings enforced)
- Context blocks max 20 blocks, 500 chars each
- Glossary auto-injected via text search (no vector DB)

## Common Gotchas

1. **TipTap JSON Format**: Always validate JSON structure before storing. Fallback to plain text on parse errors.
2. **Chat History**: Chat mode includes last 20 messages (configurable); Translate button workflow excludes all history.
3. **Tool Calling**: AI proactively calls document tools for relevant questions. Web search enabled by default for new sessions.
4. **Keychain Access**: First run requires OS authentication prompt for keychain access.
5. **Sidecar Lifecycle**: MCP sidecar processes must be cleaned up on app exit.
6. **i18n Keys**: Match keys in `src/i18n/locales/ko.json` and `en.json`.
7. **Mock Provider**: Mock mode is not supported for translation. Setting `mock` provider throws an error with guidance to configure OpenAI API key.
8. **Translation Truncation**: Large documents may cause response truncation. Dynamic max_tokens calculation and truncation detection handle this automatically.
9. **Markdown Translation Pipeline**: Translation uses Markdown as intermediate format (NOT TipTap JSON directly). TipTap ↔ Markdown conversion via `tiptap-markdown` extension. Output uses `---TRANSLATION_START/END---` markers.
10. **AbortSignal Propagation**: When using `AbortController` for request cancellation, always pass `abortSignal` to `streamAssistantReply`. Creating the controller alone doesn't cancel requests.
11. **JSON Parsing with Brace Counting**: Avoid greedy regex for JSON extraction. Use brace counting (`extractJsonObject` in `parseReviewResult.ts`) to handle nested objects and extra brackets in AI responses.
12. **TipTap Decoration Cross-Node Search**: Use `buildTextWithPositions()` to build full text/position mapping before searching. Simple `indexOf` on individual nodes fails for text spanning node boundaries.
13. **Abort Existing Requests**: In `chatStore.ts`, always abort existing `abortController` before starting new translate or web search requests to prevent response mixing.
14. **Session Null Handling**: When creating sessions at max limit, ensure `currentSession` is updated to prevent null reference errors in subsequent operations.
15. **Review Chunk Size Consistency**: Use `DEFAULT_REVIEW_CHUNK_SIZE` constant (12000) from `reviewTool.ts` for both initial chunking and subsequent operations to maintain segment alignment.
16. **TipTap JSON Initialization on Project Load**: `sourceDocJson`/`targetDocJson` must be initialized in `projectStore` at project load time (via `htmlToTipTapJson`), not just on editor mount. This ensures AI tools work in Focus Mode (Source panel hidden).
17. **Extension Sync Between Editor and Converter**: `markdownConverter.ts`'s `getExtensions()` must include all extensions used by `TipTapEditor.tsx` (including Underline, Highlight, Subscript, Superscript) to prevent JSON parsing errors like "no mark type underline in schema".
18. **Streaming Finalization Guard**: Use `isFinalizingStreaming` flag in `chatStore.ts` to prevent race conditions when streaming completes while a new message is being sent. Wait for finalization to complete before starting new requests.
19. **AbortController Immediate Cleanup**: After calling `abort()` on an AbortController, immediately set `abortController: null` in state to prevent stale references during the race window before creating a new controller.
20. **Debounce Timer Project ID Verification**: When using debounced persist operations (like `schedulePersist`), capture the project ID at schedule time and verify it hasn't changed before executing the persist. This prevents saving chat data to the wrong project.
21. **Review Highlight Auto-Recalculation**: `ReviewHighlight.ts` ProseMirror plugin automatically recalculates decorations on `tr.docChanged`. No cross-store subscription needed - highlights persist through manual edits, removing only when the target text is no longer found.
22. **Fresh State in Callbacks**: When using callbacks that execute over time (like chunk processing loops), use `getState()` instead of closure-captured values to ensure fresh state. Example: `useChatStore.getState()` in `ReviewPanel` to get latest `translationRules`.
23. **Tool Handler Null Safety**: Always check for null `project` in AI tool handlers before accessing project-related state. Return meaningful error messages like "프로젝트가 로드되지 않았습니다" instead of generic errors.
24. **SearchHighlight Extension Pattern**: Use `buildTextWithPositions()` for cross-node text search (same pattern as ReviewHighlight). Replace operations must recalculate matches after each replacement due to position shifts.
25. **Editor Search Shortcut Scope**: Search (Cmd+F) triggers on Source panel, Replace (Cmd+H) triggers on Target panel only. Both shortcuts require panel focus to avoid global conflicts.
26. **Editor Registry for Cross-Component Access**: Use `editorRegistry.ts` (`getSourceEditor`, `getTargetEditor`) to access editor instances from non-editor components (e.g., ReviewPanel applying suggestions).
27. **Markdown Normalization for Search**: Use `normalizeForSearch()` to strip markdown formatting (bold, italic, list markers) before searching in TipTap editor's plain text. AI responses often include markdown in excerpts.
28. **Review Apply vs Copy by Issue Type**: "오역/왜곡/일관성" types use Apply (replace in editor), "누락" type uses Copy (clipboard) since the text doesn't exist in target document.
29. **Review Apply Deletes Issue**: When "적용" button is clicked, `deleteIssue(issue.id)` removes the issue from results. The highlight disappears automatically on next `tr.docChanged` recalculation since the issue no longer exists in `getCheckedIssues()`.
30. **Multi-Provider Model Selection**: Model selection determines provider automatically (`claude-*` → Anthropic, others → OpenAI). No explicit `provider` field; use `openaiEnabled`/`anthropicEnabled` checkboxes in App Settings. At least one provider must be enabled.
31. **Model Dropdown with optgroup**: Translation/Chat model selectors use `<optgroup>` to group models by provider (OpenAI/Anthropic). Only enabled providers' models are shown.
32. **Review API Optimization**: Use `runReview()` from `src/ai/review/runReview.ts` for review operations instead of chat infrastructure. This bypasses tool calling and Responses API for significantly faster response times.
33. **Fresh Chunks on Review Start**: Always regenerate chunks with `buildAlignedChunks(project)` at review start time, not from cached store state. This ensures the review uses the latest document content.
34. **Marker-based JSON Extraction**: Review responses use `---REVIEW_START/END---` markers. `extractMarkedJson()` tries marker extraction first, then falls back to brace counting. This prevents parsing failures when AI includes extra text outside JSON.
35. **Review Streaming Text State**: `reviewStore.streamingText` stores current chunk's AI response for real-time display. Updated via `onToken` callback in `runReview()`. Preserved after completion for debugging.
36. **Elapsed Timer Pattern**: Use `useEffect` with `setInterval` for elapsed time tracking during async operations. Clear interval on completion or unmount. Store `elapsedSeconds` in component state, not global store.
37. **HTML Paste Sanitization**: Use `htmlNormalizer.ts` with DOMPurify for pasted HTML (especially from Confluence). Validates URL protocols (blocks `javascript:`, `data:`, `vbscript:`), strips dangerous attributes, and normalizes inline styles to semantic tags.
38. **Path Validation in Rust**: Use `validate_path()` from `src-tauri/src/utils/mod.rs` for all file import commands (CSV, Excel). Blocks access to system directories (`/etc`, `/System`, `C:\Windows`, etc.) to prevent path traversal attacks.
39. **Git Hooks with Husky**: `.husky/pre-commit` runs TypeScript type check (`npx tsc --noEmit`). `.husky/post-merge` auto-runs `npm install` when `package-lock.json` changes. Ensures type safety and dependency consistency.
40. **Bidirectional Text Normalization for Highlight**: `ReviewHighlight.ts` and `SearchHighlight.ts` use `buildNormalizedTextWithMapping()` with shared `applyUnicodeNormalization()` from `normalizeForSearch.ts`. This handles Unicode special spaces, CRLF, consecutive whitespace, and **quote normalization** (curly quotes `""`→`"`, CJK brackets `「」『』`→`"`, fullwidth quotes).
41. **Chat Panel Pin State**: `uiStore.chatPanelPinned` controls whether outside clicks minimize the floating chat panel. Pin state persists across sessions.
42. **GPT-4.1 Temperature Handling**: GPT-4.1 requires explicit temperature parameter (unlike GPT-5 which doesn't support it). In `client.ts`, `isGpt5 = model.startsWith('gpt-5')` determines whether to include temperature. GPT-4.1 automatically receives temperature since it doesn't match the `gpt-5` prefix.

## Testing Patterns

- **Frontend**: No test framework configured (use manual testing)
- **Backend**: Rust unit tests in `src-tauri/src/` with `cargo test`
- **Integration**: Test full workflows (load project → edit → save → AI chat)

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
- **Sidecar Not Starting**: Check `scripts/build-sidecar.mjs` output
- **OAuth Failures**: Verify redirect URIs in MCP server config
- **SSE Connection Drops**: Check network logs for event stream errors

## File Organization Principles

- **Feature Co-location**: Related files grouped by feature (e.g., `ai/`, `editor/`, `stores/`)
- **Type Definitions**: `src/types/index.ts` for shared interfaces
- **Tauri Wrappers**: `src/tauri/*.ts` mirrors `src-tauri/src/commands/*.rs`
- **Utilities**: `src/utils/` for shared helpers
  - `markdownConverter.ts`: TipTap JSON ↔ Markdown conversion (`tipTapJsonToMarkdown`, `markdownToTipTapJson`, `htmlToTipTapJson`)
  - `imagePlaceholder.ts`: Image URL extraction/restoration for translation (`extractImages`, `restoreImages`)
  - `normalizeForSearch.ts`: Markdown normalization for text search (`normalizeForSearch`, `stripMarkdownInline`)
  - `htmlNormalizer.ts`: HTML sanitization for pasted content (DOMPurify + URL protocol validation)
  - `hash.ts`: Content hashing, `stripHtml`
  - `diff.ts`: Diff utilities
- **UI Components**: Organized by layout hierarchy
  - `components/panels/`: SettingsSidebar, FloatingChatPanel, SourcePanel, TargetPanel
  - `components/chat/`: ChatContent (extracted from ChatPanel)
  - `components/ui/`: FloatingChatButton, common UI components
  - `components/editor/`: Editor-related UI
  - `components/review/`: ReviewPanel, ReviewResultsTable
- **Review Feature**: `src/ai/review/` (runReview.ts, parseReviewResult.ts), `src/components/review/` (UI), `src/editor/extensions/ReviewHighlight.ts`
- **Search/Replace Feature**: `src/editor/extensions/SearchHighlight.ts` (TipTap extension), `src/components/editor/SearchBar.tsx` (UI)
- **Editor Registry**: `src/editor/editorRegistry.ts` - Global access to TipTap editor instances for cross-component operations

## When Adding New Features

1. Check PRD/TRD for requirements alignment
2. Update relevant Zustand store(s)
3. Add Tauri command if backend logic needed
4. Create/update UI components
5. Add i18n keys to both `ko.json` and `en.json`
6. Test with real AI API calls (not mocked)
7. Verify SQLite persistence across sessions

## Version Management

### Version Files (Must Stay in Sync)
- `package.json` → `"version": "x.y.z"`
- `src-tauri/Cargo.toml` → `version = "x.y.z"`
- `src-tauri/tauri.conf.json` → `"version": "x.y.z"`

### When to Update Version
주요 기능 추가, 버그 수정, 또는 릴리즈 준비 시 버전 업데이트를 제안할 것. 작업 완료 후 변경 규모에 따라 `/bump-version` 실행을 권장.

### SemVer Guidelines
| Type | When | Example |
|------|------|---------|
| **major** | Breaking changes, DB schema changes | 1.0.0 → 2.0.0 |
| **minor** | New features, UI improvements | 1.0.0 → 1.1.0 |
| **patch** | Bug fixes, docs, refactoring | 1.0.0 → 1.0.1 |

### Version Update Command
```
/bump-version          # 변경사항 분석 후 버전 타입 제안
/bump-version minor    # minor 버전으로 업데이트
```

## Version Control

- **Branch Strategy**: `main` (stable), `alpha-1.0` (active development)
- **Commit Messages**: Use imperative mood (Korean preferred based on git log)
- **PR Requirements**: Not specified; use discretion
