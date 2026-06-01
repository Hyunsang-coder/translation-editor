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
src/components/editor/SearchBar.tsx

// Editor instance management (Zustand)
useEditorStore.getState().setSourceEditor(editor)
useEditorStore.getState().setTargetEditor(editor)
useEditorStore.getState().clearEditors()  // 메모리 누수 방지
```

**Key Principle**: TipTap JSON is the canonical format. Never bypass JSON format when saving/loading.

### Editor Store (Zustand)
```typescript
// src/stores/editorStore.ts — TipTap 에디터 인스턴스 관리
useEditorStore.getState().setSourceEditor(editor)
useEditorStore.getState().setTargetEditor(editor)
useEditorStore.getState().clearEditors()  // 메모리 누수 방지

// 호출 위치:
// - EditorCanvasTipTap에서 에디터 생성 후 store에 등록
// - projectStore.switchProjectById()에서 에디터 초기화 시 clearEditors() 호출

// ❌ 구식 패턴 (제거됨):
// src/editor/editorRegistry.ts (모놀리스 전역 변수)
```

### Plugin Keys (중앙화)
```typescript
// src/editor/plugins/pluginKeys.ts — 모든 TipTap Plugin Key 중앙화
export const pluginKeys = {
  reviewHighlight: Key.create(),
  searchHighlight: Key.create(),
  // ... 다른 플러그인들
};

// 외부 접근:
// src/editor/extensions/index.ts에서 export
import { pluginKeys } from './pluginKeys';

// ❌ 구식 패턴 (분산 관리):
// 각 extension 파일 내부에 Key 정의
```

### Content Sync (lastContentRef + replaceDocContent)
```typescript
// src/editor/utils/replaceDocContent.ts
// ProseMirror 트랜잭션 기반 콘텐츠 교체 (setContent() 대체)
// - preventUpdate 미설정 → onUpdate 콜백 정상 발동 → store 자동 동기화
// - addToHistory 명시 제어: sync용 false, 번역 적용용 true

replaceDocContent(editor, content, { addToHistory: false }); // sync
replaceDocContent(editor, content, { addToHistory: true });  // 번역 적용 (Ctrl+Z 지원)

// TipTapEditor.tsx, useBlockEditor.ts — lastContentRef 패턴
const lastContentRef = useRef<string>(content);

onCreate: ({ editor: ed }) => {
  lastContentRef.current = ed.getHTML();
},
onUpdate: ({ editor: ed }) => {
  const html = ed.getHTML();
  lastContentRef.current = html;   // 항상 최신 HTML 추적
  if (onChange) onChange(html);
},

// sync useEffect: getHTML() 비교 대신 lastContentRef 비교
useEffect(() => {
  if (!editor) return;
  if (content === lastContentRef.current) return; // false positive 방지
  replaceDocContent(editor, content, { addToHistory: false });
}, [editor, content]);

// ❌ 금지 패턴:
// editor.commands.setContent()  → onUpdate 미발동, ghost undo step
// content !== editor.getHTML()  → 비결정적 (속성 순서, 공백 차이)
```

### Image Extensions (Dual Mode)
```typescript
// src/editor/extensions/ImagePlaceholder.ts
// 두 개의 extension으로 모드 전환 (pasteImageMode 설정에 따라)

// ImagePlaceholder: placeholder 모드 (기본이 아닌 대체 모드)
// - 네트워크 요청 방지, 에디터 성능 향상
// - 표시: 🖼️ [Image], 🎬 [Video], 📎 [Embed]
// - src는 data-src로 보존

// ImageOriginal: original 모드 (기본값)
// - 실제 <img> 태그 렌더링 (CDN 이미지 표시)
// - 기본 Image extension의 renderHTML 사용

// 공통 parseHTML (extendedParseHTML):
// - img[src], img, div[data-type="image"] 모두 파싱
// - placeholder ↔ original 모드 전환 시 데이터 보존

