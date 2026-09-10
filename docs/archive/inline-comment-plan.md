# 인라인 마킹 + 코멘트 기능 구현 계획

> **상태(2026-06-30 업데이트)**: 첫 슬라이스(Phase 1+2+3a+3b+4) **구현·검증 완료**.
> 영속 방식은 **신규 `comments` 테이블**로 확정·구현. tsc clean, 유닛 616 pass, cargo 11 pass.
>
> **2번째 슬라이스(CommentListPanel 마운트) 구현·검증 완료**: 코멘트 패널을 docking sidebar의
> 신규 고정 패널 `'comments'`로 추가(review와 동일 패턴). tsc clean, 유닛 620 pass(신규 4).
> - `FixedPanelType`에 `'comments'` 추가(`isFixedPanel` 갱신).
> - `uiStore`: 기본 `leftSidebar.panels`에 `'comments'` 추가, `openCommentsPanel()` 액션,
>   persist v4→v5 마이그레이션(기존 사용자에 `comments` 탭 idempotent 추가).
> - `CommentListPanel.tsx`(신규): source/target 그룹핑, 클릭→마크 위치 스크롤, resolve 토글,
>   삭제(마크+스토어 동시 제거 후 saveProject).
> - `commentNavigation.ts`(+`.test.ts`, 신규): `findCommentRange`/`scrollToComment`/`removeCommentMark`
>   — 위치는 commentId 마크에서 직접 탐색(excerpt 검색 아님).
> - `UnifiedSidebar`: meta/icon/renderContent에 comments 등록.
> - `EditorCanvasTipTap`: 헤더에 코멘트 버튼(개수 배지)→`openCommentsPanel`.
> - i18n: `comment.title`/`jumpTo`/`emptyHint` 추가(ko/en).
>
> **3c 폴리싱 주입 구현·검증 완료**: tsc clean, 유닛 623 pass(신규 3).
> - `serializeUserComments(comments, { field?, leadIn? })`로 확장 — 기본 동작은 불변(번역 경로 영향 없음).
>   폴리싱은 `{ field: 'target', leadIn: '…다듬을 때 반드시 반영…' }`로 호출(폴리싱은 target만 다룸).
> - `polishDocument.ts`: `PolishTargetDocumentParams.userComments?` + `buildPolishSystemPrompt`/`buildPolishMessages` 주입
>   (styleRules 다음 위치, 번역 경로와 동일 패턴).
> - `EditorCanvasTipTap.openPolishPreview`에서 target 코멘트 직렬화 전달.
>
> **3d 리뷰 주입 구현·검증 완료**: tsc clean, 유닛 625 pass(신규 2).
> - `serializeUserComments`에 `segmentGroupIds?: Set<string>` 옵션 추가 — segmentGroupId가 있는
>   코멘트는 집합에 포함될 때만 통과(청크 범위 한정), id 없는 코멘트는 항상 포함.
> - `runReview.ts`: `RunReviewParams.userComments?` + user content에 코멘트 섹션 주입.
> - `ReviewPanel.handleRunReview`: 청크별로 `chunk.segments`의 groupId 집합으로 한정 직렬화
>   (대조 검수는 source/target 양쪽 코멘트 모두 맥락 사용).
>
> **3e 채팅 주입 구현·검증 완료**: tsc clean, 유닛 627 pass(신규 2).
> - `collectCommentIdsInRange(doc, from, to)` 헬퍼 추가(commentNavigation) — 선택 범위와 겹치는
>   코멘트 마크 id 수집(등장순 dedupe).
> - `EditorCanvasTipTap`의 Add-to-Chat onClick: 선택 범위에 걸린 코멘트를 `> 코멘트: {comment}`로
>   excerpt 아래 첨부해 composer에 전달.
>
> **🎉 LLM 주입 4경로(번역/폴리싱/검수/채팅) 모두 완료. 인라인 코멘트 기능 end-to-end 닫힘.**
> 남은 선택 작업: (옵션) 청킹 번역 경로 코멘트 지원, E2E 시나리오.
>
> 구현된 파일: `src/editor/extensions/CommentMark.ts`, `src/stores/commentStore.ts`,
> `src/tauri/comments.ts`, `src/ai/commentContext.ts`(serializeUserComments),
> `src/components/comment/CommentInputPopover.tsx`,
> `src-tauri`(schema `comments` 테이블 + `save_comments`/`load_comments` + `CommentRow`),
> `EditorCanvasTipTap.tsx`(버블 옆 코멘트 버튼→popover→마크+스토어, 번역 주입),
> `markdownConverter.ts`(CommentMarkForConversion: schema 등록+Markdown 무시),
> projectStore(load/save 하이드레이션 + 고아 정리 `collectLiveCommentIds`/`pruneOrphans`).
> `CommentListPanel.tsx`는 만들었다가 **이번 슬라이스에선 제거**(다음 슬라이스에 마운트와 함께 재생성).
>
> --- 아래는 원래 계획(참고용) ---
>
> **이번 슬라이스 범위 (확정)**: Phase 1 + 2 + **3b(번역/재번역 경로만)**.
> 폴리싱(3c)·리뷰(3d)·채팅(3e)은 첫 슬라이스 검증 후 다음 슬라이스로 미룬다.
> 이유: 한 번에 4곳 다 연결하면 검증 표면이 너무 커짐. 번역 경로로 end-to-end 먼저 닫는다.

