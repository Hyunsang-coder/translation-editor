# Phase 4.5 — 정렬 검사 뷰 (Alignment Inspection View)

> 시안: `OddEyes UI 개선.dc.html` 의 **`2a`** 화면.
> 선행: Phase 1–4 (`README.md`). Phase 3의 상단 바·상태 스트립, Phase 4의 인스펙터를 재사용한다.
> 예상 규모: **1.5주**. 스키마 변경 0, 마이그레이션 0, 백엔드 변경 0.

---

## 0. 왜 이 단계가 존재하는가

`1c` 시안의 세그먼트 정렬 뷰(Phase 5)를 **영속 정렬 레이어 없이** 구현하는 중간 단계다.

현재 코드베이스에는 원문↔번역문의 지속적 정렬이 **없다.** 구현 전에 아래 세 가지를 반드시 이해하고 시작할 것. 이걸 모르고 시작하면 잘못된 가정 위에 코드를 쌓게 된다.

1. **`project.segments`는 죽은 모델이다.**
   `projectStore.addSegment()`는 정의만 되어 있고 **호출부가 한 군데도 없다.** 세그먼트는 프로젝트 생성 시 기본 2개(`projectStore.ts` 약 371–381행)에서 늘어나지 않는다. 문단 42개짜리 문서를 붙여넣어도 세그먼트는 2개다.
   → **`project.segments` / `project.blocks` / `segmentGroupId`를 정렬 근거로 쓰지 말 것.**

2. **blocks는 문자 오프셋으로 역투영된다.**
   `materializeBlocksFromDocuments`(`projectStore.ts` 약 1485행)의 폴백은 "원본 기준 오프셋을 계산하고 길이 차이(delta)를 **마지막 블록에 몰아준다**". 한 번이라도 편집하면 마지막을 제외한 모든 블록 경계가 어긋난다.

3. **`translationUnitId`는 원문/번역문에서 독립 발급된다.**
   `TranslationUnitId` 익스텐션은 각 에디터에서 문단·헤딩·표셀에 UUID를 붙인다. 두 문서를 잇는 건 `reattachTranslationUnitIds` 하나뿐인데, **노드 개수·타입·경로가 완전히 일치할 때만** 동작하고 아니면 `alignedUnitIds: []`로 통째로 포기한다.
   → 번역문에만 문단 하나를 추가하면 ID 기반 정렬은 전부 끊긴다.

**Phase 4.5의 입장**: 정렬을 저장하지 않는다. 뷰를 열 때마다 두 에디터의 현재 문서에서 **계산**하고, 짝이 안 맞는 구간은 **고치지 않고 불일치로 표시**한다. 편집은 기존 2분할(문서 보기)에서 한다.

부수 효과로 **"실무에서 정렬이 얼마나 자주 깨지는가"** 데이터가 쌓인다. 이게 Phase 5에 4~6주를 쓸지 판단하는 근거가 된다.

---

## 1. 범위

### 하는 것
- 원문/번역문 문단을 나란히 놓는 **읽기 전용** 대조 테이블
- 문단 쌍 계산 (순번 + 타입 시퀀스 매칭)
- 불일치 구간 표시 (1:0, 0:1)
- 행별 이슈·코멘트 배지
- 행 클릭 → 문서 보기로 전환 + 해당 문단으로 점프
- 하단 정렬 요약 지표
- 우측 인스펙터 재사용 (Phase 4에서 만든 것)

### 안 하는 것
- 편집 (행 안에서 타이핑 불가)
- 정렬 저장 / 스키마 변경 / `.ite` 마이그레이션
- 사용자가 수동으로 짝을 고치는 기능 (분할/병합)
- 1:N, N:1 매칭 — 이번엔 1:1과 1:0 / 0:1만 다룬다
- **`정렬 검사`를 기본 모드로 만들지 않는다.** 기본은 `문서 보기`다.

---

## 2. 정렬 알고리즘

**신규 파일: `src/utils/alignUnits.ts`** — 순수 함수. React·스토어 의존성 없음. 단위 테스트 대상.

### 입력

```ts
import { collectTranslationUnits, type TranslationUnit, type TranslationUnitDocument }
  from '@/editor/extensions/TranslationUnitId';
```

`collectTranslationUnits(doc)` 는 이미 존재하며 `{ id?, type, path, text }[]` 를 문서 순서대로 반환한다. **이 함수를 그대로 쓴다. 새로 만들지 말 것.**

### 전처리

