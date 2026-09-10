# In-depth 코드 리뷰 (2026-07-07)

> 대상: `translation-editor` 전체 코드베이스 (`src/`, `src-tauri/`, `crates/`, `tauri-testing-mcp/`, `oddeyes-desktop-mcp/`), HEAD `4d0cc59` (품질 장부 WP-A1) 기준.
> 관점: **Performance · Architecture · Logic · Security**, 특히 **Concurrency** 정밀 검증.
> 방법: 4개 관점별 멀티에이전트 정밀 리뷰 후, P0/P1 발견은 소스 재확인(file:line)으로 적대적 검증. `.claude/gotchas.md`·`architecture.md`·`patterns.md`의 문서화된 의도와 대조하여 오탐 제거, 문서-코드 불일치는 별도 표기.
> 표기: 심각도 P0(데이터 손상/보안 치명) > P1(런타임 실패/유실) > P2(UX/성능 체감) > P3(위생/부채). 각 항목은 진단 → 트리거 → 수정안 순.

---

## 0. 총평

F1–F13 수정(2026-07-03) 이후 **reviewApply/SearchHighlight의 문서 손상 계열**과 **모델 호출 옵션 통일**은 견고합니다. 저장 동시성(`saveProject` single-flight+requeue), 채팅 hydration/persist의 projectId 재검증, history의 requestSeq 가드 등 store 계층의 race 방어는 이미 상당 수준으로 구축되어 있습니다(§검증완료 참조).

그러나 이번 전수 리뷰에서 **아직 방어되지 않은 concurrency 취약 지점 3종**이 새로 확인되었습니다. 모두 F-계열이 잡은 "reviewApply 문서 손상"과 동급의 사용자 가시적 손상으로 직결됩니다.

1. **채팅 스트림 완료 경로에 소유권(epoch) 가드 부재** — 취소/전환된 요청이 새 요청의 상태를 덮어씀 (§L1).
2. **번역/폴리싱/Desktop 프리뷰 apply에 프로젝트·리비전 재검증 부재** — A 프로젝트의 번역이 B 문서에 적용됨 (§L2, §L3).
3. **OAuth 토큰 갱신 single-flight 부재 + 실패 시 유효 토큰 삭제** — 동시 요청이 방금 갱신된 토큰을 파괴, 강제 재인증 (§C2).

또한 성능 측면에서 **키 입력당 문서 전체 직렬화 + 캔버스 전체 리렌더**(§P1), **검수 하이라이트 O(k·n) 재계산**(§P2)이 대형 문서(번역가가 실제로 붙여넣는 10만 자급)에서 체감 랙을 유발합니다. 보안은 vault/키체인 설계·AI 렌더링 정화가 탄탄하나, **CSP가 XSS를 못 막는 상태**(§S3)와 **테스트 브리지 고정 토큰/Origin 미검증**(§S1)이 심층방어 공백입니다.

우선순위 요약:

| # | 심각도 | 영역 | 파일 | 요약 |
|---|--------|------|------|------|
| L1 | P0 손상 | Logic/Concurrency | `chatStore.ai.ts:290-294,298-335` | 취소·전환된 채팅 스트림이 완료 시 새 요청 상태를 덮어씀 (소유권 가드 부재) |
| L2 | P0 손상 | Logic/Concurrency | `EditorCanvasTipTap.tsx:641-684,705-743` | 번역/폴리싱 프리뷰 Apply가 프로젝트 전환 후 다른 프로젝트 문서를 덮어씀 |
| L3 | P0 손상 | Security/Concurrency | `translationPreviewActions.ts:10-42` | Desktop 프리뷰 apply에 projectId/revision 재검증 부재 |
| C2 | P1 유실 | Concurrency | `mcp/oauth.rs:215-247` | 동시 토큰 갱신 race + 실패 시 유효 토큰 삭제 → 강제 재인증 |
| C1 | P1 UX멈춤 | Concurrency | `commands/*.rs` 동기 명령 | DB/백업 명령이 메인 스레드 점유 → UI 프리즈 |
| S1 | High | Security | `tauri-plugin-testing/src/lib.rs:99-103,208` | 테스트 브리지 고정 fallback 토큰 + Origin 미검증 → 로컬 RCE |
| S2 | Med | Security | `desktop_mcp.rs:241` | 운영 브리지 토큰 `bridge.json` 0644 평문 저장 |
| S3 | Med | Security | `tauri.conf.json:26` | CSP `unsafe-inline`+`unsafe-eval` → XSS 방어 무력화 |
| L4 | P1 재진입 | Logic/Concurrency | `ReviewPanel.tsx:166-306` | 검수 실행 이중 실행 창 + 전환 시 미중단 → 품질 장부 오염 |
| C3 | P2 유실 | Concurrency | `App.tsx:267-299` | Safe Exit이 채팅/설정 debounce를 flush 안 함 → 종료 시 유실 |
| C4 | P2 hang | Concurrency | `commands/ai.rs:254,382`, `http_proxy.rs` | timeout 없는 reqwest + 루프 상단만 취소 검사 → 취소 불능 hang |
| C5 | P2 누수 | Concurrency | `oddeyes-bridge/src/lib.rs:318-353` | pending map이 timeout 시 제거 안 됨 (운영 상시 활성) |
| P1 | P1 성능 | Performance | `TipTapEditor.tsx:199-208` | 키 입력당 getHTML+getJSON+캔버스 전체 리렌더 |
| P2 | P1 성능 | Performance | `ReviewHighlight.ts:93-96` | 문서 변경마다 데코레이션 O(k·n) 재계산 |
| P3 | P2 성능 | Performance | `ChatContent.tsx:439-446` | 토큰마다 전체 메시지 리스트 리렌더 |
| A1 | 부채 | Architecture | `materializeBlocksFromDocuments` | delta를 마지막 블록에 귀속하는 휴리스틱이 세그먼트 매핑 훼손 |
| A2 | 부채 | Architecture | 다수 | 문서-코드 드리프트 (버전/상수/도구 개수) |

