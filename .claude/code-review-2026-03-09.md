# Code Review 2026-03-09

> 총 66건 | Critical ~~11~~ 0 (all fixed) | Warning 35 | Suggestion 20

---

## AI (src/ai/)

### Critical

- [x] **[C-01] Prompt injection** `src/ai/prompt.ts:127-129`, `src/ai/translateDocument.ts:148-150`
  - persona/rules/context가 시스템 프롬프트에 무검증 삽입
  - Fix: `escapeXmlTags()` 함수 추가, 모든 `<user_persona>` 래핑에 적용

- [x] **[C-02] abortSignal 미전달** `src/ai/chat.ts:960-966`
  - 이미지 fallback 경로에서 `abortSignal` 누락, 사용자 취소 불가
  - Fix: fallback `runToolCallingLoop` 호출에 `abortSignal` 전달

### Warning

- [ ] **[W-12] loopMessages 토큰 미체크** `src/ai/chat.ts:344`
  - 도구 호출 루프에서 누적 메시지 토큰 예산 미확인, context window 초과 가능
  - Fix: 누적 토큰 카운트 + 예산 초과 시 중단

- [ ] **[W-13] Confluence cachedCloudId TTL 없음** `src/ai/tools/confluenceTools.ts:132`
  - 계정 전환 시 stale 데이터 유지
  - Fix: TTL 또는 무효화 로직 추가

- [ ] **[W-14] buildAlignedChunks 매 호출 재계산** `src/ai/tools/reviewTool.ts:449`
  - `get_review_chunk`마다 HTML->MD 변환 반복
  - Fix: 첫 호출 시 캐싱

- [ ] **[W-15] withTimeout 사이드이펙트 미취소** `src/ai/chat.ts:38-58`
  - 타임아웃 후에도 원래 프로미스의 사이드이펙트 계속 실행
  - Fix: AbortController 연계 또는 결과 무시 처리

- [ ] **[W-16] 하드코딩된 한국어 에러 메시지** `src/ai/chat.ts:520,541`
  - Fix: i18n 키 사용으로 전환

### Suggestion

- [ ] **[S-47] retry.ts/chat.ts 테스트 커버리지 부재**
  - 핵심 인프라 유닛 테스트 필요

- [ ] **[S-48] buildToolGuideMessage 토큰 과다** `src/ai/chat.ts:631-753`
  - Fix: 압축 또는 tool description만 활용

- [ ] **[S-49] detectRequestType 한국어 질문형 오분류** `src/ai/prompt.ts:30-85`
  - "번역해줘?" -> question으로 분류될 수 있음

---

## Store (src/stores/)

### Critical

- [x] **[C-03] editSessions 무한 증가** `src/stores/projectStore.ts:804-819`
  - `openDocDiffPreview`가 append만 하고 eviction 없음, `finalizeEditSession`은 상태만 변경
  - Fix: `MAX_EDIT_SESSIONS=50` 상한 + finalized 세션 eviction + loadProject 시 초기화

- [x] **[C-04] isLoading 공유 충돌** `src/stores/chatStore.settings.ts:235-252`
  - AI 채팅과 첨부 작업이 같은 `isLoading` 사용
  - Fix: `isAttachmentLoading` 별도 플래그 분리 (types/settings/session/chatStore 반영)

- [x] **[C-05] currentSession 비정규화** `src/stores/chatStore.types.ts:31`, `chatStore.session.ts`
  - `currentSession`이 `sessions[]`와 별도 저장, 동기화 불일치 위험
  - Fix: `useChatStore.subscribe`로 자동 동기화 (sessions/currentSessionId 변경 시 파생)

### Warning

- [ ] **[W-17] autoSnapshotTimer 500ms 변경 없어도 hash 계산** `src/stores/historyStore.ts:248-324`
  - Fix: `lastChangeAt` 미변경 시 early exit 추가

- [ ] **[W-18] loadSecureKeys race condition** `src/stores/aiConfigStore.ts:96-98`
  - concurrent 호출 시 두 번째 caller가 skip
  - Fix: 로딩 프로미스 공유 (promise dedup)

