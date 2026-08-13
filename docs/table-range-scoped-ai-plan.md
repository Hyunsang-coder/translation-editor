# 표 특정 구간 부분 리뷰 · 폴리싱 · 재번역

> **진행 상태 (이 헤더가 진실)**
> - [x] Phase 0: `resolveTopLevelBlockRange`가 `CellSelection.ranges`를 읽게 함
> - [x] Phase 1: 표 안 선택을 **셀 사각형 스코프**로 분류하는 유틸 (`tableRangeScope.ts`)
> - [x] Phase 2: 부분 폴리싱 — 고른 셀만 다듬고 표 나머지·바깥 문단은 불변 (`tableRectSplice.ts`)
> - [x] Phase 3: 부분 재번역 — 여러 셀 `CellSelection`을 셀마다 치환 (ADR-0010 개정 완료)
> - [x] Phase 4: i18n 라벨 (ko/en). **E2E는 저장소 정책상 작성하지 않음** — 유닛으로 갈음
>
> 구현 완료 2026-08-13. `npx tsc --noEmit` + 유닛 1461개 통과. 데브 빌드 수동 확인 미실시.
>
> **착수 후 바뀐 결정 3가지** (본문보다 이 목록이 우선):
> 1. **병합 셀(colspan/rowspan)이 표에 하나라도 있으면 `table-rect`로 분류하지 않고
>    `top-level-blocks`(=오늘과 같은 표 전체 실행)로 되돌린다.** 토스트를 띄우지 않는다 —
>    사각형 **안**만 검사하면 부족하기 때문이다. rect 왼쪽/위쪽의 병합이 뒤 칸의 JSON
>    인덱스를 밀어 엉뚱한 셀에 결과가 들어간다. 표 전체 폴리싱은 정상 동작이므로
>    에러가 아니라 축소다.
> 2. **재번역 게이트는 `resolveAiSelectionScope`가 아니라 `canApplySelectionEdits`다.**
>    §3-1 스케치는 `tableScope?.kind === 'table-rect' && every...single textblock`이었지만,
>    그 술어는 적용 게이트와 어긋날 수 있다. 적용이 실제로 요구하는 조건(한 표 안 서로
>    다른 셀의 단일 textblock 범위)을 그대로 쓴다 — 생성 후 적용에서만 실패하는 구멍이 없다.
> 3. **§2-2 폴리싱 프롬프트 한 줄은 넣지 않았다.** 기존 system이 이미
>    "Preserve the document topology: ... table dimensions" + "Do not add, remove, reorder,
>    merge, or split document blocks"를 말한다. 플래그 없이 무조건 넣으면 전체 폴리싱에서
>    거짓말이 된다.
>
> **구현 위치**: `src/editor/utils/tableRangeScope.ts`(분류) ·
> `src/editor/utils/tableRectSplice.ts`(추출/병합) ·
> `applySelectionEdit.ts`의 `applySelectionEdits`/`canApplySelectionEdits` ·
> `retranslateSelection.ts`의 `retranslateTableCells` ·
> `SelectionEditPreviewModal`의 `cells` 모드.
>
> 작성: 2026-08-13. 배경: 번역가가 표의 **일부 행/열/셀**만 골라 검수·폴리싱·재번역을
> 돌리려 하면, 검수만 셀 단위로 동작하고 폴리싱은 표 전체로 넓히며 재번역은
> 여러 셀을 거절한다. 안정성 원칙은 `docs/scoped-ai-runs-plan.md`와 같다 —
> **fail-closed**, 문서 손상 경로를 만들지 않는다.
>
> 선행: [ADR-0010](adr/0010-selection-apply-single-range-only.md),
> [scoped-ai-runs-plan](scoped-ai-runs-plan.md) (원칙 3을 이 문서가 개정),
> gotcha 154/158, `.claude/patterns.md` Anchored Selection Editing.

## 새 세션 시작 방법

1. 이 파일을 읽고 헤더 체크리스트가 진실인지 워킹트리와 대조한다.
2. Phase 0 패치가 없으면 먼저 착수한다 (`git log` / `git diff src/editor/utils/blockRangeScope.ts`).
3. 구현 전 §0 계약을 **파일을 직접 열어** 라인이 밀렸는지 재확인한다.
4. 비목표를 제안으로 되살리지 않는다.

---

## 사용자 증상

