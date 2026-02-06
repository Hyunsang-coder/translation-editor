# Common Gotchas

Critical implementation warnings learned from past issues.

## TipTap / Editor

1. **TipTap JSON Format**: Always validate JSON structure before storing. Fallback to plain text on parse errors.

2. **TipTap JSON Initialization on Project Load**: `sourceDocJson`/`targetDocJson` must be initialized in `projectStore` at project load time (via `htmlToTipTapJson`), not just on editor mount. This ensures AI tools work in Focus Mode (Source panel hidden).

3. **Extension Sync Between Editor and Converter**: `markdownConverter.ts`'s `getExtensions()` must include all extensions used by `TipTapEditor.tsx` (including Underline, Highlight, Subscript, Superscript) to prevent JSON parsing errors like "no mark type underline in schema".

4. **TipTap Decoration Cross-Node Search**: Use `buildTextWithPositions()` to build full text/position mapping before searching. Simple `indexOf` on individual nodes fails for text spanning node boundaries.

5. **TipTap Editor Cleanup**: Always call `editor.destroy()` in useEffect cleanup. Use `clearEditorRegistry()` when switching projects to prevent memory leaks from stale editor references.

6. **Editor Search Shortcut Scope**: Search (Cmd+F) triggers on Source panel, Replace (Cmd+H) triggers on Target panel only. Both shortcuts require panel focus to avoid global conflicts.

7. **Editor Registry for Cross-Component Access**: Use `editorRegistry.ts` (`getSourceEditor`, `getTargetEditor`) to access editor instances from non-editor components (e.g., ReviewPanel applying suggestions).

8. **ProseMirror Base Style Override**: `.ProseMirror` base styles (`px-6 py-4`, `min-h-[200px]`) apply to all TipTap editors. For chat composer, explicitly override with `.chat-composer-tiptap` using `@apply px-0 py-0 min-h-0`. Check full CSS inheritance chain when modifying UI.

## AI / Chat

9. **Chat History**: Chat mode includes last 20 messages (configurable); Translate button workflow excludes all history.

10. **Tool Calling**: AI proactively calls document tools for relevant questions. Web search enabled by default for new sessions.

11. **Mock Provider**: Mock mode is not supported for translation. Setting `mock` provider throws an error with guidance to configure OpenAI API key.

12. **Markdown Translation Pipeline**: Translation uses Markdown as intermediate format (NOT TipTap JSON directly). TipTap ↔ Markdown conversion via `tiptap-markdown` extension. Output uses `---TRANSLATION_START/END---` markers.

13. **Translation Truncation**: Large documents may cause response truncation. Dynamic max_tokens calculation and truncation detection handle this automatically.

14. **Translation max_tokens by Model**: `translateDocument.ts` dynamically sets `maxAllowedTokens`: Claude 64000, GPT-5 65536, GPT-4o 16384. Exceeding limits causes API errors that may appear as "번역이 취소되었습니다".

15. **Multi-Provider Model Selection**: Model selection determines provider automatically (`claude-*` → Anthropic, others → OpenAI). No explicit `provider` field; use `openaiEnabled`/`anthropicEnabled` checkboxes. At least one provider must be enabled.

16. **Model Dropdown with Grouped Options**: Translation/Chat model selectors use custom `Select` component with `SelectOptionGroup[]` to group models by provider. Only enabled providers' models are shown.

17. **Tool Handler Null Safety**: Always check for null `project` in AI tool handlers before accessing project-related state. Return meaningful error messages like "프로젝트가 로드되지 않았습니다" instead of generic errors.

18. **GPT-5 Temperature Handling**: GPT-5 series doesn't support temperature parameter. In `client.ts`, `isGpt5 = model.startsWith('gpt-5')` determines whether to exclude temperature.

19. **LangChain Image Format Unification**: LangChain handles both OpenAI and Anthropic vision with the same `image_url` format. LangChain `@langchain/anthropic` internally converts to Anthropic's native `source` format. Do NOT use provider-specific image formats in `chat.ts`.

20. **Provider-Specific Image Limits**: `chat.ts` → `maybeReplaceLastHumanMessageWithImages()` enforces different size limits: Anthropic 5MB, OpenAI 20MB. Error messages include provider name for clarity.

