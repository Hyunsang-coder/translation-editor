# 부분 범위 AI 실행 플랜 — 이어서 번역 · 폴리시/검수 범위 실행

> **진행 상태 (이 헤더가 진실)**
> - [x] Phase 0-1: 번역/폴리시 스트리밍 프롬프트 캐싱
> - [x] Phase 0-2: 번역 프리뷰 선택 적용 (재번역 케이스)
> - [x] Phase 1: 이어서 번역 (남은 원문 자동 감지 → append) — **§1-1 알고리즘 교체됨, 아래 참조**
> - [x] Phase 2: 폴리시 범위 실행 (선택 구간만 다듬기)
> - [x] Phase 3: 검수 범위 실행 (선택 구간만 검수)
>
> 구현 완료 2026-08-12 (브랜치 `worktree-scoped-ai-runs`). typecheck + 유닛 1415개 통과.
> 수동 확인(데브 빌드)과 E2E 시나리오는 미실시 — 별도 요청 시.
>
> **후속 (표 셀 단위, 2026-08-13 구현 완료)**: 원칙 3(표 안 선택 → 표 전체 스냅)은
> **개정됐다** — 고른 칸이 병합 없는 사각형이면 그 사각형만으로 유효한 작은 표를 만들어
> 보낸다. 깨진 부분 표를 보내지 않는다는 원래 동기는 그대로다. 병합 셀·중첩 표·표 바깥까지
> 걸친 선택은 여전히 표 전체 스냅이다. [table-range-scoped-ai-plan](table-range-scoped-ai-plan.md).
>
> 작성: 2026-08-12. 배경: 분량이 큰 문서에서 이미 완료된 앞부분을 제외하고
> 번역/검수/폴리시를 돌릴 수 있게 한다. 안정성 원칙: **모든 경로는 fail-closed** —
> 정렬/검증이 애매하면 기능을 끄고 전체 실행으로 안내한다. 문서를 손상시키는
> 실패 모드는 만들지 않는다.

## 비목표 (이번에 하지 않는 것 — 제안 금지)

- **번역의 중간 구간 교체**: 교차 정렬 + 모델의 N유닛→N유닛 개수 일치율 미측정
  (ADR-0010이 보류한 문제). append와 폴리시/검수 범위만 다룬다.
- **유닛 완료 상태 영속화(잠금)**: 별도 결정 후 진행 (옵션 C).
- **dead 청킹 경로(`src/ai/chunking/`) 부활**: 건드리지 않는다.
- **`project.segments` 모델 수선**: 죽은 모델. 검수 범위는 segments를 우회한다.

---

## 0. 검증된 코드 계약 (2026-08-12 확인, 구현 전 재확인 필수)

구현 시 각 파일을 직접 읽고 라인이 밀렸는지 확인할 것. 아래는 설계가 딛고 선 사실이다.