## 새 세션 시작 가이드 (먼저 읽기)

1. 이 문서 전체와 아래 "조사로 확정된 사실"을 먼저 읽는다. (재조사 불필요 — 이미 검증됨)
2. 구현 순서: **Phase 1a → 1b → 1c → 1d → Phase 2 → Phase 3a → 3b → Phase 4**.
3. 첫 커밋 슬라이스 정의(검증 가능 목표):
   "Source/Target에서 텍스트 선택 → 코멘트 작성 → 마킹 표시 + 영속 저장 →
    번역/재번역 시 `[사용자 코멘트]` 섹션이 LLM 프롬프트에 포함되어 반영된다."
4. 각 단계 끝에 명시된 verify를 통과시키며 진행. 코드 작성 전 `.claude/rules/editor.md`와 `ai-chain.md` 재확인.
5. 시작 전 사용자에게 Phase 1d의 **영속 방식**(신규 `comments` 테이블 vs `blocks.metadata_json`)만 한 번 확정받는다.

## 조사로 확정된 사실 (재조사 불필요)

- **마킹 UI 재사용원**: `EditorCanvasTipTap.tsx`의 Add-to-Chat 버블 패턴 —
  `scheduleAddToChatBubble`/`attachSelectionWatcher`(L174-227), 렌더(L868-889), `coordsAtPos`로 좌표 계산.
- **마크 패턴 재사용원**: `src/editor/extensions/DiffMark.ts` — `Mark.create` + `parseHTML`/`renderHTML`.
  단 DiffMark는 라이브 에디터에 **미등록** 상태이므로 CommentMark는 직접 등록해야 함.
- **데이터 모델 차용원**: `src/stores/reviewStore.ts` `ReviewIssue`(L52-63), `generateIssueId`(L43-50).
  reviewStore 자체는 **휘발성**(비영속)이라 그대로 못 씀 → commentStore는 영속화 필요.
- **목록 UI 차용원**: `src/components/review/`의 `ReviewPanel.tsx`/`ReviewResultsTable.tsx`.
- **LLM 앵커링 선례(핵심)**: `translateDocument.ts` `buildTranslationSetup`이 reviewIssues를
  `[검수 이슈]` + `1. [타입] "원문" → "번역"` 형태(L233-262)로 system 프롬프트에 주입.
  코멘트도 **이 형태를 그대로 본떠** `[사용자 코멘트]\n1. "{excerpt}" — {comment}`로 주입.