---

## 1. Logic / Concurrency (P0–P1)

### L1. [P0 손상] 채팅 스트림 완료 경로에 소유권(epoch) 가드 부재
`src/stores/chatStore.ai.ts:110-111, 277-294, 298-335`

`executeAiReply`는 시작 시 `abortController`를 store에 등록하지만(110-111행), 완료/에러 시점에 "이 컨트롤러가 아직 내 것인가"를 확인하지 않고 무조건 store에 씁니다:

```ts
// 290-294행 (성공 경로)
set({ streamingContent: restored });
get().finalizeStreaming();     // get()의 "현재" streamingMessageId에 커밋
set({ abortController: null }); // 무조건 클리어
```

`streamAssistantReply`(`src/ai/chat.ts`)는 청크 사이에서만 abort를 확인하므로, 마지막 청크 수신 후 abort되면 정상 resolve됩니다.

**트리거**: ① 요청 A 스트리밍 중 사용자가 프로젝트 전환(`hydrateForProject`의 abort, `chatStore.session.ts:46`) 또는 `deleteMessageFrom`으로 A 취소 → ② A는 이미 마지막 청크를 받아 정상 resolve 대기 → ③ 사용자가 새 메시지 B 전송(스트리밍 상태 초기화됐으므로 가드 통과) → ④ A의 후속 코드가 `streamingContent`를 A 텍스트로 덮고, `finalizeStreaming()`이 **현재** `streamingMessageId`(=B placeholder)에 **A의 내용을 커밋**, `abortController:null`로 B의 진행 상태까지 파괴 → B의 토큰은 최종 커밋되지 못하고 유실. catch 경로(298-335행)도 무조건 리셋하므로 동일. `/web` 검색 경로(454, 463행)는 abortSignal조차 없어 같은 클래스입니다.

**수정**: 진입 시 생성한 `abortController`를 클로저에 보관하고, 완료/에러 상태 쓰기 전에 `if (get().abortController !== abortController) return;` 가드 추가. `finalizeStreaming`은 호출자가 `assistantId`를 명시 전달하도록 변경.

### L2. [P0 손상] 번역/폴리싱 프리뷰 Apply에 프로젝트·리비전 재검증 부재
`src/components/editor/EditorCanvasTipTap.tsx:439-535, 641-684, 705-743`

`EditorCanvasTipTap`은 프로젝트 전환 시 remount되지 않습니다(780-784행 주석). `translateAbortController`·`translatePreviewDoc`·`translatePreviewOpen`은 모두 컴포넌트 로컬 상태/ref이며, `switchProjectById`(`projectStore.ts:808-846`)는 채팅 abort만 수행하고 번역/폴리싱 컨트롤러는 store에 없어 건드리지 못합니다.

**트리거**: 프로젝트 A에서 번역 실행 → 스트리밍 중(또는 프리뷰 모달 열린 채) B로 전환 → 완료 후 모달이 B 위에 그대로 표시 → Apply 클릭 → `applyTranslatePreview`(641행)가 프로젝트/리비전 검증 없이 `replaceDocContent(targetEditorRef.current, ...)`로 **B의 Target 문서를 A의 번역으로 통째로 교체**, 658행에서 fresh `project`(=B)를 읽어 **B의 히스토리에 스냅샷**, 673행에서 **B의 품질 장부에 기록**. 폴리싱(554-612, 705-743행)도 동일. ReviewPanel 재번역은 스트리밍 중 전환은 막지만(519행 stale check 유효), **완료 후 모달 열린 채 전환 후 Apply**(`applyRetranslationDoc`가 fresh project 사용)는 막지 못합니다.

