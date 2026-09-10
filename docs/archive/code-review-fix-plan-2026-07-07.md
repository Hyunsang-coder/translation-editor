# 코드 리뷰 수정 계획 (2026-07-07)

> **구현 상태: ✅ F14–F27 구현 완료** — 전체 코드베이스 in-depth 리뷰(`docs/code-review-2026-07-07.md`)에서 확정된 발견 사항의 실행 계획. `npx tsc --noEmit` + `npm run test:run`(797 passed) + `cd src-tauri && cargo test`(23 passed) 통과 확인.
> 대상: HEAD `4d0cc59`(품질 장부 WP-A1) 기준 전체 코드베이스. 관점: Performance / Architecture / Logic / Security, 특히 Concurrency.
> 각 항목은 **진단 → 수정안 → 검증** 순. P0/P1은 소스 재확인(file:line) 완료.
> 구현 시 준수: Surgical > Sweeping(여기 명시된 변경만), 기존 스타일 유지, 완료 전 `npx tsc --noEmit` + `npm run test:run`(+Rust 변경 시 `cd src-tauri && cargo test`).
> **보안(S1–S4)·아키텍처 부채(A1–A3)는 §백로그로 분리** — 이번 사이클 착수 대상 아님. 근거: 배포 릴리스 정상 사용에서 원격 치명 취약점 없음(심층방어/dev 한정). 상세는 리뷰 문서 §5·§6 참조.

## 우선순위 요약 (착수 순서)

| # | 심각도 | 파일 | 요약 | 규모 |
|---|--------|------|------|------|
| F14 | P0 손상 | `src/stores/chatStore.ai.ts:110,290,298` | 취소·전환된 채팅 스트림이 완료 시 새 요청 상태를 덮어씀 (소유권 가드) | S |
| F15 | P0 손상 | `src/components/editor/EditorCanvasTipTap.tsx:641,705` | 번역/폴리싱 프리뷰 Apply 시 프로젝트·리비전 재검증 | M |
| F16 | P0 손상 | `src/desktop/translationPreviewActions.ts:10` 외 | Desktop 프리뷰 apply projectId/revision 재검증 + 전환 시 clear | M |
| F17 | P1 오염 | `src/components/review/ReviewPanel.tsx:166-306` | 검수 이중 실행 창 + 전환 미중단 → 품질 장부 오염 | M |
| F18 | P1 유실 | `src-tauri/src/mcp/oauth.rs:215-247` | OAuth 토큰 갱신 single-flight + 실패 시 유효 토큰 보존 | S |
| F19 | P1 프리즈 | `src-tauri/src/commands/{storage,project,chat}.rs` 외 | 무거운 DB/백업 명령 async화 (메인 스레드 해제) | S |
| F20 | P2 유실 | `src/App.tsx:267-299` | Safe Exit 시 채팅/설정 debounce flush | S |
| F21 | P2 hang | `src-tauri/src/commands/ai.rs:254,382`, `http_proxy.rs` | reqwest timeout + 취소 즉시 반영 + Client 공유 | M |
| F22 | P2 누수 | `crates/tauri-plugin-oddeyes-bridge/src/lib.rs:318` 외 | pending map timeout 시 엔트리 제거 | S |
| F23 | P1 성능 | `src/components/editor/TipTapEditor.tsx:199` | onChange/onJsonChange 디바운스 (타이핑 랙) | S |
| F24 | P1 성능 | `src/editor/extensions/ReviewHighlight.ts:93` 외 | 검수 하이라이트 O(k·n)→O(n+k) + 재계산 디바운스 | M |
| F25 | P2 성능 | `src/components/chat/ChatContent.tsx:439` 외 | 스트리밍 리렌더 범위 축소 + chip 복원 1회 | S |
| F26 | P2 성능 | `src/components/editor/EditorCanvasTipTap.tsx:156` | 번역/폴리싱 스트리밍 텍스트를 modal/store로 이동 | M |
| F27 | P2 위생 | (묶음) L5·C6·C7 소규모 항목 | stale 후행 쓰기 가드 · TOCTOU · 트랜잭션 · 패닉 잠복 | M |