- **하이라이트 복원 인프라**: `ReviewHighlight.ts`(L43-101)가 excerpt를 `normalizeForSearch`+`indexOf`로
  위치 복원. `buildTextWithPositions`/`findSegmentRange`(`SearchHighlight.ts` L55-103) 재사용 가능.
- **저장 포맷**: 블록 `content`는 HTML로 SQLite `blocks`에 저장(`db/schema.rs`, `projectStore.materializeBlocksFromDocuments`).
  → CommentMark span은 자동 영속. 코멘트 **본문**만 별도 영속 필요.
- **함정 출처**: `.claude/rules/editor.md` — 새 마크는 `getExtensions()`+`TipTapEditor.tsx` 양쪽 등록 필수,
  Underline/Highlight류처럼 **Markdown 변환 시 소실**(그래서 AI엔 excerpt로 변환).

## 목표

번역가가 Source/Target 에디터에서 **특정 단어/문장을 마킹하고 짧은 코멘트**를 남긴다.
이 코멘트는 (1) 화면에서 참고용으로 보이고, (2) 번역/재번역·폴리싱·리뷰·채팅 시
LLM에 **정확한 맥락으로 전달**되어 활용된다.

## 핵심 설계 결정 (확정)

- **저장 방식**: 영속 마크 `CommentMark` — 텍스트 범위에 `commentId` attrs를 입힌다.
  편집 시 ProseMirror가 위치를 자동 추적하고, HTML로 직렬화되어 SQLite `blocks.content`에 자동 영속.
- **코멘트 본문 저장**: 마크는 `commentId`만 들고, 코멘트 텍스트/메타는 별도 스토어(`commentStore`) + 영속 데이터에 둔다.
  (마크 attrs에 긴 텍스트를 넣지 않음 — HTML 오염/이스케이프 회피)
- **LLM 앵커링**: 마크는 Markdown 변환 시 소실되므로 **excerpt(인용) 방식으로 변환해 전달**.
  기존 `reviewIssues` 주입 패턴(`"인용구절" — 코멘트`)을 그대로 차용. 이 앱의 표준 앵커링 방식과 일치.

## 핵심 함정 (반드시 처리)

1. **Markdown 변환 소실** (`.claude/rules/editor.md`): CommentMark는 Underline/Highlight처럼 AI Markdown 경로에서 사라진다.
   → AI에 줄 땐 마크를 직렬화하지 말고, 코멘트별로 `editor`에서 `commentId` 범위의 `textBetween`을 뽑아 excerpt로 변환.
2. **확장 양쪽 등록**: 새 마크는 `markdownConverter.ts`의 `getExtensions()` + `TipTapEditor.tsx`의 `extensions` 양쪽 등록 필수.
   (누락 시 "no mark type comment in schema") — 단, **Markdown 변환기 쪽엔 등록하되 Markdown 직렬화에서 무시**되도록 처리(소실 허용).
3. **같은 구절 중복**: excerpt가 본문에 여러 번 나오면 모호. `segmentGroupId`(블록 범위 한정)를 함께 전달해 완화 — reviewStore 선례 사용.
4. **청킹 경로 누락**: `translateSourceDocWithChunking`은 reviewIssues/retranslateMessage를 청크에 안 넘김. 코멘트도 동일 한계 → 청크 경로에도 흘려보내거나, 단일호출 경로에서만 우선 지원하고 명시.
5. **고아 코멘트(orphan)**: 마킹된 텍스트가 삭제되면 마크는 사라지지만 commentStore 항목은 남음 → 주기적/저장 시 고아 정리 로직.

---

## 단계별 구현 계획

### Phase 1 — 데이터 모델 & 영속 마크 (기반)

