# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OddEyes.ai** (internal codename: Integrated Translation Editor / ITE) is a professional translation workstation built with Tauri (Rust) and React (TypeScript). It features a Notion-style document editor powered by TipTap, integrated AI chat with LangChain, and MCP (Model Context Protocol) server integration for external knowledge sources.

**Core Philosophy**: "AI를 동료로, 번역을 예술로" - Translator-led workflow where AI assists only when requested. The translator maintains full control over the translation process.

## Essential Documentation

**Source of Truth**: `prd.md` (Product Requirements) and `trd.md` (Technical Requirements) are the authoritative documents. When conflicts arise between code and documentation, align with PRD/TRD.

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

## Architecture Overview

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Editor**: TipTap (ProseMirror) - dual instances for Source/Target documents
- **State Management**: Zustand with persistence
- **AI Integration**: LangChain.js (OpenAI only)
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

- **Request Type Detection**: `prompt.ts` → `detectRequestType()` analyzes user message to determine `translate` | `question` | `general`

- **Review Mode** (`ReviewPanel.tsx`):
  - AI-assisted translation review for error, omission, distortion, consistency issues
  - Document split into chunks → sequential AI review → JSON result parsing
  - Results displayed in table with checkboxes
  - Checked issues highlighted in Target editor via TipTap Decoration
  - Non-intrusive: no automatic document modification

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
- `aiConfigStore.ts`: AI provider settings, model selection, system prompts
- `connectorStore.ts`: MCP connector states (Confluence, Notion, web search)
- `uiStore.ts`: Layout state, Focus Mode, panel positions/sizes, sidebar width, floating button position
- `reviewStore.ts`: Translation review state (chunks, results, check states, highlight)

#### 6. Security: API Key Management
- **Primary Storage**: OS keychain (macOS Keychain, Windows Credential Manager, Linux keyring)
- **Unified JSON Bundle**: All API keys stored as single encrypted JSON
- **User Input**: App Settings → API Key entry → keychain storage
- **No Fallbacks**: Environment variables (`VITE_*`) not used for security
- **Commands**: `src-tauri/src/commands/secure_store.rs`

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
- Attachments (total): 50,000 chars

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
2. **Chat History**: `question` mode includes last 20 messages (configurable); `translate` mode excludes all history.
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
21. **Cross-Store Subscription for State Invalidation**: Use Zustand's `subscribe()` to monitor state changes in other stores. Example: `reviewStore` subscribes to `projectStore.targetDocJson` changes to invalidate highlights when the document is modified.
22. **Fresh State in Callbacks**: When using callbacks that execute over time (like chunk processing loops), use `getState()` instead of closure-captured values to ensure fresh state. Example: `useChatStore.getState()` in `ReviewPanel` to get latest `translationRules`.
23. **Tool Handler Null Safety**: Always check for null `project` in AI tool handlers before accessing project-related state. Return meaningful error messages like "프로젝트가 로드되지 않았습니다" instead of generic errors.
24. **SearchHighlight Extension Pattern**: Use `buildTextWithPositions()` for cross-node text search (same pattern as ReviewHighlight). Replace operations must recalculate matches after each replacement due to position shifts.
25. **Editor Search Shortcut Scope**: Search (Cmd+F) triggers on Source panel, Replace (Cmd+H) triggers on Target panel only. Both shortcuts require panel focus to avoid global conflicts.

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
  - `hash.ts`: Content hashing, `stripHtml`
  - `diff.ts`: Diff utilities
- **UI Components**: Organized by layout hierarchy
  - `components/panels/`: SettingsSidebar, FloatingChatPanel, SourcePanel, TargetPanel
  - `components/chat/`: ChatContent (extracted from ChatPanel)
  - `components/ui/`: FloatingChatButton, common UI components
  - `components/editor/`: Editor-related UI
  - `components/review/`: ReviewPanel, ReviewResultsTable
- **Review Feature**: `src/ai/review/` (parsing), `src/components/review/` (UI), `src/editor/extensions/ReviewHighlight.ts`
- **Search/Replace Feature**: `src/editor/extensions/SearchHighlight.ts` (TipTap extension), `src/components/editor/SearchBar.tsx` (UI)

## When Adding New Features

1. Check PRD/TRD for requirements alignment
2. Update relevant Zustand store(s)
3. Add Tauri command if backend logic needed
4. Create/update UI components
5. Add i18n keys to both `ko.json` and `en.json`
6. Test with real AI API calls (not mocked)
7. Verify SQLite persistence across sessions

## Version Control

- **Branch Strategy**: `main` (stable), `alpha-1.0` (active development)
- **Commit Messages**: Use imperative mood (Korean preferred based on git log)
- **PR Requirements**: Not specified; use discretion
