# Implementation Patterns

## TipTap Integration

```typescript
// Editor instances
src/components/panels/SourcePanel.tsx
src/components/panels/TargetPanel.tsx

// Document builders
src/editor/sourceDocument.ts
src/editor/targetDocument.ts

// TipTap JSON ↔ SQLite
projectStore.ts → loadProject/saveProject

// Review highlight (Decoration-based, non-persistent)
src/editor/extensions/ReviewHighlight.ts

// Search/Replace
src/editor/extensions/SearchHighlight.ts
src/components/editor/SearchBar.tsx

// Cross-component access
src/editor/editorRegistry.ts → getSourceEditor(), getTargetEditor()
```

**Key Principle**: TipTap JSON is the canonical format. Never bypass JSON format when saving/loading.

## AI Payload Construction

### Chat Mode
```typescript
// src/ai/prompt.ts → buildLangChainMessages()
// Uses ChatPromptTemplate with MessagesPlaceholder
// Documents accessed via Tool Calling (on-demand)
```

### Translation Mode
```typescript
// src/ai/translateDocument.ts
// Pipeline: TipTap JSON → Markdown → LLM → Markdown → TipTap JSON
// Direct message array: SystemMessage + HumanMessage
// No chat history
```

## Tauri Commands Pattern

```rust
// Commands: src-tauri/src/commands/*.rs
// Invocation: src/tauri/*.ts (TypeScript wrappers)

// Example:
// Rust: #[tauri::command] async fn load_project(...)
// TS: export async function loadProject(...) { return invoke('load_project', ...) }
```

All async Tauri commands use `async fn`. State passed via Tauri's State management.

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
3. UI toggle in Settings panel
4. Tool integration in chat composer (`+` menu)

### Modifying Editor Behavior
1. TipTap extensions: `src/editor/` directory
2. Document builders: `sourceDocument.ts`, `targetDocument.ts`
3. Store updates: `projectStore.ts` → setSourceDoc/setTargetDoc
4. UI components: `SourcePanel.tsx`, `TargetPanel.tsx`

## Translation Workflow

1. User writes Source document
2. User clicks "Translate" button
3. AI generates translation → Preview modal with diff view
4. If error occurs → Retry button shown (recoverable errors only)
5. User reviews and clicks "Apply" → Target document replaced entirely
6. User manually edits Target if needed

## Markdown Conversion

```typescript
// src/utils/markdownConverter.ts
tipTapJsonToMarkdown()   // TipTap JSON → Markdown
markdownToTipTapJson()   // Markdown → TipTap JSON
htmlToTipTapJson()       // HTML → TipTap JSON
```

**Important**: `getExtensions()` in converter must include ALL extensions used by TipTapEditor.tsx.

## Image Handling

```typescript
// src/utils/imagePlaceholder.ts
extractImages()   // Replace base64 with placeholders before translation
restoreImages()   // Restore after translation

// src/utils/imageResize.ts
resizeImageForApi()   // Progressive resize for API limits
```

## Review Feature

```typescript
// API: src/ai/review/runReview.ts
// Bypasses chat infrastructure for faster response
// Uses streaming with onToken callback

// Parsing: src/ai/review/parseReviewResult.ts
// Uses ---REVIEW_START/END--- markers
// Falls back to brace counting for JSON extraction

// Highlight: src/editor/extensions/ReviewHighlight.ts
// ProseMirror Decoration-based, auto-recalculates on doc change
```

## Search/Replace Feature

```typescript
// Extension: src/editor/extensions/SearchHighlight.ts
// Uses buildTextWithPositions() for cross-node search

// UI: src/components/editor/SearchBar.tsx
// Search (Cmd+F) on Source panel, Replace (Cmd+H) on Target panel
```

## Grouped Zustand Selectors

```typescript
// src/stores/chatStore.selectors.ts
useChatComposerState()   // Composer-related state
useChatSessionState()    // Session-related state
// Uses useShallow to minimize re-renders
```

## MCP Direct Invocation Pattern

MCP tool을 LangChain을 거치지 않고 Tauri command로 직접 호출하는 패턴.
LLM 컨텍스트에 전체 응답이 노출되지 않아 토큰 절약.

```typescript
// src/ai/tools/confluenceTools.ts

// 1. Tauri command로 MCP tool 직접 호출
const result = await invoke<McpToolResult>('mcp_call_tool', {
  name: 'getConfluencePage',
  arguments: { cloudId, pageId, contentFormat: 'markdown' },
});

// 2. TypeScript에서 결과 처리 (단어 카운팅 등)
const countResult = countWords(markdown, { language, excludeTechnical });

// 3. JSON 요약만 LLM에 반환
return JSON.stringify({ totalWords, breakdown });
```

**Use Case**: 대용량 콘텐츠에서 통계/요약만 필요할 때 (예: 번역 분량 산정)

## Build Commands

```bash
# Standard build (current OS)
npm run tauri:build

# macOS Universal (Intel + Apple Silicon)
rustup target add x86_64-apple-darwin aarch64-apple-darwin
npx tauri build --target universal-apple-darwin

# Specific bundle only
npx tauri build --bundles dmg    # macOS
npx tauri build --bundles nsis   # Windows
```

**Build Output Paths**:
- macOS: `src-tauri/target/release/bundle/dmg/`
- macOS Universal: `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`
- Windows: `src-tauri/target/release/bundle/nsis/`
