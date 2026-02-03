# Architecture

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS |
| Editor | TipTap (ProseMirror) - dual instances |
| State | Zustand with persistence |
| AI | LangChain.js (OpenAI + Anthropic) |
| UI Layout | Hybrid Panel (Settings sidebar + Floating Chat via react-rnd) |
| Toast | Sonner (position: top-center) |
| Backend | Tauri 2 + Rust |
| Storage | SQLite (`.ite` project files) |
| i18n | i18next (Korean/English) |
| Auto Update | Tauri updater plugin + GitHub Releases |

## Key Design Decisions

### 1. TipTap Document-First Approach

- **Two Editor Instances**: Source (left) and Target (right), both editable
- **Storage Format**: TipTap JSON stored in SQLite `documents` table
- **Supported Formats**: Headings (H1-H6), lists, bold, italic, strike, blockquote, links, tables, images
- **Editor-only Formats**: Underline, Highlight, Subscript, Superscript (lost during Markdown conversion)
- **Notion-Style UX**: Noto Sans KR font, 16px, line-height 1.8, max-width 800px
- Focus Mode can hide Source panel

### 2. AI Interaction Model

#### Translation Mode (`translateDocument.ts`)
- Full Source → **Markdown** → LLM → **Markdown** → TipTap JSON → Preview modal → Apply
- No chat history in payload
- Output uses `---TRANSLATION_START/END---` markers
- Uses: System Prompt + Translation Rules + Project Context + Glossary
- **Dynamic max_tokens** by model:
  - Claude: 64000 (Haiku 4.5 limit)
  - GPT-5: 65536
  - GPT-4o: 16384
- **Image Placeholder**: Base64 images replaced with placeholders (saves 99%+ tokens)

#### Chat/Question Mode (`chat.ts`)
- User-initiated Q&A with chat history (max 20 messages)
- **On-demand document access**: Documents NOT included in initial payload
- Uses Tool Calling to fetch Source/Target when needed

#### Review Mode (`runReview.ts`)
- AI-assisted review for errors, omissions, distortions, consistency
- Document split into chunks → sequential AI review → Markdown parsing
- Output format: Markdown with `---REVIEW_START/END---` markers (required `Suggestion` field)
- Results displayed in table with Apply/Copy/Ignore actions
- **Two Categories**:
  - **Comparison Review** (대조 검수): Source↔Target comparison
  - **Polishing** (폴리싱): Target-only inspection
- **Retranslation**: Uses `translateWithStreaming()` with all project settings (translationRules, projectContext, translatorPersona, glossary) + reviewIssues context

### 3. Tool Calling Architecture

Implemented in `src/ai/chat.ts` with LangChain tools:
- `get_source_document`: Fetch Source as Markdown
- `get_target_document`: Fetch Target as Markdown
- `suggest_translation_rule`: AI proposes new rules
- `suggest_project_context`: AI proposes context additions
- `confluence_word_count`: Count words in Confluence pages (번역 분량 산정)

**Proactive Tool Usage**: AI calls document tools first rather than guessing. Tool calling loop allows up to 6 steps.

**MCP Direct Invocation**: `confluence_word_count`는 MCP tool을 Tauri command로 직접 호출하여 LangChain을 거치지 않음. 페이지 전체 내용이 LLM 컨텍스트에 노출되지 않아 토큰 절약.

### 4. MCP Integration (Rust Native)

- **Confluence Search**: Rust SSE client with OAuth 2.1 PKCE (`src-tauri/src/mcp/client.rs`)
- **Notion Integration**: Rust HTTP client with Integration Token (`src-tauri/src/mcp/notion_client.rs`)
- **Web Search**: Brave Search API + OpenAI Web Search
- **OAuth Flow**: Lazy authentication - toggle enables tool, "Connect" initiates OAuth

### 5. State Management (Zustand Stores)

| Store | Purpose |
|-------|---------|
| `projectStore.ts` | Project metadata, documents, glossary, attachments |
| `chatStore.ts` | Multi-tab chat sessions, messages, tool calls |
| `aiConfigStore.ts` | Provider flags, model selection, system prompts |
| `connectorStore.ts` | MCP connector states |
| `uiStore.ts` | Layout state, Focus Mode, panel positions |
| `reviewStore.ts` | Review state, chunks, results, highlights |

**Important**: `sourceDocJson`/`targetDocJson` in projectStore are TipTap JSON caches for AI tools.

### 6. Security

#### API Key Storage
- OS keychain (macOS Keychain, Windows Credential Manager, Linux keyring)
- Unified JSON bundle, no environment variable fallbacks
- Commands: `src-tauri/src/commands/secure_store.rs`

#### XSS Prevention
- DOMPurify sanitization for pasted HTML
- URL protocol validation (blocks `javascript:`, `data:`, `vbscript:`)
- Implementation: `src/utils/htmlNormalizer.ts`

#### Path Traversal Prevention
- Rust-side path validation for file imports
- Blocks system directories (`/etc`, `/System`, `C:\Windows`)
- Implementation: `src-tauri/src/utils/mod.rs` → `validate_path()`

#### DoS Prevention
- Translation Rules: 10,000 chars
- Context: 30,000 chars
- Glossary: 30,000 chars

## SQLite Schema

| Table | Content |
|-------|---------|
| `projects` | Project metadata (id, name, domain, languages, settings) |
| `documents` | Source/Target TipTap JSON blobs |
| `chat_sessions` | Chat tabs with metadata |
| `chat_messages` | Messages with tool calls, parent references |
| `glossary` | Term pairs (source/target) |
| `attachments` | Reference documents |

**Auto-save**: Changes trigger `isDirty` flag → periodic save to SQLite.

## UI/UX Constraints

- **No Auto-Apply**: AI never modifies documents without user confirmation
- **Preview-First**: Translation results shown in modal before applying
- **Keyboard-First**: All core actions have shortcuts (Cmd+L for Add to Chat)
- **Focus Mode**: Source panel can be hidden (3-panel → 2-panel)
- **Hybrid Panel Layout**:
  - Settings/Review sidebar: Fixed right, draggable width (280-600px)
  - Floating Chat panel: Draggable/resizable via react-rnd (min 320×400px)
  - Chat Pin Feature: Prevents auto-minimize on outside click
- **Chat Composer**:
  - `+` button for attachments/web search toggle
  - Enter to send, Shift+Enter for newline
  - IME-aware Enter handling

## Token Limits

| Content | Limit |
|---------|-------|
| Translation Rules | 10,000 chars |
| Project Context | 30,000 chars |
| Glossary | 30,000 chars |
| Documents | 100,000 chars |
| Attachments (per file) | 30,000 chars |
| Attachments (total) | 100,000 chars |
| Chat images | max 10, auto-resized (Anthropic 5MB, OpenAI 20MB) |