```ts
// 빈 문단은 정렬 대상에서 제외한다.
// (번역 과정에서 빈 문단 개수가 흔히 달라지므로, 포함하면 정렬이 쉽게 깨진다)
const contentUnits = units.filter((u) => u.text.trim().length > 0);
```

### 시그니처

각 유닛을 매칭용 시그니처로 환원한다. **텍스트 내용은 쓰지 않는다** — 원문과 번역문은 언어가 달라 내용 비교가 무의미하다.

```ts
function signature(u: TranslationUnit): string {
  // heading은 레벨까지 구분해야 h2↔h3 오매칭을 막는다.
  // path의 마지막 depth로 리스트 항목/표 셀 여부를 구분한다.
  return `${u.type}:${u.path.length}`;
}
```

> `collectTranslationUnits`가 heading level을 주지 않으므로, 필요하면 `attrs.level`을 함께 수집하도록 `TranslationUnit`에 `level?: number`를 추가한다. 익스텐션의 기존 동작은 건드리지 않는다.

### 매칭 — LCS

시그니처 시퀀스에 대해 **최장 공통 부분수열(LCS)** 을 구하고, 백트래킹으로 연산 목록을 만든다. 외부 라이브러리 불필요, ~70행.

```ts
export type AlignOp =
  | { kind: 'pair';        source: TranslationUnit; target: TranslationUnit }
  | { kind: 'source-only'; source: TranslationUnit }   // 1:0 — 번역 누락 의심
  | { kind: 'target-only'; target: TranslationUnit };  // 0:1 — 원문 없는 추가 의심

export interface AlignResult {
  ops: AlignOp[];
  pairedCount: number;
  mismatchCount: number;   // source-only + target-only
  totalUnits: number;      // max(source.length, target.length)
  ratio: number;           // pairedCount / totalUnits
}

export function alignUnits(
  sourceDoc: TranslationUnitDocument,
  targetDoc: TranslationUnitDocument,
): AlignResult;
```

**동작 규칙**

- 시그니처가 완전히 같으면 전부 `pair` (가장 흔한 경우 — 번역 직후).
- 한쪽에만 문단이 있으면 그 위치에 `source-only` / `target-only`.
- 연속된 mismatch는 UI에서 하나의 "불일치 구간"으로 묶어 보여준다 (§4.3).
- **LCS가 O(n·m)이다.** 문단 500개까지는 무시할 만하지만(250k 연산), 상한을 둔다: `source.length * target.length > 250_000` 이면 LCS를 포기하고 **순번 매칭 폴백**(`min(n,m)`까지 `pair`, 나머지는 한쪽만)으로 내려간다. `AlignResult`에 `degraded: boolean`을 넣어 UI에서 "정렬 정확도 낮음"을 표시한다.

### 테스트 — `src/utils/alignUnits.test.ts`

최소 케이스:

| # | 상황 | 기대 |
|---|---|---|
| 1 | 동일 구조 5:5 | `pair` 5, `mismatchCount` 0, `ratio` 1 |
| 2 | 번역문에 문단 1개 추가 (5:6) | `pair` 5, `target-only` 1 |
| 3 | 번역문에 문단 1개 누락 (5:4) | `pair` 4, `source-only` 1 |
| 4 | 중간에 heading 하나만 다름 | 앞뒤는 `pair`, 그 자리만 mismatch |
| 5 | 빈 문단이 한쪽에만 3개 | 전부 `pair` (빈 문단 제외되므로) |
| 6 | 한쪽이 빈 문서 | 전부 `source-only` |
| 7 | 500 × 500 | `degraded === false`, 100ms 이내 |
| 8 | 600 × 600 | `degraded === true` (폴백 경로) |

---

## 3. 상태

`src/stores/uiStore.ts` 에 **2개만** 추가한다.

```ts
editorViewMode: 'document' | 'alignment';   // 기본 'document'
activeAlignmentUnitId: string | null;       // 인스펙터가 볼 대상 (target 유닛 id)
```

- `editorViewMode`는 `persist` 대상에 **포함한다** (사용자가 고른 모드가 유지되도록). `uiStore.ts` 하단 `partialize`에 추가.
- `activeAlignmentUnitId`는 persist하지 않는다.
- `alignResult` 자체는 **스토어에 넣지 않는다.** `AlignmentView` 안에서 `useMemo`로 계산한다.

계산 트리거:

```ts
const alignResult = useMemo(
  () => alignUnits(sourceJson, targetJson),
  [sourceRevision, targetRevision],
);
```