**1a. `CommentMark` 익스텐션 신설** — `src/editor/extensions/CommentMark.ts`
- `DiffMark.ts`의 `Mark.create` + `parseHTML`/`renderHTML` 패턴 복제.
- `addAttributes()`: `{ commentId: { default: null, parseHTML, renderHTML → data-comment-id } }`.
- 렌더: `<span data-comment-id="..." class="comment-mark">`.
- 커맨드: `setComment(commentId)` = `setMark('comment', { commentId })`, `unsetComment(commentId)`.
- verify: 단위 테스트 — 마크 입힌 HTML round-trip(parse→render) 시 commentId 보존.

**1b. 확장 등록 동기화**
- `TipTapEditor.tsx` `extensions`에 `CommentMark` 추가.
- `markdownConverter.ts` `createExtensions()`/`createExtensionsForTranslation()`에 추가하되, Markdown 직렬화에서는 무시(span 소실 허용).
- verify: 에디터 로드 시 schema 에러 없음, 기존 마크다운 왕복 테스트 통과.

**1c. 코멘트 데이터 모델 + 스토어** — `src/stores/commentStore.ts`
- 타입: `{ id, field: 'source'|'target', segmentGroupId?, excerpt, comment, resolved, createdAt }`.
  (`ReviewIssue` 형태 차용, `generateIssueId` 유사 결정적 id)
- 액션: `addComment / updateComment / removeComment / resolveComment / setComments / getCommentsForField`.
- verify: 스토어 단위 테스트(add/update/remove/resolve).

**1d. 영속화 — SQLite**
- 결정 필요: (옵션1) 신규 `comments` 테이블 / (옵션2) `blocks.metadata_json` 활용 / (옵션3) project 데이터 JSON.
- 마크는 `blocks.content` HTML에 이미 자동 저장되므로, **commentStore 본문만 영속**하면 됨.
- 추천: 신규 `comments` 테이블(project_id, id, field, excerpt, comment, resolved, ...) — Rust 커맨드 `save_comments`/`load_comments` 추가.
- verify: 코멘트 작성 → 앱 재시작 → 마크+코멘트 모두 복원(E2E 또는 수동).

### Phase 2 — 마킹/코멘트 UI

**2a. 선택 버블에 "코멘트 추가" 버튼**
- `EditorCanvasTipTap.tsx`의 `scheduleAddToChatBubble`/`attachSelectionWatcher`/`coordsAtPos` 패턴 복제.
- Add-to-Chat 버블 옆에 "코멘트" 버튼 추가(공존). 클릭 시 코멘트 입력 popover.
- verify: 드래그 → 버튼 노출 → 입력 → `setComment` + `commentStore.addComment` 호출.

**2b. 코멘트 입력 popover**
- 작은 인라인 입력(텍스트 1–2줄) + 저장/취소. `excerpt`는 `textBetween(from,to)`, `segmentGroupId`는 블록 attr에서.
- verify: 저장 시 해당 범위에 마크 적용 + 스토어 반영, 화면에 밑줄/배경 표시.

**2c. 코멘트 표시 & 목록 패널**
- 마킹된 span hover/click 시 코멘트 표시(tooltip 또는 사이드).
- 목록 패널: `ReviewResultsTable`/`ReviewPanel` 구조 차용 — 코멘트 목록, 클릭 시 에디터 스크롤(역방향 연결 신규 구현), resolve 토글.
- verify: 목록↔에디터 양방향 이동, resolve 동작.

**2d. i18n**
- `ko.json`/`en.json`에 코멘트 관련 키 추가.

### Phase 3 — LLM 연결 (excerpt 변환 + 프롬프트 주입)

> 이번 슬라이스: **3a + 3b만**. 3c/3d/3e는 다음 슬라이스.

**3a. 코멘트 → excerpt 직렬화 헬퍼** — `src/ai/commentContext.ts`(신규)
- 입력: 현재 editor + commentStore. 각 코멘트의 `commentId` 범위를 `textBetween`으로 재추출(마크 위치 기준, excerpt보다 정확)하거나 저장된 excerpt 사용.
- 출력: `[사용자 코멘트]\n1. "{excerpt}" — {comment}` 텍스트 블록. (resolved 제외)
- verify: 단위 테스트 — 코멘트 N개 → 올바른 직렬화 문자열.