| 계약 | 위치 | 내용 |
|---|---|---|
| 정렬 엔진 | `src/utils/alignUnits.ts:117` | `alignUnits(sourceDoc, targetDoc): AlignResult` — `ops: AlignOp[]`(`pair`/`source-only`/`target-only`, 각 op가 `TranslationUnit` 보유), `pairedCount`, `ratio`, `degraded`. 빈 문단은 정렬 제외(`contentUnits`). LCS 상한 250k 셀 초과 시 `degraded=true` + 순번 폴백 |
| 유닛 수집 | `src/editor/extensions/TranslationUnitId.ts:75` | `collectTranslationUnits(doc)` — TipTap JSON 순회, `TranslationUnit { id?, type, path, text, level? }`. `path[0]` = 최상위 블록 인덱스 |
| 범위→유닛 | `TranslationUnitId.ts:174` | `getTranslationUnitIdsAtRange(pmDoc, from, to): string[]` |
| ID 재이식 | `TranslationUnitId.ts:106` | `reattachTranslationUnitIds(source, target)` — 토폴로지 완전 일치 시에만 이식, 불일치면 전체 unaligned(적용은 막지 않음). **sub-doc에도 그대로 동작** |
| 짝 유닛 조회 | `src/editor/utils/alignedCounterpartUnits.ts:26` | `findAlignedCounterpartUnits(counterpartDoc, primaryDoc, selectedUnitIds)` — 부분 실패 시 `[]` 반환 (fail-closed) |
| 번역 셋업 | `src/ai/translateDocument.ts:152` | `buildTranslationSetup(params)` — `params.sourceDocJson`을 그대로 MD 변환. **sub-doc을 넘겨도 파이프라인 전체가 동작**. maxTokens는 입력 크기에서 동적 계산(`:294-315`), 초과 시 throw |
| 번역 스트리밍 | `translateDocument.ts:506` | `translateWithStreaming(params)` — Tauri 경로는 `streamWithTauriAiBackend`(`:530`), 결과에 `restoreTranslationUnitIds(params.sourceDocJson, doc)`(`:544`) |
| 폴리시 스트리밍 | `src/ai/polishDocument.ts:286` | `polishTargetDocumentWithStreaming(params)` — `params.targetDocJson` 그대로 MD 변환(`:172`). sub-doc 투입 가능. Tauri 경로 `:306` |
| 캐싱 파라미터 | `src/ai/backendCompletion.ts:119,190` | `completeWithTauriAiBackend`/`streamWithTauriAiBackend` 둘 다 `cacheSystem?: boolean` 지원. **번역(:530)/폴리시(:306) 호출부만 안 넘기고 있음** |
| 프리뷰 모달 | `src/components/editor/TranslatePreviewModal.tsx:61-87` | `originalDocJson` + `onApplySelective(mergedDoc)`를 주면 변경사항 탭에서 문단 선택 적용. 폴리시 인스턴스만 사용 중(`EditorCanvasTipTap.tsx:2182-2183`), 번역 인스턴스(`:2156-2171`)는 미사용 |
| diff/병합 | `src/utils/docBlockDiff.ts:545,616` | `buildDocDiffPlan(original, next)` / `mergeDocBySelection` — 블록 diff + Dice 재짝짓기. 부분 병합 시 인라인 마크 유실 한계는 기존과 동일 |
| 적용 가드 | `EditorCanvasTipTap.tsx:1380-1442,1463-1515` | `applyTranslatePreview`/`applyPolishDoc` — L2 가드 ①프로젝트 ID ②`computeTargetRevision()`(`:293`, target MD 해시) 불일치 시 적용 중단. 리비전 계산 실패(null)도 중단 |
| 요청 메타 | `EditorCanvasTipTap.tsx:284-289` | `PreviewRequestMeta { projectId, targetRevision }` — `translateRequestMetaRef`/`polishRequestMetaRef` |
| 재번역 모달 | `EditorCanvasTipTap.tsx:1205-1215, 2100-2154` | target에 내용 있으면 번역 클릭 시 지시사항 모달 → `openTranslatePreview(retranslateMessage)` |
| 폴리시 진입 | `EditorCanvasTipTap.tsx:1331-1346` | `handlePolishClick` → `setPolishModalOpen(true)` (지시사항 모달) → `openPolishPreview(polishMessage)` |
| 검수 트리거 | `src/stores/reviewStore.ts:124,511-518` | `pendingReviewRun: { instruction } \| null` — 요청 객체 패턴. `ReviewPanel.tsx:412-415` effect가 소비 |
| 검수 청크 | `src/ai/tools/reviewTool.ts:51-62,124` | `AlignedSegment { groupId, order, sourceText, targetText }`, `AlignedChunk { chunkIndex, segments, totalChars }`, `buildAlignedChunksAsync(project, 12000, signal)` — `project.segments` 기반 |
| 이슈 순번 복원 | `src/components/review/reviewIssueOrder.ts:11` | 응답 `SegmentGroupId` → **해당 런의 청크 세그먼트** 역인덱싱 (project.segments를 직접 뒤지지 않음) |
| 이슈 적용 | `src/components/review/reviewApply.ts:430,484` | excerpt 텍스트 기반 4단계 증거 탐색. 입력 범위와 독립 |
| 선택 툴바 | `EditorCanvasTipTap.tsx:2191-2219` | `SelectionInlineToolbar` — `onRetranslateSelection`은 target 패널 전용 조건부 prop. 컴포넌트 파일은 grep으로 위치 확인 |
| 문맥 상한 선례 | `src/ai/retranslateSelection.ts:30` | `SURROUNDING_TEXT_MAX_CHARS = 400` (유닛당) |

**공통 후속 의무 (기능 추가 체크리스트, .claude/CLAUDE.md)**: i18n 키는 `src/i18n/locales/ko.json`과
`en.json` **양쪽에** 추가. 새 TipTap 확장/마크는 만들지 않으므로 `markdownConverter.ts` 동기화는
이번 플랜에서 발생하지 않는다(만들게 되면 editor.md 체크리스트 적용).

---

## 공통 설계 원칙

1. **병합-후-전체-교체 전략**: 부분 결과를 에디터에 "부분 적용"하지 않는다. 요청 시점
   target 스냅샷에 결과를 **JSON 수준에서 병합한 완성본**을 만들어 기존 전체 교체
   경로(`replaceDocContent`/`replaceDocumentWithAppliedChanges`)로 넣는다. 기존 L2 가드
   (프로젝트 ID + target 리비전)가 병합 기준 스냅샷의 유효성을 그대로 보장한다
   — 리비전이 같으면 스냅샷과 현재 문서가 동일하므로 인덱스 기반 병합이 안전하다.
