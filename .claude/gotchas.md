# Common Gotchas

Critical implementation warnings learned from past issues.

## TipTap / Editor

1. **TipTap JSON Format**: Always validate JSON structure before storing. Fallback to plain text on parse errors.

2. **TipTap JSON Initialization on Project Load**: `sourceDocJson`/`targetDocJson` must be initialized in `projectStore` at project load time (via `htmlToTipTapJson`), not just on editor mount. This ensures AI tools work in Focus Mode (Source panel hidden).

3. **Extension Sync Between Editor and Converter**: `markdownConverter.ts`'s `getExtensions()` must include all extensions used by `TipTapEditor.tsx` (including Underline, Highlight, Subscript, Superscript) to prevent JSON parsing errors like "no mark type underline in schema".

4. **TipTap Decoration Cross-Node Search**: Use `buildTextWithPositions()` to build full text/position mapping before searching. Simple `indexOf` on individual nodes fails for text spanning node boundaries.

5. **TipTap Editor Cleanup**: Always call `editor.destroy()` in useEffect cleanup. Use `useEditorStore.getState().clearEditors()` when switching projects to prevent memory leaks from stale editor references. **After `clearEditors()`, re-register live editor instances** if the canvas component is not remounted on project switch (`EditorCanvasTipTap` reuses TipTap instances — only `content` prop changes). Without re-registration, `onEditorReady` won't fire again and cross-component features (review apply, comments) see `targetEditor === null`.

6. **Editor Search Shortcut Scope**: Search (Cmd+F) triggers on Source panel, Replace (Cmd+H) triggers on Target panel only. Both shortcuts require panel focus to avoid global conflicts.

7. **Editor Store for Cross-Component Access**: Use `useEditorStore` (Zustand) to access editor instances from non-editor components (e.g., ReviewPanel applying suggestions). Access via `useEditorStore.getState().sourceEditor` / `.targetEditor`. Highlights may still render (ProseMirror plugin inside live editor) even when the store reference is stale — if apply fails with "Target 에디터가 아직 준비되지 않았습니다", check store registration after project switch, not editor visibility.

8. **ProseMirror Base Style Override**: `.ProseMirror` base styles (`px-6 py-4`, `min-h-[200px]`) apply to all TipTap editors. For chat composer, explicitly override with `.chat-composer-tiptap` using `@apply px-0 py-0 min-h-0`. Check full CSS inheritance chain when modifying UI.

154. **선택 범위는 `selection.ranges`로 읽을 것 (`from/to` 금지)**: 표에서 여러 셀을 드래그하면 `CellSelection`이고 `selection.from/to`는 **head 셀 하나**만 가리킨다(문서 순서도 아님 — 실측 시 `[[23,27],[3,7],[9,13],[17,21]]`). `from/to`를 쓰면 조용히 한 셀만 처리된다(코멘트·복사가 실제로 그랬다). `ranges`의 min/max span으로 합치는 것도 틀렸다 — 3열 표에서 1·3열만 고르면 사이의 2열이 들어온다. 범위마다 따로 처리하고 `from` 기준으로 정렬할 것(`buildSelectionBubble`). 코멘트 마크도 한 chain에서 범위마다 적용한다.

155. **Cmd+A는 `sameParent`가 아니라 클램핑으로 처리**: 전체 선택은 `AllSelection`이고 `from=0`이 doc 노드를 가리켜 `isTextblock`이 false다. 동일 문단 검사를 풀어도 여전히 거부되므로, 범위가 덮는 첫/마지막 textblock **내부로 좁혀야** 한다(`textblockSpan`). 가장자리 공백 트림 뒤에는 블록 수를 다시 세야 한다 — 트림으로 앞 블록의 기여분이 공백뿐이었으면 사라진다.

156. **앵커 텍스트는 블록 구분자를 포함해 읽을 것**: `doc.textBetween(from, to)`를 구분자 없이 쓰면 문단 병합이 텍스트를 바꾸지 않아(`One`+`Two` → `OneTwo`) 구조 변경을 stale로 못 잡는다. `readAnchorText`가 `'\n'`을 넣는다. 단일 블록에서는 두 값이 문자 단위로 동일하므로 무회귀이고, `SelectionContext.text`(`'\n'` + trim)와 값이 일치해 proposal 검증이 옳아진다.

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

18a. **Opus 4.7+ / Sonnet 5 Sampling & Thinking Guards**: Claude Opus 4.7+ and Sonnet 5 return 400 if non-default `temperature` is sent. GPT-5 series also rejects temperature. **Use `resolveModelCallOptions(cfg, useFor)`** (`src/ai/modelCallOptions.ts`) as the single source of truth — do NOT duplicate guards in `client.ts` and `backendCompletion.ts` separately. LangChain path: `createChatModel`. Tauri path: `getModelCallArgs` → Rust `ai.rs` (`adaptive_thinking`, `output_config.effort` / `reasoning_effort`). Anthropic `effort: 'high'` is the server default (no-op); real uplift on OpenAI review uses `reasoning_effort: 'high'`.

19. **LangChain Image Format Unification**: LangChain handles both OpenAI and Anthropic vision with the same `image_url` format. LangChain `@langchain/anthropic` internally converts to Anthropic's native `source` format. Do NOT use provider-specific image formats in `chat.ts`.

20. **Provider-Specific Image Limits**: `chat.ts` → `maybeReplaceLastHumanMessageWithImages()` enforces different size limits: Anthropic 5MB, OpenAI 20MB. Error messages include provider name for clarity.

145. **Target Polishing Is Not Review**: 폴리싱은 `src/ai/polishDocument.ts`의 Target-only 재작성 워크플로우다. ReviewPanel의 `reviewIssues`, 검수 chunk, source 문서를 사용하지 말 것. 버튼은 에디터 헤더에서 번역/검수 다음에 위치하며 Target이 비어 있으면 disabled여야 한다.

146. **Polishing Prompt Must Preserve Meaning**: 폴리싱 프롬프트는 원어민 관점의 collocation, 표현, 문장 구조, 톤을 자연스럽게 다듬되 의미 변경, 정보 추가, 정보 삭제를 금지해야 한다. 번역 품질 개선처럼 보이더라도 Source 없이 새 의미를 추정하면 안 된다.