Target 에디터에서 표의 일부만 드래그한 뒤:

| 동작 | 기대한 것 | 실제 |
|---|---|---|
| 이 구간만 검수 | 고른 셀만 검수 | **동작함** (셀 유닛 ID로 청크). 적용·하이라이트도 excerpt 경로로 동작 |
| 선택 구간만 다듬기 (폴리싱) | 고른 셀만 다듬기 | **표 전체**가 모델에 들어가 표의 다른 셀까지 바뀔 수 있음. 체크박스는 "블록 1개" |
| 부분 재번역 | 고른 셀들을 재번역 | 한 셀·한 문단만 통과. 여러 셀은 "한 문단 안의 텍스트만 선택해주세요."로 **생성 전 거절** |

텍스트를 셀 **안에서** 드래그한 경우(일반 `TextSelection`) 폴리싱도 표 전체로 스냅한다.
셀을 가로질러 드래그하면 `CellSelection`이 된다.

---

## 비목표 (이번에 하지 않는 것 — 제안 금지)

- **`TRANSLATION_UNIT_TYPES`에서 `tableCell` 제거** — 정렬 뷰와 `collectTranslationUnits`가 공유. ADR-0010이 버린 이유 그대로.
- **일반 멀티문단 `TextSelection`의 재번역 적용** — ADR-0010 본문. 이번 예외는 **표 `CellSelection` + 각 range가 단일 textblock**일 때만.
- **비연속 셀**(1·3열만, 2열 제외)을 CellSelection으로 만들기 — `prosemirror-tables`의 `CellSelection`은 **항상 사각형**. 1·3열만 고르는 입력은 이 라이브러리에 없다. 검수 청크 테스트의 `targetUnitIds: [c1, c3]`는 툴/정렬 계약용이지 UI 제스처가 아니다.
- **부분 표를 깨진 HTML로 보내기** — `<table>`에서 셀 몇 개만 잘라 보내면 열 수가 안 맞아 모델이 표를 붕괴한다. scoped-ai-runs 원칙 3의 원래 동기. 이번에도 **유효한 표(사각형 서브테이블) 또는 셀 안 문단 sub-doc**만 보낸다.
- **폴리싱/번역 마커 계약 변경** — `---POLISH_START/END---` 파서는 그대로. 입력이 sub-doc(문단 또는 작은 표)이 될 뿐이다.
- **이어서 번역의 표 중간 구멍** — 이미 표를 통째로 제외한다 (`continueTranslation.test.ts`). 이번 범위 아님.
- **채팅 `propose_selection_edit`의 멀티셀 적용** — 재번역과 같은 적용 함수를 쓰게 되면 따라오지만, 이번 착수 범위는 툴바 재번역·폴리싱·검수.

---

## 0. 검증된 코드 계약 (2026-08-13 확인, 구현 전 재확인 필수)

구현 시 각 파일을 직접 읽고 라인이 밀렸는지 확인한다.