2. **fail-closed**: `degraded`, `pairedCount===0`, 낮은 `ratio`, `findAlignedCounterpartUnits`
   빈 배열 → 기능 비활성/중단 + "전체 실행" 안내 토스트. 억지로 진행하는 경로를 만들지 않는다.
3. **최상위 블록 스냅**: 범위는 항상 최상위 블록(`path[0]`) 단위로 넓힌다. 표 내부
   선택은 표 전체가 범위가 된다(유닛에 tableCell 포함 — 셀 단위 절단 금지).
4. **프롬프트 계약 불변**: `---TRANSLATION_START/END---`, `---POLISH_START/END---`,
   검수 세그먼트 목록 형식과 각 파서는 건드리지 않는다. 입력 문서가 sub-doc이 될 뿐이다.

새 공용 유틸 (Phase 1·2가 공유):

```
src/editor/utils/topLevelBlockSplice.ts   (신규, 순수 함수 + 테스트)
  appendTopLevelBlocks(base: TipTapDocJson, added: TipTapDocJson): TipTapDocJson
  replaceTopLevelBlockRange(base: TipTapDocJson, fromIndex: number, toIndex: number,
                            replacement: TipTapDocJson): TipTapDocJson
  // content 배열의 얕은 슬라이스 조합. 입력 불변(새 객체 반환). attrs 건드리지 않음.
```

---

## Phase 0-1. 번역/폴리시 스트리밍 프롬프트 캐싱 (독립, 최소 diff)

**목적**: "지시사항 바꿔 재실행"마다 system(규칙+용어집+메모리)이 정가 재과금되는 것 방지.
`cacheSystem`은 이미 `streamWithTauriAiBackend`/`completeWithTauriAiBackend`가 지원한다.

1. `src-tauri/src/commands/ai.rs`에서 `cacheSystem`이 Anthropic 외 provider(OpenAI)에서
   무해하게 무시되는지 확인한다 (`ai.rs:305-313` 부근의 system 블록 변환 로직).
   → verify: 코드 리딩으로 확인. OpenAI 경로에서 필드를 참조하지 않으면 통과.
2. `src/ai/translateDocument.ts`: `streamWithTauriAiBackend` 호출(`:530`)과 스트리밍 실패
   폴백의 `completeWithTauriAiBackend` 호출(`:594` 부근)에 `cacheSystem: true` 추가.
3. `src/ai/polishDocument.ts`: `streamWithTauriAiBackend` 호출(`:306`)과 폴백 호출(파일 내
   `completeWithTauriAiBackend` grep)에 `cacheSystem: true` 추가.
   근거 선례: `retranslateSelection.ts:304`, `runReview.ts:152`.
4. → verify: `npx tsc --noEmit && npm run test:run`. 수동: 같은 문서로 번역 2회 실행 후
   백엔드 로그/usage에서 cache read 확인(가능하면. 불가하면 코드 리딩으로 갈음).

## Phase 0-2. 번역 프리뷰 선택 적용 — 재번역 케이스 (Phase 1의 토대)

**목적**: 폴리시·검수 재번역에만 있는 `originalDocJson`+`onApplySelective`를 번역 프리뷰에도.
재번역 시 완성된 앞부분이 통째로 덮이는 현재 동작의 안전판이자, Phase 1의 적용 경로.

모든 변경은 `src/components/editor/EditorCanvasTipTap.tsx`.

1. 상태 추가: `translateOriginalDocJson: TipTapDocJson | null` (폴리시의
   `polishOriginalDocJson` 대칭. 선언 위치도 그 옆).
2. `openTranslatePreview`(`:1068`): try 진입 직후, target에 내용이 있으면
   `targetEditorRef.current.getJSON()`을 `setTranslateOriginalDocJson(...)`으로 캡처.
   비어 있으면 `null` (첫 번역 = 오늘과 동일 동작).
3. `applyTranslatePreview`(`:1380`)를 `applyTranslateDoc(doc: TipTapDocJson)`으로 일반화
   (가드·스냅샷 로직 이동, `applyPolishDoc` 형태와 대칭).
   `applyTranslatePreview = () => translatePreviewDoc && applyTranslateDoc(translatePreviewDoc)`.
4. 번역 모달 인스턴스(`:2156-2171`)에 `originalDocJson={translateOriginalDocJson}`,
   `onApplySelective={applyTranslateDoc}` 전달.