157. **도구 인자 기본값을 함수 시그니처에 박지 말 것**: `getSelectionSurroundings(doc, ids, beforeUnits = 0, afterUnits = 0)`처럼 두면 "생략"과 "0개 요청"이 구분되지 않아 `clampUnits`의 기본값이 죽는다. 실제로 모델이 인자 없이 호출하면 선택 영역만 돌아와 **도구 스텝만 낭비**했다. 시그니처는 `beforeUnits?: number`로 두고 기본값은 clamp 함수 한 곳에서 정한다. zod 스키마의 `min/max`도 clamp와 같은 값으로 유지할 것 — 스키마가 먼저 거절하므로 어긋나면 clamp가 무의미하다.

158. **표 셀은 번역 단위 2개로 세어진다**: `TRANSLATION_UNIT_TYPES`에 `paragraph`와 `tableCell`이 모두 있어 셀 하나가 **셀 + 안쪽 문단** 두 칸을 차지하고 텍스트가 중복된다(`selected: ["셀1","셀1"]`, 표 뒤 문단의 `before: ["셀2","셀2"]`). 앞뒤 N칸이 표에서 실질 N/2칸이 된다. `selectionTools.dropDuplicatedContainers`가 조상 단위를 **자손과 텍스트까지 같을 때만** 버린다(셀 안에 문단이 여러 개면 안 걸린다). `TRANSLATION_UNIT_TYPES` 자체를 고치지 말 것 — `collectTranslationUnits`를 정렬 검사 뷰(`alignUnits.ts`)와 문서 조회 도구가 같이 쓴다. 선택 재번역 경로는 `dropAncestorUnits`(`TranslationUnitId.ts`)로 조상 유닛을 텍스트 비교 없이 버린다 — 선택 문단의 원문만 필요한 경로라 규칙이 다르다. `documentTools`의 `unitIds` 경로에는 같은 중복이 남아 있다.

159. **선택 문맥의 "앞뒤 N칸"은 인덱스 구간이 아니다**: `selectedUnitRange`는 선택 유닛의 최소~최대 인덱스를 준다. 그 구간을 그대로 `selected`로 쓰면 떨어져 있는 선택(표 1·3열)에서 고르지 않은 2열이 "선택됨"으로 모델에 전달된다. 구간은 before/after 계산에만 쓰고 `selected`는 실제 id로 필터할 것(id가 없는 유닛은 판정 불가라 위치 기준으로 남긴다).

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

31. **Review Severity Filter**: `reviewStore.severityFilter`는 `IssueSeverity[]`로 기본값 `['critical', 'major', 'minor']`(전부 표시). 프롬프트는 항상 모든 이슈(Critical/Major/Minor) 검출하고 UI에서 severity 필터로 표시 제어. `ReviewIntensity` 타입은 삭제됨 — LLM이 프롬프트 필터링 지시를 무시하는 문제 때문에 UI 필터링으로 전환.

32. **Review API Optimization**: Use `runReview()` from `src/ai/review/runReview.ts` for review operations instead of chat infrastructure. This bypasses tool calling and Responses API for significantly faster response times.

33. **Markdown Normalization for Search**: Use `normalizeForSearch()` to strip markdown formatting (bold, italic, list markers) before searching in TipTap editor's plain text. AI responses often include markdown in excerpts.

34. **Bidirectional Text Normalization for Highlight**: `ReviewHighlight.ts` uses `buildNormalizedTextWithMapping()` with shared `applyUnicodeNormalization()`. This handles Unicode special spaces, CRLF, consecutive whitespace, and quote normalization (curly quotes → straight quotes, CJK brackets → quotes).

35. **Review Apply vs Copy by Issue Type**: "오역/왜곡/일관성" types use Apply (replace in editor), "누락" type uses Copy (clipboard) since the text doesn't exist in target document.

36. **Review Apply Deletes Issue**: When "적용" button is clicked, `deleteIssue(issue.id)` removes the issue from results. The highlight disappears automatically on next `tr.docChanged` recalculation.

148. **Review Apply Ambiguity Guards (F1/F2)**: `findExcerptRange` returns null when the same text appears multiple times without `segmentGroupId` (refuse wrong replacement). `findBestSentenceMatch` also returns null when multiple sentences exceed the similarity threshold document-wide. Fuzzy matching respects `segmentRange` when `segmentGroupId` is present.

149. **Review Quote Stripping Deferred to Apply (F6)**: `parseReviewResult` preserves wrapping quotes in excerpts/suggestions. `resolveReplacementText` strips quotes from suggestions only when the matched document text is not wrapped. Use `getWrappingQuotePair` (balance-aware) — never strip at parse time.

150. **Block-Boundary Replace Guard (F3)**: `rangeCrossesBlockBoundary` prevents replace operations spanning multiple ProseMirror blocks (paragraph merge). Used in `reviewApply.ts` and `SearchHighlight.ts` replace commands.

147. **Review Naturalness Criteria**: 검수 프롬프트에는 누락/오역/왜곡/일관성뿐 아니라 원어민이 보기에 어색한 collocation, 표현, 문장 구조도 명시해야 한다. 단, 검수는 이슈 제안만 생성하고 문서를 자동 수정하지 않는다.

## JSON Parsing

37. **JSON Parsing with Brace Counting**: Avoid greedy regex for JSON extraction. Use brace counting (`extractJsonObject` in `parseReviewResult.ts`) to handle nested objects and extra brackets in AI responses.

## Session / State Management

38. **Session Null Handling**: When creating sessions at max limit, ensure `currentSession` is updated to prevent null reference errors in subsequent operations.

39. **Fresh State in Callbacks**: When using callbacks that execute over time (like chunk processing loops), use `getState()` instead of closure-captured values to ensure fresh state. Example: `useChatStore.getState()` in `ReviewPanel`.

40. **Debounce Timer Project ID Verification**: When using debounced persist operations (like `schedulePersist`), capture the project ID at schedule time and verify it hasn't changed before executing the persist.

41. **Chat Session Message Limit**: Frontend `MAX_MESSAGES_PER_SESSION = 1000` enforces FIFO in-memory. Backend (`db/mod.rs`) saves up to 100 messages per session to SQLite. Ensure backend limit stays reasonable relative to frontend.

113. **Save Concurrency Guard**: `projectStore.ts`의 `saveProject()`는 `saveInFlight` Promise로 동시 실행을 방지. Auto-save 타이머와 write-through 타이머가 독립적으로 `saveProject()`를 호출할 수 있으므로, 이전 save가 완료될 때까지 다음 save가 대기.