규모: S(≤1시간), M(반나절). **F14–F16이 F1–F13이 잡은 문서 손상과 동급이므로 최우선.**

---

## F14. 채팅 스트림 완료 경로 소유권(epoch) 가드 (chatStore.ai.ts)

### 진단
- `executeAiReply`(:95)는 시작 시 `abortController`를 store에 등록(:110-111)하지만, 완료(:290-294)/에러(:298-335) 경로에서 "이 컨트롤러가 아직 활성인가"를 확인하지 않고 무조건 `set({ streamingContent })`, `finalizeStreaming()`, `set({ abortController: null })`를 실행한다.
- `finalizeStreaming()`은 `get().streamingMessageId`(현재 값)에 커밋하므로, 취소된 요청 A가 마지막 청크 수신 후 정상 resolve되면 **새 요청 B의 placeholder에 A의 내용을 커밋**하고 B의 진행 상태(abortController 등)를 파괴한다.
- 트리거: A 스트리밍 → 프로젝트 전환/`deleteMessageFrom`으로 abort → A가 마지막 청크 후 resolve 대기 → 사용자 B 전송 → A 후속 코드가 B 상태 덮어씀. `/web` 경로(:454,463)는 abortSignal조차 없음.

### 수정안
1. 진입 시 로컬 참조 보관, 모든 상태 쓰기 전에 소유권 확인:
   ```ts
   const abortController = new AbortController();
   set({ abortController, isLoading: true, /* ... */ });
   const isStale = () => get().abortController !== abortController;
   ```
2. 완료 경로(:277-297) 첫 줄:
   ```ts
   if (isStale()) return; // 취소/전환된 요청 — 새 상태를 건드리지 않음
   ```
3. catch 경로(:298): AbortError는 기존대로 로컬 상태만 정리하되, 비-AbortError도 `if (isStale()) return;`을 앞에 두어 stale 요청이 활성 요청의 error/streaming 상태를 덮지 않게 한다.
4. `finalizeStreaming`(chatStore.ai.ts 하단)은 인자로 `assistantId`를 받아 커밋 대상을 명시하도록 시그니처 변경(현재 `get().streamingMessageId` 암묵 의존 제거). 호출부는 `get().finalizeStreaming(assistantId)`.
5. `/web` 경로에도 abortSignal 연결(streamAssistantReply와 동일 패턴).

### 검증
- `chatStore.integration.test.ts`에 추가: A 스트림 시작 → abort → B 스트림 시작 → A resolve 시뮬레이션 → B의 `streamingMessageId`/내용이 보존되고 A 내용이 커밋되지 않음.
- 정상 단일 요청/취소 케이스 회귀 통과.

---

## F15. 번역/폴리싱 프리뷰 Apply 프로젝트·리비전 재검증 (EditorCanvasTipTap.tsx)

### 진단
- `EditorCanvasTipTap`은 프로젝트 전환 시 remount되지 않음(:780-784 주석). `translateAbortController`·`translatePreviewDoc`·`translatePreviewOpen`은 컴포넌트 로컬 상태라 `switchProjectById`가 정리하지 못한다.
- `applyTranslatePreview`(:641)·폴리싱 apply(:705)가 프로젝트/리비전 검증 없이 `replaceDocContent(targetEditorRef.current, ...)`로 현재 Target을 덮고, fresh `project`(=전환된 B)에 스냅샷(:658)·품질 장부(:673) 기록.
- ReviewPanel 재번역은 스트리밍 중 전환은 막지만(:519 stale check), 완료 후 모달 열린 채 전환 후 Apply(`applyRetranslationDoc`)는 못 막음.

### 수정안
1. 번역/폴리싱/재번역 **요청 시작 시** projectId + Target 문서 해시 캡처(기존 `hash.ts`의 djb2 재사용):
   ```ts
   const reqProjectId = useProjectStore.getState().project?.id ?? null;
   const reqTargetRev = hashDoc(targetEditorRef.current?.getJSON());
   // preview 상태에 함께 저장 (translatePreviewMeta 등)
   ```