**3b. 번역/재번역 주입** — `translateDocument.ts`
- `buildTranslationSetup` params + `StreamingTranslationParams`(+ 가능하면 `ChunkedTranslationParams`)에 `userComments?` 추가.
- `retranslateMessage` 섹션 인근에 `[사용자 코멘트]` 섹션 push(reviewIssues 직렬화 코드 본뜸).
- 호출부(`EditorCanvasTipTap.openTranslatePreview`)에서 commentStore→직렬화 전달.
- verify: `/test-ai` dry-run으로 프롬프트에 코멘트 섹션 포함 확인.

> ⏸️ **이번 슬라이스 제외 — 다음 슬라이스로 연기 (3c/3d/3e)**

**3c. 폴리싱 주입** — `polishDocument.ts`
- `buildPolishSystemPrompt`/`buildPolishMessages`/`PolishTargetDocumentParams`에 `userComments?` 필드 추가(현재 슬롯 없음 → 신규).
- `styleRules` 인근에 코멘트 섹션. target field 코멘트만 사용.
- verify: dry-run 프롬프트 확인.

**3d. 리뷰/검수 주입** — `runReview.ts`/`reviewTool.ts`
- `buildReviewMessages`의 세그먼트별 직렬화에 해당 segmentGroupId 코멘트를 끼워넣거나, 별도 `## 사용자 코멘트` 섹션.
- verify: dry-run 프롬프트 확인.

**3e. 채팅 연결** — `prompt.ts`/`chatStore`
- Add-to-Chat 시 코멘트가 걸린 범위면 `> "{excerpt}" 코멘트: {comment}` 형태로 composer 또는 컨텍스트에 포함.
- (선택) `buildBlockContextText`에 해당 블록 코멘트 함께 주입.
- verify: 채팅 페이로드에 코멘트 맥락 포함.

### Phase 4 — 정리 & 검증

- 고아 코멘트 정리 로직(저장/로드 시 마크 없는 commentId 제거).
- `npx tsc --noEmit` + `npm run test:run` + `cd src-tauri && cargo test`.
- (선택) `/e2e-scenario`로 마킹→코멘트→번역 반영 E2E.

---

## 변경/신규 파일 요약

| 파일 | 변경 |
|---|---|
| `src/editor/extensions/CommentMark.ts` | **신규** — commentId 마크 |
| `src/components/editor/TipTapEditor.tsx` | 확장 등록 |
| `src/utils/markdownConverter.ts` | 확장 등록(Markdown 직렬화 무시) |
| `src/stores/commentStore.ts` | **신규** — 코멘트 데이터/액션 |
| `src/components/editor/EditorCanvasTipTap.tsx` | 선택 버블 버튼, popover, 호출부 코멘트 전달 |
| `src/components/comment/*` | **신규** — popover, 목록 패널(ReviewPanel 차용) |
| `src/ai/commentContext.ts` | **신규** — excerpt 직렬화 |
| `src/ai/translateDocument.ts` | 코멘트 섹션 주입 |
| `src/ai/polishDocument.ts` | 코멘트 섹션 주입 |
| `src/ai/review/runReview.ts` / `tools/reviewTool.ts` | 코멘트 섹션 주입 |
| `src/ai/prompt.ts` / `chatStore.*` | 채팅 코멘트 맥락 |
| `src-tauri/src/db/schema.rs` + commands | `comments` 영속(테이블 or metadata_json) |
| `src/i18n/locales/{ko,en}.json` | 코멘트 키 |

## 미해결(구현 중 결정)
- Phase 1d 영속 방식: 신규 테이블 vs `blocks.metadata_json` vs project JSON.
- 청킹 경로 코멘트 지원 여부(우선 단일호출만 지원 가능).
- excerpt 출처: 저장된 excerpt vs 마크 위치 재추출(후자가 편집 후에도 정확).