5. 닫기/취소 경로(`onClose`, `handleTranslateCancel`)에서 `translateOriginalDocJson` 정리
   (`handlePolishClose` 대칭).
6. → verify: `npx tsc --noEmit && npm run test:run`. 수동(데브 빌드): 재번역 실행 →
   변경사항 탭에서 문단 선택 → 선택 적용이 선택분만 반영하는지, 첫 번역(빈 target)은
   기존과 동일한지.

## Phase 1. 이어서 번역

**동작**: target에 내용이 있을 때 뜨는 재번역 모달에 "이어서 번역 (남은 문단 n개)" 버튼을
추가한다. 정렬로 남은 원문 suffix를 자동 감지해 그 부분만 번역하고, 기존 번역문 **뒤에
이어 붙인 병합본**을 프리뷰로 보여준다. 적용은 Phase 0-2 경로 그대로.

### 1-1. 경계 판정 모듈 (신규, 순수 함수)

> **구현 시 교체됨 (2026-08-12).** 아래 LCS 기반 알고리즘은 이 기능의 대상 문서에서
> 동작하지 않는다는 것이 구현 중 실측으로 드러나, **prefix 시그니처 대조**로 바꿨다.
>
> - **왜 안 되는가**: `signature()`는 텍스트를 보지 않으므로(원문↔번역문은 언어가
>   달라 내용 비교가 무의미) 같은 타입 블록이 연속되면 정렬이 완전히 모호하고,
>   `alignUnits`의 백트래킹은 그 모호함을 **뒤쪽으로** 푼다. 원문 `A,B,C,D`에 `A,B`의
>   번역만 있는 문서에서 실제 ops는 `src-only(A), src-only(B), pair(C→…), pair(D→…)`다
>   (heading이 섞여도 같다 — heading만 앞에서 짝이 맞고 문단들은 뒤로 몰린다).
>   따라서 `k = max(pair의 source path[0])`는 늘 문서 끝이 되어, 부분 번역 문서에서
>   남은 구간이 **항상 0**으로 나온다. `ratio` 게이트는 방향이 더 나쁘다 — 덜
>   번역했을수록(=이어서 번역이 더 필요할수록) 비율이 낮아 차단된다.
> - **대신**: 이 기능의 실제 전제("번역문은 원문 prefix의 번역이다")를 직접 검증한다.
>   앞에서부터 M개(=번역문 콘텐츠 유닛 수)를 `signature()`로 대조하고, 하나라도
>   어긋나면 `misaligned-prefix`로 기능을 끈다. `k = sourceUnits[M-1].path[0]`.
> - **reason 집합 변경**: `no-pairs`/`low-ratio`/`degraded` → `misaligned-prefix` 하나로.
>   `empty-target`/`nothing-remaining`은 그대로. `CONTINUE_RATIO_MIN` 상수는 사라졌다.
> - `alignUnits`는 건드리지 않았다 — 정렬 뷰와 `findAlignedCounterpartUnits`에는
>   현재 동작이 맞고, 이번 플랜의 비목표다.
> - 남은 한계(문서화만): 전부 같은 타입인 문서에서 번역가가 중간 한 문단을
>   건너뛰었다면 시그니처만으로는 구분할 수 없어 경계가 한 칸 밀린다. 결과는 프리뷰
>   diff에 그대로 보이고 선택 적용으로 걸러낼 수 있어 문서 손상 경로는 아니다.
>   `middleGapUnitCount`는 "경계 블록 안에서 대응을 못 찾은 유닛 수"(예: 절반만
>   번역된 표의 나머지 셀)로 의미가 바뀌었다.

`src/editor/utils/continueTranslation.ts`:

```ts
export const CONTINUE_RATIO_MIN = 0.5;      // 조정 가능 상수로 노출
export const CONTINUE_CONTEXT_PAIRS = 3;    // 직전 번역 참고 개수
export const CONTINUE_CONTEXT_MAX_CHARS = 400; // retranslateSelection.ts:30 선례

export interface ContinuationPlan {
  remainingSourceDoc: TipTapDocJson;   // source.content.slice(k+1)로 만든 sub-doc
  remainingBlockCount: number;
  remainingUnitCount: number;          // path[0] > k 인 source-only 유닛 수
  middleGapUnitCount: number;          // path[0] <= k 인 source-only 유닛 수 (정보용)
  contextPairs: Array<{ source: string; target: string }>; // 마지막 N pair, 각 400자 컷
}
export type ContinuationPlanResult =
  | { ok: true; plan: ContinuationPlan }
  | { ok: false; reason: 'empty-target' | 'no-pairs' | 'degraded' | 'low-ratio' | 'nothing-remaining' };

export function buildContinuationPlan(
  sourceDocJson: TipTapDocJson, targetDocJson: TipTapDocJson,
): ContinuationPlanResult;
// 내부: planFromAlignResult(align: AlignResult, sourceDocJson)를 분리 export
// (degraded/low-ratio 게이트를 AlignResult 조작만으로 테스트하기 위함)
```