**수정**: ① 요청 시작 시 `projectId` + Target 문서 해시(revision) 스냅샷을 잡고, 완료/Apply 시 `useProjectStore.getState().project?.id` 및 현재 revision과 비교, 불일치 시 apply 중단 + 사용자 토스트("프로젝트가 전환되어 적용을 취소했습니다"). 재번역의 519행 패턴을 apply 시점까지 확장. ② `project?.id` 변경 effect에서 두 프리뷰 모달 close + abort.

### L3. [P0 손상 / 보안] Desktop 프리뷰 apply에 projectId·revision 재검증 부재
`src/desktop/translationPreviewActions.ts:10-42`, `src/desktop/oddeyesAppBridge.ts:120-152`, `src/stores/translationPreviewStore.ts`

`setTranslationPreview`(oddeyesAppBridge.ts:120-152)는 set 시점에만, 그것도 **호출자가 revision을 넘긴 경우에만** 검사합니다(`assertRevision`: expected 없으면 통과). `projectId` 파라미터는 아예 받지 않습니다(`setReviewIssues`/`setTranslationContext`는 검사하므로 비대칭). 그리고 `translationPreviewStore`는 `switchProjectById`/`loadProject` 어디에서도 clear되지 않습니다(clearPreview는 apply/discard 두 곳뿐).

**트리거**: Claude Desktop이 A 기준 프리뷰 set → 사용자가 B로 전환(모달 `DesktopTranslationPreviewHost`는 App 루트라 그대로 열림) → Apply 또는 외부 `oddeyes_apply_translation_preview` 호출 → `applyDesktopTranslationPreview`가 검증 없이 **B의 targetEditor를 A의 번역으로 교체** + B에 스냅샷. 같은 프로젝트라도 set과 apply 사이 사용자 편집분이 `targetRevision` 재확인 없이 통째로 덮임. 이는 §S(보안)의 "외부 브리지가 사용자 확인 없이 문서 변조"와 겹치는 지점.

**수정**: ① store에 `projectId` 필드 추가, `setPreview` 시 기록, `applyDesktopTranslationPreview`에서 현재 project.id + `targetRevision`(문서 해시) 재검증 후 불일치 시 throw. ② `switchProjectById`/`loadProject`에서 `clearPreview()`. ③ oddeyesAppBridge의 revision/projectId를 필수 파라미터화.

### L4. [P1 재진입] 검수 실행 이중 실행 창 + 전환 시 미중단 → 품질 장부 오염
`src/components/review/ReviewPanel.tsx:166-306`

- **이중 실행**: `handleRunReview`는 `startReview()`(203행, `isReviewing=true`)를 **`await buildAlignedChunksAsync`(188행) 이후**에 호출. 큰 문서에서 이 await는 수백 ms이며 그동안 "검수 시작" 버튼이 계속 노출됨(`isReviewing` 아직 false). `triggerReview()`의 가드(`reviewStore.ts:359`)도 같은 창을 못 막음. 두 루프 동시 진행 시 `addResult`가 뒤섞여 progress 2배 카운트, 먼저 끝난 루프의 `finishReview()`가 진행 중 검수를 완료로 표시, 취소 버튼이 첫 루프를 못 멈춤.
- **전환 미중단 + 장부 오염**: 검수 루프는 프로젝트 전환 시 abort되지 않음. 전환 후 effect(149행)가 `initializeReview(newProject)`로 results를 비워도 **돌던 루프가 계속 `addResult`로 구 프로젝트 이슈 주입**. 특히 282-284행이 `useProjectStore.getState().project?.id`를 **fresh로 읽어** `recordIssuesProposed(새프로젝트ID, 구프로젝트이슈)`를 기록 → 품질 장부 영구 오염.

**수정**: ① 함수 첫 줄에 `if (useReviewStore.getState().isReviewing) return;`, chunk 빌드 전에 `isReviewing:true` 설정. ② 루프 시작 시 `startProjectId` 캡처, 매 iteration에서 현재 id와 비교해 break, ledger 기록도 캡처된 ID 사용. ③ `switchProjectById`에서 review abort 신호 제공.

### L5. [P2] 기타 stale 후행 쓰기 / 재진입 (묶음)

