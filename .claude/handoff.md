# Session Handoff

> Generated: 2026-06-30
> Branch: main

## 작업 요약

인라인 마킹+코멘트 기능의 **첫 슬라이스(Phase 1+2+3a+3b+4)를 구현·검증 완료**했다.
번역가가 Source/Target 에디터에서 텍스트를 마킹하고 코멘트를 남기면, ① 마크+코멘트가 영속되고
② 번역/재번역 시 LLM 프롬프트에 `[사용자 코멘트]` 섹션으로 주입된다. 전체 계획은 `docs/inline-comment-plan.md`.

## 현재 상태

**아직 커밋 안 함 — 작업 트리에 23개 파일 변경(미커밋). 이번 세션 신규 커밋 없음.**
검증 모두 통과: `npx tsc --noEmit` clean / 유닛 616 pass(신규 16) / `cargo test` 11 pass(신규 1 `save_and_load_comments_roundtrip`).

### 변경된 파일 (modified)
- `src-tauri/src/commands/mod.rs` — `pub mod comments;` 등록
- `src-tauri/src/db/mod.rs` — `CommentRow` + `save_comments`/`load_comments` + 유닛 테스트
- `src-tauri/src/db/schema.rs` — `comments` 테이블 + 인덱스
- `src-tauri/src/lib.rs` — invoke_handler에 `save_comments`/`load_comments` 등록
- `src/ai/translateDocument.ts` — `userComments?` 파라미터 + `[사용자 코멘트]` 섹션 주입
- `src/components/editor/EditorCanvasTipTap.tsx` — 선택 버블 옆 코멘트 버튼→popover→마크+스토어, 번역 주입 호출부
- `src/components/editor/TipTapEditor.tsx` — `CommentMark` 확장 등록
- `src/i18n/locales/{ko,en}.json` — `comment.*` 키
- `src/index.css` — `.comment-mark` 스타일
- `src/stores/projectStore.ts` — 코멘트 load/save 하이드레이션 + 고아 정리
- `src/utils/markdownConverter.ts` — `CommentMarkForConversion`(schema 등록+Markdown 직렬화 무시)
- `docs/inline-comment-plan.md` — 슬라이스 완료 현황 반영

### 신규 파일 (untracked)
- `src-tauri/src/commands/comments.rs` — `save_comments`/`load_comments` 커맨드
- `src/editor/extensions/CommentMark.ts` (+ `.test.ts`) — commentId 마크
- `src/stores/commentStore.ts` (+ `.test.ts`) — 코멘트 데이터/액션
- `src/tauri/comments.ts` — TS invoke wrapper
- `src/ai/commentContext.ts` (+ `.test.ts`) — `serializeUserComments`
- `src/components/comment/CommentInputPopover.tsx` — 코멘트 입력 popover
- `src/utils/commentMarkConversion.test.ts` — 변환 경로 테스트

### 커밋 이력 (이번 세션)
없음. (직전 커밋 `fc15852 inline comment`는 이전 세션의 계획 단계 커밋)

## 미완료 작업 (다음 슬라이스)

- [ ] **이번 작업 커밋** — 23개 변경 파일. 아직 사용자 미승인 → 다음 세션 시작 시 먼저 확인.
- [ ] **CommentListPanel 마운트** — 컴포넌트를 만들었다가 dead code 방지 위해 **이번 슬라이스에서 제거함**. 다음 슬라이스에 재생성 필요: uiStore 토글 + UnifiedSidebar(또는 우측) 마운트 + 항목 클릭 시 에디터 스크롤(`SearchHighlight.ts`의 `findSegmentRange` 재사용 → `coordsAtPos` → scrollIntoView). 삭제 시 `onRemoveComment`로 마크도 함께 제거하도록 props 설계 권장(계획 문서 참조).
- [ ] **3c 폴리싱 주입** — `polishDocument.ts`의 `buildPolishSystemPrompt`/`PolishTargetDocumentParams`에 `userComments?` 추가(target field만).
- [ ] **3d 리뷰 주입** — `runReview.ts`/`reviewTool.ts`에 코멘트 섹션.
- [ ] **3e 채팅 주입** — `prompt.ts`/`chatStore`에 Add-to-Chat 시 코멘트 맥락 포함.
- [ ] (선택) E2E: `/e2e-scenario`로 마킹→코멘트→번역 반영 자동화.