| 계약 | 위치 | 내용 |
|---|---|---|
| CellSelection `from/to` | `prosemirror-tables` `CellSelection` 생성자 | `ranges[0]`은 **head 셀**(문서 순서가 아님). `super(ranges[0].$from, ranges[0].$to, ranges)`라 Selection.`from`/`to`/`empty`는 head만 본다. head가 빈 셀이면 `from===to` → `empty===true`여도 다른 셀 range는 내용이 있다 |
| 선택 읽기 | `EditorCanvasTipTap.tsx` `buildSelectionBubble` | `selection.ranges`를 셀마다 모아 `to > from`만 남기고 `from` 기준 정렬. 코멘트·복사·채팅·검수가 이 페이로드를 씀 |
| 폴리싱 범위 | `src/editor/utils/blockRangeScope.ts` `resolveTopLevelBlockRange` | 선택을 최상위 `path[0]` min/max로 넓힘. 표 안 선택 → **표 블록 하나**. Phase 0 이후 ranges를 읽지만 **스냅 자체는 여전히 표 전체** |
| 폴리싱 실행 | `EditorCanvasTipTap.tsx` `openPolishPreview` | `target.content.slice(fromIndex, toIndex+1)`를 모델에 보내고, 성공 시 `replaceTopLevelBlockRange`로 그 최상위 구간만 치환. L2 가드(프로젝트 ID + target 리비전) 유지 |
| 폴리싱 파이프라인 | `src/ai/polishDocument.ts` | sub-doc을 넘겨도 동작. `---POLISH_START/END---`. `restoreTranslationUnitIds` = `reattachTranslationUnitIds`(토폴로지 일치 시에만 ID 이식) |
| 검수 범위 | `openScopedReview` → `buildScopedAlignedChunks` | `bubble.ranges`의 유닛 ID. `dropAncestorUnits`로 셀+문단 중복 제거. 짝 하나라도 없으면 `null`(fail-closed) |
| 재번역 거절 | `openSelectionRetranslate` | `selection.spansMultipleBlocks`이면 생성 전 토스트. `applySelectionEdit`는 `getSingleAnchorRange`가 없으면 `invalid` |
| 재번역 적용 | `src/editor/utils/applySelectionEdit.ts` | 한 textblock 안을 `replaceWith` 평문(+공통 marks). 멀티블록이면 문단·셀이 한 덩어리로 뭉개짐 — ADR-0010의 이유 |
| 앵커 정규화 | `normalizeSelectionAnchorRanges` | 범위마다 클램프. 한 셀 CellSelection → `blockCount === 1`. 두 셀 → `blockCount === 2` |
| 표 직렬화 | `tipTapJsonToMarkdownForTranslation` (`TableForTranslation`) | 표는 **항상 raw HTML**. 깨진 표를 보내면 모델이 차원을 바꿀 위험이 큼 |
| 셀 중복 유닛 | gotcha 158 | `tableCell` + 안쪽 `paragraph`가 둘 다 유닛. 재번역·검수는 `dropAncestorUnits`. 채팅 도구는 `dropDuplicatedContainers`(텍스트까지 같을 때만) |
| CellSelection 슬라이스 | `CellSelection.content()` | 선택한 **사각형**을 유효한 작은 표 `Slice`로 만듦. colspan이 걸치면 attrs를 잘라 맞춤. 병합의 기하 기준 |

Phase 0 (워킹트리에 있을 수 있음): `resolveTopLevelBlockRange`가 `empty`/`from`/`to` 대신 `selection.ranges`를 읽는다. 테스트: `blockRangeScope.test.ts`의 CellSelection·빈 head 셀 케이스. **이 패치 없이는 Phase 2의 빈 셀 드래그에서 체크박스 자체가 안 뜬다.** 스냅이 표 전체인 문제는 고치지 않는다.

이미 추가된 회귀 테스트 (Phase 1+에서 깨면 안 됨):

- `buildScopedAlignedChunks.test.ts` — 1·3열만 요청하면 2열 세그먼트 없음
- `reviewApply.integration.test.ts` — 표 셀 excerpt 적용, 중복 문구는 source prior로 해당 셀만
- `applySelectionEdit.test.ts` — 한 셀 안 치환, 옆 셀·표 구조 보존
- `alignedCounterpartUnits.test.ts` — 셀+문단 ID → `dropAncestorUnits` 후 안쪽 원문 하나
- `SelectionAnchor.test.ts` — 한 셀 `blockCount === 1`, 두 셀 `getSingleAnchorRange === null`
- `topLevelBlockSplice.test.ts` — 표 블록 치환 시 앞뒤 문단 보존

---

## 공통 설계

### 분류 (Phase 1이 만드는 유일한 진입점)

`src/editor/utils/tableRangeScope.ts` (신규, 순수에 가깝게 — Editor를 받아 PM 문서를 읽음):

```ts
export type AiSelectionScope =
  | { kind: 'top-level-blocks'; fromIndex: number; toIndex: number; unitCount: number }
  | { kind: 'table-rect'; tableIndex: number; rect: TableRect; cells: ScopedTableCell[] }
  | { kind: 'in-cell'; tableIndex: number; cell: ScopedTableCell; textRange?: { from: number; to: number } }
  | null; // 접힌 선택, 비유닛만, 해석 불가

export interface TableRect { top: number; left: number; bottom: number; right: number } // bottom/right exclusive, TableMap과 동일
export interface ScopedTableCell {
  row: number;
  col: number;
  unitIds: string[];          // 셀+자손, 호출부가 dropAncestorUnits
  cellPos: number;            // PM 문서에서 tableCell/tableHeader 노드 pos
  jsonPath: number[];         // collectTranslationUnits.path (tableCell 유닛)
}
```