- **`reviewStore.initializeReview`(reviewStore.ts:243-262)**: `await buildAlignedChunksAsync` 후 무조건 set → A→B 빠른 전환 시 늦게 끝난 A가 B 상태를 덮음. `hydrateCommentsForProject`의 `requestSeq` 패턴 적용 권장.
- **`switchProjectById`(projectStore.ts:808-846)**: 동시 호출 시 전환 세대 토큰 없음 → last-click-wins 위반 가능. `await` 동안 이전 에디터 편집분이 `loadProject`의 `isDirty:false`로 유실 가능.
- **`attachFileAction`(chatStore.settings.ts:211-231)**: `projectId` 캡처 후 재검증 없이 append → 첨부 중 전환 시 유령 첨부가 새 프로젝트 UI에 표시. set 전 `if (get().loadedProjectId !== projectId) return;`.
- **abort 시 빈 assistant placeholder**(chatStore.ai.ts:171,300): AbortError catch가 빈 메시지를 제거하지 않아 구 프로젝트에 빈 말풍선 영속.
- **retranslate 모달 실행 버튼 이중 클릭 가드 없음**(ReviewPanel.tsx:913).
- **죽은 코드**: `pendingDocDiff`/`acceptDocDiff`(projectStore.ts:948-989)는 Monaco 시대 잔재, 미사용. 제거 권장.

---

## 2. Concurrency (Rust 백엔드, P1–P2)

### C1. [P1 UI 프리즈] 동기 DB/백업 명령이 메인 스레드 점유
`commands/storage.rs:50`, `project.rs:130`, `chat.rs:92`, `glossary.rs`, `history.rs`, `quality.rs` 등 다수

DB를 만지는 명령이 전부 동기 `pub fn`(`#[tauri::command(async)]` 없음)입니다. Tauri v2에서 동기 명령은 메인 스레드에서 실행됩니다. `export_project_file`(storage.rs:50)은 메인 스레드에서 `Backup::run_to_completion(5, 10ms, ...)`(db/mod.rs:231)을 돌려, 20MB DB(스냅샷 50개면 쉽게 도달)면 약 10초간 UI 완전 정지. `save_project`는 blocks 전량 delete+insert를 500ms write-through마다 반복. 나아가 모두 `DbState(std::sync::Mutex<Database>)` 하나를 공유하므로, 한 명령이 락을 오래 쥐면 뒤이은 동기 명령이 메인 스레드 위에서 락 대기하며 이벤트 루프 전체(메뉴/리사이즈/렌더)가 얼어붙습니다.

**수정**: 무거운 명령을 `async fn` + `tauri::async_runtime::spawn_blocking`으로 이관하거나 최소한 `#[tauri::command(async)]` 부여(스레드풀 실행, 사실상 1줄 변경). export/import는 진행 콜백과 함께 백그라운드 수행.

### C2. [P1 유실] OAuth 토큰 갱신 single-flight 부재 + 실패 시 유효 토큰 삭제
`src-tauri/src/mcp/oauth.rs:215-247`

```rust
let needs_refresh = { ... t.is_expired() };
if needs_refresh {
    match self.refresh_token().await {
        Err(e) => {
            *self.token.lock().await = None;
            let _ = SECRETS.delete(VAULT_MCP_TOKEN).await; // ← 방금 갱신된 토큰까지 삭제
            return None;
```

`get_access_token`은 요청마다 호출되는데(`build_mcp_request`) 갱신에 single-flight가 없습니다.

**트리거**: 토큰 만료 상태에서 MCP 도구 호출 2건 동시 진입 → A, B 모두 `needs_refresh=true` → 둘 다 같은(구) refresh_token으로 POST. OAuth 2.1 public client라 refresh token rotation이 적용되므로, A가 성공해 새 토큰을 vault 저장한 직후 B가 invalid_grant로 실패하고, B의 에러 경로가 메모리 토큰과 vault의 토큰을 삭제 → 갱신이 성공했는데도 사용자가 로그아웃되고 브라우저 재인증 강제. `commands/connector.rs:191-246`도 동시 refresh race 존재(삭제는 안 하므로 경미).

**수정**: refresh 전용 `tokio::sync::Mutex`로 single-flight화, 락 획득 후 만료 재확인(double-check), 삭제는 "실패한 refresh_token이 현재 저장된 것과 동일할 때"만 수행.

### C3. [P2 유실] Safe Exit이 채팅/설정 debounce를 flush 안 함
`src/App.tsx:267-299`

`onCloseRequested`는 `projectStore.isDirty`만 검사/저장. 채팅 메시지/설정은 `CHAT_PERSIST_DEBOUNCE_MS=800ms` + DebouncedTextarea 700ms로 저장되므로, 마지막 메시지 수신/설정 입력 후 ~1.5초 내 종료 시 유실(창 닫기는 unmount flush도 미발생).

**수정**: close 핸들러에서 `clearPersistTimer()` 후 `persistNow()` await 추가. DebouncedTextarea는 프로젝트 전환 신호에서 즉시 flush(연관: L5 설정 필드 유실).

### C4. [P2 hang] timeout 없는 reqwest + 루프 상단만 취소 검사
`commands/ai.rs:254,363-389,466-491`, `http_proxy.rs:157`