2. 각 apply 함수 첫 줄에 가드:
   ```ts
   const cur = useProjectStore.getState().project;
   if (!cur || cur.id !== meta.projectId) { toast('프로젝트가 전환되어 적용을 취소했습니다'); closePreview(); return; }
   if (hashDoc(targetEditorRef.current?.getJSON()) !== meta.targetRev) { toast('문서가 변경되어 적용을 취소했습니다'); return; }
   ```
   (같은 프로젝트 내 편집 충돌을 하드 차단할지 경고 후 강제할지는 §남은 확인 — 우선 하드 차단으로 구현.)
3. `project?.id` 변경 effect(기존 :785 재등록 effect 근처)에서 열린 번역/폴리싱 프리뷰 모달 close + `translateAbortController?.abort()`.

### 검증
- E2E(`/e2e-scenario`): A 번역 → 완료 후 B 전환 → Apply → B Target 불변 + 토스트 확인.
- 단위: apply 함수에 stale meta 주입 시 early-return + 문서 미변경.

---

## F16. Desktop 프리뷰 apply 재검증 + 전환 시 clear (translationPreviewActions.ts / translationPreviewStore.ts)

### 진단
- `setTranslationPreview`(oddeyesAppBridge.ts:120-152)는 set 시점에만, revision을 넘긴 경우에만 검사(`assertRevision`: expected 없으면 통과). `projectId`는 파라미터로 받지 않음(`setReviewIssues`/`setTranslationContext`는 검사 — 비대칭).
- `translationPreviewStore`는 `switchProjectById`/`loadProject` 어디서도 clear되지 않음(clearPreview는 apply/discard만).
- 트리거: Desktop이 A 기준 프리뷰 set → B 전환(모달 App 루트라 유지) → apply → B Target을 A 번역으로 교체. (§S2 "외부 브리지 무확인 변조"와 동일 근본.)

### 수정안
1. `translationPreviewStore`에 `projectId: string | null` + `targetRevision: string | null` 필드 추가, `setPreview` 시 기록.
2. `applyDesktopTranslationPreview`(translationPreviewActions.ts:10):
   ```ts
   const cur = useProjectStore.getState().project;
   if (!cur || cur.id !== preview.projectId) throw new Error('프로젝트 불일치로 적용 취소');
   if (hashDoc(targetEditor?.getJSON()) !== preview.targetRevision) throw new Error('문서 변경으로 적용 취소');
   ```
3. `oddeyesAppBridge.ts`의 `setTranslationPreview`가 `projectId`를 필수로 받아 set 시 저장(F15의 meta와 통일).
4. `switchProjectById`/`loadProject`(projectStore.ts)에서 `useTranslationPreviewStore.getState().clearPreview()` 호출.

### 검증
- 단위: preview.projectId ≠ 현재 프로젝트 → apply throw. 전환 시 store clear 확인.
- oddeyesAppBridge set/apply 왕복 테스트에 projectId 필수화 반영.

---

## F17. 검수 이중 실행 창 + 전환 미중단 + 장부 오염 (ReviewPanel.tsx)

### 진단
- `handleRunReview`(:166)가 `startReview()`(:203, `isReviewing=true`)를 `await buildAlignedChunksAsync`(:188) **이후** 호출 → 큰 문서에서 수백 ms 동안 "검수 시작" 버튼 노출, 이중 실행 가능. `triggerReview` 가드(reviewStore.ts:359)도 이 창을 못 막음.
- 검수 루프는 전환 시 abort 안 됨. 전환 후 effect(:149)가 results를 비워도 돌던 루프가 계속 `addResult`. :282-284가 `useProjectStore.getState().project?.id`를 fresh로 읽어 `recordIssuesProposed(새ID, 구이슈)` 기록 → 장부 영구 오염.

### 수정안
1. 재진입 가드를 함수 최상단으로:
   ```ts
   if (useReviewStore.getState().isReviewing) return;
   useReviewStore.setState({ isReviewing: true }); // chunk 빌드 전에 선점
   ```
   (또는 `startReview()`를 await 이전으로 이동.)