알고리즘:
1. `alignUnits(source, target)` 실행.
2. 게이트(순서대로): target 콘텐츠 유닛 0개 → `empty-target` / `degraded` → `degraded` /
   `pairedCount === 0` → `no-pairs` / `ratio < CONTINUE_RATIO_MIN` → `low-ratio`.
3. `k = max(op.source.path[0] for op in ops if op.kind === 'pair')`.
   **구조적 성질**: k가 pair의 최대 최상위 인덱스이므로, 인덱스 > k인 블록에는 pair가
   없다. 부분 번역된 표(내부에 pair 존재)는 인덱스 ≤ k가 되어 통째로 제외된다.
4. `path[0] > k`인 `source-only` 유닛이 없으면 → `nothing-remaining`.
5. `remainingSourceDoc = { type:'doc', content: source.content.slice(k+1) }`
   (비유닛 블록 — hr 등 — 도 슬라이스에 포함, 의도된 동작).
6. `contextPairs`: 마지막 `CONTINUE_CONTEXT_PAIRS`개 pair op의 `source.text`/`target.text`
   각 400자 절단.

**알려진 한계(문서화만, 수정 금지)**: ① 중간 구멍(k 이전의 source-only)은 범위에 넣지
않는다 — `middleGapUnitCount`로 사용자에게 알리고 정렬 뷰를 안내. ② 경계 부근의 비유닛
블록(hr 등)이 target 끝에 이미 있으면 중복될 수 있다 — 프리뷰에서 보이며, diff 선택
적용으로 제외 가능.

테스트 `continueTranslation.test.ts` (TipTap JSON 리터럴 픽스처):
- 정상 suffix: p0,p1 번역됨 + p2,p3 남음 → k=1, remaining 2블록.
- 전부 번역됨 → `nothing-remaining` / target 비어 있음 → `empty-target`.
- 부분 번역된 표: 표(인덱스 t) 내부 셀 일부만 pair → 표가 remaining에 포함 안 됨.
- 중간 구멍: p1이 source-only인데 p2가 pair → k=2, `middleGapUnitCount=1`(원문 유닛 수 기준).
- `planFromAlignResult`에 조작된 AlignResult로 `degraded`/`low-ratio` 게이트 확인.
- contextPairs 400자 절단.

→ verify: `npx vitest run src/editor/utils/continueTranslation.test.ts`

### 1-2. 병합 유틸 (신규)

`src/editor/utils/topLevelBlockSplice.ts` + 테스트 (공통 설계 원칙 참조; Phase 1은
`appendTopLevelBlocks`만 사용). 테스트: 블록 수, 원본 불변성, attrs(`translationUnitId`) 보존.

→ verify: `npx vitest run src/editor/utils/topLevelBlockSplice.test.ts`

### 1-3. 프롬프트 확장

`src/ai/translateDocument.ts`:
1. `StreamingTranslationParams`(`:479` 부근)에
   `continuation?: { contextPairs: Array<{ source: string; target: string }> }` 추가.
2. `buildTranslationSetup`(`:152`)에 같은 파라미터를 통과시키고, 존재하면 `systemLines`에
   섹션 추가 (`[사용자 추가 지시사항]` 블록 뒤):

```
[이어서 번역]
INPUT_DOCUMENT는 긴 문서의 뒷부분입니다. 앞부분은 이미 번역이 완료되었습니다.
아래 '직전 번역 참고'의 용어 선택과 문체를 그대로 이어가세요.
'직전 번역 참고'를 다시 번역하거나 출력에 포함하지 마세요. INPUT_DOCUMENT만 번역하세요.

[직전 번역 참고]
(원문) {pair.source}
(번역) {pair.target}
...
```

3. 출력 마커/파서/`restoreTranslationUnitIds`는 변경 없음.
4. 테스트: `translateDocument.test.ts`의 기존 페이로드 테스트 패턴을 따라 — continuation
   전달 시 system에 `[이어서 번역]`/참고 텍스트 포함, user의 INPUT_DOCUMENT에는 sub-doc
   마크다운만 포함되는 것을 단언. `/test-ai` 스킬로 dry-run 페이로드 확인 가능.

→ verify: `npx vitest run src/ai/translateDocument.test.ts`

### 1-4. UI 배선