`reqwest::Client::new()`에 connect/read timeout이 없고(ai.rs:254,548), 취소 플래그는 루프 상단에서만 검사(ai.rs:382). 서버가 침묵하면 `response.chunk().await`가 영원히 반환되지 않아, `ai_stream_cancel`로 플래그를 세워도 관찰되지 않음 → 커맨드 future 영구 생존, 프론트 promise 미settle.

**수정**: Client 빌드 시 `connect_timeout`+`read_timeout` 설정, 또는 `AtomicBool` 대신 `CancellationToken`/`Notify` + `tokio::select!`로 취소 즉시 반영. (부수: ai.rs는 호출마다 `Client::new()`라 커넥션 풀 미재사용 → `State`에 공유 Client 보관 권장, 성능 §과 연동.)

### C5. [P2 누수] 운영 브리지 pending map이 timeout 시 미제거
`crates/tauri-plugin-oddeyes-bridge/src/lib.rs:318-353`, `tauri-plugin-testing/src/lib.rs:388-438`

`call_bridge_method`는 `pending.insert(id, tx)` 후 `timeout(...)`으로 대기하는데, 타임아웃 경로에서 map 엔트리를 제거하지 않음. 운영 브리지는 `configure_runtime_env()`가 `ODDEYES_BRIDGE_ENABLED=1`을 무조건 설정(desktop_mcp.rs:92)해 **프로덕션 상시 활성**이므로, JS 브리지 무응답(webview reload/예외)마다 `HashMap` 엔트리가 영구 누적.

**수정**: 타임아웃/에러 반환 직전 `pending.lock().remove(&request_id)`(양쪽 플러그인).

### C6. [P2] SecretManager init 타임아웃 race → 마스터키 불일치 가능
`src-tauri/src/secrets/manager.rs:170-207`

대기자가 60초 후 상태를 `NotInitialized`로 리셋(175-183행)하는데, 원래 초기화 스레드는 여전히 실행 중일 수 있음(Keychain 프롬프트 방치). 이때 세 번째 호출자가 두 번째 초기화를 시작 → 첫 실행(Keychain 엔트리 없음)이면 둘 다 서로 다른 마스터키 생성 → 인터리브에 따라 "Keychain 저장 키 ≠ 메모리 키" → 다음 실행에서 복호화 실패, 모든 API 키/토큰 유실. 확률 낮으나 피해 큼.

**수정**: 타임아웃 시 상태 리셋 금지(에러만 반환)하거나 초기화 본체를 별도 Mutex로 순차화. `keyring get/set_password`는 블로킹 OS 호출이므로 `spawn_blocking` 래핑 권장.

### C7. [P2–P3] connect() TOCTOU 이중 실행 / cancel 레지스트리 누수 (묶음)

- **`mcp/client.rs:77-90`, `oauth.rs:373-395`**: `connect()`가 read 락으로 `is_connected||is_connecting` 확인 후 락 놓고 별도 write로 전환 → 동시 `mcp_connect` 2건이 OAuth/initialize 이중 실행, 콜백 서버 shutdown 채널 유실로 포트 방치. 상태 확인+전환을 하나의 write 락에서 수행.
- **`ai.rs:314-319`, `http_proxy.rs:83-88`**: `cancel()`이 `entry().or_insert_with()`로 미존재 id에 엔트리 생성 → 종료 후 도착한 늦은 cancel이 영구 엔트리 잔류. `get()`만 하고 없으면 no-op.
- **`block.rs:107,164`**: `split_block`/`merge_blocks`가 트랜잭션 없이 다중 쓰기(중간 실패 시 콘텐츠 중복). `unchecked_transaction()`으로 감쌀 것.
- **UTF-8 슬라이스 패닉 잠복**(`oauth.rs:316-320` 등): `&body[..200]`이 멀티바이트 경계에서 패닉. 현재 tracing subscriber 미초기화로 잠복이나, 로그 붙이는 순간 CJK 응답에서 패닉. `s.get(..n)` 사용.

---

## 3. Performance (P1–P2)

### P1. [P1] 키 입력당 문서 전체 직렬화 2회 + 캔버스 전체 리렌더
`TipTapEditor.tsx:199-208`, `EditorCanvasTipTap.tsx:67-68,1007,1102`

`onUpdate`마다 `getHTML()`+`getJSON()`(둘 다 O(문서)) 무조건 실행 → `setSourceDocument`/`setTargetDocument`+`setSourceDocJson`/`setTargetDocJson`가 매 키스트로크 store 갱신. `EditorCanvasTipTap`이 `sourceDocument`/`targetDocument`를 구독하므로 키 입력마다 1,300줄 캔버스(메뉴바/Select/패널 전부) 리렌더. **영향**: 10만 자급 문서에서 키당 20–40ms 체감 타이핑 랙.