## AbortController / Async

21. **AbortSignal Propagation**: When using `AbortController` for request cancellation, always pass `abortSignal` to `streamAssistantReply`. Creating the controller alone doesn't cancel requests.

22. **Abort Existing Requests**: In `chatStore.ts`, always abort existing `abortController` before starting new translate or web search requests to prevent response mixing.

23. **AbortController Immediate Cleanup**: After calling `abort()` on an AbortController, immediately set `abortController: null` in state to prevent stale references during the race window before creating a new controller.

24. **Streaming Finalization Guard**: Use `isFinalizingStreaming` flag in `chatStore.ts` to prevent race conditions when streaming completes while a new message is being sent. Wait for finalization to complete before starting new requests.

25. **Async Operation Project Validation**: After any `await` in ReviewPanel or similar components, validate that `project.id` still matches `useProjectStore.getState().project?.id` to handle project switching during async operations.

## Review Feature

26. **Review Chunk Size Consistency**: Use `DEFAULT_REVIEW_CHUNK_SIZE` constant (12000) from `reviewTool.ts` for both initial chunking and subsequent operations to maintain segment alignment.

27. **Review Highlight Auto-Recalculation**: `ReviewHighlight.ts` ProseMirror plugin automatically recalculates decorations on `tr.docChanged`. No cross-store subscription needed - highlights persist through manual edits.

28. **Fresh Chunks on Review Start**: Always regenerate chunks with `buildAlignedChunks(project)` at review start time, not from cached store state. This ensures the review uses the latest document content.

29. **Marker-based JSON Extraction**: Review responses use `---REVIEW_START/END---` markers. `extractMarkedJson()` tries marker extraction first, then falls back to brace counting. This prevents parsing failures when AI includes extra text outside JSON.

30. **Review Streaming Text State**: `reviewStore.streamingText` stores current chunk's AI response for real-time display. Updated via `onToken` callback in `runReview()`. Preserved after completion for debugging.

31. **Review Polishing Mode**: Use `isPolishingMode(intensity)` from `reviewStore.ts` to check if current mode is grammar/fluency vs comparison. Polishing mode sends only `targetText` without `sourceText` to AI.

32. **Review API Optimization**: Use `runReview()` from `src/ai/review/runReview.ts` for review operations instead of chat infrastructure. This bypasses tool calling and Responses API for significantly faster response times.

33. **Markdown Normalization for Search**: Use `normalizeForSearch()` to strip markdown formatting (bold, italic, list markers) before searching in TipTap editor's plain text. AI responses often include markdown in excerpts.

34. **Bidirectional Text Normalization for Highlight**: `ReviewHighlight.ts` uses `buildNormalizedTextWithMapping()` with shared `applyUnicodeNormalization()`. This handles Unicode special spaces, CRLF, consecutive whitespace, and quote normalization (curly quotes → straight quotes, CJK brackets → quotes).

35. **Review Apply vs Copy by Issue Type**: "오역/왜곡/일관성" types use Apply (replace in editor), "누락" type uses Copy (clipboard) since the text doesn't exist in target document.

36. **Review Apply Deletes Issue**: When "적용" button is clicked, `deleteIssue(issue.id)` removes the issue from results. The highlight disappears automatically on next `tr.docChanged` recalculation.

## JSON Parsing

37. **JSON Parsing with Brace Counting**: Avoid greedy regex for JSON extraction. Use brace counting (`extractJsonObject` in `parseReviewResult.ts`) to handle nested objects and extra brackets in AI responses.

## Session / State Management

38. **Session Null Handling**: When creating sessions at max limit, ensure `currentSession` is updated to prevent null reference errors in subsequent operations.

39. **Fresh State in Callbacks**: When using callbacks that execute over time (like chunk processing loops), use `getState()` instead of closure-captured values to ensure fresh state. Example: `useChatStore.getState()` in `ReviewPanel`.

40. **Debounce Timer Project ID Verification**: When using debounced persist operations (like `schedulePersist`), capture the project ID at schedule time and verify it hasn't changed before executing the persist.

41. **Chat Session Message Limit**: `MAX_MESSAGES_PER_SESSION = 1000` enforces FIFO deletion of old messages to prevent memory growth in long sessions.

