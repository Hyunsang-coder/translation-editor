# 적용 표시(초록 하이라이트) 개별 확인 개선 계획

> 상태: 미착수 (계획만 문서화, 구현 없음).
>
> 문제: AI 번역·폴리싱·검수 적용 시 남는 초록 표시는 현재 전체 해제(지우개 버튼) 또는 해당 문장 직접 수정으로만 사라진다. 여러 개 중 일부만 확인하거나, 읽기만 하고 확인 처리하는 경로가 없다.
>
> 범위: 스키마 변경 없이 `changeId` 문장 그룹 단위의 개별 확인 + 개수 표시 + 이전/다음 탐색을 추가한다. 실행 단위(`batchId`) 묶음, 자동 decay는 후속 단계로 미룬다(§4).
>
> 자체 평가: 10점 만점에 7점. 안전성 9 / 문제 해결·UX 완결성은 6. 감점 사유는 §10에 정리.

## 1. 한눈에 보는 결론

1. 개별 확인 커맨드 `clearAppliedChangeById(changeId)`를 신설한다. 내부는 기존 `removeAppliedChangeIds` 재사용 + `APPLIED_CHANGE_CLEAR_META` 설정, `addToHistory`는 bulk와 동일하게 건드리지 않음(undo 가능).
2. 메뉴바의 boolean 구독을 개수(number) 구독으로 교체하고, `[‹] n/m [›] | 이 문장 확인 | 모두 확인(N)` 클러스터를 둔다. DOM 클릭 가로채기는 하지 않는다.
3. `ReviewPanel`의 transaction 감시에서 `APPLIED_CHANGE_CLEAR_META`를 스킵한다(마크-only 확인이 리뷰 undo 감지를 어긋나게 하는 기존 버그 포함 수정).
4. 인라인 칩(캐럿이 표시 안에 있을 때 뜨는 `확인` 팝오버)은 2단계로 둔다. 현재 항목의 별도 강조 클래스는 두지 않는다 — 이동 위치는 텍스트 선택(selection) 자체로 표시한다(§2.3).
5. 스키마·그룹핑·저장·export·데스크톱 경로는 손대지 않는다.

## 2. 사용자에게 보이는 기대 결과

### 2.1 메뉴바 클러스터 (1단계, target 패널만)

현재 `TipTapMenuBar.tsx:810-823`의 지우개 단일 버튼을 아래 구성으로 바꾼다.

```
[‹] 2/7 [›] | [이 문장 확인] | [지우개 N개 모두 확인]
```

- `‹ ›` + 위치: 이전/다음 변경으로 이동. 동작은 `scrollToComment`(`src/editor/utils/commentNavigation.ts:44-54`)와 동일 — 그룹의 min-max 범위를 `setTextSelection + focus + scrollIntoView`로 범위 선택한다(코멘트와 동일, “뭐가 바뀌었는지 보여주기”가 목적). 이동 대상은 문서 순서상 이전/다음 `changeId` 그룹. 캐럿이 표시 안에 있으면 `n/m`을 표시하고, 밖에 있으면 위치 없이 `N개`만 표시한다. 이 경우 `‹ ›`는 캐럿 위치 기준 다음/이전 그룹으로 점프한다.
- `이 문장 확인`: 캐럿/선택이 초록 표시 안에 있을 때만 활성화. 비활성 시 툴팁은 “초록 표시 안에 커서를 두세요”. 클릭 시 해당 문장 그룹의 표시만 제거한다(텍스트 불변). blast radius가 단어 1개가 아니라 문장 전체임을 라벨/툴팁에 명시한다(“문장 확인”).
- `모두 확인`: 기존 지우개 동작 유지(전체 `removeMark`, undo 가능). `aria-label`은 기존 키(`editor.menuBar.clearAppliedChanges`, 테스트 `TipTapMenuBar.appliedChanges.test.tsx:29` 참조)를 유지하고, 개수 `N`은 별도 badge span에만 표시한다(aria 변경으로 기존 테스트가 깨지지 않게).
- 첫 노출 안내 팝업 문구(`TipTapMenuBar.tsx:187-199`)를 함께 고친다: “문장을 수정하거나 `이 문장 확인`을 누르면 사라져요”.