**수정**: onChange/onJsonChange를 150–300ms 디바운스(저장이 어차피 500ms 디바운스라 정합성 손실 없음), DocJson 캐시는 push가 아니라 AI 도구가 읽는 시점에 live editor에서 lazy 계산.

### P2. [P1] 검수 하이라이트: 문서 변경마다 데코레이션 O(k·n) 재계산
`ReviewHighlight.ts:93-96`, `reviewApply.ts:60-91`, `SearchHighlight.ts:55-111`

`tr.docChanged`면 무조건 `createReviewDecorations` 재실행 → ① `buildExcerptSearchContext`가 문자 단위 positions+indexMap 재구축 O(n), ② 이슈마다 `findSegmentRange`가 `doc.descendants` 전체 스캔 O(n). **영향**: 이슈 100개 + 10만 자 = 키 입력당 ~101회 문서 순회(~1000만 연산). 검수 결과 떠 있는 상태의 Target 편집이 눈에 띄게 느림.

**수정**: ① ctx 구축 시 한 번의 순회로 segmentGroupId→range 맵 생성(O(n+k)로 축소), ② docChanged 시엔 기존 데코레이션을 `map()`만 하고 재계산은 300ms idle 디바운스 또는 `highlightNonce` 갱신 시로 한정.

### P3. [P2] 채팅 스트리밍: 토큰마다 전체 메시지 리스트 리렌더 + O(n²) 문자열
`ChatContent.tsx:439-446`, `ChatMessageItem.tsx:38`, `chatStore.ai.ts:186`

`streamingContent`/`statusMessage`를 모든 `ChatMessageItem`에 prop 전달, `memo`에 커스텀 비교자 없어 토큰마다 전 아이템 reconcile. 또 토큰마다 `restoreGhostChips(full)`로 누적 전체 재처리(chip 존재 시 O(L²)).

**수정**: `streamingContent={streamingMessageId === message.id ? streamingContent : null}`로 전달 범위 축소(또는 memo 비교자), chip 복원은 finalize 시 1회.

### P4. [P2] 번역/폴리싱 스트리밍 텍스트가 캔버스 로컬 state
`EditorCanvasTipTap.tsx:156,509-511`

`onToken → setStreamingText(text)`가 컴포넌트 `useState` → 델타마다 두 TipTap 에디터 포함 캔버스 전체 리렌더(64K 토큰 번역이면 수만 회). 표시는 modal에서만 하므로, 스트리밍 텍스트를 modal 내부 state/전용 store로 이동하면 캔버스 리렌더 0회.

### P5. [P2] 기타 (묶음)

- **이미지 바이트를 `number[]` JSON으로 IPC**(attachments.ts:43, attachments.rs:170): 5MB 스크린샷이 ~20MB JSON 문자열 → 붙여넣기 시 UI 수백 ms 프리즈. base64 문자열 또는 raw `tauri::ipc::Response`로 전환.
- **500ms 폴링 루프 3개**(projectStore autoSave, historyStore autoSnapshot, write-through): 상시 wakeup + 스냅샷 시 문서 재구축+해시. 단일 스케줄러 + 이벤트 구동(`lastChangeAt`) 전환 권장. 배터리 비우호적.
- **동기 저장 명령 async화 + reqwest Client 공유**: C1/C4와 연동, 저비용 고효과.

---

## 4. Architecture (부채)

### A1. materializeBlocksFromDocuments의 delta 휴리스틱이 세그먼트 매핑 훼손
`projectStore.ts:1519-1657`

"TipTap JSON is canonical" 원칙과 달리 실제 canonical은 `project.blocks` HTML이며, 그 위에 sourceDocument/targetDocument + sourceDocJson/targetDocJson의 3중 표현이 존재. 저장 시 역투영 fallback이 **문서 길이 delta를 전부 마지막 블록에 귀속**하는 휴리스틱(1567-1600행)이라, 중간 블록 편집 시 세그먼트-블록 매핑이 실제 위치와 어긋난 채 저장. 검수 segmentGroupId 매칭의 신뢰도가 이 휴리스틱에 얹혀 있음.

**권장**: TipTap 노드 attrs(segmentGroupId) 기준 정투영으로 교체.

### A2. 문서-코드 드리프트