`sourceRevision` / `targetRevision`은 `hashContent(tipTapJsonToMarkdownForTranslation(json))` — `EditorCanvasTipTap`의 기존 `computeTargetRevision`과 동일한 산식. **매 키 입력마다 재계산하면 안 된다.** 읽기 전용 뷰이므로 모드 진입 시 1회 + 문서 리비전 변경 시에만 계산하면 충분하다. 300ms 디바운스를 건다.

---

## 4. 컴포넌트

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/utils/alignUnits.ts` | 정렬 알고리즘 (순수) |
| `src/utils/alignUnits.test.ts` | 알고리즘 테스트 |
| `src/components/editor/AlignmentView.tsx` | 뷰 전체 (헤더 + 행 목록 + 요약) |
| `src/components/editor/AlignmentRow.tsx` | 행 하나 |
| `src/components/editor/useAlignmentAnnotations.ts` | 이슈/코멘트를 행에 매핑 |

### 수정 파일

| 파일 | 변경 |
|---|---|
| `src/components/editor/EditorCanvasTipTap.tsx` | `editorViewMode`에 따라 `PanelGroup` ↔ `AlignmentView` 분기 |
| `src/stores/uiStore.ts` | 상태 2개 + partialize |
| `src/editor/extensions/TranslationUnitId.ts` | `TranslationUnit`에 `level?: number` 추가 (선택) |
| `src/i18n/locales/ko.json`, `en.json` | 신규 문자열 |

### 4.1 모드 토글

`EditorCanvasTipTap` 헤더의 툴바 줄에 세그먼트 컨트롤로 넣는다.

```
[ 문서 보기 | 정렬 검사 ]   [🔒 읽기 전용]   [불일치 구간만 3] [이슈 있는 문단 5]
```

- 컨테이너 `border border-editor-border rounded-md overflow-hidden`
- 활성 옵션 `bg-primary-500 text-white text-[11px] font-extrabold px-3 h-[26px]`
- 비활성 `text-[11px] font-semibold text-editor-muted px-3 h-[26px]`
- `읽기 전용` 칩: `h-6 px-[9px] bg-editor-surface border border-editor-border rounded text-[11px] font-semibold text-editor-muted`, 좌측에 `Lock` 아이콘 12px
- 필터 칩 2개는 **토글**. 활성 시 `border-primary-500 bg-accent-tint text-accent-deep font-bold`
- 우측 끝 힌트 텍스트: `행을 클릭하면 문서 보기의 해당 문단으로 이동합니다` (`text-[11px] text-editor-muted`)

### 4.2 테이블 헤더

`h-8`, `border-b border-editor-border`, `bg-editor-bg`
`text-[10px] font-extrabold tracking-[.12em] uppercase text-editor-muted`

| 컬럼 | 폭 |
|---|---|
| `#` | `w-[52px]`, `pl-[18px]` |
| `원문 · EN` | `flex-1`, `pl-[18px]`, `border-l` |
| `번역문 · KO` | `flex-1`, `pl-[18px]`, `border-l` |
| `정렬` | `w-[120px]`, `pl-[14px]`, `border-l` |

언어 라벨은 하드코딩하지 말고 `project.metadata.targetLanguage` 와 원문 감지 결과를 쓴다. 원문 언어 감지는 `ReviewPanel.tsx`의 `detectSourceLanguage`를 `src/utils/`로 올려 재사용한다.

### 4.3 행

**정상 쌍 (`pair`)**

```
[04]  Beryl M762: vertical recoil…   │  베릴 M762: 초탄 4발 구간의…   │  ✓ 1:1
                                                                        심각 1
                                                                        코멘트 1
```

- 컨테이너 `flex items-stretch border-b border-editor-border/40`
- 셀 `px-5 py-3 text-sm leading-relaxed`
- 헤딩 유닛은 `text-base font-bold leading-snug` (h1은 `text-lg`)
- 번호 `w-[52px] pt-3.5 pl-[18px] text-xs font-bold text-slate-400`
- 정렬 셀: `✓ 1:1` — `Check` 아이콘 12px + `text-[11px] font-semibold text-editor-muted`
- 배지: `px-1.5 py-0.5 rounded text-[10px] font-bold`, 색은 기존 severity 색 사용

**활성 행**: `bg-accent-tint border-l-[3px] border-l-primary-500`, 번호 셀 `pl-[15px]`(3px 보정), 텍스트 `text-primary-500`
번역문 셀 끝에 인라인 버튼 `이 문단 편집 ↗` — `h-6 px-2.5 border border-primary-500 bg-white rounded text-[11px] font-bold text-accent-deep`

**불일치 구간 (연속 mismatch를 하나로 묶음)**