### 2.2 인라인 칩 (2단계)

- 캐럿이 표시 안에 있을 때(빈 선택 포함) 선택 영역 위·아래에 작은 칩을 띄운다: `AI 적용됨 · [확인]`.
- 위치 계산은 `EditorCanvasTipTap.tsx:551-568`(`coordsAtPos` + 툴바 높이), 우측 overflow 밀어넣기는 `596-605`, 팝오버 껍데기는 `CommentDetailPopover.tsx:65-83`(fixed + zIndex 82), 바깥 클릭 닫기는 `48-56`, 포커스 유지용 `onMouseDown preventDefault`와 Esc 닫기는 `SelectionInlineToolbar.tsx:213-218` 패턴을 재사용한다.
- 기존 선택 툴바 감시(`EditorCanvasTipTap.tsx:617-621`)는 `from === to`면 숨기므로, 칩용 감시는 “빈 선택 + 마크 안”을 허용하는 별도 조건으로 둔다. `TipTapEditor.tsx:228-244`의 `handleDOMEvents.click`에 분기를 추가하지 않는다(커서 가로채기 금지).

### 2.3 시각

- 기존 `.applied-change-highlight`(`src/index.css:1005-1017`, `diff-insertion` 기반 초록) 유지.
- 추가는 `:hover` 시 배경 살짝 진하게 1개뿐(어포던스용, 동작 없음). 별도 `.applied-change-active` 클래스는 두지 않는다 — `appliedChange`는 `renderHTML` 클래스가 고정된 Mark(`210-240`)라 특정 id만 꾸미려면 decoration(ReviewHighlight 방식) 도입이 필요한데 이번 범위 밖이다. 현재 위치 표시는 탐색 시 남는 텍스트 선택으로 충당한다.
- 접근성/testid는 기존 컨벤션 답습: `editor-menubar-comment-${panelType}`, `selection-inline-toolbar-${panel}` 형식으로 `...-applied-...` 계열 추가, 모든 버튼에 `aria-label`.

## 3. 현재 구조와 조사 결과

- 마크 정의: `src/editor/extensions/AppliedChangeHighlight.ts:210-240` — `name='appliedChange'`, attr는 `changeId` 하나, DOM은 `span[data-applied-change + data-applied-change-id]` 렌더.
- 묶음 단위: `87-123` — `findSentenceRangeAt`으로 문장 키를 만들고 같은 문장은 같은 `changeId`. 같은 문장 재적용은 `112-114`에서旧마크 삭제 후 교체.
- 자동 해제: `261-292` — `APPLY/CLEAR/DOCUMENT_REPLACE` meta가 아닌 `docChanged`면 건드린 문장의 `changeId`를 수집해 제거, `289-291`에서 `addToHistory:false`(undo 불가).
- 수동 해제: `242-258` `clearAppliedChangeHighlights` — `0~doc.content.size` 전체 `removeMark`, `addToHistory` 미설정이라 undo 가능. 개별 해제 커맨드는 없음.
- UI: `TipTapMenuBar.tsx:160-164`에서 `hasAppliedChangeHighlights(doc)` boolean만 구독, `810-823` 지우개가 전체 삭제의 유일 경로. 개수 없음.
- 문서 전체 적용: `src/editor/utils/applyDocumentWithHighlight.ts:195-216` — `replaceWith(0~size)` + `addToHistory:true` 한 undo 단위. 안 바뀐 문장의旧`changeId`는 `101-188`에서 보존 후 재삽입(`207-211`).
- 단일 제안 적용: `src/components/review/reviewApply.ts:523-531`(`closeHistory` + `REVIEW_SUGGESTION_APPLY_META`), 선택 적용: `src/editor/utils/applySelectionEdit.ts:158-170, 300-307`. 모두 `addAppliedChangeMarksToTransaction` 경유.
- 영속: `AppliedChangeHighlight.test.ts:43-57` JSON/HTML 라운드트립 유지, `markdownConverter.test.ts:47-54` 프로젝트 HTML 저장 시 복원, `39-44` 내보내기 HTML/Markdown·AI 입력에서는 제거. 변환용 확장은 `markdownConverter.ts:51-60`에서 serialize를 `''`로 무시.
- 에디터 등록: `TipTapEditor.tsx:116` 기본 extensions 포함. 프리뷰 모달(`TranslatePreviewModal.tsx:295-319`)은 미등록 + `editable:false`라 영향 없음.
- 리뷰 감시: `ReviewPanel.tsx:209-216` 모든 `docChanged`를 `reconcileAppliedSuggestionTransaction`(`src/stores/reviewStore.ts:669-739`)에 전달, `REVIEW_SUGGESTION_APPLY_META`만 제외. 마크-only 해제는 현재 스킵되지 않음(§8.3).
- 히스토리: `TipTapEditor.tsx:94-95` `depth:100, newGroupDelay:500`.
- 코멘트 선례: 클릭 식별 `commentNavigation.ts:89-102`, 범위 탐색 `17-38`, 스크롤 이동 `44-54`, 마크 제거 `109-118`(comment 타입 한정이라 appliedChange와 간섭 없음). `ReviewHighlight`는 decoration 방식이라 스키마 충돌 없음.