// TipTapEditor.tsx에서 모드별 extension 선택:
const imageExtension = useMemo(() => {
  if (pasteImageMode === 'original') {
    return ImageOriginal.configure({ inline: true, allowBase64: true });
  }
  return ImagePlaceholder.configure({ inline: true, allowBase64: true });
}, [pasteImageMode]);
// useEditor deps에 [extensions] 전달 → 모드 변경 시 에디터 재생성
```

### HTML Paste Normalization
```typescript
// src/utils/htmlNormalizer.ts
// 붙여넣기된 HTML 정규화 파이프라인

normalizePastedHtml(html, options?)
  // 1. Confluence 태그 변환 (ac:image → img, video/iframe → placeholder)
  // 2. 인라인 스타일 → 시맨틱 태그 (font-weight: bold → <strong>)
  // 3. DOMPurify 보안 정제 (허용 태그/속성만 유지)
  // 4. 후처리: span unwrap, div→p, 빈 p 제거, URL 검증
  // 5. 옵션: removeImages (ignore 모드), removeLinks

// 보안: javascript:, data:text/html 등 위험한 URL 프로토콜 차단
// 리스트 내 이미지: <li> 안의 이미지만 포함한 div는 unwrap
// shouldNormalizePastedHtml 미통과 시 applyPasteOptions()로 후처리
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

// 출력 크기 제한 (MAX_TOOL_OUTPUT_CHARS = 8000)
// notionTools.ts, McpClientManager.ts에서 truncateToolOutput() 적용
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

## SQLite Pragma & Migration Pattern

```rust
// db/mod.rs — apply_pragmas() sets WAL, synchronous, foreign_keys
// Called in new() AND initialize() (import resets pragmas)

fn apply_pragmas(&self) -> Result<(), IteError> {
    self.conn.pragma_update(None, "journal_mode", "WAL")?;
    self.conn.pragma_update(None, "synchronous", "NORMAL")?;
    self.conn.pragma_update(None, "foreign_keys", true)?;
    Ok(())
}

pub fn initialize(&self) -> Result<(), IteError> {
    self.apply_pragmas()?;           // import 후 pragma 복원
    self.conn.execute_batch(schema::CREATE_SCHEMA)?;
    self.run_migrations()?;
    Ok(())
}
```

**Critical**: `import_db_from_file()` (SQLite backup API) resets all pragmas. Always call `initialize()` after import to restore them.

### Column Migration

```rust
// Pattern: check column existence, then ALTER TABLE if missing
fn run_migrations(&self) -> Result<(), IteError> {
    let has_column = self.conn
        .prepare("SELECT new_column FROM table LIMIT 0")
        .is_ok();
    if !has_column {
        self.conn.execute_batch(
            "ALTER TABLE table ADD COLUMN new_column TYPE NOT NULL DEFAULT value;"
        )?;
    }
    Ok(())
}
```

No formal migration framework — uses idempotent `SELECT LIMIT 0` probe per column. Add new migrations to `run_migrations()`.

## Zustand Store Patterns

### Store Selectors (최적화)
```typescript
// ✅ 권장: 필드별 개별 selector (리렌더 최소화)
const streamingText = useReviewStore((s) => s.streamingText);
const reviewTrigger = useReviewStore((s) => s.reviewTrigger);
const severityFilter = useReviewStore((s) => s.severityFilter);

// ❌ 회피: 전체 store 구독 (과도한 리렌더)
const { streamingText, reviewTrigger, ...} = useReviewStore();

// ⚠️ 객체 구조 주의: 매번 새 객체 생성 → 무한 리렌더 루프
const { results, isReviewing } = useReviewStore((s) => ({
  results: s.results,
  isReviewing: s.isReviewing,
})); // ❌ useShallow 없이 사용 금지
```