판정 순서:

1. `selection.ranges`를 `buildSelectionBubble`과 같이 수집. 0개면 `null`.
2. 모든 range가 **같은 표 노드 안**이면 (`$from.node(-1)` table 또는 cell의 조상 table이 동일):
   - range가 1개이고 그 셀의 한 textblock 안이면 → `in-cell`
   - 그 외(여러 셀, 또는 셀 전체 CellSelection) → `table-rect` (`TableMap.rectBetween` of first/last cell)
3. 그 외 → 기존 `resolveTopLevelBlockRange` 결과의 `top-level-blocks` (표+바깥 문단에 걸친 선택 포함). 표가 구간에 들어가면 **오늘과 같이 표 전체**가 폴리싱 대상 — 혼합 선택을 셀 단위로 억지 해석하지 않음.

`CellSelection`이면 `instanceof` 대신 ranges로도 충분하다. 테스트에서는 `setCellSelection`을 쓴다 (`blockRangeScope.test.ts` 패턴).

### 서브문서 추출 — 깨진 표를 만들지 않기

| scope | 모델에 보내는 sub-doc | 병합 |
|---|---|---|
| `in-cell` (셀 안 문단만) | `{type:'doc', content: [그 문단 노드]}` — 표 HTML이 아님 | 해당 문단/셀 content만 JSON 치환 |
| `table-rect` | **그 사각형만의 유효한 표** 한 블록. 행마다 `rect.left .. rect.right` 셀을 복사 (colspan/rowspan이 사각형을 넘으면 fail-closed 또는 `CellSelection.content()`와 같은 클립). 바깥 문단 없음 | 원본 표의 같은 `rect` 칸만 결과 표의 칸으로 교체. 행·열 수가 `rect`와 다르면 throw |
| `top-level-blocks` | 오늘과 동일 `content.slice(from, to+1)` | `replaceTopLevelBlockRange` 그대로 |

병합은 항상 **요청 시점 스냅샷 JSON**에 대해 수행하고, 완성본을 기존 전체 교체 경로로 넣는다 (scoped-ai-runs 원칙 1 + L2 리비전 가드). 에디터에 "부분 트랜잭션으로 셀만" 직접 넣지 않는다 — 폴리싱 프리뷰가 완성본 diff를 보여야 한다.

### fail-closed

- 결과 표의 행 수 ≠ `rect.bottom - rect.top` 또는 어느 행의 셀 수 ≠ 너비 → 에러, 적용 없음. 토스트: 표 구조가 바뀌어 선택 셀만 반영할 수 없음 → 표 전체 폴리싱을 안내.
- `reattachTranslationUnitIds`가 unaligned여도 적용은 막지 않음 (전체 폴리싱과 동일). 다만 **병합은 ID가 아니라 rect/path 기하**로 한다 — 모델이 셀 ID를 버려도 칸 위치로 넣는다.
- 검수는 기존대로 짝 없으면 `null`.
- 재번역 N셀: 마커 N개를 못 파싱하면 적용 없음.

---

## Phase 0. CellSelection ranges (폴리싱 체크박스 생존)

**이미 구현됐을 수 있음.** 없으면 `blockRangeScope.ts`를 `buildSelectionBubble`과 같은 ranges 루프로 바꾸고 테스트를 가져온다.

완료 조건: 빈 셀이 head인 2셀 드래그에서도 `resolveTopLevelBlockRange`가 표 인덱스를 반환. `npx vitest run src/editor/utils/blockRangeScope.test.ts`.

이것만으로는 표 전체가 여전히 폴리싱된다. Phase 2가 본론이다.

---

## Phase 1. `tableRangeScope` 유틸

파일: `src/editor/utils/tableRangeScope.ts` + `tableRangeScope.test.ts`.

픽스처: `blockRangeScope.test.ts`와 같은 Editor + Table + `TranslationUnitId`. `setTimeout(0)`으로 ID 부여를 기다린다.

테스트:

- 문단만 선택 → `top-level-blocks` (기존과 같은 from/toIndex)
- 셀 안 텍스트 선택 → `in-cell`, `tableIndex`는 표의 최상위 인덱스
- 3열 중 1–2열 CellSelection → `table-rect` `{left:0,right:2,...}` (0-based, exclusive right). 3열 유닛은 `cells`에 없음
- 빈 셀 head + 이웃 셀 → `table-rect`가 이웃을 포함 (Phase 0과 같은 제스처)
- 표와 앞 문단에 걸친 텍스트 선택 → `top-level-blocks` fromIndex=문단, toIndex=표
- 접힌 선택 → `null`