- [ ] **[W-19] pendingDiffs loadProject 미초기화** `src/stores/projectStore.ts:547-561`
  - 프로젝트 전환 시 이전 프로젝트의 pendingDiffs 잔류
  - Fix: `pendingDiffs: {}` 초기화 추가

- [ ] **[W-20] toasts 배열 미사용** `src/stores/uiStore.ts:17`
  - sonner 사용으로 dead state
  - Fix: 제거

- [ ] **[W-21] reviewStore cache invalidation 취약** `src/stores/reviewStore.ts:197-199`
  - `highlightNonce` 기반 캐시, nonce 변경 없이 results 변경 시 stale
  - Fix: results 변경 시 nonce도 갱신

- [ ] **[W-22] initializeProject fire-and-forget** `src/stores/projectStore.ts:346-419`
  - 비동기 IIFE, caller가 완료/실패 감지 불가
  - Fix: 프로미스 반환 또는 상태 플래그 노출

- [ ] **[W-23] sendMessage unsafe non-null assertion** `src/stores/chatStore.ai.ts:368-370`
  - `createSession` 실패 시 `currentSessionId!`가 null
  - Fix: null 체크 추가

### Suggestion

- [ ] **[S-50] appendTo* 중복 로직** `src/stores/chatStore.settings.ts:79-135`
  - Fix: 공유 헬퍼 추출

- [ ] **[S-51] 매직 넘버 상수화**
  - projectStore 1500ms/500ms, historyStore 3000ms, chatStore.ai 100ms 등
  - Fix: 네임드 상수로 추출

- [ ] **[S-52] connectorStore getConnectorConfigs 매 호출 배열 생성**
  - Fix: 셀렉터 메모이제이션

- [ ] **[S-53] legacy sidebar state 정리** `src/stores/uiStore.ts:749`
  - deprecated 상태가 persist에 남아있음
  - Fix: persist에서 제거

- [ ] **[S-54] chatStore 셀렉터에 action 포함**
  - useShallow에서 action 분리 필요

---

## Editor (src/editor/, src/components/editor/, src/hooks/)

### Critical

- [x] **[C-06] TranslatePreviewModal 메모리 누수** `src/components/editor/TranslatePreviewModal.tsx:240-249`
  - `useEditor`가 modal 닫혀도 파괴되지 않음
  - Fix: outer/inner 패턴 분리 — `open===false` → null, `open===true` → Inner 마운트

- [x] **[C-07] SearchBar transaction 과도 구독** `src/components/editor/SearchBar.tsx:103-122`
  - `transaction` 이벤트가 모든 ProseMirror 트랜잭션에 발생
  - Fix: `transaction` 리스너 제거, `update` 이벤트만 유지

### Warning

- [ ] **[W-24] useBlockEditor stale closure** `src/hooks/useBlockEditor.ts:68-139`
  - `editor` null 참조 가능
  - Fix: 콜백 내에서 `_view` 파라미터 사용으로 전환

- [ ] **[W-25] replaceDocContent innerHTML XSS** `src/editor/utils/replaceDocContent.ts:19-23`
  - Fix: DOMPurify sanitize 적용

- [ ] **[W-26] scrollToMatch 잘못된 scroll container** `src/editor/extensions/SearchHighlight.ts:183-191`
  - `view.dom`이 아닌 실제 scrollable ancestor 찾아야 함
  - Fix: closest scrollable ancestor 탐색 로직

- [ ] **[W-27] editorStore 파괴된 에디터 참조 미정리** `src/stores/editorStore.ts`
  - unmount/재생성 시 null 설정 cleanup 누락
  - Fix: cleanup 로직 추가

- [ ] **[W-28] TipTapMenuBar ARIA/i18n 부재** `src/components/editor/TipTapMenuBar.tsx`
  - heading dropdown에 role="menu" 없음, 라벨 한국어 하드코딩
  - Fix: ARIA 속성 + i18n 키 적용

- [ ] **[W-29] DomSelectionAddToChat debounce 타이머 누수** `src/components/editor/DomSelectionAddToChat.tsx:92-102`
  - unmount 시 pending setTimeout 미정리
  - Fix: useEffect cleanup에서 clearTimeout