### 액션 함수 구독
```typescript
// ✅ 권장: selector로 함수만 추출 (불변 참조 유지)
const setTokenStatus = useConnectorStore((s) => s.setTokenStatus);

// ❌ 회피: 함수를 객체에 포함 (불필요한 참조 생성)
const { setTokenStatus } = useConnectorStore((s) => ({
  setTokenStatus: s.setTokenStatus
}));
```

### 비동기 상태 플래그 (동시 호출 방지)
```typescript
// aiConfigStore.ts — Zustand 모듈 레벨 변수로 관리
let keysLoaded: boolean | 'loading' = false;

loadSecureKeys: async () => {
  if (keysLoaded === true) return;      // ✅ 성공 후 캐시
  if (keysLoaded === 'loading') return; // ✅ 동시 호출 방지

  keysLoaded = 'loading';
  try {
    // ... 로드 로직
    keysLoaded = true;  // ✅ 성공 후에만 true
  } catch (err) {
    keysLoaded = false; // ✅ 실패 시 false → 재시도 가능
  }
}
```

### Cross-Store 접근 (구독 금지)
```typescript
// ✅ 권장: getState()로 현재값만 읽기 (구독 없음)
const project = useProjectStore.getState().project;

// ❌ 회피: 다른 store 구독 (순환 참조, 메모리 누수)
useEffect(() => {
  const unsubscribe = useProjectStore.subscribe(...);
  return unsubscribe;
});
```

## chatStore Slice Structure

```typescript
// chatStore.ts — 7개 슬라이스 조합
createPersistHelpers() → schedulePersist, persistNow
createSessionActions() + createMessageActions()
createAiActions() + createStreamingActions()
createComposerActions() + createSettingsActions() + createContextBlockActions() + createAttachmentActions() + createUtilityActions()
```

새 AI/세션 로직 추가 시 해당 슬라이스 파일(`chatStore.ai.ts`, `chatStore.session.ts` 등)에 구현.

## History Snapshot Change Detection

```typescript
// src/stores/historyStore.ts — createSnapshotIfChanged()
// 실제 변경이 있을 때만 스냅샷 생성 (중복 스냅샷 방지)

// latestBlocksHash: 최신 스냅샷의 해시를 상태에 캐시 (비용 큰 getSnapshot 호출 1회만)
// loadHistory() 완료 후 백그라운드로 최신 스냅샷 로드 → hashContent() → 캐시

createSnapshotIfChanged({ projectId, description, blocks, chatSummary })
  // Fast path: 캐시된 해시와 비교 → 변경 없으면 즉시 return null
  // Slow path (캐시 없음): 최신 스냅샷 load → 비교 → 변경 감지 후 새 스냅샷 생성
  // 호출처: TranslatePreviewModal (번역 적용 전 자동 스냅샷)
  //         HistoryRestoreDialog (복원 전 자동 스냅샷)
```

**UI 표시**: HistoryTimeline에 "수정됨" 배지 (amber-500) — `currentBlocksHash ≠ latestBlocksHash`

## Modal Component

```typescript
// src/components/ui/Modal.tsx
<Modal open={open} onClose={onClose} closeOnOverlay closeOnEsc>
  {children}
</Modal>
```

- Focus trap (Tab/Shift+Tab 순환), 초기 포커스 → 첫 focusable 요소
- ESC, 오버레이 클릭으로 닫기
- ReviewModal, TranslatePreviewModal, AppSettingsModal, UpdateModal 등에서 사용

## Save Concurrency Guard

```typescript
// projectStore.ts — prevents overlapping saveProject() calls
let saveInFlight: Promise<void> | null = null;

saveProject: async () => {
  if (saveInFlight) await saveInFlight;   // wait for previous
  // ... set isLoading
  let resolve: () => void;
  saveInFlight = new Promise(r => { resolve = r; });
  try { /* save logic */ }
  finally { saveInFlight = null; resolve!(); }
}
```