`TableMap`은 `@tiptap/pm/tables`에서 import. 셀 좌표는 `map.findCell(cellPos - tableStart)`.

→ verify: `npx vitest run src/editor/utils/tableRangeScope.test.ts`

---

## Phase 2. 부분 폴리싱을 셀 사각형에 맞추기

### 2-1. JSON 추출/병합 (순수 함수)

`src/editor/utils/tableRectSplice.ts` (또는 `tableRangeScope.ts`에 같이):

```ts
extractTableRectDoc(full: TipTapDocJson, tableIndex: number, rect: TableRect): TipTapDocJson
// 반환: { type:'doc', content: [ table with only rect cells ] }

replaceTableRect(
  full: TipTapDocJson, tableIndex: number, rect: TableRect, replacement: TipTapDocJson,
): TipTapDocJson
// replacement.content[0]이 table이어야 함. 차원 불일치 시 throw.
// 원본 불변. 표 밖 블록·rect 밖 셀의 객체 정체성 유지(참조 재사용).
```

`in-cell`은 문단 하나만 있는 sub-doc ↔ 해당 `jsonPath` 노드 치환. 기존 `replaceTopLevelBlockRange`를 표 하나에 쓰면 안 된다.

테스트:

- 2×3 표에서 가운데 열만 추출 → 2×1 표, 텍스트가 그 열
- 추출본의 셀 텍스트를 바꿔 `replaceTableRect` → 가운데 열만 변경, 나머지 셀 텍스트 동일, 앞뒤 문단 동일, 입력 객체 불변
- 결과 표가 1×1인데 rect는 2×1 → throw
- 헤더 행(`tableHeader`)이 rect에 포함되면 타입을 유지하고 데이터 행과 섞지 않음

### 2-2. 폴리싱 프롬프트

`buildPolishSystemPrompt` / `buildPolishMessages`에 옵션을 **추가하지 않고도** 동작해야 한다 — 입력이 이미 작은 표 또는 한 문단이면 기존 "topology 유지" 문구가 그 작은 표에 적용된다.

선택: system에 한 줄 추가해도 된다 (파서 무변경).

```
INPUT_DOCUMENT is a fragment (one table region or one cell). Do not add rows or columns. Do not invent surrounding document content.
```

`StreamingPolishParams`에 플래그를 달지 말고, 호출부가 sub-doc만 바꾸면 된다.

### 2-3. UI 배선

`handlePolishClick`: `resolveTopLevelBlockRange` 대신 `resolveAiSelectionScope`.

state 타입을 `TopLevelBlockRange | TableRectScope | null`로 넓히거나, `AiSelectionScope` 하나를 저장.

체크박스 라벨:

- `top-level-blocks`: 기존 `editor.polishModal.scopeLabel` (블록 n개)
- `table-rect` / `in-cell`: 새 키 `editor.polishModal.scopeLabelCells` — "선택한 셀만 다듬기 ({{count}}개)". `count`는 `dropAncestorUnits` 후 비어 있지 않은 셀 수
- 해제 시 오늘과 같이 문서 전체 폴리싱

`openPolishPreview`:

- `table-rect`: `extractTableRectDoc` → `polishTargetDocumentWithStreaming({ targetDocJson: subDoc })` → `replaceTableRect(fullSnapshot, ...)`
- `in-cell`: 문단 sub-doc 폴리싱 → 셀 내부 노드 치환. 셀에 문단이 여러 개인데 하나만 골랐으면 **그 문단만** 치환 (다른 문단 불변)
- `top-level-blocks`: 기존 slice + `replaceTopLevelBlockRange`
- `polishOriginalDocJson`은 **전체 target** 유지 (프리뷰 diff 기준)
- 가드·선택 적용·스냅샷 경로 변경 없음

i18n: `ko.json` / `en.json` 양쪽. `editor.polishScopeStructureChanged` 에러 문자열(차원 불일치).

→ verify: `npx vitest run src/editor/utils/tableRectSplice.test.ts src/ai/polishDocument.test.ts` (페이로드에 서브테이블 HTML만 있고 옆 셀 텍스트가 없는지). `npx tsc --noEmit`.