`src/components/editor/EditorCanvasTipTap.tsx`:
1. `openContinueTranslatePreview(extraMessage?)` 추가 — `openTranslatePreview`(`:1068`)를
   복제·축약하지 말고, `openTranslatePreview`에 내부 옵션
   `{ continuationPlan?: ContinuationPlan }`을 추가하는 방식으로 공용화한다
   (언어 검증·컨텍스트 수집·abort/소유권 가드·finally 정리를 재사용하기 위함).
   continuation 모드에서 달라지는 것만 분기:
   - `sourceDocJson` → `plan.remainingSourceDoc`
   - 용어집 검색 텍스트 → remaining 마크다운 (`tipTapJsonToMarkdown(plan.remainingSourceDoc)`)
   - `translateWithStreaming`에 `continuation: { contextPairs }` 전달
   - **결과 병합**: 성공 시 `merged = appendTopLevelBlocks(targetDocJsonAtStart, doc)`,
     `setTranslatePreviewDoc(merged)`. `targetDocJsonAtStart`는 Phase 0-2에서 캡처한
     `translateOriginalDocJson`과 같은 시점 값(같은 getJSON 결과를 재사용).
   - requestMeta/리비전 가드는 기존 그대로 — **경계가 target 상태에 의존하므로 이 가드가
     이 기능의 정합성 핵심이다. 우회 금지.**
