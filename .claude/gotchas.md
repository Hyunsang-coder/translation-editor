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

14. **Translation max_tokens by Model**: `translateDocument.ts` dynamically sets `maxAllowedTokens`: Claude 64000, GPT-5 65536, GPT-4.1/4o 16384. Exceeding limits causes API errors that may appear as "번역이 취소되었습니다".

15. **Multi-Provider Model Selection**: Model selection determines provider automatically (`claude-*` → Anthropic, others → OpenAI). No explicit `provider` field; use `openaiEnabled`/`anthropicEnabled` checkboxes. At least one provider must be enabled.

16. **Model Dropdown with Grouped Options**: Translation/Chat model selectors use custom `Select` component with `SelectOptionGroup[]` to group models by provider. Only enabled providers' models are shown.

17. **Tool Handler Null Safety**: Always check for null `project` in AI tool handlers before accessing project-related state. Return meaningful error messages like "프로젝트가 로드되지 않았습니다" instead of generic errors.

18. **GPT-4.1 Temperature Handling**: GPT-4.1 requires explicit temperature parameter (unlike GPT-5 which doesn't support it). In `client.ts`, `isGpt5 = model.startsWith('gpt-5')` determines whether to include temperature.

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

34. **Bidirectional Text Normalization for Highlight**: `ReviewHighlight.ts` and `SearchHighlight.ts` use `buildNormalizedTextWithMapping()` with shared `applyUnicodeNormalization()`. This handles Unicode special spaces, CRLF, consecutive whitespace, and quote normalization (curly quotes → straight quotes, CJK brackets → quotes).

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

46. **Chat Panel Pin State**: `uiStore.chatPanelPinned` controls whether outside clicks minimize the floating chat panel. Pin state persists across sessions.

47. **FloatingChatButton Drag vs Click**: Use `hasMoved` ref to distinguish drag from click. If mouse moves during mousedown, it's a drag - don't toggle panel on mouseup. Double-click resets position to default.

48. **FloatingChatButton Tooltip Delay**: Track `mouseMoveCount` to prevent tooltip showing when button appears under static cursor. Only enable tooltip after actual mouse movement over the button.

49. **Conditional Event Listeners**: For global event listeners (like `mousemove` on FloatingChatButton), only register when the component is actually visible/needed. Use dependencies in `useEffect` to conditionally attach/detach listeners.

50. **Elapsed Timer Pattern**: Use `useEffect` with `setInterval` for elapsed time tracking during async operations. Clear interval on completion or unmount. Store `elapsedSeconds` in component state, not global store.

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

## Search Feature

68. **SearchHighlight Extension Pattern**: Use `buildTextWithPositions()` for cross-node text search (same pattern as ReviewHighlight). Replace operations must recalculate matches after each replacement due to position shifts.