수동: 3열 표에서 1–2열만 선택 → 폴리싱 → diff에 3열 변경 0건. 요청 후 편집 → L2 가드 중단.

---

## Phase 3. 여러 셀 부분 재번역

ADR-0010을 **좁게** 개정한다. 새 ADR을 쓰지 않고 0010 Consequences에 예외 한 줄을 추가해도 된다. 결정 문장:

> 표 `CellSelection`(또는 정규화 후 모든 range가 서로 다른 셀의 단일 textblock인 선택)은 범위마다 독립 `replaceWith`를 **한 트랜잭션**으로 적용할 수 있다. 일반 문단을 가로지르는 `TextSelection`은 여전히 거절한다.

### 3-1. 생성

`openSelectionRetranslate`의 `spansMultipleBlocks` 거절을 다음으로 교체:

```
const tableScope = resolveAiSelectionScope(editor)
const canApply =
  !selection.spansMultipleBlocks
  || (tableScope?.kind === 'table-rect'
      && everyNormalizedRangeIsSingleTextblock(editor, selectionAnchor))
```

문단 두 개를 가로지르는 드래그는 오늘처럼 거절.

원문: 셀마다 `dropAncestorUnits(findAlignedCounterpartUnits(...))`. 한 셀이라도 원문이 없으면 오늘처럼 전체 실패 (부분 생성 없음).

한 번의 모델 호출 (`retranslateSelection.ts` 확장 또는 `retranslateTableCells.ts` 신규):

입력: `cells: Array<{ sourceText, currentTargetText, surroundings? }>`

출력 마커 (기존 SELECTION_EDIT 마커와 충돌 없게 인덱스):

```
---CELL_0_START---
...plain text...
---CELL_0_END---
---CELL_1_START---
...
---CELL_1_END---
```

`maxTokens`는 기존 `SELECTION_EDIT_MAX_TOKENS`. 개수 불일치·END 누락 → throw. 도구 바인딩 0개 유지 (gotcha 147).

미리보기: 셀이 하나면 기존 `SelectionEditPreviewModal` 그대로. 여러 셀이면 **셀마다 원문/현재/제안** 리스트(최소: 이어 붙인 diff + "셀 n개"). UX를 크게 새로 만들지 말고, 1차는 모달에 `replacements: string[]`를 넣고 순서대로 보여 준다. 손편집은 1차에서 셀마다 textarea 또는 단일 텍스트를 `\n---\n`로 나누지 말 것 — 나누면 셀 경계가 무너진다. 1차는 손편집 없이 재생성·적용만 허용해도 된다 (모달에 명시).

### 3-2. 적용

`applySelectionEdit`를 확장하거나 `applySelectionEdits`를 옆에 둔다:

- `anchor.ranges.length === replacements.length`
- 각 range: `sameParent` + `isTextblock` + `expectedTexts[i]` TOCTOU
- **문서 뒤쪽 range부터** 같은 `tr`에 `replaceWith` (앞 치환이 뒤 pos를 밀지 않음)
- 서식: range마다 `getUniformSelectionMarks` / flatten 동의 시 `getCommonSelectionMarks`
- 한 `dispatch`, 앵커 `remove`, `focus`. Undo 한 단계
- `getSingleAnchorRange` 우회는 이 함수 안에서만. 다른 호출부가 `ranges[0]`을 쓰게 만들지 말 것

테스트 (`applySelectionEdit.test.ts`):

- 두 셀 텍스트를 한 호출로 교체, 표 구조·미선택 셀 보존
- 한쪽 expectedText가 다르면 전체 `stale`, 문서 불변
- 문단 두 개 TextSelection을 이 함수에 넣으면 `invalid` (CellSelection 전용 가드)

`openSelectionRetranslate` / `SelectionEditPreviewModal` apply 핸들러가 N>1일 때 새 함수를 부른다.

→ verify: `npx vitest run src/editor/utils/applySelectionEdit.test.ts src/ai/retranslateSelection.test.ts src/editor/extensions/SelectionAnchor.test.ts`

---

## Phase 4. 라벨 · E2E

i18n (ko+en):

- `editor.polishModal.scopeLabelCells`
- `editor.polishScopeStructureChanged`
- `selection.tableCellsRetranslate` (여러 셀일 때 버튼/토스트, 기존 `sameBlockRequired`를 표 셀에 쓰지 말 것)