2. 재번역 모달(`:2100-2154`)에 버튼 추가: 모달 오픈 시(`retranslateModalOpen` true 전이)
   양쪽 에디터 `getJSON()`으로 `buildContinuationPlan` 계산해 state에 보관.
   - `ok:true` → "이어서 번역 (남은 문단 {remainingUnitCount}개)" 버튼 표시,
     `middleGapUnitCount > 0`이면 안내 문구 한 줄 ("중간에 대응 없는 문단 n개는 포함되지
     않습니다 — 정렬 뷰에서 확인").
   - `ok:false` → 버튼 숨김 (`nothing-remaining`) 또는 비활성+사유 툴팁 (그 외 reason).
   - 버튼 클릭 → `setRetranslateModalOpen(false); void openTranslatePreview(retranslateMessage, { continuationPlan: plan })`.
3. 스트리밍 탭에는 신규 번역분만 흐른다(병합 전) — 의도된 동작, 주석으로 명시.
4. i18n 키 (ko/en 양쪽): `editor.continueTranslate`, `editor.continueTranslateRemaining`,
   `editor.continueTranslateMiddleGap`, `editor.continueTranslateUnavailable.degraded`,
   `.lowRatio`, `.noPairs` 등. 자동 스냅샷 라벨은 기존 `history.autoSnapshotAfterTranslate` 재사용.

→ verify: `npx tsc --noEmit && npm run test:run`. 수동(데브 빌드):
  (a) 원문 6문단 중 3문단만 번역된 프로젝트 → 이어서 번역 → 프리뷰가 기존 3 + 신규 3 병합본,
  diff 탭에 신규분이 추가로 표시, 적용 후 기존 번역 무변경.
  (b) 요청 후 target을 수정하고 적용 → 리비전 가드로 중단되는지.
  (c) 전부 번역된 문서 → 버튼 미노출.

## Phase 2. 폴리시 범위 실행 (선택 구간만 다듬기)

**동작**: target 에디터에 비접힘 선택이 있는 상태로 폴리시를 열면, 지시사항 모달에
"선택 구간만 다듬기 (문단 n개)" 체크박스(기본 체크)가 나타난다. 실행 시 해당 최상위
블록 구간만 모델에 보내고, 결과를 그 구간에 치환한 병합본을 프리뷰한다.

1. **범위 해석 유틸** (신규 `src/editor/utils/blockRangeScope.ts` + 테스트):
   ```ts
   resolveTopLevelBlockRange(editor: Editor): { fromIndex; toIndex; unitCount } | null
   // selection 비접힘일 때: getTranslationUnitIdsAtRange(state.doc, from, to)
   // → collectTranslationUnits(getJSON())에서 해당 ID들의 path[0] min/max.
   // 유닛 0개(비유닛 블록만 선택)면 null.
   ```
   표 내부 선택 → 표 전체 구간이 됨(원칙 3). 테스트: 단일 문단, 걸친 다중 문단, 표 셀,
   접힌 선택 null.
2. `handlePolishClick`(`:1331`): 모달 열기 전에 `resolveTopLevelBlockRange` 결과를
   `polishScope` state로 저장 (null이면 스코프 UI 미노출). 모달 닫힘/실행 후 정리.
3. 폴리시 모달: 체크박스 렌더 + 해제 시 전체 실행. i18n 키 추가.
4. `openPolishPreview`(`:1222`)에 스코프 분기 (내부 옵션 파라미터, Phase 1과 같은 공용화 방식):
   - `subDoc = { type:'doc', content: target.content.slice(fromIndex, toIndex+1) }`
   - `polishTargetDocumentWithStreaming({ targetDocJson: subDoc, ... })` — 나머지 파라미터 동일.
     용어집 검색은 기존(전체 텍스트) 유지 — 결정 사항 §D3.
   - `polishOriginalDocJson`은 **전체 target** 유지 (diff 기준).
   - 성공 시 `merged = replaceTopLevelBlockRange(fullTargetAtStart, fromIndex, toIndex, polishedDoc)`,
     `setPolishPreviewDoc(merged)`.
   - 가드·선택 적용·스냅샷 경로 변경 없음 (병합본이 흘러가므로 그대로 성립).
5. → verify: `npx tsc --noEmit && npm run test:run`. 수동: 3문단 선택 폴리시 → diff에
   구간 밖 변경 0건, 구간 내 변경만 표시. 요청 후 편집 → 가드 중단. 표 셀 선택 → 표 전체가 대상.

## Phase 3. 검수 범위 실행 (선택 구간만 검수)

**동작**: target 패널에서 구간 선택 → 선택 툴바의 "이 구간만 검수" → 검수 패널이 열리며
해당 구간의 원문↔번역문 쌍만 검수. 이슈 목록·적용·하이라이트는 기존과 완전 동일.

1. **사전 검증 (필수, 코드 변경 전)**: `ReviewIssue.segmentGroupId` 소비처를 전수 확인해
   합성 groupId가 안전한지 판정한다.
   `grep -rn "segmentGroupId" src --include="*.ts" --include="*.tsx"` 중 **ReviewIssue에서
   유래한 값**을 `project.segments` 조회에 쓰는 곳이 있는지 본다. (조사 시점 결론:
   `reviewIssueOrder.ts`는 런 자체의 청크 세그먼트만 역인덱싱하고, `reviewApply.ts`는
   excerpt 기반 — 합성 ID 안전. 단 `oddeyesAppBridge.ts`/`projectStore.ts`의 사용처는
   comment 쪽인지 issue 쪽인지 구현 시 반드시 확인.) 안전하지 않으면 실제 세그먼트
   groupId를 재사용하는 것으로 폴백.

   > **전수 검증 결과 (2026-08-12): 합성 groupId 안전. 폴백 불필요.**
   > - `reviewIssueOrder.ts` — 그 런의 청크 세그먼트로만 역인덱싱. ✔
   > - `reviewApply.ts` / `ReviewHighlight.ts` — excerpt 텍스트 검색. 세그먼트 범위
   >   제한 경로(`findExcerptRange:114`, `reviewApply:467`)는 `hasSegmentGroupId(doc)`가
   >   참일 때만 작동하는데, **문서 노드에 `segmentGroupId` 속성을 다는 프로덕션 확장이
   >   없다**(그 attrs는 테스트 스키마에만 존재). 따라서 항상 비활성. ✔
   > - `projectStore.getBlocksBySegment` / `getSegment` — 호출부 0곳(죽은 접근자). ✔
   > - `oddeyesAppBridge.ts:259` — MCP로 **들어오는** 이슈에 값을 쓰는 쪽. 소비 아님. ✔
   > - `commentContext.ts` — 유일한 실질 상호작용. 코멘트의 segmentGroupId는 실제/추론
   >   값이라 합성 ID 화이트리스트를 걸면 코멘트가 전부 빠진다 → 계획 §3-5가 허용한
   >   대로 **스코프 런에서는 범위 한정을 생략**(전체 코멘트 주입)했다.
2. **스코프 청크 빌더** (신규, `src/ai/tools/reviewTool.ts`에 추가 + 테스트):
   ```ts
   buildScopedAlignedChunks(params: {
     sourceDocJson; targetDocJson; targetUnitIds: string[];
     maxCharsPerChunk?: number;  // 기본 DEFAULT_REVIEW_CHUNK_SIZE
   }): AlignedChunk[] | null    // null = 정렬 실패 (fail-closed)
   ```
   - `alignUnits(source, target)` ops에서 `target` 유닛이 `targetUnitIds`에 속한 `pair`만
     추출 (ID 우선, ID 부재 시 path 키 매칭 — `findAlignedCounterpartUnits`와 동일 기준).
   - 선택 유닛 중 pair를 못 찾은 것이 하나라도 있으면 `null` (fail-closed).
   - pair마다 `AlignedSegment { groupId: 'scoped-' + i, order: i, sourceText, targetText }`
     → 기존과 동일한 12,000자 로직으로 청크 분할.
   - 테스트: 정상 쌍, 일부 미대응 → null, 12k 초과 분할, 표 셀 유닛.
3. **스토어**: `reviewStore.pendingReviewRun`을
   `{ instruction: string; scope?: { targetUnitIds: string[]; label: string } }`로 확장
   (`reviewStore.ts:124,511`). 기존 호출부는 scope 없이 그대로.
4. **선택 툴바**: `SelectionInlineToolbar`(컴포넌트 파일 grep으로 확인)에 target 패널 전용
   "이 구간만 검수" 액션 추가 — `onRetranslateSelection`(`EditorCanvasTipTap.tsx:2212-2219`)과
   같은 조건부 prop 패턴. 핸들러: 선택 범위 → `getTranslationUnitIdsAtRange` → unitIds와
   라벨("문단 n개")로 `requestReviewRun` 호출 + 검수 패널 열기(기존 패널 열기 경로 재사용).
5. **ReviewPanel** (`handleRunReview`, `:217` / pendingReviewRun 소비 `:412`):
   scope가 있으면 `buildAlignedChunksAsync` 대신 `buildScopedAlignedChunks` 사용
   (source/target JSON은 프로젝트 blocks에서 기존 방식으로 확보). `null`이면 토스트
   "원문 대응을 찾지 못해 범위 검수를 할 수 없습니다. 전체 검수를 사용해주세요." 후 중단.
   패널 헤더에 범위 라벨 칩 + 해제 버튼(해제 시 전체 검수로 재실행 아님 — 그냥 칩 제거).
   나머지 루프(언어 감지, 코멘트 직렬화 `chunkGroupIds` 한정, 이슈 파싱/정렬)는 무변경.
   **주의**: 코멘트 직렬화가 `chunkGroupIds`로 세그먼트 groupId를 참조한다면(`:315-322`)
   합성 groupId와의 상호작용을 확인하고, 스코프 런에서는 코멘트 범위 한정을 생략(전체
   target 코멘트 주입)하는 쪽으로 단순화해도 된다.
6. i18n 키 (ko/en): 툴바 액션, 범위 칩, 실패 토스트.
7. → verify: `npx vitest run src/ai/tools/reviewTool.test.ts src/stores/reviewStore.test.ts`
   (기존 테스트 파일 위치 확인 후), `npx tsc --noEmit && npm run test:run`.
   수동: 2문단 선택 검수 → 이슈가 해당 구간에서만 나오고 적용·하이라이트 정상.

---

## 최종 검증

- 전체: `npm run test:ci:local` (typecheck + unit + web e2e + cargo test).
- E2E 자동화 시나리오 추가는 별도 요청 시에만 (`/e2e-scenario 이어서 번역 흐름` 등).
- 수동 확인은 데브 빌드(`npm run tauri:dev`) 기준. 설치본 교체는 명시 요청 시에만.

## 결정 사항 (기본값 채택, 이견 시 여기만 바꾸면 됨)

- **D1 진입점**: 이어서 번역 = 재번역 모달 내 버튼 (target에 내용이 있을 때만 뜨는
  모달이므로 노출 조건이 정확히 일치). 별도 툴바 버튼은 만들지 않는다.
- **D2 게이트 상수**: `ratio ≥ 0.5`, 직전 참고 3쌍, 유닛당 400자. 모두 named const로 노출.
- **D3 폴리시 범위의 용어집 검색**: 기존(전체 텍스트) 유지 — 절감 핵심은 출력 토큰이고,
  검색 축소는 품질 리스크 대비 이득이 작다.
- **D4 검수 범위 진입점**: target 패널 선택 툴바만. source 쪽 진입은 후속.
- **D5 중간 구멍**: 이어서 번역은 suffix만 담당. 중간 구멍은 알림만 하고 건드리지 않는다.
- **D6 상태 비영속**: 이번 플랜의 범위/스코프는 전부 휘발성(요청 단위). 영속 잠금은 옵션 C.

## 위험과 격리

| 위험 | 격리 장치 |
|---|---|
| 경계 오판(정렬 어긋남) | degraded/ratio/no-pairs 게이트로 사전 차단, 통과해도 append+프리뷰라 손상 없음 |
| 요청 후 사용자 편집 | 기존 L2 리비전 가드가 병합 기준 스냅샷 유효성 보장 (우회 금지) |
| 모델이 참고 문맥을 재번역 | 프롬프트 금지 지시 + 프리뷰 diff에서 즉시 노출, 적용 전 차단 가능 |
| 합성 groupId 부작용 | Phase 3-1 전수 검증 선행, 불안하면 실제 groupId 폴백 |
| 부분 병합 마크 유실 | 기존 docBlockDiff 한계 그대로 — 새 회귀 아님 (docs/polish-diff-whitespace-bug.md 참조) |