2. 루프 시작 시 `const startProjectId = useProjectStore.getState().project?.id;` 캡처. 매 iteration `addResult` 전과 ledger 기록(:282)에서 `if (useProjectStore.getState().project?.id !== startProjectId) break;`, ledger 기록도 `startProjectId` 사용.
3. `switchProjectById`(projectStore.ts)에서 reviewStore abort 신호 제공(reviewStore에 `abortController`/`cancelToken` 이관 또는 `isReviewing=false` + 루프의 매 iteration cancel 체크).
4. retranslate 모달 실행 버튼(:913) 이중 클릭 가드: `if (retranslateLoading) return;` 첫 줄.

### 검증
- 단위: 검수 진행 중 project 변경 → 이후 iteration에서 break, 구 프로젝트 ID로만 ledger 기록. 빠른 이중 호출 → 두 번째 no-op.

---

## F18. OAuth 토큰 갱신 single-flight + 실패 시 유효 토큰 보존 (oauth.rs)

### 진단
- `get_access_token`(:215)이 요청마다 호출되는데 갱신에 single-flight 없음. 만료 상태 동시 요청 2건이 같은 구 refresh_token으로 refresh POST.
- 실패 경로(:232-238)가 메모리 토큰 + vault 토큰을 삭제 → refresh token rotation 환경에서 A 성공 직후 B가 invalid_grant로 실패하면 **방금 갱신된 토큰까지 삭제**, 강제 재인증.

### 수정안
1. `OAuthClient`에 `refresh_lock: tokio::sync::Mutex<()>` 필드 추가.
2. `get_access_token`의 갱신 블록을 락 안에서 double-check:
   ```rust
   if needs_refresh {
       let _guard = self.refresh_lock.lock().await;
       // 락 획득 후 재확인 — 다른 태스크가 이미 갱신했을 수 있음
       let still_expired = { self.token.lock().await.as_ref().map_or(true, |t| t.is_expired()) };
       if still_expired {
           match self.refresh_token().await {
               Ok(()) => { /* ... */ }
               Err(e) => {
                   warn!("[OAuth] refresh failed: {}", e);
                   // 삭제는 현재 저장 토큰이 여전히 만료 상태일 때만
                   let mut tok = self.token.lock().await;
                   if tok.as_ref().map_or(false, |t| t.is_expired()) {
                       *tok = None;
                       drop(tok);
                       let _ = SECRETS.delete(VAULT_MCP_TOKEN).await;
                   }
                   return None;
               }
           }
       }
   }
   ```
3. `commands/connector.rs:191-246`도 동일 락 패턴 적용(삭제 없으므로 double-check만).

### 검증
- `cargo test`: 동시 `get_access_token` 2건 → refresh_token 1회만 호출, 성공 후 두 호출 모두 유효 토큰 반환(mock).

---

## F19. 무거운 DB/백업 명령 async화 (commands)

### 진단
- `save_project`(project.rs:130), `export_project_file`(storage.rs:50), `save_chat_sessions`(chat.rs:92), backup/import/glossary가 동기 `pub fn` → Tauri v2에서 메인 스레드 실행. `export`는 `Backup::run_to_completion`(db/mod.rs:231)이 대형 DB에서 수 초 UI 정지. 공유 `DbState(std::sync::Mutex)` 때문에 락 대기도 메인 스레드에서 발생.

### 수정안
- 무거운 명령을 우선 `#[tauri::command(async)]` + `async fn`으로 전환(스레드풀 실행). 대상: `save_project`, `save_chat_sessions`, `export_project_file`, import 계열, backup, `log_quality_records`.
  - `State<DbState>`는 그대로 사용 가능(std Mutex는 짧은 스코프, await 미포함이므로 안전 — 이미 확인됨).
  - 명령 본문이 길게 블로킹하면 `tauri::async_runtime::spawn_blocking`으로 감싸 이관.
- 순수 저장 로직은 불변, 시그니처만 `async` + 어노테이션. 프론트 `invoke` 호출부는 무변경.

### 검증
- `cargo test` 통과. 앱 실행 후 대형 프로젝트 export 중 창 리사이즈/메뉴 반응 확인(수동 또는 E2E ping).

---

## F20. Safe Exit 시 채팅/설정 debounce flush (App.tsx)