42. **Grouped Zustand Selectors**: Use selectors from `chatStore.selectors.ts` instead of individual `useChatStore()` calls. Grouped selectors use `useShallow` to minimize re-renders.

## UI Components

43. **Select Component Portal Positioning**: `Select.tsx` uses Headless UI `Portal` to render dropdown outside parent overflow constraints. Use `anchor="top"` for bottom-positioned controls where dropdown needs to open upward.

44. **Select with optgroup Replacement**: Native `<select>` with `<optgroup>` replaced by custom `Select` component. Use `SelectOptionGroup[]` for grouped options.

45. **Select Component setTimeout**: Avoid using `setTimeout(() => setIsOpen(open), 0)` pattern inside components. Use `useEffect` with proper dependencies instead to prevent memory warnings on rapid mount/unmount.

46. **Elapsed Timer Pattern**: Use `useEffect` with `setInterval` for elapsed time tracking during async operations. Clear interval on completion or unmount. Store `elapsedSeconds` in component state, not global store.

## Chat Composer

51. **ChatComposerEditor IME Handling**: `ChatComposerEditor.tsx` uses `isComposingRef` with `compositionstart`/`compositionend` events to prevent Enter key from sending messages during IME composition (Korean, Japanese). The `event.isComposing` check alone is not reliable across all browsers.

52. **ChatComposerEditor Markdown Sync**: `ChatComposerEditor` uses `tiptap-markdown` extension to sync with `composerText` (Markdown string). Use `lastSetContentRef` to prevent infinite loops when syncing between editor and state.

53. **ChatComposerEditor clearContent**: Use `editor.clearComposerContent()` (custom method) instead of `editor.commands.clearContent()` directly, as it also resets `lastSetContentRef` to prevent stale content restoration.

## Image Handling

54. **Chat Image Auto-Resize**: `src/utils/imageResize.ts` provides Canvas API-based image resizing. `resizeImageForApi()` progressively reduces resolution (2048→1536→1024→768px) and quality (85%→70%) until image fits within API limits.

55. **Chat Image Context Retention**: `prompt.ts` → `mapRecentMessagesToHistory()` includes images from the last 3 user messages (`MAX_HISTORY_IMAGES_MESSAGES = 3`) in chat history. Older messages retain text only.

56. **Image Message Immutability**: Messages with `imageAttachments` are treated as immutable inputs. Edit and Replay buttons are hidden for these messages to preserve input snapshot integrity.

57. **addComposerAttachment No Loading State**: `chatStore.ts` → `addComposerAttachment()` does NOT set `isLoading: true` because `isLoading` is reserved for AI response generation. Setting it during image attachment causes skeleton UI to incorrectly appear.

## Build / Platform

58. **buildAlignedChunksAsync for Large Documents**: Use `buildAlignedChunksAsync()` instead of `buildAlignedChunks()` for review operations to prevent UI blocking. The async version yields every 10 segments and supports AbortSignal.

59. **Windows Tauri Build**: `scripts/tauri-build.mjs` uses `shell: process.platform === 'win32'` for `spawn()` because Windows cannot directly execute `.cmd` files without shell.

60. **macOS Universal Build**: Requires both Rust targets installed (`rustup target add x86_64-apple-darwin aarch64-apple-darwin`). Use `npx tauri build --target universal-apple-darwin`.

61. **Bundle Targets Configuration**: `tauri.conf.json` uses `"targets": "all"` to auto-select bundles for current OS. Override with `--bundles` flag.

## Security

62. **Keychain Access**: First run requires OS authentication prompt for keychain access.

63. **HTML Paste Sanitization**: Use `htmlNormalizer.ts` with DOMPurify for pasted HTML (especially from Confluence). Validates URL protocols, strips dangerous attributes, normalizes inline styles.

64. **Path Validation in Rust**: Use `validate_path()` from `src-tauri/src/utils/mod.rs` for all file import commands (CSV, Excel). Blocks access to system directories.

## i18n / Git

65. **i18n Keys**: Match keys in `src/i18n/locales/ko.json` and `en.json`.

66. **Git Hooks (Native)**: `.git/hooks/pre-commit` runs TypeScript type check (`npx tsc --noEmit`). Uses native Git hooks instead of Husky.