- [ ] **[W-30] EditorCanvasTipTap 워드카운트 매 변경 재계산** `src/components/editor/EditorCanvasTipTap.tsx:147-156`
  - Fix: debounce/throttle 적용

### Suggestion

- [ ] **[S-55] TranslatePreviewModal generateText 이중 호출** `src/components/editor/TranslatePreviewModal.tsx:258-284`
  - Fix: 한번 계산 후 파생

- [ ] **[S-56] TipTap extension 배열 중복**
  - TipTapEditor/TranslatePreviewModal에서 유사 extension 배열 반복
  - Fix: `createBaseExtensions()` 공유 함수 추출

- [ ] **[S-57] legacy 블록 에디터 코드**
  - SegmentGroupRow/TranslationBlock 사용 여부 확인, 미사용 시 제거

---

## UI (src/components/, src/hooks/)

### Critical

- [x] **[C-08] usePanelDrag 50ms 폴링** `src/hooks/usePanelDrag.ts:239`
  - `setInterval(50ms)`가 드래그 없어도 상시 실행
  - Fix: `dragStateListeners` 이벤트 기반 알림으로 전환, polling 제거

- [x] **[C-09] DebouncedTextarea unmount 시 값 유실** `src/components/ui/DebouncedTextarea.tsx:43-49`
  - cleanup에서 타이머 clear만 하고 pending 값 flush 안 함
  - Fix: `latestValueRef` + `onDebouncedChangeRef`로 unmount 시 flush

### Warning

- [ ] **[W-31] ReviewPanel getAllIssues memoize 누락** `src/components/review/ReviewPanel.tsx:476-477`
  - Fix: `useMemo` 적용

- [ ] **[W-32] isSessionLimitReached 반응성 없음** `src/components/panels/UnifiedSidebar.tsx:70,276`
  - 함수 참조 구독 -> 파생 boolean 구독으로 전환
  - Fix: store에서 파생 boolean 셀렉터

- [ ] **[W-33] MainLayout handleCreateProject stale closure** `src/components/layout/MainLayout.tsx:55`
  - Fix: 더블클릭 방지 가드에 ref 사용

- [ ] **[W-34] ProjectSidebar refresh 미메모이제이션** `src/components/layout/ProjectSidebar.tsx:82`
  - Fix: useCallback 또는 effect 내부 추출

- [ ] **[W-35] HistoryDrawer backdrop 이벤트 전파** `src/components/history/HistoryDrawer.tsx:235`
  - Fix: aside에 stopPropagation 추가

- [ ] **[W-36] Toolbar dropdown ARIA 부재** `src/components/layout/Toolbar.tsx:122-178`
  - Fix: role="menu"/menuitem 추가

- [ ] **[W-37] HistoryTimeline Intl 매 호출 생성** `src/components/history/HistoryTimeline.tsx:28`
  - Fix: formatter를 모듈 스코프 또는 useMemo로 캐싱

### Suggestion

- [ ] **[S-58] ErrorBoundary i18n 미적용** `src/components/ui/ErrorBoundary.tsx:43-50`
  - 한국어 하드코딩
  - Fix: i18n 키 사용

- [ ] **[S-59] AppSettingsModal API 키 입력 debounce 미적용** `src/components/AppSettingsModal.tsx:287,325`
  - 매 키스트로크 store 호출
  - Fix: debounce 적용

- [ ] **[S-60] ChatContent 컴포넌트 700줄+**
  - Fix: 서브 훅/컴포넌트 분리

- [ ] **[S-61] isTauriTestingBridgeActive 중복 정의**
  - ProjectSidebar/HistoryDrawer에서 동일 코드
  - Fix: 공유 유틸 추출

---

## Rust (src-tauri/)

### Critical

- [x] **[C-10] split_block/merge_blocks DB 미저장** `src-tauri/src/commands/block.rs:106-108, 159-160`
  - TODO 방치, DB persistence 미구현
  - Fix: `update_block` + `insert_block` / `delete_block` DB 저장 구현