## 4. 설계 결정과 버린 대안

| 결정 | 이유 |
|---|---|
| 스키마 변경 없음(`batchId` 미도입) | attr 추가는 `addAttributes/parseHTML/renderHTML` + `207-211` preserved + 구 문서 마이그레이션 + `translationPreviewActions.ts:86` 데스크톱 무마크 경로 불일치까지 동반. “이번 실행만 확인”은 2차 과제로 분리 |
| DOM 클릭 가로채기 없음 | `TipTapEditor.tsx:228-244`에서 `return true` 하면 ProseMirror 클릭이 삼켜져 커서를 못 놓음. selection 기반 버튼으로 회피 |
| 타이머 자동 decay 없음 | `43-57` 라운드트립 영속 테스트와 충돌하고, 삭제 정책을 새로 정해야 함. 읽기만 한 표시의 정리는 개별 확인 버튼으로 충당 |
| 그룹핑 로직 untouched | `SENTENCE_TERMINATORS`는 `.!? 。！？` 위주라 한국어 장문락이 한 그룹이 될 수 있음. 로직을 바꾸면 auto 경로까지 regress하므로 카피(“문장”)로만 정직하게 고지 |
| 개별 확인도 undo 가능으로 | bulk와 일관. auto(`addToHistory:false`)는 그대로. 개별 확인이 history 항목을 늘리는 것은 리뷰 단일 적용(`closeHistory` 건당 1항목) 선례와 동일하게 “사용자 액션당 1 undo”로 간주. 급속 연타는 `newGroupDelay:500`으로 합쳐질 수 있음(보장 아님) |

## 5. 구현 단계

### 5.1 Phase 1 — 개별 확인 + 개수 + 탐색 (필수)

1. `src/editor/extensions/AppliedChangeHighlight.ts`
   - `APPLIED_CHANGE_CLEAR_META` 상수 export(값 `'appliedChangeClear'` 유지).
   - `countAppliedChangeGroups(doc): number` 추가 — `133-143` 순회 그대로, `Set<changeId>` 수집. `hasAppliedChangeHighlights`는 `count > 0` 유도로 유지(기존 호출부·테스트 보존).
   - `getAppliedChangeIdAtSelection(state): string \| null` 추가 — `commentNavigation.ts:62-84` 패턴. 빈 선택이면 캐럿 앞뒤 텍스트 노드의 마크 확인, 범위 선택이면 `nodesBetween` 첫 적중 반환. 반환은 primitive.
   - `getAppliedChangeGroups(doc): Array<{ id: string; from: number; to: number }>` 추가 — `findCommentRange:17-38` min-max 병합 + `normalizeRanges:31-42` 정렬. 렌더 경로 호출 금지(탐색 버튼 클릭 시에만 계산).
   - `clearAppliedChangeById(changeId)` 커맨드 추가 — `185-202` 재사용 + `CLEAR_META` 설정, 미발견 시 `false`(bulk의 `247` early-return과 대칭).