- `db/mod.rs:664` 주석 "메시지 30개" vs 코드 `MAX_MESSAGES_PER_SESSION=100`(701행).
- `reviewStore.severityFilter` 기본값 코드 `['critical','major','minor']`(224행) vs patterns.md/gotchas #31 `['critical','major']`.
- patterns.md `oddeyes-desktop-mcp v0.2.0, 10개 도구` vs 실제 0.3.0/12개(quality 도구 2종 추가).
- `.claude/gotchas.md:241`(#89) "WAL로 동시성 대폭 향상" vs 실제 커넥션 1개 + `std::sync::Mutex`라 앱 내부 읽기조차 직렬화(WAL 동시성 이득 없음).

**권장**: manifest `tools` 배열을 등록부에서 생성하는 빌드 스크립트로 드리프트 제거, `PRAGMA user_version` 도입(현재 `SELECT LIMIT 0` 프로브 방식).

### A3. AI 호출 경로 이원화 잔여 divergence
`modelCallOptions.ts`가 temperature/thinking/effort는 통일했으나, review effort 가드가 한쪽에만 존재: `resolveModelCallOptions`는 OpenAI면 무조건 `effort:'high'`(71행), Rust는 `starts_with("gpt-5")`일 때만 전달(ai.rs:188), LangChain은 모델 구분 없이 전달(client.rs:76) → 웹/폴백에서 gpt-4o 검수 시 400 위험. 가드를 `resolveModelCallOptions`(모델 판정 지점)로 이동. 또 `withRetry`(429 백오프)가 chat 경로에만 있고 Rust 번역/검수엔 없음 → 긴 문서 번역 중 429 그대로 실패.

---

## 5. Security

### S1. [High] 테스트 브리지 고정 fallback 토큰 + Origin 미검증 → 로컬 RCE
`crates/tauri-plugin-testing/src/lib.rs:99-103, 208-246, 322-345`

릴리스에서는 `#[cfg(feature="testing")]`로 제외되나(clean 확인), `--features testing` E2E 세션에서: ① `TAURI_TEST_TOKEN` 미설정 시 고정값 `"tauri-testing-token"` + 고정 포트, ② `accept_async` 후 **Origin 미검증**(브라우저 WebSocket엔 CORS/프리플라이트 미적용), ③ `tauri.invoke` 메서드(344행)가 임의 커맨드 실행 허용.

**시나리오**: 개발자가 E2E로 앱을 띄운 동안 브라우저의 악성 페이지가 기본 포트/토큰으로 인증 → `tauri.invoke`로 `write_binary_file` 호출 → `~/Library/LaunchAgents/`에 plist 심어 로그인 시 코드 실행(지속성).

**수정**: fallback 토큰 제거(미설정 시 서버 미기동), Origin을 `tauri://`/`http://127.0.0.1:1420`만 허용, 상수 시간 토큰 비교(`subtle`/`ring::constant_time`).

### S2. [Med] 운영 브리지 토큰 `bridge.json` 0644 평문 저장
`src-tauri/src/desktop_mcp.rs:241`, `crates/tauri-plugin-oddeyes-bridge/src/lib.rs:205`

운영 브리지는 릴리스 상시 활성(랜덤 포트 + 190bit 랜덤 토큰이라 브루트포스는 비현실적 → 완화). 그러나 토큰이 `fs::write`(241행) 기본 퍼미션(0644)으로 평문 저장되어 **동일 사용자 권한의 다른 프로세스가 읽을 수 있음** → 포트+토큰 확보 시 인증 통과. 인증 후 `oddeyes.*` 메서드로 문서 전문 유출, `setTranslationPreview`+`applyTranslationPreview`로 **사용자 확인 없이 Target 덮어쓰기**(L3와 동일 근본), persona/rules/검수 이슈 주입 가능. 단 `tauri.invoke`가 없어 RCE는 불가(고정 12개 메서드 제한).

**수정**: `bridge.json`을 0600으로 생성(작성 후 `set_permissions`), Origin 검증, 상수 시간 비교, `applyTranslationPreview`에 UI 확인 게이트 유지.

### S3. [Med] CSP가 XSS를 못 막는 상태
`src-tauri/tauri.conf.json:26`

`script-src 'self' 'unsafe-inline' 'unsafe-eval'` → 스크립트에 인라인+eval 허용이라 CSP가 XSS를 전혀 못 막음. 현재 프론트 sink는 정화로 잘 방어되나(clean), 정화 누락 하나면 즉시 `window.__TAURI_INTERNALS__.invoke`를 통한 완전 장악으로 확대. 앱이 입력 정화에만 전적 의존.

**수정**: 스크립트 `unsafe-inline` 제거(nonce/hash), 가능하면 `unsafe-eval`도 제거. 최소한 심층방어로 인라인 스크립트 차단.

### S4. [Low] 기타 (묶음)

- **Dev 마스터키**(secrets/manager.rs:120-151,214): `ITE_DEV_MASTER_KEY`가 `debug_assertions` 게이트 없어 릴리스 바이너리도 env 있으면 Keychain 우회. 솔트/KDF 없는 SHA-256 → 약한 passphrase면 vault 유출 시 GPU 브루트포스. `#[cfg(debug_assertions)]` 게이트 + Argon2id/scrypt+솔트.
- **HTTP 프록시 리다이렉트**(http_proxy.rs:157): allowlist+https-only는 견고하나, reqwest 기본 리다이렉트 10회를 호스트 재검증 없이 추종(허용 호스트의 오픈 리다이렉트 시 이론적 SSRF). `Policy::none()` 또는 리다이렉트마다 재검증. (Authorization은 크로스호스트 시 제거되므로 키 유출 완화.)
- **validate_path가 blocklist 방식**(utils.rs:82-129): `~/.ssh`, `~/Library/LaunchAgents` 등 홈 전체 쓰기 허용. 현재 익스플로잇 경로는 없으나 XSS 하나 뚫리면 지속성 RCE로 확대. export 대상 allowlist화 또는 다이얼로그 반환 경로만 수용. (심링크는 canonicalize로 차단됨.)
- **프롬프트 인젝션 데이터 흐름**(documentTools.ts:188, oddeyesAppBridge.ts:190): MCP 외부 콘텐츠/주입 검수 이슈에 신뢰경계 마킹 없음. `<untrusted>...</untrusted>` 구분자 + 시스템 프롬프트에 실행 금지 명시.
- **로그 정보 노출**(oauth.rs:156 client_id, notion/client.rs:126 request_body): 시크릿 값은 아니나 준민감. 마스킹/제거.

### 보안 clean (확인)
Vault(XChaCha20-Poly1305 AEAD + CSPRNG + zeroize + atomic write), Keychain 최소화(마스터키 1개만), 채팅 AI 렌더링(react-markdown `skipHtml`), Confluence/붙여넣기 HTML(DOMPurify allowlist + 프로토콜 차단 + 스키마 재파싱), AI 자율 도구(전부 읽기/제안 전용, 문서 변조·파일 쓰기·커맨드 실행 불가), Confluence/Notion REST(id 검증 + 호스트 고정 → SSRF 불가), 커맨드 인젝션 없음, 테스트 브리지 릴리스 제외, 업데이터 minisign 서명 검증, CI 시크릿(태그/dispatch 트리거만, `pull_request_target` 없음), 첨부/임시 이미지(경로탐색 제거 + 확장자 allowlist + 크기 제한 + zip-slip 없음), capabilities 최소 권한.

---

## 6. 검증 완료 (건전 확인 — 커버리지 참고)

**Concurrency (Rust)**: std MutexGuard를 await 너머로 보유하는 곳 없음(전수 확인); 락 순서 역전/이중 락 데드락 없음(SecretManager 단방향, oauth.rs:453 스코프 분리 주석 정확); DB 다중 쓰기 트랜잭션(delete_project/save_project/save_comments/quality/glossary 배치 사용, 예외는 block.rs 2곳); vault 쓰기 원자성(tmp+sync_all+rename); 테스트 브리지 단일 클라이언트 enforcement(`active_client.swap(true, SeqCst)` 원자적); OAuth 콜백 서버 수명(shutdown mpsc + 자체 타임아웃 + state 검증); 전역 초기화(Lazy/OnceCell thread-safe); JSON-RPC 요청 ID(AtomicU64); DB Mutex poison → LOCK_ERROR 매핑; http_proxy 보안 게이트.

**Concurrency (Frontend)**: `saveProject` single-flight+requeue(concurrency.test 커버); chat hydration 가드(requestId + 활성 프로젝트 재검증, F Issue#3 유효); chat persist projectId 재검증(F Issue#9 유효); comments hydrate/persist requestSeq; historyStore(requestSeq + 프로젝트별 직렬화 큐 + auto snapshot 무효화); **reviewApply F1–F3**(적용 시점 재검색으로 위치 드리프트 원천 차단, 다중 매치 포기, 블록 경계 가드 유지); **SearchHighlight replace F**(단일 트랜잭션 역순 교체); EditorCanvasTipTap 에디터 재등록 fix(project.id effect + isDestroyed 가드 유효); 재번역 스트리밍 중 전환 가드(519행); finalizeStreaming 재진입 가드; useChatScroll F9/F10; aiConfigStore 키 로딩 single-flight.

**Security**: §5 clean 목록 참조.

---

## 7. 남은 확인 필요 (사람 판단 권장)
- L2/L3의 프리뷰 revision 재검증 시 "같은 프로젝트에서 set 후 사용자 편집"을 어디까지 막을지(하드 차단 vs 경고 후 강제 적용) 제품 결정 필요.
- S3 CSP 강화는 Vite 인라인 스크립트/HMR과 충돌 가능 → 빌드 설정 조정 동반 필요.
- C1 async화는 명령별로 대량 변경이므로, 무거운 명령(export/import/save_project/save_chat_sessions/backup) 우선 적용 권장.
