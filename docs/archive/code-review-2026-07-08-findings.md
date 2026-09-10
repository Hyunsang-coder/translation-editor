# 코드 리뷰 findings (2026-07-08, xhigh workflow)

> 대상: 2026-07-08 커밋들(디바운스 에디터 동기화 + 사이드바 숨김 리팩터). `/code-review ultra`(workflow, xhigh) 결과 15 findings.
> workflow run `wf_ab8b25be-aa4`. 리뷰가 매긴 `[1]`–`[15]`가 세션의 F1–F15와 동일.

## 처리 상태

| # / F | file:line | verdict | 요약 | 상태 |
|---|---|---|---|---|
| F1 / [2] | App.tsx:288 | CONFIRMED | 종료 시 debounce 내 편집 유실 | ✅ e3aaa19 |
| F2 / [1] | TipTapEditor.tsx:264 | CONFIRMED | AI 도구가 stale 문서 JSON 읽음 | ✅ e3aaa19 |
| F3 / [3] | ReviewHighlight.ts:100 | CONFIRMED | 하이라이트 추적 stale(≤300ms) | ⏸️ nonce 안전망 있어 미수정 결론 |
| F4 / [4] | EditorCanvasTipTap.tsx:724 | PLAUSIBLE | apply 리비전 가드 null 시 우회 | ✅ 2e6af35 |
| F5 / [5] | utils.rs:154 | PLAUSIBLE | symlink $HOME → .ssh/.aws 차단 우회 | ✅ 2e6af35 |
| F6 / [6] | docBlockDiff.ts:108 | CONFIRMED | sentenceKey 한글 어절 공백 오분류 | ✅ 2e6af35 (현행 유지+문서화) |
| F7 / [7] | ReviewPanel.tsx:228 | PLAUSIBLE | 검수 중 전환 시 isReviewing 누수 | ✅ 조기반환+finally 반납 |
| F8 / [8] | chatStore.helpers.ts:47 | PLAUSIBLE | ghost-restore suffix 충돌 | ✅ window 32→128 하드닝 |
| F9 / [9] | EditorCanvasTipTap.tsx:100 | CONFIRMED | reveal이 빈 채팅 세션 생성 | ✅ panels 있으면 un-hide만 |
| F10 / [10] | attachments.ts:122 | CONFIRMED | 이미지 크기 base64 경계 오탐 | ✅ padding 차감 정확 계산 |
| F11 / [11] | ai.rs:33 | PLAUSIBLE | 비스트리밍에도 read_timeout 적용 | ✅ oneshot 클라이언트 분리 |
| F12 / [12] | attachments.rs:190 | CONFIRMED | spawn_blocking 누락(async만 표시) | ✅ run_db_task 전환 |
| F13 / [13] | fileUtils.ts:12 | CONFIRMED | fileToBytes dead code | ✅ 제거 |
| F14 / [14] | EditorCanvasTipTap.tsx:41 | PLAUSIBLE | reveal-right 빈 panels 비대칭 | ✅ Invisible 셀렉터로 대칭 |
| F15 / [15] | en.json:5 | CONFIRMED | 미사용 i18n 키 common.show | ✅ 양 로케일 제거 |

## 상세 (F7–F15)

### F7 [PLAUSIBLE] ReviewPanel.tsx:228 — isReviewing 누수
`handleRunReview`가 `acquireReviewRun()`(isReviewing=true) 후, `buildAlignedChunksAsync` await 중
프로젝트 전환을 감지한 line 228 early-return이 `releaseReviewRun()` 없이 반환 → isReviewing=true 고착.
같은 근본원인: reviewStore.ts:264, ReviewPanel.tsx:226. 재현: Review 클릭 직후 청크 빌드 중 프로젝트 전환.

### F8 [PLAUSIBLE] chatStore.helpers.ts:47 — ghost-restore suffix 충돌
`createIncrementalGhostRestorer` 연속성 체크가 committed raw text의 suffix window만 비교.
스트림 리셋이 동일 trailing CONTINUITY_CHECK_LEN 문자를 다른 앞부분과 함께 재현하면 full recompute
미발동 → stale restoredPrefix 유지 → finalize 전까지 스트리밍 버블 깨짐.

### F9 [CONFIRMED] EditorCanvasTipTap.tsx:100 — reveal이 빈 세션 생성
`revealRightSidebar`가 `openActiveChat()`에 위임 → no-session 분기에서 un-hide 대신 `createSession()` 호출.
버튼은 rightSidebar.hidden일 때만 노출. 세션 0인 상태에서 우측 숨김 후 reveal 클릭 → 원치 않은 빈 채팅 세션 생성.

### F10 [CONFIRMED] attachments.ts:122 — 이미지 크기 base64 경계
`readImageAsDataUrl`가 원본 바이트를 `Math.ceil(base64.length*3/4)`로 근사 → base64 padding으로 최대 2바이트 과대.
maxSizeBytes 정확히 경계인 이미지가 spurious 'too large'로 거부.

### F11 [PLAUSIBLE] ai.rs:33 — 비스트리밍 read_timeout
공유 AI client의 `read_timeout(300s)`가 non-streaming `ai_complete`에도 적용 → first-byte 타임아웃으로 동작.
>300s 걸리는 reasoning 모델이 AI_NETWORK_ERROR. 이전(Client::new, 타임아웃 없음)엔 성공. doc 주석은 스트리밍만 고려.

### F12 [CONFIRMED] attachments.rs:190 — spawn_blocking 누락
`list_attachments`/`delete_attachment`가 async로 표시됐지만(주석은 스레드풀 offload 주장) `db_state.acquire()`를
async 런타임에서 inline 호출 — spawn_blocking 없음. 다른 변환 커맨드는 `run_db_task` 사용. std Mutex 하 동기 DB가
런타임 워커 블록 → C1 완화 미적용.

### F13 [CONFIRMED] fileUtils.ts:12 — dead code
`fileToBytes` 호출부(useChatComposerHandlers, useChatDragDrop) 모두 이 diff에서 제거됨. 함수만 남음. grep 확인 필요.

### F14 [PLAUSIBLE] EditorCanvasTipTap.tsx:41 — reveal-right 비대칭
`revealRightSidebar`는 `rightSidebar.hidden`일 때만 표시. 하지만 우측(채팅) 기본/빈 상태는 `{hidden:false, panels:[]}`로
역시 아무것도 렌더 안 함 → reveal 버튼 안 뜸. 좌측(`leftSidebarInvisible`)은 `.hidden` + `panels.length===0` 모두 처리 → 비대칭.

### F15 [CONFIRMED] en.json:5 — 미사용 i18n 키
`common.show`(및 ko.json 대응)가 두 로케일에 추가됐으나 소스 어디서도 미참조. `common.hide`는 UnifiedSidebar에서 사용.
Minimal>Speculative 위반.