### 진단
- `onCloseRequested`(:267-299)가 `projectStore.isDirty`만 저장. 채팅(`CHAT_PERSIST_DEBOUNCE_MS=800`)·설정(DebouncedTextarea 700ms)은 flush되지 않아 마지막 ~1.5초 입력이 종료 시 유실.

### 수정안
- close 핸들러에서 프로젝트 저장 전/후:
  ```ts
  useChatStore.getState().clearPersistTimer?.();
  await useChatStore.getState().persistNow?.();
  ```
- DebouncedTextarea는 프로젝트 전환/close 신호에서 즉시 flush(연관 F27의 설정 유실 항목과 함께). close 핸들러가 flush 완료를 await한 뒤 `appWindow.close()`.

### 검증
- E2E: 메시지 전송 직후(디바운스 내) 창 닫기 → 재실행 시 메시지 존재.

---

## F21. reqwest timeout + 취소 즉시 반영 + Client 공유 (ai.rs / http_proxy.rs)

### 진단
- `reqwest::Client::new()`(ai.rs:254,548)에 connect/read timeout 없음, 호출마다 새 Client(커넥션 풀 미재사용). 취소 플래그는 루프 상단(:382)만 검사 → 서버 침묵 시 `response.chunk().await`가 영구 대기, `ai_stream_cancel`이 무효.

### 수정안
1. 공유 Client를 `State`에 보관(`OnceCell`/Lazy) + timeout:
   ```rust
   reqwest::Client::builder()
       .connect_timeout(Duration::from_secs(15))
       .read_timeout(Duration::from_secs(120)) // reqwest 0.12
       .build()
   ```
2. 취소를 `tokio_util::sync::CancellationToken`(또는 `Notify`)로 바꾸고 스트림 루프를 `tokio::select!`:
   ```rust
   tokio::select! {
       _ = cancel.cancelled() => break,
       chunk = response.chunk() => { /* ... */ }
   }
   ```
3. `http_proxy.rs`도 timeout 부여, 리다이렉트는 `Policy::none()` 또는 재검증(§S4와 연동, 백로그 참조 가능).

### 검증
- `cargo test`: 취소 토큰 발화 시 스트림 루프 즉시 종료. 느린 mock 서버로 read_timeout 발화 확인.

---

## F22. pending map timeout 시 엔트리 제거 (bridge 플러그인)

### 진단
- `call_bridge_method`(oddeyes-bridge/src/lib.rs:318-353, testing/src/lib.rs:388-438)가 `pending.insert(id, tx)` 후 `timeout(...)` 실패 경로에서 엔트리 미제거. 운영 브리지는 `ODDEYES_BRIDGE_ENABLED=1` 상시 활성이라 JS 무응답마다 `HashMap` 누적.

### 수정안
- 타임아웃/에러 반환 직전:
  ```rust
  Err(_) => { self.pending.lock().remove(&request_id); return Err(/* timeout */); }
  ```
  양쪽 플러그인 동일. `window.eval` 실패 경로에도 동일 정리 확인.

### 검증
- `cargo test`: 응답 없는 요청 후 pending map size 0으로 복귀.

---

## F23. 에디터 onChange/onJsonChange 디바운스 (TipTapEditor.tsx)

### 진단
- `onUpdate`(:199-208)마다 `getHTML()`+`getJSON()`(O(문서)) 무조건 실행 → store 갱신 → `EditorCanvasTipTap`이 문서 구독하므로 키 입력마다 캔버스 전체 리렌더. 10만 자급에서 키당 20–40ms 랙.

### 수정안
- onChange/onJsonChange 콜백을 150–300ms 디바운스(저장이 이미 500ms 디바운스라 정합성 손실 없음). blur/apply 직전엔 즉시 flush.
- DocJson 캐시(`setSourceDocJson`/`setTargetDocJson`)는 매 키 push 대신, AI 도구가 읽는 시점에 `editorStore`의 live editor에서 lazy 계산(push 제거).

### 검증
- 단위: 연속 키 입력 시 store setter 호출 횟수 급감(디바운스 확인). AI 도구가 최신 JSON을 lazy로 받는지.
- 수동: 대형 문서 타이핑 체감.

---

## F24. 검수 하이라이트 O(k·n)→O(n+k) + 재계산 디바운스 (ReviewHighlight.ts)