114. **Chat Session/Message LIMIT 동기화**: `db/mod.rs`의 `load_chat_sessions` SQL LIMIT과 `save_chat_sessions`의 `MAX_SESSIONS`가 반드시 일치해야 함. 불일치 시 저장된 세션이 로드에서 누락되어 앱 재시작마다 영구 삭제됨.

115. **toParagraphHtml HTML 감지**: `/<[a-z][a-z0-9]*[\s/>]/i` 정규식으로 실제 HTML 태그 존재 여부를 확인. 이전의 `startsWith('<') && endsWith('>')` 방식은 `<user input>`을 HTML로 오인하거나 `<p>Hello</p> world`를 텍스트로 오인하는 문제가 있었음.

42. **Grouped Zustand Selectors**: Use selectors from `chatStore.selectors.ts` instead of individual `useChatStore()` calls. Grouped selectors use `useShallow` to minimize re-renders.

## UI Components

43. **Select Component Portal Positioning**: `Select.tsx` uses Headless UI `Portal` to render dropdown outside parent overflow constraints. Use `anchor="top"` for bottom-positioned controls where dropdown needs to open upward.

44. **Select with optgroup Replacement**: Native `<select>` with `<optgroup>` replaced by custom `Select` component. Use `SelectOptionGroup[]` for grouped options.

45. **Select Component setTimeout**: Avoid using `setTimeout(() => setIsOpen(open), 0)` pattern inside components. Use `useEffect` with proper dependencies instead to prevent memory warnings on rapid mount/unmount.

46. **Elapsed Timer Pattern**: Use `useEffect` with `setInterval` for elapsed time tracking during async operations. Clear interval on completion or unmount. Store `elapsedSeconds` in component state, not global store.

47. **Tauri WebView Prompt Reliability**: `window.prompt()` can be inconsistent in Tauri WebView (no UI or immediate null in some environments). For user input flows like history snapshot rename, use app-native modal components (`Modal`) instead of browser prompt APIs.

## Chat Composer

51. **ChatComposerEditor IME Handling**: `ChatComposerEditor.tsx` uses `isComposingRef` with `compositionstart`/`compositionend` events to prevent Enter key from sending messages during IME composition (Korean, Japanese). The `event.isComposing` check alone is not reliable across all browsers.

52. **ChatComposerEditor Markdown Sync**: `ChatComposerEditor` uses `tiptap-markdown` extension to sync with `composerText` (Markdown string). Use `lastSetContentRef` to prevent infinite loops when syncing between editor and state.

53. **ChatComposerEditor clearContent**: Use `editor.clearComposerContent()` (custom method) instead of `editor.commands.clearContent()` directly, as it also resets `lastSetContentRef` to prevent stale content restoration.

54. **Chat Clipboard Image Paste (Tauri)**: WKWebView paste 이벤트의 `clipboardData`에 이미지가 없는 경우가 많음(macOS 스크린샷 등). `ChatComposerEditor`는 `paste` capture 리스너 + `useChatComposerHandlers.handleComposerPaste`로 처리하고, Web `DataTransfer`에 이미지가 없으면 `@tauri-apps/plugin-clipboard-manager` `readImage()`로 네이티브 fallback. `text/plain`이 있으면 텍스트 붙여넣기를 우선(이미지 fallback 스킵). 플러그인 등록(`lib.rs`) + capability `clipboard-manager:allow-read-image` 필수.

55. **Chat Composer Temp Image Path**: 클립보드/드래그앤드롭 이미지는 `save_temp_image` → `std::env::temp_dir()/oddeyes-uploads`에 저장 후 `preview_attachment`로 DTO 생성. macOS에서는 canonical path가 `/private/var/folders/...`이므로 `validate_path()`가 `/private/var` 전체를 차단하면 첨부가 silent fail함. `/private/var/folders/`, `/var/folders/`는 사용자 임시 디렉토리로 허용.

## Image Handling

56. **Chat Image Auto-Resize**: `src/utils/imageResize.ts` provides Canvas API-based image resizing. `resizeImageForApi()` progressively reduces resolution (2048→1536→1024→768px) and quality (85%→70%) until image fits within API limits.

57. **Chat Image Context Retention**: `prompt.ts` → `mapRecentMessagesToHistory()` includes images from the last 3 user messages (`MAX_HISTORY_IMAGES_MESSAGES = 3`) in chat history. Older messages retain text only.

58. **Image Message Immutability**: Messages with `imageAttachments` are treated as immutable inputs. Edit and Replay buttons are hidden for these messages to preserve input snapshot integrity.

59. **addComposerAttachment No Loading State**: `chatStore.ts` → `addComposerAttachment()` does NOT set `isLoading: true` because `isLoading` is reserved for AI response generation. Setting it during image attachment causes skeleton UI to incorrectly appear.

## Build / Platform

58. **buildAlignedChunksAsync for Large Documents**: Use `buildAlignedChunksAsync()` instead of `buildAlignedChunks()` for review operations to prevent UI blocking. The async version yields every 10 segments and supports AbortSignal.

59. **Windows Tauri Build**: `scripts/tauri-build.mjs` uses `shell: process.platform === 'win32'` for `spawn()` because Windows cannot directly execute `.cmd` files without shell.

60. **macOS Universal Build**: Requires both Rust targets installed (`rustup target add x86_64-apple-darwin aarch64-apple-darwin`). Use `npx tauri build --target universal-apple-darwin`.

61. **Bundle Targets Configuration**: `tauri.conf.json` uses `"targets": "all"` to auto-select bundles for current OS. Override with `--bundles` flag.

142. **Tauri Resource Path `_up_` Prefix**: `tauri.conf.json`의 `resources`에 `../` 상대경로를 쓰면 릴리스 빌드 시 `_up_/`으로 치환됨. 예: `"../oddeyes-desktop-mcp/build/x.mcpb"` → `Contents/Resources/_up_/oddeyes-desktop-mcp/build/x.mcpb`. Rust에서 `BaseDirectory::Resource`로 resolve할 때 이 전체 경로를 사용해야 함. Dev 모드에서는 리포 경로를 직접 참조하므로 문제가 안 보여서 릴리스에서만 실패하는 함정.