Two independent timers can trigger `saveProject()`: auto-save (500ms poll) and write-through (500ms debounce). The Promise guard serializes them.

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
5. User reviews and clicks "Apply" → Target document replaced via `replaceDocContent(addToHistory: true)` (Ctrl+Z undoable)
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
stripImages()     // 번역/검수 전 이미지 마크다운 제거 (토큰 절약)
extractImages()   // Replace base64 with placeholders before translation
restoreImages()   // Restore after translation (deprecated)

// src/utils/imageResize.ts
resizeImageForApi()   // Progressive resize for API limits

// 번역: translateDocument.ts → stripImages() 적용
// 검수: reviewTool.ts → buildAlignedChunks/Async에서 stripImages() 적용
// 두 파이프라인 모두 이미지를 LLM 전송 전 제거
```

## Review Feature

```typescript
// API: src/ai/review/runReview.ts
// Bypasses chat infrastructure for faster response
// Uses streaming with onToken callback
// Output format: Markdown with ---REVIEW_START/END--- markers (NOT JSON)

// Prompt: buildReviewPrompt() — 항상 모든 이슈 검출 (thorough)
// ReviewIntensity 타입 삭제됨 — 프롬프트 필터링 대신 UI 필터링 사용

// Parsing: src/ai/review/parseReviewResult.ts
// Uses ---REVIEW_START/END--- markers
// Markdown format: ### Issue #N with **Suggestion**: field (required)
// JSON fallback: supports suggestedFix, suggestion, Suggestion keys for compatibility
// Falls back to brace counting for JSON extraction

// Highlight: src/editor/extensions/ReviewHighlight.ts
// ProseMirror Decoration-based, auto-recalculates on doc change

// Severity Filter: reviewStore.severityFilter (IssueSeverity[])
// 기본값: ['critical', 'major'] — Minor 숨김
// useShallow 호환을 위해 Set 대신 배열 사용
// UI: ReviewResultsTable의 severity 배지가 클릭 가능한 토글 버튼
// 필터링: ReviewResultsTable 내부에서 filteredIssues로 표시

// Results Table: src/components/review/ReviewResultsTable.tsx
// Layout: table-fixed with 1:2:3 column ratio
// Combined column: checkbox, #, severity, type (vertical flex layout)
// Columns: combined (16.67%), suggestedFix (50%), description (33.33%)
// Container: flex-1 overflow-y-auto for full-height usage
```

## Search/Replace Feature

```typescript
// UI: src/components/editor/SearchBar.tsx
// Search (Cmd+F) on Source panel, Replace (Cmd+H) on Target panel
// Uses TipTap SearchHighlight extension (src/editor/extensions/SearchHighlight.ts)
```

## Grouped Zustand Selectors

```typescript
// src/stores/chatStore.selectors.ts
useChatComposerState()   // Composer-related state
useChatSessionState()    // Session-related state (streamingSessionId 기반 세션별 격리)
// Uses useShallow to minimize re-renders
```

세션별 스트리밍 격리: `streamingSessionId`로 현재 스트리밍 중인 세션만 `isLoading`/`streamingContent` 표시. 다른 세션 탭은 스트리밍 상태가 아닌 것으로 렌더링.

## Dual Sidebar & Responsive Layout

```typescript
// src/components/panels/UnifiedSidebar.tsx
// 양쪽 사이드바가 동일 컴포넌트를 side prop으로 공유
<UnifiedSidebar side="left" />   // Settings (default)
<UnifiedSidebar side="right" />  // Chat (default)

// 각 사이드바는 독립적으로 Settings / Review / Chat 탭 표시
// State: uiStore.leftSidebar / rightSidebar (SidebarState)
// Actions: setSidebarTab(side, tab), toggleSidebarCollapse(side),
//          openSidebarTab(side, tab), openReviewInSidebar(side)

// Chat 전역 토글: toggleChatVisibility() — 모든 사이드에 걸쳐 chat 패널 On/Off
// - On: chat 패널이 있는 모든 사이드를 펼치고 chat 탭 활성화
// - Off: 보이는 chat을 모두 숨김 (fallback 패널 전환 또는 collapse)
// - Toolbar.tsx의 handleChat() + View 메뉴 모두 이 액션 호출