배너 + 해당 행들을 `bg-amber-50`으로 감싼다.

```
⚠ 정렬 불일치 — 번역문에 문단이 1개 더 있습니다 (원문 5 : 번역문 6)
  이 구간은 짝을 추정하지 않고 그대로 표시합니다.        [이 구간 문서 보기로 열기 ↗]
─────────────────────────────────────────────────────
[06]  ┆ 대응하는 원문 없음 ┆   │  투척류는 이제 차량…   │  0:1
```

- 배너 `flex items-center gap-2.5 px-[18px] py-2 border-b border-dashed border-amber-400`
- 배너 텍스트 `text-xs font-bold text-amber-700`, 부가 설명 `text-[11px] text-amber-800`
- 빈 셀 플레이스홀더: `w-full px-3 py-2.5 border border-dashed border-amber-400 rounded text-xs text-amber-700 bg-white/50`
- 정렬 셀 배지 `bg-amber-400/20 text-amber-700` — `1:0` 또는 `0:1`
- `⚠` 은 lucide `TriangleAlert` 15px

**amber는 신규 색이다.** Tailwind 기본 `amber-*` 팔레트를 그대로 쓰고 CSS 변수로 승격하지 않는다 — 불일치 경고 한 곳에서만 쓰이는 상태색이다.

### 4.4 행 클릭 → 문서 보기 점프

```ts
function jumpToUnit(unitId: string, field: 'source' | 'target') {
  const editor = field === 'source'
    ? useEditorStore.getState().sourceEditor
    : useEditorStore.getState().targetEditor;
  if (!editor || editor.isDestroyed) return;

  let pos: number | null = null;
  editor.state.doc.descendants((node, p) => {
    if (pos !== null) return false;
    if (node.attrs?.translationUnitId === unitId) { pos = p + 1; return false; }
    return true;
  });
  if (pos === null) return;

  useUIStore.getState().setEditorViewMode('document');
  // 모드 전환 후 에디터가 다시 레이아웃될 때까지 한 프레임 기다린다
  requestAnimationFrame(() => {
    editor.chain().focus().setTextSelection(pos!).run();
  });
}
```

> **`scrollIntoView()`를 쓰지 말 것.** 앱 규칙이다. TipTap의 `setTextSelection` + `focus()` 가 ProseMirror의 자체 스크롤 로직을 태우므로 그것으로 충분하다.

### 4.5 이슈·코멘트 매핑 — `useAlignmentAnnotations.ts`

`ReviewIssue.segmentGroupId`는 **신뢰할 수 없다**(§0-1). 대신 **텍스트 포함 검사**로 행에 매핑한다. `reviewApply.ts`가 이미 같은 이유로 퍼지 검색을 쓰고 있다.

```ts
import { stripRichTextMarkup, normalizeForSearch } from '@/utils/normalizeForSearch';

// 이슈 → target 유닛 id
// targetExcerpt가 어느 유닛 텍스트에 포함되는지 찾는다.
// 여러 유닛에 걸리면(중복 구절) 매핑하지 않는다 — 잘못된 위치를 보여주느니 안 보여준다.
```

- 코멘트도 동일: `comment.excerpt` 를 `comment.field` 쪽 유닛에서 찾는다.
- 매핑 실패한 이슈는 **버리지 말고** 뷰 하단에 `위치를 특정하지 못한 이슈 {n}건` 으로 모아 보여준다. 클릭하면 검수 패널이 열린다. 이 카운트 자체가 정렬 품질 지표다.
- 정규화·비교는 `normalizeForSearch.ts`의 기존 함수를 쓴다. 새 정규화 로직을 만들지 말 것.

### 4.6 하단 정렬 요약

`h-14 border-t border-editor-border bg-editor-surface flex items-center gap-[18px] px-[18px]`

```
정렬 상태
42개 문단 중 39개 정렬 · 3개 불일치     [████████████░]     [⬇ 정렬 리포트]
```

- 라벨 `text-[10px] font-extrabold tracking-[.1em] uppercase text-editor-muted`
- 수치 `text-sm font-bold`, `39개 정렬`은 `text-primary-500`, `3개 불일치`는 `text-amber-700`
- 막대: `flex-1 max-w-[420px] h-2 bg-editor-border rounded overflow-hidden`, 안에 `primary-500` 비율 + `amber-400` 비율
- `degraded === true` 이면 막대 옆에 `정렬 정확도 낮음 (문단 수 과다)` 경고
- **`정렬 리포트` 버튼**: 현재 `AlignResult` 요약을 JSONL 한 줄로 내보낸다. `src/quality/`의 `saveQualityJsonl` 패턴을 따른다.