143. **Windows `Compress-Archive` 확장자 제한**: PowerShell `Compress-Archive`는 `.zip` 확장자만 지원. `.mcpb` 등 커스텀 확장자는 `NotSupportedArchiveFileExtension` 에러 발생. `.zip`으로 생성 후 rename 필요.

144. **`oddeyes-desktop-mcp` 도구/스키마 변경 = 배포 3종 동기화 필수**: `src/tools/*.ts`에 도구를 등록·스키마를 바꾸고 `index.ts`에 register하면 코드는 동작하지만, 클라이언트가 **옛 목록/필드**를 본다. ① `package.json` + `manifest.template.json` 버전 bump, ② `manifest.template.json`의 `tools` 배열(추가·설명 변경), ③ `npm run build`로 `.mcpb` 재번들 **그리고** `npm publish`(npx 경로 사용 시)까지 해야 함. 예: v0.7.0 glossary entry CRUD + link/unlink — 미배포 시 Desktop이 옛 스키마를 봄. 사용 측은 `.mcpb` 재설치 또는 npx 캐시 무효화 후 클라이언트 재연결. (`npm view oddeyes-desktop-mcp version`으로 확인.) Persona/참고 문서 MCP 도구는 의도적으로 없음. 용어집 생성(관리 UI)은 라이브러리만 추가하고 프로젝트 연결은 별도(토글/MCP link); 미연결 용어집 용어 추가는 orphan 방지로 자동 연결.

## Security

62. **Keychain Access**: First run requires OS authentication prompt for keychain access.

148. **SecretManager Failed State Must Be Retryable**: Keychain prompt 취소, 잠금, startup UI 제한 등으로 초기화가 한 번 실패해도 `InitState::Failed`에서 바로 `PreviousInitFailed`를 반환하면 이후 API 키 저장 시 macOS prompt가 다시 뜨지 않는다. `manager.rs`는 다음 explicit secret access에서 initialize를 재시도해야 한다.

149. **API Key Save Warning Means Secure Persist Failed**: `aiConfigStore`는 키 입력 시 UI state를 먼저 갱신한 뒤 `ai/api_keys_bundle` secure store 저장을 비동기로 수행한다. `secureKeyPersistError`가 있으면 현재 세션에서는 키가 보일 수 있지만 재시작 후 사라질 수 있다. 절대 localStorage에 실제 API 키를 fallback 저장하지 말 것.

150. **Dev Master Key Bypasses Keychain**: `.env.local`의 `ITE_DEV_MASTER_KEY`가 설정된 개발 실행은 Keychain을 우회한다. dev build에서 API 키 저장이 성공해도 release `.app`의 Keychain prompt/persistence를 검증한 것으로 보지 말고, 설치된 앱을 종료/재실행해 키가 남는지 확인해야 한다.

151. **Mac Migration Can Split Vault and Keychain Master Key**: Mac migration can copy `~/Library/Application Support/com.oddeyes.desktop/secrets.vault` without preserving a usable Keychain master key (`com.ite.app` / `ite:master_key_v1`) or its app ACL. Symptom: API key appears saved for the current session, disappears after restart, then saving again fails. Recovery is to quit the installed app, back up `secrets.vault`, delete the Keychain master key, install/run the patched `/Applications/OddEyes.ai.app` from the same path, and re-enter API keys. If the app is tested from `target/release/.../OddEyes.ai.app` but later launched from `/Applications/OddEyes.ai.app`, Keychain ACL/path differences can reproduce the issue; always verify persistence using the installed app path.

63. **HTML Paste Sanitization**: Use `htmlNormalizer.ts` with DOMPurify for pasted HTML (especially from Confluence). Validates URL protocols, strips dangerous attributes, normalizes inline styles.

64. **Path Validation in Rust**: Use `validate_path()` from `src-tauri/src/utils.rs` for all file import commands. Blocks system directories (`/etc`, `/usr/bin`, `/private/var/db` 등). macOS 사용자 임시 폴더(`/private/var/folders/`, `/var/folders/`)는 `save_temp_image` 업로드 경로이므로 예외 허용.

116. **Console Log Content Leakage**: `saveProject`의 디버그 로그에서 사용자 콘텐츠(`content.slice(0, 100)`)를 출력하지 않도록 주의. `console.debug`로 최소 정보(projectId, blocksCount)만 기록. 프로덕션 빌드에서도 브라우저 콘솔에 노출됨.

## i18n / Git

65. **i18n Keys**: Match keys in `src/i18n/locales/ko.json` and `en.json`.

66. **Git Hooks (Native)**: `.git/hooks/pre-commit` runs TypeScript type check (`npx tsc --noEmit`). Uses native Git hooks instead of Husky.

## Auto Update

67. **Auto Update System**: `useAutoUpdate.ts` hook uses `@tauri-apps/plugin-updater` to check GitHub Releases for updates. Features: automatic check on app start (production only, 3s delay), download progress tracking, skip version (localStorage), cancel download (AbortController).

68. **Manual Update Check via Custom Event**: `AppSettingsModal`에서 `check()`를 직접 호출하고, 업데이트 발견 시 `window.dispatchEvent(new CustomEvent('app:update-found'))` → `App.tsx`가 수신하여 `setManualUpdate()` → 기존 `UpdateModal` 재사용. 수동 체크는 `skipVersion` 필터를 우회함 (사용자 의도 존중). 더블클릭 방지: `checkState === 'checking'` 가드.

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

79. **Tool Output Size Limit**: `McpClientManager.ts`에서 도구 출력을 `MAX_TOOL_OUTPUT_CHARS`(8000자)로 제한. 초과 시 앞 70% + 뒤 30% + `...[truncated]...` 마커로 자름.

80. **buildToolSpecs 공통 함수**: 스트리밍/비스트리밍 모두 `buildToolSpecs()`로 도구 빌드. `boundToolNames` 반환하여 `buildToolGuideMessage()`가 실제 바인딩된 도구 기반으로 가이드 동적 생성. 가이드-도구 불일치 에러("Tool not found") 방지.

81. **Confluence 민감정보 로그**: `confluenceTools.ts`에서 문서 내용 미리보기 로그는 `import.meta.env.DEV` 조건 하에서만 출력. 프로덕션 보안 강화.

82. **Image Extension Dual Mode**: `ImagePlaceholder`(placeholder)와 `ImageOriginal`(실제 이미지 렌더링) 두 extension 존재. `pasteImageMode` 설정에 따라 `TipTapEditor.tsx`에서 선택. 두 extension 모두 `extendedParseHTML`을 공유하여 `img[src]`와 `div[data-type="image"]` 양쪽 파싱 가능 → 모드 전환 시 이미지 데이터 보존.