// 탭 드래그: src/hooks/usePanelDrag.ts (마우스 이벤트 기반, HTML5 DnD 대체)

// src/hooks/useResponsiveLayout.ts
// 자동 패널 접기/닫기 (윈도우 너비 감소 시만)

useResponsiveLayout()  // MainLayout에서 호출

// 브레이크포인트:
// - 1200px: ProjectSidebar 축소 (210px → 48px)
// - 1000px: RightSidebar 닫힘
// - 800px: LeftSidebar 닫힘
// - 600px: ProjectSidebar 완전 숨김 (48px → 0px)
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
listAvailableSections(doc)            // 섹션 목록 조회 (재귀 탐색)
wrapAsDocument(nodes)                 // AdfNode[] → AdfDocument 래핑
```

**재귀 탐색**: `listAvailableSections()`, `extractSection()`, `extractUntilSection()`은 모든 중첩 구조
(layoutSection, panel, expand 등) 내부의 heading도 탐색.

**부분 매칭**: heading 검색 시 다음 순서로 매칭:
1. 정확히 일치: `"Overview"` = `"Overview"`
2. 첫 줄 일치: `"Title\n번역"` → `"Title"`로 검색 가능
3. 번호/접미사 제거: `"1. Overview"` → `"Overview"`, `"Overview (v2)"` → `"Overview"`

**ADF 우선 전략**: `confluenceTools.ts`에서 ADF 형식을 먼저 요청하고, 실패 시 Markdown으로 폴백.
ADF는 구조적 정보(heading level, 표 셀 구분)를 보존하여 더 정확한 섹션 필터링 가능.

**형식별 분리 캐시**: 동일 페이지에 ADF와 Markdown 둘 다 캐시 가능. `getFromCache(pageId, 'adf')`로
선호 형식 지정, 없으면 다른 형식 반환.

## AI Call Resilience

```typescript
// src/ai/retry.ts
// Rate limit (429) 및 일시적 서버 오류에 대한 자동 재시도

import { withRetry } from './retry';

// 사용 예시
const stream = await withRetry(
  () => model.stream(messages, { signal }),
  { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 }
);

// 재시도 대상 에러
// - 429 Too Many Requests (rate limit)
// - 500, 502, 503 (server errors)
// - timeout, network, ECONNRESET

// AbortError는 재시도하지 않음 (사용자 취소)
```

**Tool Call Timeout**:
```typescript
// src/ai/chat.ts - withTimeout 유틸리티
const out = await withTimeout(
  tool.invoke(call.args ?? {}),
  30000,  // 30초 timeout
  `Tool ${call.name} timed out`
);
```

## Tauri Menu Event Bridge

Rust 네이티브 메뉴 ↔ React 상태를 양방향 동기화하는 패턴.

```typescript
// === Rust → React (메뉴 클릭 → React 액션) ===
// src-tauri/src/lib.rs: 메뉴 이벤트를 CustomEvent로 webview에 전달
app.on_menu_event(move |app_handle, event| {
  let id = event.id().as_ref();
  // window.eval()로 CustomEvent('tauri-menu') 디스패치
  let js = format!(
    "window.dispatchEvent(new CustomEvent('tauri-menu', {{ detail: {} }}))",
    serde_json::to_string(id)
  );
  window.eval(&js);
});

// App.tsx: 이벤트 리스너로 수신
useEffect(() => {
  const handler = async (e: Event) => {
    const menuId = (e as CustomEvent<string>).detail;
    switch (menuId) {
      case 'app-settings': setShowAppSettingsModal(true); break;
      case 'check-updates': /* ... */ break;
      case 'view-toggle-chat': useUIStore.getState().toggleChatVisibility(); break;
    }
  };
  window.addEventListener('tauri-menu', handler);
  return () => window.removeEventListener('tauri-menu', handler);
}, []);