## Auto Update

67. **Auto Update System**: `useAutoUpdate.ts` hook uses `@tauri-apps/plugin-updater` to check GitHub Releases for updates. Features: automatic check on app start (production only, 3s delay), download progress tracking, skip version (localStorage), cancel download (AbortController).

## Confluence / ADF

69. **ADF Section Heading Matching**: Confluence 다국어 페이지에서 heading이 `"Title\n번역"` 형태로 저장됨. `extractSection()`과 `extractUntilSection()`은 첫 줄만 비교하여 매칭. 예: `"General Status\n전체 현황"` → `sectionHeading: "General Status"`로 검색 가능.

70. **ADF vs Markdown Fallback**: `confluenceTools.ts`는 ADF 형식을 우선 요청하고, 파싱 실패 시 Markdown으로 자동 폴백. ADF가 구조적 정보를 더 정확히 보존하지만, MCP 서버 오류나 비표준 응답 시 Markdown이 더 안정적.

71. **HTML Paste Table Column Width**: `htmlNormalizer.ts`의 `ALLOWED_ATTR`에 `colwidth` 속성이 필요함. 누락 시 Confluence/Word 등에서 표 붙여넣기 후 TipTap이 열 너비 정보를 잃어 드래그 리사이즈 불가.

72. **Inline Element Visual Spacing**: 인라인 요소(strong, em 등)가 한글/영문 텍스트 사이에서 시각적 공백을 만들 수 있음. CSS `margin-left/right: -0.05em`으로 브라우저 렌더링 간격 상쇄. `letter-spacing`은 영문에서 효과 없음.

73. **ADF Section Recursive Search**: `extractSection()`과 `extractUntilSection()`은 재귀 탐색으로 layoutSection, panel, expand 등 중첩 구조 내 heading도 찾음. 단, 추출 결과는 최상위 노드 기준으로 슬라이스되므로 중첩 구조 내부만 추출하는 것은 불가.

74. **ADF Heading Partial Match**: `"1. Overview"`를 `"Overview"`로 검색 가능. 정규식 `^[\d.]+\s*`로 선행 번호 제거, `\s*\([^)]*\)\s*$`로 후행 괄호 제거. 정확한 매칭이 우선하며, 부분 매칭은 폴백으로 사용.

75. **ADF Cache Format Separation**: `confluenceTools.ts`의 페이지 캐시는 ADF와 Markdown을 별도 필드로 저장. 동일 페이지에 두 형식이 공존 가능하며, `getFromCache(pageId, 'adf')`로 선호 형식 지정. ADF 실패 후 Markdown 캐시만 있어도 이후 요청에서 ADF 재시도 가능.

76. **Tool Calling 병렬화**: `runToolCallingLoop()`에서 독립적인 도구 호출은 `Promise.allSettled`로 병렬 실행. 순차 실행 대비 2개 이상 도구 호출 시 latency ~50% 감소.

77. **외부 도구 출력 인젝션 방어**: `EXTERNAL_TOOLS` 목록의 도구 출력에 `<external_content>` 태그 래핑. LLM이 외부 문서 내용을 지시문으로 해석하지 않도록 방어.

78. **Tool Error 반복 조기 중단**: 같은 도구에서 같은 에러가 `MAX_SAME_ERROR`(2)회 반복되면 루프 조기 중단. "Tool not found" 무한 반복 방지.

79. **Tool Output Size Limit**: `notionTools.ts`, `McpClientManager.ts`에서 도구 출력을 `MAX_TOOL_OUTPUT_CHARS`(8000자)로 제한. 초과 시 앞 70% + 뒤 30% + `...[truncated]...` 마커로 자름.

80. **buildToolSpecs 공통 함수**: 스트리밍/비스트리밍 모두 `buildToolSpecs()`로 도구 빌드. `boundToolNames` 반환하여 `buildToolGuideMessage()`가 실제 바인딩된 도구 기반으로 가이드 동적 생성. 가이드-도구 불일치 에러("Tool not found") 방지.

81. **Confluence 민감정보 로그**: `confluenceTools.ts`에서 문서 내용 미리보기 로그는 `import.meta.env.DEV` 조건 하에서만 출력. 프로덕션 보안 강화.