83. **Review suggestedFix HTML 태그 처리**: AI가 테이블 셀 수정 시 `<td>텍스트</td>` 형태로 suggestedFix를 반환할 수 있음. `hasHtmlTags()` 검사로 HTML 포함 시 Apply 버튼 숨김 (서식 손실 방지). 표시는 `stripHtml()`로 태그 제거 후 보여줌.

84. **Toast 라이브러리 Sonner**: `react-toastify` 대신 `sonner` 사용. `uiStore.addToast()`가 내부적으로 `sonner.toast.success/error/warning/info()`를 호출. `ToastHost.tsx`에서 `<Toaster>` 컴포넌트 렌더링.

86. **ImagePlaceholder inline 설정**: `ImagePlaceholder.configure({ inline: true })`로 설정해야 리스트(`<li>`) 내 이미지가 텍스트와 같은 줄에 표시됨. `inline: false`면 TipTap이 이미지를 블록 노드로 처리하여 별도 줄로 분리됨.

87. **HTML Normalizer 리스트 내 이미지**: `htmlNormalizer.ts`의 `normalizeDivs()`에서 `<li>` 안의 이미지만 포함한 `<div>`는 unwrap하여 이미지가 리스트 항목과 같은 줄에 유지되도록 함. Confluence 붙여넣기 시 `<li><div><img></div></li>` 구조가 들어옴.

88. **shouldNormalizePastedHtml 보안 검사**: `style=`, `javascript:`, `data:text`, `data:application` 포함 여부를 검사하여 인라인 스타일 변환 및 XSS 공격 차단. 단순 텍스트는 정규화 건너뜀.

89. **SQLite WAL Mode**: `Database::new()`에서 `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;` 설정. 단, 앱은 커넥션 1개를 `Arc<Mutex<Database>>`로 공유하므로 앱 내부 읽기/쓰기는 어차피 직렬화됨. WAL의 실익은 크래시 내구성과 외부 프로세스 리더(백업 등)이며, 앱 내부 동시성 향상은 없음.

117. **SQLite Migration Pattern**: `db/mod.rs`의 `run_migrations()`에서 `SELECT column FROM table LIMIT 0`으로 컬럼 존재 여부 확인 후 `ALTER TABLE ADD COLUMN` 실행. `CREATE TABLE IF NOT EXISTS`는 새 DB에만 적용되므로, 기존 DB에는 별도 마이그레이션 필요.

118. **confluenceSearchEnabled Round-Trip**: `ChatSession`의 `confluenceSearchEnabled` 필드는 Rust 모델(`models.rs`) + DB 스키마(`schema.rs`) + 저장/로드 로직(`db/mod.rs`) 세 곳 모두에 존재해야 완전히 영속됨. 프론트엔드 전용 필드는 `?? true` fallback으로 기본값 적용.

90. **Token Estimation CJK Ratio**: `estimateMarkdownTokens()`는 영어(~4자/토큰)와 CJK(~1.2자/토큰)를 구분하여 가중 평균 계산. 한글 문서에서 토큰 과소추정 방지.

91. **Event Listener Debounce Pattern**: `DomSelectionAddToChat.tsx`의 `selectionchange`, `scroll`, `resize` 이벤트는 150ms debounce 적용. 60+ events/sec 폭주 방지.

92. **Rate Limit (429) Retry**: `src/ai/retry.ts`의 `withRetry()`로 AI 호출 래핑. Exponential backoff (1s → 30s) + jitter로 429/5xx 에러 자동 재시도.

94. **Tool Call Timeout**: `chat.ts`에서 개별 tool.invoke()에 30초 timeout 적용. 느린 외부 API(Confluence)가 전체 채팅을 블록하지 않도록 방지.

95. **CSV Import Batch Processing**: `db/mod.rs`의 `import_glossary_csv()`는 파일 읽기/파싱을 Lock 외부에서 수행 후 500개 단위 배치 커밋. DB Lock 유지 시간 최소화.

96. **MCP Reconnection Backoff**: `mcp/client.rs`의 `connect()`는 최대 5회 재시도, exponential backoff (1s → 30s) + jitter. 일시적 네트워크 오류에 자동 복구.

97. **TipTap History Depth Limit**: `StarterKit.configure({ history: { depth: 100 } })`로 Undo 히스토리 제한. 무제한 히스토리로 인한 메모리 누수 방지.

126. **setContent() Undo 히스토리 파괴 (HI-07)**: `editor.commands.setContent()`는 내부적으로 `preventUpdate: true`를 설정하여 `onUpdate` 콜백이 억제됨 → store HTML 미갱신 → 다음 렌더에서 false positive 발생. 또한 불필요한 `setContent()` 호출이 ghost undo step 생성 (시각적 변화 없는 교체 기록). **해결**: `replaceDocContent()` 유틸리티 사용 (`src/editor/utils/replaceDocContent.ts`).

127. **getHTML() 비교 비결정성 (MD-11)**: `content !== editor.getHTML()` 비교는 비결정적 — 속성 순서, 공백, 셀프클로징 태그 등이 다를 수 있어 false positive 발생 → 불필요한 콘텐츠 교체 트리거. **해결**: `lastContentRef` 패턴으로 마지막으로 설정/수신한 HTML을 추적하여 정확한 동등성 비교.

98. **AbortController Atomic Replacement**: `chatStore.ts`에서 abort 후 새 controller를 즉시 생성하여 null 상태 최소화. 이전 패턴은 `abort() → set(null) → new AbortController()` 사이에 race window 존재.

99. **ReviewResultsTable Virtualization**: `@tanstack/react-virtual`로 500개+ 이슈 가상화. CSS Grid 기반 (`grid-cols-[32px_32px_60px_1fr_1fr]`) 레이아웃으로 테이블 대체.

100. **Monaco Editor Error Boundary**: `SourceMonacoEditor.tsx`에 `EditorErrorBoundary` 래핑. Monaco 초기화 실패 시 "Retry" 버튼이 있는 fallback UI 표시.

102. **Chat Document Tools Table Support**: `documentTools.ts`의 `get_source_document`, `get_target_document`는 `tipTapJsonToMarkdownForTranslation()` 사용. 테이블을 `[table]` 플레이스홀더 대신 HTML로 변환하여 LLM이 내용 조회 가능.

