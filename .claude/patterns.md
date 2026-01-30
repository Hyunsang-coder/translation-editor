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

### Image Placeholder
```typescript
// src/editor/extensions/ImagePlaceholder.ts
// 이미지를 로딩하지 않고 placeholder로 표시
// - 네트워크 요청 방지 (failed to load resource 에러 제거)
// - 에디터 성능 향상 (Base64 이미지 렌더링 생략)
// - 이미지 데이터(src)는 JSON에 그대로 보존

// 표시: 🖼️ [Image]
// 삭제: 기본 키보드/마우스 동작으로 삭제 가능
// 내보내기: getHTML() 시 원본 <img> 태그로 출력
```

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

## Tool Calling Patterns

### 도구 빌드 공통화
```typescript
// src/ai/chat.ts → buildToolSpecs()
// 스트리밍/비스트리밍 모두에서 동일한 도구 빌드 로직 사용
const { toolSpecs, bindTools, boundToolNames } = await buildToolSpecs({
  includeSource: true,
  includeTarget: true,
  webSearchEnabled: !!input.webSearchEnabled,
  confluenceSearchEnabled: !!input.confluenceSearchEnabled,
  notionSearchEnabled: !!input.notionSearchEnabled,
  provider: cfg.provider,
});

// buildToolGuideMessage()는 boundToolNames 기반으로 동적 가이드 생성
// 가이드-도구 불일치 문제 방지
```

### 도구 호출 병렬화
```typescript
// src/ai/chat.ts → runToolCallingLoop()
// 독립적인 도구 호출은 Promise.allSettled로 병렬 실행
const toolCallPromises = toolCalls.map(async (call) => { ... });
const toolResults = await Promise.allSettled(toolCallPromises);

// 2개 이상 도구 호출 시 latency ~50% 감소
```

### 외부 도구 출력 안전화
```typescript
// src/ai/chat.ts
// 외부 도구 출력에 인젝션 방어 태그 적용
const EXTERNAL_TOOLS = ['notion_get_page', 'getConfluencePage', 'notion_search'];
function wrapExternalToolOutput(toolName: string, output: string): string {
  if (!EXTERNAL_TOOLS.includes(toolName)) return output;
  return `<external_content>\n<!-- 외부 문서입니다 -->\n${output}\n</external_content>`;
}

// 출력 크기 제한 (MAX_TOOL_OUTPUT_CHARS)
// - confluenceTools.ts: 20000자 (페이지 전체 조회용)
// - notionTools.ts, McpClientManager.ts: 8000자
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

// 1. Tauri command로 MCP tool 직접 호출 (ADF 우선, Markdown 폴백)
const result = await invoke<McpToolResult>('mcp_call_tool', {
  name: 'getConfluencePage',
  arguments: { cloudId, pageId, contentFormat: 'adf' },  // ADF 우선
});

// 2. TypeScript에서 결과 처리 (단어 카운팅 등)
const countResult = countWords(content, { language, excludeTechnical });

// 3. JSON 요약만 LLM에 반환
return JSON.stringify({ totalWords, breakdown });
```

**Use Case**: 대용량 콘텐츠에서 통계/요약만 필요할 때 (예: 번역 분량 산정)

## ADF (Atlassian Document Format) Parsing

Confluence 페이지 구조적 파싱을 위한 ADF 파서.

```typescript
// src/utils/adfParser.ts

// 타입
interface AdfDocument { type: 'doc'; version: number; content: AdfNode[]; }
interface AdfNode { type: string; attrs?: Record<string, unknown>; content?: AdfNode[]; text?: string; }

// 핵심 함수
extractText(doc, { excludeTypes: ['codeBlock'] })  // 텍스트 추출
extractSection(doc, 'Overview')       // 특정 섹션 추출 (heading 기준, 부분 매칭 지원)
extractUntilSection(doc, 'Appendix')  // 처음부터 특정 섹션 전까지
filterByContentType(doc, 'table')     // 콘텐츠 타입별 필터 (table/text/list)
extractByColumn(doc, 1)               // 2-column 레이아웃에서 특정 컬럼 추출 (1=좌, 2=우)
listAvailableSections(doc)            // 섹션 목록 조회 (재귀 탐색)
listAvailableSectionsWithColumns(doc) // 중복 섹션에 "[col N]" 표시
wrapAsDocument(nodes)                 // AdfNode[] → AdfDocument 래핑
```

**재귀 탐색**: `listAvailableSections()`, `extractSection()`, `extractUntilSection()`은 모든 중첩 구조
(layoutSection, panel, expand 등) 내부의 heading도 탐색.

**컬럼 필터링**: 2-column 바이링구얼 페이지에서 좌/우 컬럼 구분이 필요할 때 `extractByColumn(doc, columnIndex)` 사용.
`confluence_word_count` 도구의 `column` 파라미터(1=좌측, 2=우측)로 노출됨.
`listAvailableSectionsWithColumns()`는 중복 섹션명에 `[col N]` 접미사를 붙여 구분.

**부분 매칭**: heading 검색 시 다음 순서로 매칭:
1. 정확히 일치: `"Overview"` = `"Overview"`
2. 첫 줄 일치: `"Title\n번역"` → `"Title"`로 검색 가능
3. 번호/접미사 제거: `"1. Overview"` → `"Overview"`, `"Overview (v2)"` → `"Overview"`

**ADF 우선 전략**: `confluenceTools.ts`에서 ADF 형식을 먼저 요청하고, 실패 시 Markdown으로 폴백.
ADF는 구조적 정보(heading level, 표 셀 구분)를 보존하여 더 정확한 섹션 필터링 가능.

**형식별 분리 캐시**: 동일 페이지에 ADF와 Markdown 둘 다 캐시 가능. `getFromCache(pageId, 'adf')`로
선호 형식 지정, 없으면 다른 형식 반환.

**캐시 공유**: `getConfluencePageTool`은 MCP의 `getConfluencePage`를 직접 바인딩하지 않고 TypeScript 래퍼로 대체.
`confluence_word_count`와 동일한 `pageCache`를 공유하여 "단어 수 알려줘" → "내용 요약해줘" 연속 요청 시 API 재호출 방지.

**재요청 감지**: `returnedFullContentPageIds` Set으로 이미 전체 내용을 반환한 페이지 추적.
같은 페이지 재요청 시 짧은 안내 메시지 반환 (20000자 → ~50자)하여 LLM 컨텍스트 절약.

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
