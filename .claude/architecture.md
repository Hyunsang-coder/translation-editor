# Architecture

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript (ES2022) + Vite + TailwindCSS |
| Editor | TipTap (ProseMirror) - dual instances |
| State | Zustand with persistence |
| AI | LangChain.js (OpenAI + Anthropic) |
| UI Layout | Dual Sidebar (Left + Right, independently collapsible) |
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
- Focus Mode: "원문 숨기기/보이기" button in editor header hides Source panel

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

#### Target Polishing Mode (`polishDocument.ts`)
- Target document only → **Markdown** → LLM → **Markdown** → TipTap JSON → Preview modal → Apply
- Triggered by the editor header `Polish` button next to Translate/Review
- Disabled when Target is empty; independent from ReviewPanel state and review issues
- Purpose: native-speaker polish for awkward collocations, phrasing, tone, and sentence structure
- Uses compact target-only prompt and existing project settings where relevant; never sends Source unless explicitly translating/reviewing

#### Chat/Question Mode (`chat.ts`)
- User-initiated Q&A with chat history (max 20 messages)
- **On-demand document access**: Documents NOT included in initial payload
- Uses Tool Calling to fetch Source/Target when needed

#### Review Mode (`runReview.ts`)
- AI-assisted review for errors, omissions, distortions, consistency, and native-speaker naturalness
- Document split into chunks → sequential AI review → Markdown parsing
- Output format: Markdown with `---REVIEW_START/END---` markers (required `Suggestion` field)
- Results displayed in table with Apply/Copy/Ignore actions
- **Tauri path**: `streamWithTauriAiBackend({ useFor: 'review' })` — model options via `resolveModelCallOptions` (thinking/effort/temperature)
- **Apply safety**: ambiguity guards (multi-match, fuzzy segment scope), block-boundary replace guard, conditional quote stripping at apply time
- **Comparison Review** (대조 검수): Source↔Target comparison plus target naturalness checks
- **Retranslation**: Uses `translateWithStreaming()` with all project settings (translationRules, projectContext, glossary) + reviewIssues context

### 3. Tool Calling Architecture

Bound in `src/ai/chat.ts`; the **single source of truth is `src/ai/tools/toolRegistry.ts`** — each descriptor carries the profiles it belongs to, its trust level, and its output cap. Do not maintain a second list here.

- Profiles: `general`, `selection-source`, `selection-target`, `selection-retranslate` (binds zero tools). `resolveChatToolNames()` derives the allowlist from profile + runtime requirements.
- Selection profiles swap whole-document reads for scoped ones: `get_selection_surroundings` (앞뒤 번역 단위, 방향별 최대 8) and `get_aligned_selection_context` (원문↔번역문 짝, 양방향).
- Write-ish tools only ever *propose* (`propose_selection_edit`, `propose_project_memory_change`, `suggest_*`); nothing mutates the document or DB directly ([ADR-0003](../docs/adr/0003-no-auto-apply-preview-first.md)).
- The tool list must not vary with message content — Anthropic renders the prefix as tools → system → messages, so a shifting list invalidates the system + history cache every turn.

**Proactive Tool Usage**: AI calls document tools first rather than guessing. Tool loop is 6 steps, or 4 when a selection is attached.

**MCP Direct Invocation**: Confluence 도구(`confluence_search`, `confluence_get_page`, `confluence_load_page`)는 서버 MCP 도구를 그대로 바인딩하지 않고, `mcp_call_tool` Tauri command를 호출하는 로컬 래퍼다 — 설명 토큰·결과 형태·출력 캡을 앱이 통제한다 ([ADR-0015](../docs/adr/0015-confluence-tools-as-local-wrappers.md)). `confluence_load_page`는 본문을 원문 에디터에 넣고 모델에는 성공 문구만 반환하므로 페이지 내용이 LLM 컨텍스트에 실리지 않는다. 반면 `confluence_get_page`는 본문을 모델에 넘기는 것이 목적이며, 신뢰경계(`<external_content>`)와 8,000자 캡이 적용된다.

### 4. MCP Integration (Rust Native)

- **Confluence Search**: Rust SSE client with OAuth 2.1 PKCE (`src-tauri/src/mcp/client.rs`)
- **Web Search**: Brave Search API + OpenAI Web Search
- **OAuth Flow**: Lazy authentication - toggle enables tool, "Connect" initiates OAuth

**Desktop Bridge MCP (역방향 — 외부 Claude가 앱을 제어)**: 위 셋이 앱→외부 서비스라면,
`oddeyes-desktop-mcp`(Node, `.mcpb`/npx, npm `oddeyes-desktop-mcp@0.7.0`)는 외부 Claude Desktop이
실행 중인 앱을 읽고 쓰는 역방향 채널이다. WebSocket → `window.__ODDEYES_APP_BRIDGE__`
(`src/desktop/oddeyesAppBridge.ts`) → Zustand store. 읽기(문서/컨텍스트/preview) + preview-first 쓰기 +
검수 주입(`set_review_issues`) + 컨텍스트 주입(`set_translation_context`: rules/projectContext) +
용어집(list/add/update/delete entry + link/unlink). 상세는 `patterns.md`의 "Desktop Bridge MCP".

### 5. State Management (Zustand Stores)