2. `src/components/review/ReviewPanel.tsx:210` — 가드에 `APPLIED_CHANGE_CLEAR_META` 스킵 추가. 상수는 `src/editor/extensions/AppliedChangeHighlight.ts`에서 export해 import한다(기존에도 `replaceDocumentWithAppliedChanges` import가 있어 허용 범위). 마크-only 확인이 `reconcile...`에 들어가지 않게 한다(§8.3).
3. `src/components/editor/TipTapMenuBar.tsx`
   - `160-164` selector를 개수 구독으로 교체(`?? 0`), `has = count > 0` 유도.
   - `810-823` 영역에 `[‹] n/m [›] | 이 문장 확인 | 모두 확인` 클러스터 구현. prev/next는 Phase 1의 groups 함수로 그때그때 계산 후 `scrollToComment` 패턴으로 범위 선택 + 이동한다(별도 active 클래스 없음, §2.3). 표시 밖에 있을 때는 `n/m` 대신 `N개`만 보여준다(§2.1).
   - `187-199` 힌트 문구 갱신.
4. i18n — `src/i18n/locales/ko.json` + `en.json`에 키 추가(계약: `CLAUDE.md` §Non-negotiable 4). 예: `editor.menuBar.appliedChangesCount`, `appliedChangesConfirmSentence`, `appliedChangesPrev/Next`, `appliedChangesConfirmSentenceDisabledHint`. 기존 `editor.menuBar.clearAppliedChanges`(테스트에서 `'적용 표시 지우기'`로 참조 — `TipTapMenuBar.appliedChanges.test.tsx:29`)는 유지.
5. CSS — `src/index.css`에 `:hover`만 추가. 기존 변수·다크모드 값 유지.

### 5.2 Phase 2 — 인라인 칩 (선택)

- `EditorCanvasTipTap.tsx`에 칩 상태(`commentPopover`/`selectionToolbar`와 동형) 추가. 트리거 조건만 “빈 선택 + `getAppliedChangeIdAtSelection !== null` + 포커스 있음”. 좌표·overflow·바깥닫기·Esc는 §2.2의 재사용 목록 그대로.
- 칩의 `확인` 버튼은 Phase 1 커맨드 호출 후 칩 닫기.

### 5.3 범위 외 (명시)

- `batchId`/실행 단위 묶음, TTL·자동 fade, 문장 경계(`SENTENCE_TERMINATORS`) 개선, 데스크톱 경로(`translationPreviewActions.ts:86`)의 마크 부여, export 형식 변경.

## 6. 파일별 변경 목록

| 파일 | 변경 |
|---|---|
| `src/editor/extensions/AppliedChangeHighlight.ts` | 상수 export + 3개 조회 헬퍼 + `clearAppliedChangeById` |
| `src/components/editor/TipTapMenuBar.tsx` | 개수 구독, 클러스터 UI, 힌트 문구 |
| `src/components/review/ReviewPanel.tsx` | `210` 가드에 CLEAR 스킵 1줄 |
| `src/index.css` | `:hover`만 추가 |
| `src/i18n/locales/ko.json`, `en.json` | 신규 키(기존 키 유지) |
| (Phase 2) `src/components/editor/EditorCanvasTipTap.tsx` | 칩 상태 + 감시 + 렌더 |
| 테스트(§7) | 기존 파일 무변경 통과 + 신규 3종 |

## 7. 테스트 계획

유지(무변경 통과):
- `src/editor/extensions/AppliedChangeHighlight.test.ts:59-104` — 문장 단위 자동 제거, 동일 문장 교체, 전체 해제.
- `src/components/editor/TipTapMenuBar.appliedChanges.test.tsx:21-32` — 전체 해제 경로.
- `src/utils/markdownConverter.test.ts:39-54` — export 제거 / 프로젝트 저장 복원.