82. **Image Extension Dual Mode**: `ImagePlaceholder`(placeholder)와 `ImageOriginal`(실제 이미지 렌더링) 두 extension 존재. `pasteImageMode` 설정에 따라 `TipTapEditor.tsx`에서 선택. 두 extension 모두 `extendedParseHTML`을 공유하여 `img[src]`와 `div[data-type="image"]` 양쪽 파싱 가능 → 모드 전환 시 이미지 데이터 보존.

83. **Review suggestedFix HTML 태그 처리**: AI가 테이블 셀 수정 시 `<td>텍스트</td>` 형태로 suggestedFix를 반환할 수 있음. `hasHtmlTags()` 검사로 HTML 포함 시 Apply 버튼 숨김 (서식 손실 방지). 표시는 `stripHtml()`로 태그 제거 후 보여줌.

84. **Toast 라이브러리 Sonner**: `react-toastify` 대신 `sonner` 사용. `uiStore.addToast()`가 내부적으로 `sonner.toast.success/error/warning/info()`를 호출. `ToastHost.tsx`에서 `<Toaster>` 컴포넌트 렌더링.

86. **ImagePlaceholder inline 설정**: `ImagePlaceholder.configure({ inline: true })`로 설정해야 리스트(`<li>`) 내 이미지가 텍스트와 같은 줄에 표시됨. `inline: false`면 TipTap이 이미지를 블록 노드로 처리하여 별도 줄로 분리됨.

87. **HTML Normalizer 리스트 내 이미지**: `htmlNormalizer.ts`의 `normalizeDivs()`에서 `<li>` 안의 이미지만 포함한 `<div>`는 unwrap하여 이미지가 리스트 항목과 같은 줄에 유지되도록 함. Confluence 붙여넣기 시 `<li><div><img></div></li>` 구조가 들어옴.

88. **shouldNormalizePastedHtml 보안 검사**: `style=`, `javascript:`, `data:text`, `data:application` 포함 여부를 검사하여 인라인 스타일 변환 및 XSS 공격 차단. 단순 텍스트는 정규화 건너뜀.

89. **SQLite WAL Mode**: `Database::new()`에서 `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;` 설정. 쓰기 중 읽기 가능, 동시성 대폭 향상. 단일 Mutex 연결 병목 완화.

90. **Token Estimation CJK Ratio**: `estimateMarkdownTokens()`는 영어(~4자/토큰)와 CJK(~1.2자/토큰)를 구분하여 가중 평균 계산. 한글 문서에서 토큰 과소추정 방지.

91. **Event Listener Debounce Pattern**: `DomSelectionAddToChat.tsx`의 `selectionchange`, `scroll`, `resize` 이벤트는 150ms debounce 적용. 60+ events/sec 폭주 방지.

92. **Rate Limit (429) Retry**: `src/ai/retry.ts`의 `withRetry()`로 AI 호출 래핑. Exponential backoff (1s → 30s) + jitter로 429/5xx 에러 자동 재시도.

94. **Tool Call Timeout**: `chat.ts`에서 개별 tool.invoke()에 30초 timeout 적용. 느린 외부 API(Notion, Confluence)가 전체 채팅을 블록하지 않도록 방지.

95. **CSV Import Batch Processing**: `db/mod.rs`의 `import_glossary_csv()`는 파일 읽기/파싱을 Lock 외부에서 수행 후 500개 단위 배치 커밋. DB Lock 유지 시간 최소화.

96. **MCP Reconnection Backoff**: `mcp/client.rs`의 `connect()`는 최대 5회 재시도, exponential backoff (1s → 30s) + jitter. 일시적 네트워크 오류에 자동 복구.

97. **TipTap History Depth Limit**: `StarterKit.configure({ history: { depth: 100 } })`로 Undo 히스토리 제한. 무제한 히스토리로 인한 메모리 누수 방지.

98. **AbortController Atomic Replacement**: `chatStore.ts`에서 abort 후 새 controller를 즉시 생성하여 null 상태 최소화. 이전 패턴은 `abort() → set(null) → new AbortController()` 사이에 race window 존재.