```jsonc
{ "kind": "alignment_check", "project_id": "…", "at": "2026-07-28T14:32:00Z",
  "total_units": 42, "paired": 39, "mismatched": 3, "ratio": 0.929,
  "unmapped_issues": 1, "degraded": false }
```

> 이 한 줄이 Phase 5 판단의 근거다. 여러 프로젝트에서 `ratio`가 꾸준히 0.95 이상이면 영속 정렬 레이어는 필요 없다. 0.7 근처로 떨어지면 Phase 5를 해야 한다.
> **자동 수집은 하지 않는다.** 사용자가 버튼을 눌러 내보내는 방식으로만 남긴다.

---

## 5. 구현 순서

각 단계마다 `npm run lint && npm run test:run` 을 통과시키고 넘어간다.

| 단계 | 내용 | 산출물 |
|---|---|---|
| 1 | `alignUnits.ts` + 테스트 8케이스 | UI 없이 알고리즘만. **여기서 멈추고 테스트가 다 통과하는지 확인** |
| 2 | `uiStore` 상태 2개 + 모드 토글 UI | 토글하면 빈 화면이 뜨는 상태 |
| 3 | `AlignmentView` + `AlignmentRow` — 정상 쌍만 렌더 | 1:1 문서에서 표가 보임 |
| 4 | 불일치 구간 배너 + 빈 셀 | 문단 하나 지워서 수동 확인 |
| 5 | 행 클릭 점프 | 문서 보기로 전환 + 커서 이동 |
| 6 | `useAlignmentAnnotations` — 이슈·코멘트 배지 | 검수 실행 후 배지 확인 |
| 7 | 하단 요약 + 정렬 리포트 내보내기 | JSONL 파일 생성 확인 |
| 8 | i18n 문자열 정리 | 하드코딩된 한국어 0개 |

---

## 6. 완료 기준

- [ ] `alignUnits.test.ts` 8케이스 통과
- [ ] 문단 500개 문서에서 모드 전환이 300ms 이내
- [ ] 정렬 뷰에서 **타이핑이 불가능**하다 (읽기 전용이 실제로 강제됨)
- [ ] 모드를 오가도 커서 위치와 스크롤이 보존된다
- [ ] `project.segments` / `segmentGroupId` 를 참조하는 새 코드가 **0줄**
- [ ] 기존 E2E 전체 통과 (`npm run test:e2e:web`)
- [ ] `문서 보기`가 여전히 기본 모드다
- [ ] 다크 모드는 고려하지 않는다 (라이트 전용 결정)

---

## 7. 함정

- **정렬 계산을 `onUpdate`에 걸지 말 것.** 문서 리비전 해시 변화 + 300ms 디바운스로만 트리거한다. 안 그러면 타이핑할 때마다 LCS가 돈다.
- **`AlignmentView` 안에서 TipTap 에디터를 만들지 말 것.** 이번 단계는 순수 읽기 전용 렌더다. 편집 가능한 행은 Phase 5의 주제다.
- **두 에디터는 계속 살아 있어야 한다.** 정렬 뷰로 전환할 때 `PanelGroup`을 언마운트하면 에디터 인스턴스가 파괴되고 `editorStore`가 비어 점프·검수 적용이 깨진다. `display:none`으로 숨기거나, 정렬 뷰를 오버레이로 얹는다. **언마운트 금지.**
- **`degraded` 상태를 조용히 넘기지 말 것.** 순번 폴백으로 내려갔는데 UI가 정상처럼 보이면 사용자가 잘못된 짝을 믿게 된다.
- 이슈 매핑이 애매하면(여러 유닛에 걸림) **매핑하지 않는다.** 틀린 위치를 보여주는 것보다 안 보여주는 게 낫다.

---

## 8. Phase 5로 갈 때 남는 것 / 버리는 것

**남는 것**: `alignUnits.ts`(초기 정렬 추정에 그대로 쓰임), `AlignmentView`의 레이아웃·행 컴포넌트, 이슈 매핑 훅, 요약 지표.

**버리는 것**: "계산해서 쓰고 버린다"는 전제. Phase 5에서는 `alignUnits`의 결과가 **초기값**이 되고, 그 뒤로는 ProseMirror `Step` 매핑으로 링크를 유지하며 `.ite`에 저장한다.

즉 Phase 4.5는 Phase 5의 **1단계를 미리 만들어 두는 것**이지 버려지는 작업이 아니다.