신규:
1. `clearAppliedChangeById` — 두 문장에 표시 후 1개 id만 제거, 다른 문장 잔류, 텍스트 불변, 미존재 id는 `false`.
2. 조회 헬퍼 — 표시 밖 캐럿은 `null`, 표시 안 캐럿·범위 선택은 해당 id, 개수는 distinct `changeId` 수.
3. 리뷰 스킵 — 마크-only clear 트랜잭션이 `reconcileAppliedSuggestionTransaction`을 호출하지 않음(호출 스파이), 텍스트 편집은 여전히 호출.

## 8. 리스크와 대응 (코드 근거)

1. **클릭이 커서를 먹음** — `TipTapEditor.tsx:228-244`에 분기를 넣으면 `return true`가 선택을 삼킴. 대응: DOM 핸들러를 건드리지 않고 selection 기반 버튼만 둠(§2.1·§5.1).
2. **매 키스트로크 리렌더** — `160-164` selector가 배열/Map을 반환하면 `useEditorState`의 `Object.is`가 매번 깨짐. 대응: 렌더 구독은 number/string|null primitive만, groups 배열은 클릭 시에만 계산.
3. **리뷰 undo 감지 어긋남(기존 버그 포함)** — `ReviewPanel.tsx:210`이 마크-only clear를 `reconcile...(669-739)`에 넣으면 `.eq`(마크 포함 비교)가 이후 Ctrl+Z 매칭을 실패시킬 수 있음(텍스트는 복귀, 이슈는 resolved 잔류). 대응: CLEAR 스킵 추가로 확인 트랜잭션을 추적에서 제외. 텍스트 편집 경로는 불변.
4. **blast radius 오해** — `94-109` 그룹핑 + `185-202` 전체 삭제라 단어 1개 확인이 문장 전체를 품. `59-73` 테스트가 이 시맨틱을 고정. 대응: 라벨·툴팁을 “문장 확인”으로 고정, 단어 단위 해제는 제공하지 않음.
5. **히스토리 항목 증가** — 개별 확인이 건당 1 undo가 됨. 대응: bulk와 동일한 “사용자 액션당 1 undo”로 간주(리뷰 적용 선례와 동일), 급속 연타는 `newGroupDelay:500`으로 합쳐질 수 있음(보장 아님). auto 경로는 `addToHistory:false` 유지.
6. **탐색 위치 stale** — groups를 캐시하면 편집 후 위치가 밀림(`SelectionAnchor` stale 문제와 동형). 대응: 탐색 시마다 현 doc에서 재계산, 캐시 금지.
7. **한국어 장문락이 한 그룹** — terminator 집합 한계. 대응: 이번 범위에서 로직 변경 없음, 카피로 고지(§4).

## 9. 검증

- `npm run test:run` — §7 유지 3종 + 신규 3종 통과.
- `npm run build` — 타입·빌드 통과.
- 수동 체크: 표시 2개 문서에서 (a) 캐럿을 첫 표시 안에 두면 `이 문장 확인` 활성화, (b) 확인 후 해당 문장만 해제·다른 문장 잔류, (c) `‹ ›` 이동이 문서 순서대로 동작, (d) 모두 확인 후 Ctrl+Z로 복원, (e) 개별 확인 후 Ctrl+Z로 해당 문장 표시 복원, (f) 확인 후 리뷰 이슈 상태가 흔들리지 않음.

## 10. 왜 7점인가 (잔여 감점)

- `-1`: 실행 단위(“이번 폴리싱만”) 미지원 — `changeId`만으로는 필터 불가.
- `-1`: 확인이 여전히 수동 — 보존(`101-188`)+저장 복원(`markdownConverter.test.ts:47-54`)의 누적 구조는 그대로라 읽기만 한 표시는 남음.
- `-1`: 한국어 경계·데스크톱 불일치 untouched(의도적 non-goal, §4·§5.3).

10점은 `batchId` 스키마+마이그레이션, 확인 트랜잭션 undo 그룹핑, 데스크톱 경로 통일까지 가야 하며 안전성과 트레이드오프다.