- [x] **[C-11] Confluence URL injection** `src-tauri/src/commands/confluence.rs:76-77`
  - `page_id`/`cloud_id`가 URL에 직접 삽입
  - Fix: `validate_url_segment()` 함수로 영숫자+하이픈 검증

### Warning

- [ ] **[W-38] reqwest::Client 매 요청 생성** `src-tauri/src/mcp/client.rs:416,474`, `notion_client.rs:219`, `confluence.rs:81`
  - Fix: 구조체 필드로 Client 재사용

- [ ] **[W-39] OAuth callback XSS** `src-tauri/src/mcp/oauth.rs:619-621`
  - 에러 메시지가 HTML에 이스케이프 없이 삽입
  - Fix: HTML 이스케이프 적용

- [ ] **[W-40] OAuth 고정 포트** `src-tauri/src/mcp/oauth.rs:22`
  - 포트 점유 시 fallback 없음
  - Fix: 포트 범위 fallback 또는 동적 할당

- [ ] **[W-41] Notion normalize_id 미검증** `src-tauri/src/notion/client.rs:305-327`
  - Fix: 32자 hex 검증 추가

- [ ] **[W-42] import_glossary_excel 단일 트랜잭션** `src-tauri/src/db/mod.rs:1124`
  - Fix: CSV처럼 배치 트랜잭션 적용

- [ ] **[W-43] SecretManager initialize TOCTOU** `src-tauri/src/secrets/manager.rs:160-190`
  - Fix: OnceCell 또는 단일 write lock

- [ ] **[W-44] Mutex 에러 처리 불일치** `src-tauri/src/commands/mcp.rs:20-21`
  - Fix: AcquireDb trait 사용으로 통일

- [ ] **[W-45] println 남용** 다수 파일
  - Fix: tracing 구조화 로깅으로 전환

- [ ] **[W-46] std::env::set_var 멀티스레드 안전성** `src-tauri/src/lib.rs:144`
  - Fix: SAFETY 코멘트 추가 또는 HashMap 대체

### Suggestion

- [ ] **[S-62] save_project delete-all + reinsert** `src-tauri/src/db/mod.rs:276-278`
  - Fix: UPSERT 패턴으로 개선

- [ ] **[S-63] update_block affected row 미확인** `src-tauri/src/db/mod.rs:804-816`
  - Fix: 0 rows 시 에러 반환

- [ ] **[S-64] path blocklist symlink 우회** `src-tauri/src/utils.rs:51-89`
  - Fix: `/private/var`, `/private/etc` 추가

- [ ] **[S-65] MasterKey Clone 제거** `src-tauri/src/secrets/manager.rs:83-84`
  - 미제어 복사 방지
  - Fix: Clone derive 제거, 참조로 전달

- [ ] **[S-66] CSV 파서 multi-line 미지원** `src-tauri/src/db/mod.rs:859-887`
  - Fix: csv crate 사용 또는 제한사항 문서화

---

## Summary by Severity

| Severity | AI | Store | Editor | UI | Rust | Total |
|----------|:--:|:-----:|:------:|:--:|:----:|:-----:|
| Critical | 2 | 3 | 2 | 2 | 2 | **11** |
| Warning | 5 | 7 | 7 | 7 | 9 | **35** |
| Suggestion | 3 | 5 | 3 | 4 | 5 | **20** |
| **Total** | **10** | **15** | **12** | **13** | **16** | **66** |

## Priority Order (recommended)

1. **Security**: C-01 (prompt injection), C-11 (URL injection), W-25 (XSS), W-39 (OAuth XSS)
2. **Memory/Resource**: C-03 (editSessions leak), C-06 (editor leak), C-08 (polling), C-07 (transaction storm)
3. **Data Loss**: C-09 (DebouncedTextarea), C-10 (DB 미저장), C-04 (isLoading 충돌)
4. **Correctness**: C-02 (abort), C-05 (비정규화), W-18 (race), W-19 (미초기화), W-23 (null)
5. **Performance**: W-14, W-17, W-30, W-37, W-38
6. **Code Quality**: remaining warnings and suggestions