99. **ReviewResultsTable Virtualization**: `@tanstack/react-virtual`로 500개+ 이슈 가상화. CSS Grid 기반 (`grid-cols-[32px_32px_60px_1fr_1fr]`) 레이아웃으로 테이블 대체.

100. **Monaco Editor Error Boundary**: `SourceMonacoEditor.tsx`에 `EditorErrorBoundary` 래핑. Monaco 초기화 실패 시 "Retry" 버튼이 있는 fallback UI 표시.

102. **Chat Document Tools Table Support**: `documentTools.ts`의 `get_source_document`, `get_target_document`는 `tipTapJsonToMarkdownForTranslation()` 사용. 테이블을 `[table]` 플레이스홀더 대신 HTML로 변환하여 LLM이 내용 조회 가능.

103. **Review sourceExcerpt/targetExcerpt 언어 혼동**: AI가 `targetExcerpt`에 번역문 대신 원문을 넣는 경우 Apply 실패. 프롬프트에 `⚠️ 절대 금지` 경고와 "잘못 복사하면 시스템이 텍스트를 찾지 못합니다!" 메시지로 강조. 언어 방향(영→한 등) 명시 필수.

104. **Review Suggestion Parsing Key Compatibility**: `parseReviewResult.ts`는 JSON 파싱 시 `suggestedFix`, `suggestion`, `Suggestion` 세 가지 키를 모두 지원. AI가 프롬프트에서 `Suggestion` 키를 사용하더라도 JSON으로 출력할 때 다른 키를 사용할 수 있으므로 호환성 보장.

105. **Review Output Format Consistency**: `runReview.ts`는 시스템 프롬프트의 Markdown 형식을 따르도록 지시. "JSON만 출력하세요" 같은 충돌하는 지시를 제거하여 AI가 일관된 형식으로 응답하도록 보장.

106. **Review Results Table Layout**: `ReviewResultsTable.tsx`는 `table-fixed` 레이아웃에서 고정 컬럼(체크박스, #, 심각도, 유형)을 하나로 통합하여 공간 효율성 향상. 1:2:3 비율(통합:수정제안:설명)로 설정하여 패널 리사이즈 시 균형있게 반응.

107. **Retranslation Project Settings**: `ReviewPanel.tsx`의 `handleRetranslate()`는 `useChatStore.getState()`에서 `translationRules`, `projectContext`, `translatorPersona`를 가져오고, `searchGlossary()`로 용어집을 검색하여 재번역 시 모든 프로젝트 세팅 정보가 포함되도록 보장.

108. **Focus Mode Button Location**: Focus Mode 토글 버튼은 상단 Toolbar가 아닌 에디터 패널 헤더(모델 선택 드롭다운 왼쪽)에 위치. 이모지 대신 텍스트("원문 숨기기"/"원문 보이기")로 표시하여 직관성 향상.

109. **Font Size Consistency (text-xs)**: 사이드바, 패널 헤더, 설정 입력 필드 등 대부분의 UI 텍스트는 `text-xs`(12px) 사용. `text-sm`(14px)은 본문 콘텐츠나 에디터 내용에만 사용. 일관성 유지를 위해 새 UI 추가 시 주변 컴포넌트 폰트 크기 확인 필요.

110. **Image parseHTML 공유 필수**: `ImageOriginal`과 `ImagePlaceholder` 모두 `extendedParseHTML`을 사용해야 함. 기본 `Image` extension의 `parseHTML`은 `img[src]`만 인식하므로, placeholder HTML(`<div data-type="image">`)을 파싱하지 못해 모드 전환 시 이미지 데이터가 소실됨.

111. **Review stripImages 누락 방지**: `reviewTool.ts`의 `buildAlignedChunks`/`buildAlignedChunksAsync` 모두 `stripImages()`로 이미지 제거 필수. 누락 시 Base64 이미지가 LLM에 전송되어 토큰 낭비(이미지당 3,000~16,000 토큰) 및 청킹 왜곡 발생.

112. **CSP img-src 외부 이미지 허용**: `tauri.conf.json`의 CSP에 `img-src 'self' asset: data: https: http:` 필요. `https: http:` 누락 시 original 모드에서 CDN 이미지 로드 차단됨.