103. **Review sourceExcerpt/targetExcerpt 언어 혼동**: AI가 `targetExcerpt`에 번역문 대신 원문을 넣는 경우 Apply 실패. 프롬프트에 `⚠️ 절대 금지` 경고와 "잘못 복사하면 시스템이 텍스트를 찾지 못합니다!" 메시지로 강조. 언어 방향(영→한 등) 명시 필수.

104. **Review Suggestion Parsing Key Compatibility**: `parseReviewResult.ts`는 JSON 파싱 시 `suggestedFix`, `suggestion`, `Suggestion` 세 가지 키를 모두 지원. AI가 프롬프트에서 `Suggestion` 키를 사용하더라도 JSON으로 출력할 때 다른 키를 사용할 수 있으므로 호환성 보장.

105. **Review Output Format Consistency**: `runReview.ts`는 시스템 프롬프트의 Markdown 형식을 따르도록 지시. "JSON만 출력하세요" 같은 충돌하는 지시를 제거하여 AI가 일관된 형식으로 응답하도록 보장.

106. **Review Results Table Layout**: `ReviewResultsTable.tsx`는 `table-fixed` 레이아웃에서 고정 컬럼(체크박스, #, 심각도, 유형)을 하나로 통합하여 공간 효율성 향상. 1:2:3 비율(통합:수정제안:설명)로 설정하여 패널 리사이즈 시 균형있게 반응.

107. **Retranslation Project Settings**: `ReviewPanel.tsx`의 `handleRetranslate()`는 `useChatStore.getState()`에서 `translationRules`, `projectContext`를 가져오고, `searchGlossary()`로 용어집을 검색하여 재번역 시 모든 프로젝트 세팅 정보가 포함되도록 보장.

108. **Focus Mode Button Location**: Focus Mode 토글 버튼은 상단 Toolbar가 아닌 에디터 패널 헤더(모델 선택 드롭다운 왼쪽)에 위치. 이모지 대신 텍스트("원문 숨기기"/"원문 보이기")로 표시하여 직관성 향상.

109. **Font Size Consistency (text-xs)**: 사이드바, 패널 헤더, 설정 입력 필드 등 대부분의 UI 텍스트는 `text-xs`(12px) 사용. `text-sm`(14px)은 본문 콘텐츠나 에디터 내용에만 사용. 일관성 유지를 위해 새 UI 추가 시 주변 컴포넌트 폰트 크기 확인 필요.

110. **Image parseHTML 공유 필수**: `ImageOriginal`과 `ImagePlaceholder` 모두 `extendedParseHTML`을 사용해야 함. 기본 `Image` extension의 `parseHTML`은 `img[src]`만 인식하므로, placeholder HTML(`<div data-type="image">`)을 파싱하지 못해 모드 전환 시 이미지 데이터가 소실됨.

111. **Review stripImages 누락 방지**: `reviewTool.ts`의 `buildAlignedChunks`/`buildAlignedChunksAsync` 모두 `stripImages()`로 이미지 제거 필수. 누락 시 Base64 이미지가 LLM에 전송되어 토큰 낭비(이미지당 3,000~16,000 토큰) 및 청킹 왜곡 발생.

112. **CSP img-src 외부 이미지 허용**: `tauri.conf.json`의 CSP에 `img-src 'self' asset: data: https: http:` 필요. `https: http:` 누락 시 original 모드에서 CDN 이미지 로드 차단됨.

## Review Audit (2026-02-09)

119. **Review Error Detection False Positive**: `parseReviewResult.ts`의 `detectAiErrorResponse()`가 `/error\s*:\s*/i` 패턴을 사용하여, 정상 검수 응답에서 "error"라는 단어가 포함되면 전체 응답을 에러로 처리하여 throw. 마커(`---REVIEW_START/END---`)가 존재하면 에러 감지를 스킵해야 함. 상세: `.claude/review-audit.md` 이슈 #1.

120. **Review Excerpt Quote Parsing Truncation**: `parseReviewResult.ts`의 Markdown 파싱에서 `[^"]*` 패턴이 excerpt 내부 따옴표에서 잘림. 예: `**Source**: "He said "hello""` → `He said `만 캡처. 하이라이트 실패 원인. 상세: `.claude/review-audit.md` 이슈 #2.

121. **Review maxTokens Truncation Undetected**: `runReview.ts`의 `maxTokens: 4096` 제한으로 이슈가 많은 청크에서 응답 잘림 발생 가능. `---REVIEW_END---` 마커 존재 여부로 잘림 감지 필요. 상세: `.claude/review-audit.md` 이슈 #3.

122. **Review segmentOrder Always Zero**: `parseReviewResult.ts` Markdown 파싱에서 `segmentOrder`가 항상 0으로 하드코딩. 동일 타입+excerpt 조합의 이슈가 다른 세그먼트에 있으면 ID 충돌로 하나가 소실. 상세: `.claude/review-audit.md` 이슈 #4.

123. **ReviewHighlight Production Console Logs**: `ReviewHighlight.ts`에 디버깅용 `console.log`가 잔존. 에디터 문서 변경마다 + 이슈 수만큼 로그 출력되어 성능 영향. 상세: `.claude/review-audit.md` 이슈 #5.

124. **Review Glossary First Chunk Only**: `ReviewPanel.tsx`에서 glossary 검색이 첫 번째 청크(4000자)만 대상. 긴 문서 후반부의 용어 불일치 누락 가능. 상세: `.claude/review-audit.md` 이슈 #6.

125. **Review severityFilter Set Re-render**: `reviewStore.ts`의 `severityFilter`가 `Set<IssueSeverity>` 타입. `toggleSeverityFilter()`에서 매번 `new Set()` 생성 → Zustand shallow 비교 시 항상 새 참조 → 전체 구독자 리렌더. `Record<IssueSeverity, boolean>`으로 변경 권장. 상세: `.claude/review-audit.md` 이슈 #7.

126. **DB Import Pragma Reset**: `import_db_from_file()` (SQLite backup API)은 커넥션 프래그마(`foreign_keys`, `journal_mode`, `synchronous`)를 리셋함. import 후 반드시 `initialize()` 호출 필요 — 내부에서 `apply_pragmas()`로 복원. `foreign_keys=OFF`가 되면 CASCADE DELETE 미작동 → 고아 레코드 발생.

127. **History Commands Not Implemented**: `commands/history.rs`의 `create_snapshot`, `restore_snapshot`, `list_history`는 `NOT_IMPLEMENTED` 에러를 반환. 프론트엔드에서 현재 호출하지 않지만, 향후 연동 시 주의.

128. **System Theme OS Change Listener**: `App.tsx`에서 `theme === 'system'`일 때 `matchMedia('prefers-color-scheme: dark').addEventListener('change', ...)` 구독 필수. 미등록 시 OS 다크/라이트 전환이 앱에 반영되지 않음.

129. **Vault AAD Not Used**: `secrets/vault.rs`의 XChaCha20-Poly1305 암호화에서 AAD(Associated Data)를 사용하지 않음. Poly1305 태그로 ciphertext 무결성은 보장되지만, vault magic 바인딩은 없음. AAD 추가 시 기존 vault 파일 호환이 깨지므로 마이그레이션 필요.

130. **ProjectSidebar mergeProjectListStable**: `listRecentProjects()` 갱신 시 `setItems(list)` 대신 `setItems((prev) => mergeProjectListStable(prev, list))` 사용. 신규 프로젝트는 상단에 추가, 기존 프로젝트는 기존 순서 유지하되 최신 데이터로 치환. updatedAt 정렬 제거로 리스트 점프 방지.

131. **streamingSessionId 세션별 격리**: `chatStore.selectors.ts`의 `useChatSessionState`는 `streamingSessionId`로 현재 스트리밍 중인 세션만 `isLoading`/`streamingContent` 표시. 다른 세션 탭은 스트리밍 상태가 아닌 것으로 렌더링. 동시 다중 스트리밍 방지.

132. **Zustand Store Selector 필수**: 컴포넌트에서 `useStore()`로 전체 store를 구독하면, 어느 필드든 변경 시 전체 리렌더 발생. 필드별 개별 selector 사용: `useStore((s) => s.field)`. 객체 구조 사용 시 매번 새 객체 생성되어 무한 리렌더 루프 가능 → 개별 selector로 분산.

133. **Zustand 비동기 상태 플래그 (동시 호출 방지)**: 비동기 로드 함수에서 `keysLoaded: boolean | 'loading'` 상태 사용. `'loading'` 체크로 진행 중인 호출 방지, 성공/실패 여부로 캐시/재시도 제어. ❌ 금지: `keysLoaded = true`를 try 시작에 설정 (에러 시 영구 실패, 재시도 불가).

134. **Cross-Store 접근 (getState 사용)**: 한 store에서 다른 store의 값이 필요할 때 `useOtherStore.subscribe()`로 구독하지 말 것 (순환 참조, 메모리 누수). 대신 콜백 내에서 `useOtherStore.getState().field` 사용하여 현재값만 읽기.

135. **Tauri Menu Event Bridge (window.eval)**: Rust `on_menu_event`에서 `window.eval()`로 `CustomEvent('tauri-menu')`를 디스패치. `serde_json::to_string(id)`로 JSON 이스케이프하여 특수문자 안전성 보장. `App.tsx`의 `useEffect` 리스너에서 `menuId`로 분기 처리. `reload`만 별도 분기 (URL 네비게이트), 나머지는 모두 CustomEvent로 통합.

136. **View Menu Chat CheckMenuItem 동기화**: Chat 메뉴는 `CheckMenuItemBuilder`로 생성 (체크 상태 표시). React 측 `isViewChatOn` 상태 변경 시 `setViewChatMenuChecked()` Tauri command로 Rust 메뉴 상태 업데이트. `useEffect` deps에 `isViewChatOn`만 포함. 실패 시 `console.warn`으로 무시 (메뉴 동기화는 non-critical).

137. **toggleChatVisibility 중앙화**: Chat 토글 로직이 `Toolbar.tsx`에 인라인으로 있었으나, View 메뉴에서도 동일 동작이 필요하여 `uiStore.toggleChatVisibility()`로 중앙화. `aria-pressed` 상태도 `isAnyChatVisible` (양쪽 사이드바 모두 검사)로 통합.

138. **Review Empty Document Pre-Check (HTML Direct)**: `ReviewPanel.tsx`의 `handleStartReview()`에서 `buildAlignedChunksAsync` 전에 `stripHtml(sourceDocument).trim()` / `stripHtml(targetDocument).trim()`으로 빈 문서 직접 검증. Markdown 변환 파이프라인이 `<p></p>`를 빈 문자열로 정확히 변환하지 못하는 문제 방지.

139. **Project Creation Double-Click Prevention**: `MainLayout.tsx`의 `handleCreateProject()`에서 `isCreating` 상태로 중복 클릭 방지. `disabled` 속성 + "생성 중..." 텍스트 피드백. `finally` 블록에서 상태 리셋.

140. **Toolbar Project Null Guard**: `Toolbar.tsx`의 Settings/Review/Chat 메뉴 버튼에 `disabled={!project}` 가드 + 핸들러 `if (!project) return` 얼리 리턴. 프로젝트 없는 상태에서 패널 열기 시도 방지.

141. **createSnapshotIfChanged Dedup**: `historyStore.ts`의 `createSnapshotIfChanged()`는 `latestBlocksHash` 캐시로 중복 스냅샷 방지. Fast path (캐시 비교) → Slow path (스냅샷 로드 비교) → 변경 감지 시만 새 스냅샷 생성. `TranslatePreviewModal`, `HistoryRestoreDialog`에서 `createSnapshot` 대신 사용.

142. **Selection Text Raw Append 금지**: 선택 영역을 채팅에 보낼 때 `appendComposerText()`를 호출하면 scope/anchor/audit 정보가 사라진다. 인라인 선택 툴바와 Cmd/Ctrl+K/L 모두 `SelectionContext`를 생성해 `setComposerSelection()`을 사용해야 한다.

143. **Selection Anchor는 영속 객체가 아님**: `SelectionAnchor`의 DecorationSet은 에디터 런타임에만 존재한다. 저장된 채팅 proposal을 재수화할 때 `active`로 복원하지 말고 `detached`로 표시해 재선택을 요구한다.

144. **Same-text Replace 금지**: 선택 수정 적용 시 문서 전체에서 문자열 검색/치환하면 중복 문구의 잘못된 위치를 바꿀 수 있다. 반드시 anchor range와 현재 텍스트를 함께 검증하고 해당 range에만 단일 transaction을 적용한다.

145. **Review Context Drift**: 리뷰 청크 루프 안에서 `chatStore`/`projectMemoryStore`를 다시 읽으면 청크마다 규칙 revision이 달라질 수 있다. glossary 검색과 `ContextSnapshot` 생성을 루프 전에 한 번만 수행하고 동일 `ResolvedWorkflowContext` 객체를 재사용한다.

146. **Legacy Project Context Fallback**: 구조화 Project Memory가 아직 비었거나 migration 조회가 실패한 순간에도 기존 `projectContext`를 버리면 안 된다. `buildContextSnapshot({ legacyProjectContext })`가 `legacy-project-context` 항목으로 보존한다. (v2.13.0에서 Settings UI 편집 필드와 chat 직접 주입은 제거됐지만, 스토어 필드·DB persist·hydrate migration·이 fallback·Desktop MCP 주입은 유지된다.)

147. **Selection Retranslate Tool Binding**: 직접 부분 재번역은 단일 AI 호출이며 `selection-retranslate` profile의 bound tools는 항상 0개다. 외부 MCP/웹/커넥터 도구를 우회로 추가하지 않는다.

148. **External Tool Gate**: MCP/Confluence/빌트인 커넥터는 registry allowlist와 explicit external intent를 모두 통과해야 한다. 특히 selection profile에서 동적 커넥터 배열을 무조건 `bindTools`에 합치면 최소 컨텍스트 계약이 깨진다.

149. **Selection Anchor 수명 = 모든 종료 경로에서 제거**: `createSelectionAnchor`로 만든 앵커(하이라이트)는 apply 성공(`applySelectionEdit`) 시에만 자동 제거된다. 그 외 종료 경로 — chat chip dismiss, proposal 폐기/stale, 새 선택으로 교체, 프로젝트 전환 — 에서 `removeSelectionAnchor`를 짝지어 호출하지 않으면 하이라이트가 `MAX_SELECTION_ANCHORS` eviction 전까지 영구 잔존한다. 앵커를 만드는 코드는 제거 경로를 함께 설계할 것.

150. **Marker 워크플로우 maxTokens는 thinking 포함 예산**: `---X_START/END---` 마커 기반 응답(번역/부분 재번역 등)에서 maxTokens을 교체문 길이만 보고 작게 잡으면(예: 4096), Anthropic adaptive thinking / OpenAI reasoning 토큰이 예산을 먼저 소비해 END 마커 전에 truncation → 파싱 실패한다. `retranslateSelection`은 `SELECTION_EDIT_MAX_TOKENS=16384`, review는 16384, chat은 8192. 신규 마커 워크플로우는 8192+ 기준으로 산정한다. (F13과 동일 문제 클래스.)

151. **선택 앵커 범위는 트림된 range로 생성**: `SelectionContext.text`는 `.trim()`되지만 앵커 검증은 `doc.textBetween(from, to)`(비트림)와 비교한다. `normalizeSelectionAnchorRange`가 가장자리 공백을 range에서 제외하지 않으면 두 값이 어긋나 proposal 적용이 항상 stale로 판정된다.

152. **번역 응답을 첫 태그만 보고 HTML로 분류하지 말 것**: `parseTranslationResponseToTipTap`은 `looksLikeBlockHtml`로 마크다운/HTML을 가른다. 번역 직렬화는 표를 **항상 raw HTML**로 쓰므로(`TableForTranslation`), 첫 태그만 보면 표로 시작하는 문서가 전부 HTML로 분류돼 DOM 파서(`convertHtmlListsToMarkdown`)를 탄다. 그 경로에서 마크다운 본문은 텍스트 노드라 유실되고, tiptap-markdown이 `텍스트 == href`인 링크를 직렬화한 **autolink `<https://…>`는 미지의 시작 태그로 삼켜져** URL이 소멸한다. 판정에서 `<table>` 세그먼트를 빼고, 혼합 콘텐츠는 `parseMarkdownWithTables`(`html: true`)에 맡길 것 — 표 밖 `<ul>`/`<p>`도 이쪽이 정상 파싱한다.

153. **DOM walk로 마크다운을 재조립할 때 3가지**: `convertHtmlListsToMarkdown`류 코드의 반복 함정. ① `children`(Element만) 순회는 텍스트 노드를 **조용히 삭제**한다 — `childNodes`를 쓸 것. ② 블록을 전부 `'\n'`으로 이으면 마크다운에서 문단이 합쳐진다 — 리스트 항목끼리만 `'\n'`, 그 외는 `'\n\n'`. ③ 중첩 리스트는 walk가 즉시 방출하므로, 부모 텍스트를 루프 뒤에 방출하면 **자식이 부모보다 먼저 나가** 중첩이 평탄화된다 — 내려가기 전에 flush하고, "아무것도 못 알아봤다" 폴백은 누적 버퍼가 아니라 **출력 길이 변화**로 판정할 것(아니면 중복 방출).

154. **Confluence 도구는 registry 등재된 로컬 래퍼만**: 서버 MCP 도구를 `bindTools`에 그대로 합치면 `allowedNames`(registry 파생)에서 전량 탈락한다 — 이름이 registry에 없기 때문이며, 2026-07-24~07-30 사이 Confluence 검색이 조용히 죽어 있던 원인이다([ADR-0015](../docs/adr/0015-confluence-tools-as-local-wrappers.md)). 새 Confluence 기능은 `mcp_call_tool`을 호출하는 로컬 도구로 만들고 registry(+ i18n `chat.toolName.*` ko/en)에 등재할 것. 바인딩은 `confluenceSearchEnabled`만이 아니라 **`mcpClientManager.getStatus().isConnected`까지** 봐야 한다 — 미연결에 붙이면 첫 호출이 실패해 모델 왕복을 버린다.

155. **외부 텍스트를 도구 결과로 넘길 때 신뢰경계 태그 무해화**: `<untrusted>`(문서·선택 도구)와 `<external_content>`(`wrapExternalToolOutput`) 둘 다 본문이 닫는 태그를 포함하면 경계가 위조된다. 사내 위키처럼 **제3자가 편집할 수 있는 텍스트**를 새 경로로 흘릴 때는 해당 래퍼가 무해화(zero-width space 삽입)를 하는지 먼저 확인할 것. 절단은 래핑보다 **먼저** 해야 닫는 태그가 살아남는다.