| Store | Purpose |
|-------|---------|
| `projectStore.ts` | Project metadata, documents, glossary, attachments |
| `chatStore.ts` | Multi-tab chat sessions, messages, tool calls (composed from 7 slices) |
| `aiConfigStore.ts` | Provider flags, model selection, system prompts |
| `connectorStore.ts` | MCP connector states |
| `uiStore.ts` | Layout state, Focus Mode, panel positions |
| `editorStore.ts` | TipTap editor instance management (Source/Target) |
| `reviewStore.ts` | Review state, chunks, results, highlights |

**chatStore 슬라이스 구조** (1,600줄+ → 7개 파일):
- `chatStore.ts` — 메인 컴포지션 + 내보내기
- `chatStore.types.ts` — 타입, 인터페이스, 상수
- `chatStore.helpers.ts` — 순수 헬퍼
- `chatStore.persist.ts` — 영속성 (schedulePersist, persistNow)
- `chatStore.session.ts` — 세션/메시지 CRUD, hydration
- `chatStore.ai.ts` — AI 상호작용 (executeAiReply, sendMessage, replayMessage, streaming)
- `chatStore.settings.ts` — 설정, 첨부, 컴포저, 컨텍스트 블록
- `chatStore.selectors.ts` — 세션별 그룹 셀렉터 (useChatSessionState, useChatComposerState)

**Important**: `sourceDocJson`/`targetDocJson` in projectStore are TipTap JSON caches for AI tools.

### 7. Tauri Menu ↔ React Event Bridge

Rust 네이티브 메뉴 이벤트와 React UI 상태를 양방향 동기화:

- **Rust → React**: `on_menu_event` → `window.eval(CustomEvent('tauri-menu'))` → `App.tsx` 리스너
- **React → Rust**: `setViewChatMenuChecked()` Tauri command로 CheckMenuItem 상태 업데이트
- **View 메뉴**: Project Sidebar / Settings / Review (MenuItemBuilder) + Chat (CheckMenuItemBuilder)
- **OddEyes 메뉴**: App Settings (`Cmd+,`) / Check for Updates
- 상세 패턴: `patterns.md` → Tauri Menu Event Bridge

### 6. Security

#### Secret Management (Two-Tier)
- **Tier 1 — Keychain**: OS keychain stores a single master key (`ite:master_key_v1`), accessed once at app startup
- **Tier 2 — Vault**: Encrypted file (`secrets.vault`) in app data dir, ChaCha20-Poly1305 with random nonce
- Secrets cached in memory after vault decryption; no further Keychain prompts at runtime
- Initialization failures are retryable: a failed startup Keychain interaction no longer blocks later explicit secret access, so saving an API key can trigger the macOS prompt again
- API keys are stored as a bundled JSON secret under `ai/api_keys_bundle`; `aiConfigStore` updates UI state immediately but surfaces `secureKeyPersistError` if vault persistence fails
- Commands: `src-tauri/src/commands/secrets.rs`, `src-tauri/src/secrets/manager.rs`
- Legacy: `secure_store.rs` wraps SecretManager with key prefixing (`ai:openai`, etc.)

#### XSS Prevention
- DOMPurify sanitization for pasted HTML
- URL protocol validation (blocks `javascript:`, `data:`, `vbscript:`)
- Implementation: `src/utils/htmlNormalizer.ts`

#### Path Traversal Prevention
- Rust-side path validation for file imports
- Blocks system directories (`/etc`, `/System`, `C:\Windows`, `/private/var/db`)
- macOS user temp (`/private/var/folders/`, `/var/folders/`) allowed for `oddeyes-uploads` clipboard/drag-drop staging
- Implementation: `src-tauri/src/utils.rs` → `validate_path()`

#### Clipboard (Desktop)
- `@tauri-apps/plugin-clipboard-manager` for native image read when WKWebView paste omits binary data
- Capability: `clipboard-manager:allow-read-image`
- Frontend: `src/tauri/clipboardImage.ts`, `src/utils/clipboardImage.ts`

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
- **Dual Sidebar Layout (v2)**:
  - `[ProjectSidebar] | [LeftSidebar] | Editor | [RightSidebar]`
  - Both sidebars share `UnifiedSidebar.tsx` component with `side` prop
  - Each sidebar independently shows Settings / Review / Chat tabs
  - State: `uiStore.leftSidebar` / `rightSidebar` (`SidebarState: { collapsed, activeTab, width }`)
  - Defaults: Left=Settings, Right=Chat
  - Resize: `useResizeHandle` hook handles both directions
  - Tab drag: Mouse-event based tab reordering (HTML5 DnD replaced)
  - Responsive layout: `useResponsiveLayout` hook auto-collapses panels on narrow screens
  - Panel state persists across sessions (localStorage via Zustand)
  - **Chat Composer**:
  - `+` button for file attachments / web search toggle
  - Cmd+V clipboard image paste (Tauri: native `readImage` fallback when WebView `DataTransfer` is empty)
  - Enter to send, Shift+Enter for newline
  - IME-aware Enter handling
- **Modal 통합**: `Modal.tsx` 공통 래퍼 (Focus trap, ESC/오버레이 닫기). ReviewModal, TranslatePreviewModal, AppSettingsModal, UpdateModal 등에서 사용.

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