// === React → Rust (상태 변경 → 메뉴 체크 동기화) ===
// src/tauri/menu.ts: CheckMenuItem 상태 업데이트 래퍼
export async function setViewChatMenuChecked(checked: boolean): Promise<void> {
  await invoke<void>('set_view_chat_menu_checked', { checked });
}

// App.tsx: chat 가시성 상태 변경 시 메뉴 체크 동기화
useEffect(() => {
  void setViewChatMenuChecked(isViewChatOn);
}, [isViewChatOn]);
```

**View 메뉴 항목**: Project Sidebar, Settings, Review (일반 MenuItemBuilder), Chat (CheckMenuItemBuilder — 체크 상태 동기화)

## Desktop Bridge MCP (외부 Claude → 앱 제어)

외부 에이전트(Claude Desktop / trans_agent)가 **실행 중인 OddEyes 앱**을 읽고 쓰는 채널.
앱 내부 MCP(Confluence/Notion, Rust)와는 **별개**다.

```
외부 Claude → oddeyes-desktop-mcp (Node, .mcpb/npx) → WebSocket
   → window.__ODDEYES_APP_BRIDGE__ (oddeyesAppBridge.ts) → Zustand store → SQLite
```

**도구 추가 패턴** (3-레이어, 신규 store 액션 없이 기존 세터만 호출):

```typescript
// 1) src/desktop/oddeyesAppBridge.ts — bridge 헬퍼 + methods 등록
async function setTranslationContext(params: BridgeParams): Promise<unknown> {
  const project = useProjectStore.getState().project;
  if (!project) throw new Error('No project loaded');           // 함정: 영속화 가드
  if (typeof params.projectId === 'string' && params.projectId.length > 0
      && params.projectId !== project.id) {
    throw new Error(`Project mismatch: ...`);                   // stale 방지
  }
  const mode = params.mode === 'append' ? 'append' : 'replace';
  // typeof value === 'string'으로 "제공 여부" 판별: undefined→스킵, ''→replace로 비우기
  // 기존 chatStore 세터(set*/appendTo*) 호출 → schedulePersist() → SQLite
}
const methods = { 'oddeyes.setTranslationContext': async (p) => setTranslationContext(p ?? {}) };

// 2) oddeyes-desktop-mcp/src/tools/<domain>.ts — registerXxxTools(server, callBridge)
//    server.registerTool("oddeyes_set_translation_context", { description, inputSchema(zod) }, handler)
// 3) oddeyes-desktop-mcp/src/index.ts — createMcpServer()에서 registerXxxTools 등록
//    + manifest.template.json tools 배열에 도구명 추가 (Claude Desktop UI 메타데이터)
```

**현재 도구** (`oddeyes-desktop-mcp` v0.2.0, 10개):
- 읽기: `get_status`, `get_source_document`, `get_target_document`, `get_translation_context`, `get_translation_preview`
- 쓰기(preview-first): `set_translation_preview`, `apply_translation_preview`, `discard_translation_preview`
- 쓰기(검수): `set_review_issues` → `reviewStore.ingestExternalReview` (highlight를 위해 `targetExcerpt` verbatim 필수)
- 쓰기(컨텍스트): `set_translation_context` → `chatStore` 세터 (persona/rules/projectContext, replace|append)

**함정**:
- **영속화는 `loadedProjectId` 필요** — 프로젝트 미로드 시 store 메모리엔 반영되나 SQLite 미저장 → bridge에서 `project` 없으면 거부.
- **빈 문자열 vs 미제공** — `replace`에서 `''`는 비우기(허용), `append`에서 `''`는 무의미(스킵). `undefined`는 항상 스킵(부분 업데이트).
- **배포 3종 동기화** — 도구 추가 시 ① `package.json`/`manifest` 버전 bump ② manifest `tools` 배열 ③ `.mcpb` 재번들 + npm publish(npx 경로). 빠뜨리면 코드는 동작하나 클라이언트가 새 도구를 못 봄.

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