## 핵심 결정 사항

- **영속 방식 = 신규 `comments` 테이블**: 기존 schema 컨벤션(history/glossary/attachments처럼 project_id FK + ON DELETE CASCADE)과 일치. `blocks.metadata_json`/`projects.metadata_json` 대안은 부분 갱신·동시성 문제로 기각. 사용자 확정.
- **마크는 commentId만, 본문은 별도 스토어+SQLite**: 마크 attrs에 긴 텍스트를 넣어 HTML 오염시키지 않음.
- **AI엔 excerpt 직렬화로 주입**: CommentMark는 Markdown 변환 시 소실(Underline류와 동일). 변환기엔 `CommentMarkForConversion`으로 schema만 등록하고 직렬화 무시. AI엔 `[사용자 코멘트]\n1. "{excerpt}" — {comment}`(reviewIssues 선례 차용).
- **CommentListPanel 이번 슬라이스 제외**: 마운트는 레이아웃 변경이 커 검증 표면 확대. 핵심 번역 주입 경로만 end-to-end로 먼저 닫음(사용자 결정).
- **고아 정리는 에디터 마운트 시에만**: 빈 commentId 집합으로 전부 삭제하는 사고 방지(`projectStore.persistCommentsForProject`).

## 주의사항

- **청킹 경로 미지원**: `translateSourceDocWithChunking`(ChunkedTranslationParams)은 reviewIssues와 동일하게 코멘트 미전달. 단일호출 경로만 지원. 청크 경로 지원 여부는 다음에 결정.
- **cargo 빌드 시 TMPDIR**: `cargo check`/`cargo test`는 `export TMPDIR="$(getconf DARWIN_USER_TEMP_DIR)"` + 샌드박스 비활성화 필요(메모리 `cargo-build-tmpdir-eperm`). 매니페스트는 절대경로로: `--manifest-path /Users/joo/GitHub/translation-editor/src-tauri/Cargo.toml`.
- **lint 스크립트 없음**: package.json에 lint 없음. `npx tsc --noEmit`이 타입/린트 게이트.
- **마크 확장 양쪽 등록 필수**: `TipTapEditor.tsx`(라이브) + `markdownConverter.ts`(변환). 누락 시 "no mark type comment in schema".
- **comments 테이블 마이그레이션 불필요**: `CREATE TABLE IF NOT EXISTS`가 `initialize()` 매 시작 실행되어 기존 DB 자동 반영.

## 핵심 파일

- `docs/inline-comment-plan.md` — **먼저 읽기.** 상단에 슬라이스 완료 현황+다음 단계, 하단에 원래 전체 계획.
- `src/editor/extensions/CommentMark.ts` — 마크 정의(commentId, setComment/unsetComment).
- `src/stores/commentStore.ts` — 코멘트 데이터 모델/액션(add/resolve/prune 등).
- `src/components/editor/EditorCanvasTipTap.tsx` — 마킹 UI 통합(버블→popover→마크), 번역 주입 호출부.
- `src/ai/commentContext.ts` — `serializeUserComments`(LLM 주입 직렬화).

## 다음 세션 가이드

1. `docs/inline-comment-plan.md` 상단 현황부터 읽는다(재조사 불필요).
2. 사용자에게 **이번 미커밋 작업을 커밋할지** 먼저 확인(아직 미승인).
3. 다음 슬라이스 우선순위 제안: **CommentListPanel 재생성+마운트**(체감 가장 큼) → 3c/3d/3e 주입 순. 각 단계 verify는 계획 문서의 단계별 verify를 따른다.
4. 작업 전 `.claude/rules/editor.md`(마크 양쪽 등록)·`ai-chain.md`(프롬프트 주입) 재확인.