### 진단
- `tr.docChanged`(:93-96)면 무조건 `createReviewDecorations` 재실행. 내부 `buildExcerptSearchContext`(O(n)) + 이슈마다 `findSegmentRange`가 `doc.descendants` 전체 스캔(O(n)) → 이슈 100개 + 10만 자 = 키당 ~101회 순회.

### 수정안
1. ctx 구축 시 **한 번의 순회**로 `Map<segmentGroupId, {from,to}>` 생성, 이슈별 스캔 제거(O(n+k)).
2. `docChanged` 시엔 기존 데코레이션을 `DecorationSet.map(tr.mapping, tr.doc)`만 하고, 전체 재계산은 300ms idle 디바운스 또는 `highlightNonce` 갱신 시로 한정.

### 검증
- 단위: segmentGroupId→range 맵 정확성(기존 findSegmentRange 결과와 일치). 데코레이션 매핑 후 위치 유지.
- 수동: 검수 결과 표시 상태에서 Target 편집 체감.

---

## F25. 스트리밍 리렌더 범위 축소 + chip 복원 1회 (ChatContent.tsx / chatStore.ai.ts)

### 진단
- `streamingContent`/`statusMessage`를 모든 `ChatMessageItem`에 prop 전달(:439-446), `memo`(ChatMessageItem.tsx:38)에 커스텀 비교자 없어 토큰마다 전 아이템 reconcile.
- 토큰마다 `restoreGhostChips(full)`(chatStore.ai.ts:186)로 누적 전체 재처리 → chip 존재 시 O(L²).

### 수정안
1. 전달 범위 축소: `streamingContent={message.id === streamingMessageId ? streamingContent : null}` (또는 `ChatMessageItem`에 memo 비교자 추가).
2. onToken에서는 마스킹된 원문을 그대로 스트림하고, `restoreGhostChips`는 finalize 시 1회만 수행.

### 검증
- 단위/수동: 긴 세션(메시지 100개)에서 스트리밍 중 비활성 아이템 리렌더 미발생(React Profiler). chip 최종 복원 정확성.

---

## F26. 번역/폴리싱 스트리밍 텍스트를 modal/store로 이동 (EditorCanvasTipTap.tsx)

### 진단
- `onToken → setStreamingText(text)`(:156,509-511)가 컴포넌트 `useState` → 델타마다 두 TipTap 에디터 포함 캔버스 전체 리렌더(64K 토큰이면 수만 회). 표시는 `TranslatePreviewModal`에서만.

### 수정안
- 스트리밍 텍스트를 `TranslatePreviewModal` 내부 state 또는 전용 store(선택 구독)로 이동 → 캔버스는 구독하지 않아 리렌더 0회. F15의 preview meta 리팩터와 함께 진행 권장.

### 검증
- 수동/Profiler: 번역 스트리밍 중 `EditorCanvasTipTap` 리렌더 미발생, 모달만 갱신.

---

## F27. 소규모 위생 항목 (묶음)

각 항목 독립, 순서 무관. 전부 소규모.