E2E: `e2e/selection-editing.spec.ts`의 `Table cell selection` describe에 추가.

- 이미 있는 것: 채팅 칩·코멘트·복사가 세 셀을 모두 덮음
- 추가: 두 셀 드래그 후 `selection-inline-review` → 검수 패널 범위 칩이 2(또는 비어 있지 않은 셀 수)
- 추가: 한 셀 텍스트 선택 후 재번역 버튼이 거절 토스트 없이 모달을 염
- 폴리싱 모달 체크박스는 web e2e에서 워크플로 버튼 의존이 커서, 유닛으로 갈음하고 데브 수동만 적는다. 가능하면 `editor.polishModal.scopeLabelCells`가 보이는지 한 케이스.

→ verify: `npx playwright test -c playwright.web.config.ts e2e/selection-editing.spec.ts`

---

## 결정 사항 (기본값, 이견 시 여기만 바꾸면 됨)

- **D1 폴리싱 입력**: 고른 사각형의 **유효한 작은 표**(또는 한 문단)만 보낸다. 표 전체를 보내 놓고 "이 셀만 고치라"고 하지 않는다 — 모델이 다른 셀을 만지면 병합 전에 티가 안 난다.
- **D2 병합 키**: translationUnitId가 아니라 **표 기하(rect + 행/열 순번)**. 모델은 ID를 버린다.
- **D3 혼합 선택**(문단+표): 셀 단위로 쪼개지 않고 오늘처럼 최상위 블록 스냅.
- **D4 재번역 N셀**: API 1회 + 셀 마커 N개. 셀마다 호출하지 않는다.
- **D5 재번역 손편집**: N>1이면 1차에서 비활성. 적용/재생성만.
- **D6 ADR-0010**: 표 셀 단일 textblock N-range만 예외. 본문 원칙(문단 병합 금지)은 유지.

---

## 위험과 격리

| 위험 | 격리 |
|---|---|
| 모델이 열을 추가/삭제 | `replaceTableRect` 차원 검사로 적용 차단, 표 전체 폴리싱 안내 |
| 병합 셀(colspan)이 rect 경계에 걸침 | 1차 fail-closed (토스트). `CellSelection.content()` 클립을 쓰려면 Phase 2 테스트에 픽스처를 추가한 뒤에만 |
| N셀 재번역이 한 셀만 덮어씀 | `ranges[0]` 금지. `applySelectionEdits`만 사용. 테스트가 두 셀 텍스트를 단언 |
| 빈 head 셀 드래그 | Phase 0 ranges. 회귀 테스트 유지 |
| 셀+문단 원문 중복 | 기존 `dropAncestorUnits`. 새 경로도 호출 전 적용 |
| 프리뷰가 표 일부만 보여 사용자가 문서가 잘렸다고 오해 | `polishOriginalDocJson`은 전체 문서. 병합본을 프리뷰. 스트리밍 탭은 서브문서만 흐름 — 주석으로 명시 (이어서 번역과 같은 패턴) |

---

## 최종 검증

```bash
npx tsc --noEmit
npx vitest run src/editor/utils/tableRangeScope.test.ts \
  src/editor/utils/tableRectSplice.test.ts \
  src/editor/utils/blockRangeScope.test.ts \
  src/editor/utils/applySelectionEdit.test.ts \
  src/ai/tools/buildScopedAlignedChunks.test.ts \
  src/components/review/reviewApply.integration.test.ts \
  src/ai/retranslateSelection.test.ts \
  src/ai/polishDocument.test.ts
npx playwright test -c playwright.web.config.ts e2e/selection-editing.spec.ts
```

데브 수동 (`npm run tauri:dev`):

1. 표 3열 중 왼쪽 두 셀 드래그 → 폴리싱 체크박스가 셀 개수 → 적용 후 3열 불변
2. 같은 선택 → 이 구간만 검수 → 이슈가 그 셀 excerpt에만 적용
3. 같은 선택 → 재번역 모달이 열림 → 두 셀만 바뀌고 Undo가 한 번에 복구
4. 셀 하나 안 텍스트만 재번역 → 오늘과 동일
5. 표+아래 문단을 함께 드래그하고 폴리싱 → 표 전체+그 문단 (D3)