1. **reviewStore.initializeReview 세대 가드**(reviewStore.ts:243-262): `await buildAlignedChunksAsync` 후 set이 무조건 실행 → A→B 전환 시 stale set. `hydrateCommentsForProject`의 `requestSeq` 패턴 적용.
2. **attachFileAction stale append**(chatStore.settings.ts:211-231, `addComposerAttachment` 포함): set 전 `if (get().loadedProjectId !== projectId) return;`.
3. **abort 시 빈 assistant placeholder**(chatStore.ai.ts:171,300): AbortError 경로에서 `deleteMessage(assistantId)` 또는 persist 전 빈 스트리밍 메시지 필터.
4. **설정 필드 pending 유실**(DebouncedTextarea + chatStore.session.ts:51): `hydrateForProject`의 `persistNow` 전에 pending flush 강제(F20과 연동).
5. **saveStatus 고착**(projectStore.ts:737-740): 조기 return 전 `set({ saveStatus:'idle', isLoading:false })`.
6. **switchProjectById 세대 토큰**(projectStore.ts:808-846): 모듈 레벨 `switchSeq` 증가 + `loadProject` 직전 최신 여부 확인(last-click-wins).
7. **connect() TOCTOU**(mcp/client.rs:77-90, oauth.rs:373-395): 상태 확인 + `is_connecting=true` 전환을 하나의 write 락에서.
8. **cancel 레지스트리 누수**(ai.rs:314-319, http_proxy.rs:83-88): `entry().or_insert_with()` → `get()`만, 없으면 no-op.
9. **block.rs 트랜잭션**(:107,164): `split_block`/`merge_blocks`를 `unchecked_transaction()`으로 감쌈.
10. **UTF-8 슬라이스 패닉 잠복**(oauth.rs:316, client.rs:324 등): `&body[..200]` → `body.get(..200).unwrap_or(&body)` 또는 char boundary truncation.
11. **SecretManager init 타임아웃 race**(secrets/manager.rs:170-207): 타임아웃 시 상태 리셋 금지(에러만 반환) 또는 초기화 본체 별도 Mutex 순차화. `keyring get/set_password`는 `spawn_blocking`.
12. **죽은 코드 제거**: `pendingDocDiff`/`acceptDocDiff`(projectStore.ts:948-989).

### 검증
- 각 store 항목은 해당 `*.test.ts`에 stale/전환 케이스 추가. Rust 항목은 `cargo test`. 항목별 독립 커밋 권장.

---

## 백로그 (이번 사이클 착수 대상 아님)

> 배포 릴리스 정상 사용에서 원격 치명 취약점 없음. 심층방어(defense-in-depth) 또는 dev 한정. 시간 날 때 하드닝.

### 보안
- **S1** [High/dev한정] 테스트 브리지 고정 fallback 토큰 제거(미설정 시 미기동) + Origin 검증(`tauri://`/`http://127.0.0.1:1420`만) + 상수시간 토큰 비교. `crates/tauri-plugin-testing/src/lib.rs:99,208`.
- **S2** [Med] 운영 브리지 `bridge.json` 0600 생성(`set_permissions`) + Origin 검증 + 상수시간 비교. `desktop_mcp.rs:241`, `oddeyes-bridge/src/lib.rs:205`.
- **S3** [Med] CSP `unsafe-inline`/`unsafe-eval` 제거(nonce/hash) — Vite/HMR 충돌 검토 동반. `tauri.conf.json:26`.
- **S4** [Low] Dev 마스터키 `#[cfg(debug_assertions)]` 게이트 + Argon2id/scrypt+솔트(manager.rs:214); http_proxy 리다이렉트 재검증(F21 연동); validate_path allowlist화(utils.rs); 프롬프트 인젝션 신뢰경계 마킹(documentTools.ts); 로그 client_id/request_body 마스킹.

### 아키텍처 부채
- **A1** `materializeBlocksFromDocuments`(projectStore.ts:1519-1657)의 delta-마지막-블록 귀속 휴리스틱 → TipTap attrs(segmentGroupId) 기준 정투영. (세그먼트 매핑 신뢰도.)
- **A2** 문서-코드 드리프트: `MAX_MESSAGES_PER_SESSION` 주석(db/mod.rs:664), severityFilter 기본값(reviewStore.ts:224), oddeyes-desktop-mcp 버전/도구 개수(patterns.md), WAL 동시성 주장(gotchas #89). manifest tools 빌드 스크립트화, `PRAGMA user_version` 도입.
- **A3** AI 경로 divergence: review effort 가드를 `resolveModelCallOptions`(모델 판정 지점)로 이동(modelCallOptions.ts:71 vs ai.rs:188 vs client.rs:76); Rust 번역/검수 경로에 429 백오프 추가.

---

## 남은 확인 (사람 판단)
- F15/F16: "같은 프로젝트에서 set 후 사용자 편집" 시 하드 차단 vs 경고 후 강제 적용 — 우선 하드 차단 구현, 제품 결정 시 조정.
- S3(백로그): CSP 강화가 Vite 인라인/HMR과 충돌 가능 → 빌드 설정 조정 필요.
- F19: async화 대상 범위 — 무거운 명령(export/import/save_project/save_chat_sessions/backup) 우선.
