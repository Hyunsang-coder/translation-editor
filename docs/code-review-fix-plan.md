# 코드 리뷰 수정 계획 (2026-07-03)

> 대상: `git diff @{upstream}...HEAD` 범위(v2.6.x 검수/폴리싱/선택적용/채팅스크롤/모델설정 변경) 코드 리뷰에서 확정된 발견 사항.
> 멀티에이전트 리뷰(finder 4 + verifier 19+3)로 발견·적대적 검증 완료. 각 항목은 **진단 → 수정안 → 검증 기준** 순.
> 구현 시 준수: Surgical > Sweeping (여기 명시된 변경만), 기존 스타일 유지, 완료 전 `npx tsc --noEmit` + `npm run test:run` (+Rust 변경 시 `cargo test`).

## 우선순위 요약

| # | 심각도 | 파일 | 요약 |
|---|--------|------|------|
| F1 | P0 손상 | `src/components/review/reviewApply.ts:306` | fuzzy 폴백이 segmentGroupId 무시 → 다른 세그먼트 문장 교체 |
| F2 | P0 손상 | `src/components/review/reviewApply.ts:102` | segmentGroupId 없으면 첫 매치 무조건 교체 (다중 매치 가드 소실) |
| F3 | P0 손상 | `src/editor/extensions/SearchHighlight.ts:64` | 블록 경계 넘는 매치를 replaceWith → 문단 병합 |
| F4 | P0 손상 | `src/components/editor/TranslatePreviewModal.tsx:221` | 전체 선택 Apply도 병합 경로 → 마크/타입-only 변경 유실 |
| F5 | P0 손상 | `src/utils/docBlockDiff.ts:260` | partial 병합 시 rebuildLeaf가 중첩 리스트/구조 파괴 |
| F6 | P0 손상 | `src/utils/normalizeForSearch.ts:109` 외 | stripWrappingQuotes가 실제 콘텐츠 따옴표 제거 + 불균형 다중 인용 손상 |
| F7 | P1 기능 no-op | `src/ai/review/runReview.ts:94` + Rust | Tauri 경로에 thinking/effort 미전달 → 검수 high effort가 실제 앱에서 무효 |
| F8 | P1 런타임 400 | `src/ai/backendCompletion.ts:70` | Sonnet 5 temperature 가드 누락 → Anthropic 400 |
| F9 | P2 UX | `src/components/chat/useChatScroll.ts:60` | 프로그램적 smooth 스크롤이 stick-to-bottom을 스스로 해제 |
| F10 | P2 UX | `useChatScroll.ts:40` + ChatContent | 위로 스크롤 중 내 메시지 전송 시 스크롤 안 됨 |
| F11 | P3 진단성 | `src/components/review/ReviewPanel.tsx:349` | catch가 모든 예외를 'not found' 토스트로 표시 |
| F12 | P3 위생 | `src/components/editor/EditorCanvasTipTap.tsx` | polish 스냅샷 상태 미정리 (correctness 아님, 선택) |
| F13 | P1 품질저하 | `src/ai/review/runReview.ts:35` 등 | thinking 토큰이 max_tokens를 잠식 → 검수 결과 무음 truncation (**지금도 발생 가능**) |

**반박되어 제외된 후보** (수정 불필요):
- "선택 적용이 스트리밍 중 사용자 편집을 되돌린다" — **REFUTED.** 스냅샷은 모달 open과 같은 동기 tick에 캡처되고(`EditorCanvasTipTap.tsx:571-580`, 첫 await는 590), 모달(`closeOnOverlay=false`, fixed inset-0, focus trap)이 열려있는 동안 Target 편집이 불가능. 재열기 경로도 항상 재스냅샷.
- "stripWrappingQuotes가 짝 안 맞는 따옴표(예: `「Hello” mixed`)를 제거" — **REFUTED.** 같은 pair의 open/close를 모두 요구하므로 미스매치는 통과. (단, 불균형 다중 인용은 F6에서 확정.)

---

## F1. fuzzy 폴백이 segmentGroupId를 무시 (reviewApply.ts:306)

### 진단
- `resolveSuggestionRange`의 exact 경로는 `findExcerptRange(doc, targetExcerpt, segmentGroupId)`(:301)로 세그먼트를 제한하지만, 폴백 `findBestSentenceMatch(doc, targetExcerpt)`(:306)는 **시그니처에 세그먼트 파라미터 자체가 없고** `doc.descendants`로 문서 전체를 스캔해 Dice 유사도 ≥0.6(`SENTENCE_SIMILARITY_THRESHOLD`, :176) 최고 문장을 반환한다.
- 게임 문서처럼 근사-중복 문장이 많으면(예: "Press [F] to open the door/chest") 사용자가 대상 문장을 수정해 exact가 실패한 순간, **다른 세그먼트의 유사 문장**이 `tr.replaceWith`(:334)로 즉시 교체된다. 미리보기 없음, 성공 토스트 후 이슈 삭제(`ReviewPanel.tsx:356-362`).

### 수정안
1. `findBestSentenceMatch`에 선택적 범위 파라미터 추가:
   ```ts
   export function findBestSentenceMatch(
     doc: ProseMirrorNode,
     rawExcerpt: string | undefined,
     segmentRange?: { from: number; to: number } | null,
   ): SentenceMatch | null {
   ```
   `doc.descendants` 콜백 안에서 textblock 처리 전에 범위 밖 블록을 건너뜀:
   ```ts
   if (!node.isTextblock) return undefined;
   if (segmentRange && (pos < segmentRange.from || pos + node.nodeSize > segmentRange.to)) {
     return false; // 범위 밖 textblock은 문장 후보에서 제외
   }
   ```
   (`findSegmentRange`가 블록 노드 경계 기준이므로 "블록 전체가 범위 안" 판정으로 충분.)
2. `resolveSuggestionRange`(:295)에서 exact 실패 후 세그먼트 범위를 계산해 전달 — exact 경로(`findExcerptRange` 내부 :88-93)와 **동일한 가드** 적용:
   ```ts
   const normalizedId = normalizeSegmentGroupId(segmentGroupId);
   const segmentRange = normalizedId ? findSegmentRange(doc, normalizedId) : null;
   if (segmentGroupId && hasSegmentGroupId(doc) && !segmentRange) return null;
   const sentence = findBestSentenceMatch(doc, targetExcerpt, segmentRange);
   ```
3. **segmentGroupId가 없을 때(segmentRange=null) fuzzy 모호성 가드**: 문서 전체 스캔에서 threshold(0.6) 이상 후보가 **2개 이상이면 null 반환** (best 하나만 있을 때만 fuzzy 허용). `findBestSentenceMatch` 안에서 `let qualifying = 0;` 카운터로 구현하고, `segmentRange`가 null일 때만 이 가드를 적용한다(세그먼트로 제한된 경우는 범위가 좁으므로 기존처럼 best 반환).
   - 근거: 후보가 여럿인데 하나를 고르는 것 자체가 이 버그의 본질. 가드에 걸리면 `applySuggestionToEditor`가 'not-found'를 반환하고 기존 UX(토스트 + "복사" 수동 처리)로 안전하게 떨어진다.

### 검증
- `src/components/review/reviewApply.test.ts`에 추가:
  - 두 세그먼트에 유사 문장(Dice ≥0.6)이 각각 있고, 이슈의 segmentGroupId가 B 세그먼트일 때 → fuzzy 매치가 **B 세그먼트 안**에서 잡히는지 (from/to가 B 블록 범위 내).
  - segmentGroupId가 있는데 해당 세그먼트가 문서에 없으면 → null (exact 경로와 동일).
  - segmentGroupId 없음 + threshold 이상 후보 2개 → null. 후보 1개 → 기존처럼 매치.
- 기존 fuzzy 테스트가 모두 통과해야 함 (단일 후보 케이스는 동작 불변).

---

## F2. segmentGroupId 부재 시 첫 매치 무조건 교체 (reviewApply.ts:102)

### 진단
- `findExcerptRange`에서 segmentGroupId가 없으면 유일한 가드 :91(`if (segmentGroupId && ...)`)이 발화하지 않고, `findNormalizedTextRange`(:121)가 문서 전체에서 **첫 번째** 유효 매치를 반환한다(:156-158). 다중 매치 검사 없음.
- 리팩터링 전의 `filterMatchesBySegment`(:35-44, 현재는 하이라이트 쪽에서만 사용)는 `hasSegmentGroups && matches.length > 1`이면 의도적으로 `[]`를 반환했다 — 이 모호성 가드가 apply 경로에서 소실됨.
- '확인' 같은 짧은 excerpt가 10곳에 있으면 엉뚱한 첫 occurrence가 수정되고 이슈는 'applied'로 삭제됨. exact 경로에는 `MIN_EXCERPT_TOKENS` 같은 최소 길이 가드도 없음.

### 수정안
`findNormalizedTextRange`가 매치 개수를 인지하도록 확장 (기존 호출부 호환 유지):
```ts
/** 정규화된 검색 텍스트의 유효 매치를 최대 limit개 수집 */
function findNormalizedTextRanges(
  searchText: string,
  segmentRange: { from: number; to: number } | null,
  ctx: ExcerptSearchContext,
  limit: number,
): Array<{ from: number; to: number }> { /* 기존 while 루프에서 return 대신 push, results.length >= limit면 중단 */ }
```
`findExcerptRange`(:102-106)의 루프를:
```ts
for (const searchText of candidates) {
  if (searchText.length === 0) continue;
  const ranges = findNormalizedTextRanges(searchText, segmentRange, context, 2);
  if (ranges.length === 1) return ranges[0]!;
  if (ranges.length > 1) {
    // 세그먼트로 좁혀지지 않은 다중 매치는 모호 → 교체 포기 (구 filterMatchesBySegment 시맨틱 복원)
    if (!segmentRange) return null;
    return ranges[0]!; // 세그먼트 내 다중 매치는 기존대로 첫 매치 (범위가 이미 좁음)
  }
}
return null;
```
**정책 결정 사항**: 구 코드는 `hasSegmentGroups`가 true일 때만 가드했지만, 위 수정은 **세그먼트 미확정 다중 매치를 항상 거부**한다(비세그먼트 문서 포함). 잘못된 위치의 무음 교체가 not-found보다 나쁘다는 판단. 원래 시맨틱을 정확히 복원하려면 `if (!segmentRange && context.hasSegmentGroups) return null;`로 좁혀도 된다 — 구현자는 전자(권장)로 진행하되 커밋 메시지에 동작 변경을 명시할 것.

### 주의
- `findExcerptRange`는 ReviewHighlight(하이라이트 데코레이션)와 공용이다(`.claude/rules/review.md`). 하이라이트 쪽은 "첫 매치 하이라이트"가 무해하지만, 이 수정으로 다중 매치 이슈는 하이라이트도 사라진다. 이는 **의도된 동작**(모호한 이슈는 위치 특정 불가)이며 구 filterMatchesBySegment 시맨틱과 일치. 하이라이트 유지가 요구되면 `findExcerptRange`에 `opts?: { allowAmbiguous?: boolean }`를 추가해 하이라이트 호출부만 true로.

### 검증
- 테스트 추가: 동일 excerpt가 2개 블록에 존재 + segmentGroupId 없음 → `findExcerptRange` null, `applySuggestionToEditor` 'not-found', 문서 불변.
- 동일 excerpt 2개 + 유효한 segmentGroupId → 해당 세그먼트 내 매치 반환(기존 테스트 유지).
- 단일 매치 문서에서 기존 테스트 전부 통과.

---

## F3. 블록 경계를 넘는 replace가 문단을 병합 (SearchHighlight.ts:64)

### 진단
- `buildTextWithPositions`가 textblock 경계에 `\n`을 삽입(:64-67)하면서 "공백 포함 검색어는 두 블록에 걸쳐 매치 불가"라는 기존 불변식이 사라졌다. 이 변경 자체는 의도된 수정(여러 블록에 걸친 excerpt 매칭 + 'problems.Can' 거짓 인접 방지)이고 테스트(`reviewApply.test.ts:290-295`)도 있다.
- 문제는 **교체 연산**: `applySuggestionToEditor`(reviewApply.ts:334)와 Cmd+H의 `replaceMatch`/`replaceAll`(SearchHighlight.ts의 `tr.replaceWith(match.from, match.to, editor.schema.text(replacement))`)이 경계를 걸친 범위를 단일 텍스트 노드로 교체하면 ProseMirror가 **두 문단을 하나로 병합**한다. 문단/리스트 구조 파괴.

### 수정안
매칭(하이라이트)은 유지하고, **교체만** 블록 경계를 넘지 않도록 가드:
1. `SearchHighlight.ts`에 헬퍼 export:
   ```ts
   /** 범위가 textblock 경계를 넘는지 (교체 시 문단 병합 방지용) */
   export function rangeCrossesBlockBoundary(doc: ProseMirrorNode, from: number, to: number): boolean {
     const $from = doc.resolve(from);
     const $to = doc.resolve(Math.max(from, to - 1));
     return !$from.sameParent($to);
   }
   ```
   (`to`는 exclusive이므로 마지막 문자 위치 `to-1`로 resolve.)
2. `applySuggestionToEditor`(reviewApply.ts:321): `resolveSuggestionRange` 성공 후 dispatch 전에:
   ```ts
   if (rangeCrossesBlockBoundary(state.doc, resolved.from, resolved.to)) return 'not-found';
   ```
   fuzzy 경로는 `findBestSentenceMatch`가 블록 내부로 한정(주석 :232)이라 이 가드에 걸리지 않음 — exact 경로 전용 안전망.
3. Cmd+H `replaceMatch` / `replaceAll`: 교체 직전 같은 가드로 해당 매치를 **건너뜀**(replaceAll은 나머지 매치 계속 진행). 두 함수의 `tr.replaceWith(...editor.schema.text(replacement))` 호출부에 각각 적용.
4. 하이라이트(SearchHighlight 데코레이션, ReviewHighlight)는 변경하지 않는다 — cross-block 하이라이트는 유용하고 무해.

### 트레이드오프 (명시)
- 여러 블록에 걸친 excerpt를 가진 이슈는 하이라이트는 되지만 "적용"은 not-found → 복사 버튼 수동 처리. 이 변경 이전에는 아예 매치가 안 됐으므로(항상 not-found) **회귀가 아니라 부분 개선**이다. 구조를 보존하는 cross-block 교체(문단별 분할 교체)는 replacement 텍스트를 블록별로 나눌 기준이 없어 사변적 — 구현하지 말 것.

### 검증
- 테스트: 문단 A 끝 + 문단 B 시작에 걸친 excerpt → `findExcerptRange`는 non-null(기존 테스트 유지), `applySuggestionToEditor`는 'not-found', 문서 불변.
- Cmd+H: cross-block 매치 + within-block 매치가 공존하는 문서에서 replaceAll → within-block만 교체, 문단 수 불변.

---

## F4. 전체 선택 Apply가 마크/공백/노드타입-only 변경을 유실 (TranslatePreviewModal.tsx:221)

### 진단
- `handleApply`(:221-236)는 `selectiveActive`(= `changeUnits.length > 0`, :199)면 전체 선택 상태에서도 `mergeDocBySelection`을 탄다.
- diff 키(`docBlockDiff.ts:76-78 blockKey`)는 공백 정규화된 plain text만 비교(`extractBlockText`는 마크·attrs 무시)하므로, **텍스트가 같고 마크/공백/노드타입(paragraph→heading)만 다른 블록은 'keep'으로 분류**되어 unit조차 생성되지 않는다. `mergeNodes`의 keep 분기(:273-274)는 원본 블록을 넣으므로 해당 변경이 조용히 탈락.
- 이전 동작(`onApply()` = AI 결과 docJson 그대로 적용) 대비 명백한 회귀.

### 수정안
**전체 선택이면 full apply로 우회** — 한 줄 조건 변경:
```ts
if (
  selectiveActive && diffPlan && originalDocJson && onApplySelective &&
  selectedCount < changeUnits.length          // ← 추가: 부분 선택일 때만 병합
) {
  const merged = mergeDocBySelection(originalDocJson, diffPlan, selectedUnitIds);
  await onApplySelective(merged);
} else {
  await onApply();
}
```
- `changeUnits.length === 0`(텍스트 변화 없음, 구조만 변화)인 경우는 이미 `selectiveActive=false`로 `onApply()`를 타므로 이 수정과 일관된다.
- 부분 선택 시 마크-only 블록이 'keep'으로 남는 것은 diff 표현력의 문서화된 한계로 유지(사용자가 명시적으로 부분 선택). 단, `docBlockDiff.ts:75` 주석에 "마크/attrs-only 변경은 unit이 되지 않아 부분 선택 시 원본이 유지된다"를 한 줄 추가할 것.

**선택 개선(별도 커밋, 필수 아님)**: `blockKey`에 노드 타입을 포함(`${node.type ?? ''} ${normalizedText}`)해 paragraph↔heading 변환을 swap unit으로 노출. `buildNodes`(:180-183)의 map이 텍스트 대신 노드를 받아야 하므로 시그니처 변경 필요. 텍스트가 동일한 unit이 UI에 어색하게 보일 수 있어(원문=제안 동일 텍스트) `SelectiveDiffList` 표시 검토가 함께 필요 — 범위가 커지므로 기본 수정에서 제외.

### 검증
- 테스트(`TranslatePreviewModal` 또는 통합 수준): 원본 대비 폴리싱 결과가 (a) 한 문장 텍스트 변경 + (b) 다른 블록 볼드 추가일 때, 전체 선택 Apply → `onApply()` 호출됨(= AI docJson 그대로). 부분 선택(하나 해제) → `onApplySelective` 호출.
- `docBlockDiff.test.ts`(있다면)에 mark-only 블록이 keep으로 분류됨을 문서화하는 테스트(현 동작 고정).

---

## F5. partial 병합 시 rebuildLeaf가 중첩 구조 파괴 (docBlockDiff.ts:260)

### 진단
- `listItem`이 `SENTENCE_REFINABLE_TYPES`(:87)에 포함 → 1:1 pair된 listItem이 `buildSentenceParts`로 문장 세분화된다. 이때 `extractBlockText`(:53-73)는 중첩 블록을 `\n`으로 join한 **평탄화 텍스트**를 만든다.
- 부분 선택 시 `mergeNodes`의 else 분기(:286-297)가 `rebuildLeaf`(:260-266)를 호출하는데, 결과는 `{ ...original, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }` — **중첩 bulletList/다중 문단/hardBreak가 전부 소실**되고 `\n`이 리터럴 문자로 남는다. 마크도 전체 소실(주석 :259가 인정하는 것 이상으로, 사용자가 선택하지 않은 문장의 마크까지).

### 수정안
문장 세분화(pair)를 **평탄한 블록으로 제한** — 평탄하지 않으면 통째 swap unit으로 강등:
1. `docBlockDiff.ts`에 헬퍼 추가:
   ```ts
   /** 문장 단위 부분 병합이 안전한 평탄 블록: 인라인 text 노드만 포함 (listItem은 단일 paragraph 한정) */
   function isFlatTextBlock(node: TipTapNodeJson): boolean {
     if (node.type === 'listItem') {
       const content = node.content ?? [];
       return content.length === 1 && content[0]!.type === 'paragraph' && isFlatTextBlock(content[0]!);
     }
     return (node.content ?? []).every(
       (child) => child.type === 'text' || child.text !== undefined,
     );
   }
   ```
   (hardBreak, 인라인 이미지 등 비텍스트 인라인 노드가 있으면 false → swap. 빈 content는 true여도 무해.)
2. `pairBlocks`(:163)의 조건 강화:
   ```ts
   if (
     SENTENCE_REFINABLE_TYPES.has(originalType) && SENTENCE_REFINABLE_TYPES.has(polishedType) &&
     isFlatTextBlock(original) && isFlatTextBlock(polished)
   ) { ... pair ... }
   ```
   조건 불충족 시 아래 기존 swap 분기(:169-170)로 자연 낙하 — 블록 전체가 하나의 unit이 되어 선택 시 polished 통째, 미선택 시 원본 통째. **구조 파괴 불가능.**
3. `rebuildLeaf`는 이제 평탄 블록만 받으므로 변경 불필요. `extractBlockText`의 `\n` join도 diff 키 용도로는 그대로 유지.
4. 남는 한계(명시적 문서화): 평탄한 paragraph 안에서 부분 선택 시 **선택하지 않은 문장의 인라인 마크**는 여전히 유실된다(:259 주석 그대로). 이는 equal 파트를 plain text로 재조립하는 설계의 한계로, 이번 수정 범위 밖. 주석에 "부분 병합은 블록 전체의 marks를 유실함(equal 문장 포함)"을 명확히.

### 검증
- 테스트 추가(`docBlockDiff` 단위):
  - listItem(paragraph + 중첩 bulletList) 쌍에서 문장 2개 변경 → **unit이 1개(swap)** 로 생성되고, 선택/미선택 각각 polished/원본 통째 반영. 병합 결과에 `\n` 리터럴이 포함된 text 노드가 없어야 함.
  - hardBreak 포함 paragraph → swap 강등 확인.
  - 평탄 paragraph 문장 2개 중 1개 선택 → 기존 부분 병합 동작 유지(회귀 방지).

---

## F6. stripWrappingQuotes가 실제 콘텐츠 따옴표를 파괴 (normalizeForSearch.ts:109, parseReviewResult.ts:140/147/183, reviewApply.ts:167)

### 진단 (검증 완료, 2건 합산)
1. **전체 인용 대사 손상**: 대상 문장 전체가 인용문(`「도망쳐, 어서!」`, `“Run, now!”`)이면 AI-wrapping과 구분 없이 벗겨진다. 파싱(:183 suggestion, :147 targetExcerpt, :140 sourceExcerpt)에서 1회 + `deriveReplacementText`(reviewApply.ts:167-169)에서 또 1회. 적용된 문장은 주변 대사와 달리 따옴표를 잃는다.
2. **불균형 다중 인용 손상** (재검증에서 추가 확정): 함수가 첫/끝 문자만 보고 pair가 실제로 마지막에서 닫히는지 검사하지 않으므로,
   `'"Stop," he said. "It's over."'` → `'Stop," he said. "It's over.'` — 독립된 두 인용의 바깥 따옴표가 삭제되어 **불균형 텍스트**가 된다. `«Bonjour» dit-il. «Adieu»`도 동일. (미스매치 pair는 통과 — 문제없음 확인.)
3. 이중 strip 복합: AI가 정당하게 감싼 경우에도 parse에서 한 겹, apply에서 또 한 겹 벗겨져 `“"Stop," he said.”` → `Stop," he said.`.

### 수정안 (3단계, 모두 적용)
**(a) parse 시점 strip 제거** — `parseReviewResult.ts`:
- :140, :147, :183의 `stripWrappingQuotes(...)` 호출을 제거하고 `?.trim() || ''`만 유지. (regex의 옵셔널 직선따옴표 `"?(.*?)"?`는 기존 동작이므로 유지.)
- 근거: excerpt 매칭은 `findExcerptRange`가 raw/stripped 두 후보를 이미 시도(:96-100)하므로 parse-time strip은 매칭에 불필요하고, 표시·복사(`handleCopySuggestion`)·저장값을 원본대로 보존하는 것이 옳다. `findBestSentenceMatch`도 내부에서 strip 후 토큰화(:240)하므로 영향 없음.
- 주의: 기존 파싱 테스트(`parseReviewResult.test.ts`)에서 strip을 기대하는 케이스는 기대값을 raw로 갱신.

**(b) apply 시점 strip을 문서 기준 조건부로** — `reviewApply.ts`:
- `normalizeForSearch.ts`에 pair 판별 헬퍼 export:
  ```ts
  /** 텍스트를 감싸는 따옴표 pair 반환 (없으면 null) */
  export function getWrappingQuotePair(text: string): [string, string] | null;
  ```
  (기존 WRAPPING_QUOTE_PAIRS 루프 재사용.)
- `applySuggestionToEditor` 재구성: strip 없는 기본 replacement로 범위를 먼저 해석한 뒤, **매칭된 문서 텍스트가 같은 pair로 감싸여 있지 않을 때만** strip:
  ```ts
  const baseReplacement = stripMarkdownInline(stripHtml(issue.suggestedFix)).trim();
  if (!issue.targetExcerpt || !baseReplacement) return 'missing-data';
  const resolved = resolveSuggestionRange(state.doc, issue.targetExcerpt, issue.segmentGroupId, baseReplacement);
  if (!resolved) return 'not-found';
  const matchedText = state.doc.textBetween(resolved.from, resolved.to, '\n');
  const pair = getWrappingQuotePair(baseReplacement);
  const docWrapped = pair !== null && getWrappingQuotePair(matchedText) !== null;
  const replacement = pair && !docWrapped ? stripWrappingQuotes(baseReplacement) : baseReplacement;
  ```
  `deriveReplacementText`는 위 로직으로 대체하거나 `(suggestedFix, matchedText?)` 시그니처로 확장 — 다른 호출부가 있으면 grep 후 정리(`grep -rn deriveReplacementText src/`).
  - `REPLACEMENT_MIN_LENGTH_RATIO` 비교는 baseReplacement 기준이 되며 따옴표 2자 차이는 0.4 비율 판정에 무의미.
- 문서가 감싸져 있으면(= 인용 대사) suggestion의 따옴표는 콘텐츠 → 유지. 문서가 안 감싸져 있는데 suggestion만 감싸져 있으면 AI 아티팩트 → strip. 이 규칙이 F6-1을 직접 해결.

**(c) stripWrappingQuotes 자체를 균형 인지형으로** (방어선) — `normalizeForSearch.ts:113-118`:
```ts
for (const [open, close] of WRAPPING_QUOTE_PAIRS) {
  if (!trimmed.startsWith(open) || !trimmed.endsWith(close)) continue;
  const inner = trimmed.slice(open.length, trimmed.length - close.length);
  if (open === close) {
    if (inner.includes(open)) return trimmed; // "a" b "c" — 단일 wrap 아님
  } else {
    let depth = 1;
    for (const ch of inner) {
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) return trimmed; // 중간에 닫힘 — wrap 아님
    }
  }
  return inner.trim();
}
```

### 검증
- `normalizeForSearch.test.ts`: 기존 `「안녕 세상」→안녕 세상` 유지(단일 wrap). 추가: `"Stop," he said. "It's over."` → 불변, `«Bonjour» dit-il. «Adieu»` → 불변, `"a"b"` → 불변.
- `parseReviewResult.test.ts`: `**Suggestion**: “도망쳐!”` → suggestedFix에 따옴표 보존.
- `reviewApply.test.ts`: (i) 문서 대상이 `「...」`로 감싸진 문장 + suggestion도 `「...」` → 적용 결과에 따옴표 보존. (ii) 문서 대상 비인용 + suggestion `"..."` wrap → strip되어 적용. (iii) 기존 따옴표 관용 매칭 테스트 전부 통과.

---

## F7. 검수 high effort가 데스크톱 앱에서 no-op (runReview.ts:94 + Rust ai.rs) — 최신 커밋 기능

### 진단
- `runReview`는 `isTauriRuntime() && provider !== 'mock'`이면 `streamWithTauriAiBackend`로 short-circuit(:94-103). 이 경로의 페이로드(`backendCompletion.ts:182-191`)는 `{streamId, provider, apiKey, model, maxTokens, messages, temperature?}`뿐 — **thinking/reasoning effort가 전달되지 않는다.**
- reasoning/thinking 옵션을 싣는 `createChatModel(..., { useFor: 'review' })`(:109)은 non-Tauri 또는 네트워크 오류 폴백에서만 도달. 즉 `eec130a`(검수 effort high) + `bf71b94`(adaptive thinking 명시)는 **실제 앱에서 무효**. translateDocument/polishDocument의 adaptive thinking도 동일 구조라면 동일 문제(구현 시 `grep -rn streamWithTauriAiBackend src/ai/`로 확인).
- Rust(`src-tauri/src/commands/ai.rs`)는 Anthropic `/v1/messages`, OpenAI `chat/completions` body를 직접 조립하며 현재 `max_tokens`/`temperature`만 지원(:104-115, :173-185, :327-338, :425-438).

### 사전 확인된 API 사실 (claude-api 레퍼런스 기준)
- Anthropic adaptive thinking: body에 `"thinking": {"type": "adaptive"}`, effort는 `"output_config": {"effort": "high"}` (top-level 아님, output_config 내부).
- **thinking 토큰은 `max_tokens`에 합산**된다(하드 리밋). → F7 수정으로 thinking이 실제 전달되기 시작하면 REVIEW_MAX_TOKENS=4096은 truncation 위험 → 함께 상향 필요(아래).
- Anthropic 스트리밍에서 thinking 델타는 `content_block_delta`의 `delta.thinking` 필드(`thinking_delta`)로 온다 → 기존 Rust 파서는 `/delta/text`만 수집(:383)하므로 **thinking 델타가 응답 텍스트에 섞이지 않음 (수정 불필요, 확인됨)**. 비스트리밍 파서도 `"text"` 필드만 collect(:141-148)라 안전.
- OpenAI chat completions: gpt-5 계열은 `"reasoning_effort": "high"` (body top-level).

### 수정안
**아키텍처 원칙: 모델별 호출 옵션 가드를 한 곳으로 모은다** — 현재 `client.ts`(LangChain)와 `backendCompletion.ts`(Tauri)가 같은 가드를 중복 유지하다 어긋난 것이 F7/F8의 공통 원인.

1. **신규 모듈 `src/ai/modelCallOptions.ts`**:
   ```ts
   export interface ModelCallOptions {
     temperature?: number;          // 모델이 거부하면 undefined
     adaptiveThinking?: boolean;    // Anthropic 전용
     effort?: 'high';               // Anthropic output_config.effort / OpenAI reasoning_effort
   }
   export function resolveModelCallOptions(cfg: AiConfig, useFor: 'translation' | 'chat' | 'review'): ModelCallOptions
   ```
   구현은 현재 `client.ts:35-58`의 로직을 이동: `isOpus47Plus`/`isSonnet5` 정규식, temperature 거부 규칙(gpt-5 포함), thinking/effort 규칙(Opus 4.7+: adaptive+high 항상, Sonnet 5: adaptive 명시 + review만 high, OpenAI: review만 reasoning high).
2. **`client.ts`**: 위 함수를 사용해 ChatAnthropic/ChatOpenAI 옵션 구성(동작 불변 리팩터링 — 기존 `client.test.ts`가 그대로 통과해야 함).
3. **`backendCompletion.ts`**:
   - `getTemperatureOption` 삭제하고 `resolveModelCallOptions` 사용.
   - `streamWithTauriAiBackend`/`completeWithTauriAiBackend` params에 `useFor?: 'translation' | 'chat' | 'review'` 추가(기본 'translation' — 기존 호출부 동작 유지), aiStream/aiComplete args에 `adaptiveThinking`/`effort` 전달.
4. **`src/tauri/ai.ts`**: `AiCompleteArgs`에 `adaptiveThinking?: boolean; effort?: string;` 추가.
5. **Rust `src-tauri/src/commands/ai.rs`**:
   - `AiCompleteArgs`/`AiStreamArgs`(rename_all=camelCase)에:
     ```rust
     pub adaptive_thinking: Option<bool>,
     pub effort: Option<String>,
     ```
   - `complete_anthropic`(:104-115)과 `stream_anthropic`(:327-338) body 조립에:
     ```rust
     if args.adaptive_thinking == Some(true) {
         body["thinking"] = json!({"type": "adaptive"});
     }
     if let Some(effort) = &args.effort {
         body["output_config"] = json!({"effort": effort});
     }
     ```
   - `complete_openai`(:178-185)/`stream_openai`(:431-438)의 gpt-5 분기에:
     ```rust
     if let Some(effort) = &args.effort {
         body["reasoning_effort"] = json!(effort);
     }
     ```
   - 응답 파서는 수정 불필요(위 "사전 확인" 참조).
6. **`runReview.ts`**: `streamWithTauriAiBackend({ cfg, ..., useFor: 'review' })` 두 곳(:95, :134). translate/polish 경로도 같은 패턴이면 `useFor: 'translation'` 명시(기본값이라 실질 no-op이지만 명시성).
7. **REVIEW_MAX_TOKENS 상향** — F13 참조 (`4096 → 16384`).

### effort 값에 대한 결정 사항 (검증 에이전트 확정)
- **Anthropic `effort: 'high'`는 서버 기본값** — 명시해도 no-op이다. 즉 커밋 `eec130a`의 "검수 effort 상향" 의도는 Anthropic에서는 (경로 문제를 고쳐도) 실질 효과가 없다. 진짜 상향을 원하면 `'xhigh'`(Opus 4.7+/Sonnet 5 지원)를 review에 사용해야 한다 — 단 `@langchain/anthropic@1.3.17` 타입이 `xhigh`를 허용하는지 확인 후 적용.
- **OpenAI `reasoning_effort` 기본값은 medium** — review의 `'high'`는 OpenAI에서는 실제 상향이므로 유지.
- 권장: `resolveModelCallOptions`에서 review일 때 Anthropic effort를 `'xhigh'`로, OpenAI를 `'high'`로. (보수적으로 가려면 둘 다 `'high'`로 두되 Anthropic no-op임을 주석으로 명시.)

### 검증
- `/sync-types` 스킬로 Rust struct ↔ TS interface 동기화 검증.
- `cd src-tauri && cargo test` + `npx tsc --noEmit` + `npm run test:run`(client.test.ts 불변 통과).
- 단위 테스트: `resolveModelCallOptions`에 대해 (opus-4-7, review) → {adaptiveThinking, effort high, temperature 없음}, (sonnet-5, chat) → {adaptiveThinking, effort 없음, temperature 없음}, (sonnet-5, review) → effort high, (gpt-5.5, review) → {effort high}, (gpt-5.5, chat) → {}, (구형 claude, chat) → {temperature}.
- **런타임 검증(필수)**: `--features testing`으로 앱 구동 후 검수 1회 실행, Rust 로그 또는 프록시로 Anthropic 요청 body에 `"thinking":{"type":"adaptive"}` + `"output_config":{"effort":"high"}` 포함 확인. `/test-ai` dry-run이 지원하면 그것으로 대체 가능.

---

## F8. Sonnet 5 temperature 가드가 Tauri 경로에 누락 (backendCompletion.ts:70-78)

### 진단
- `client.ts:38-39`에는 `isSonnet5` 가드가 추가됐지만, "Keep backend calls aligned with createChatModel guards" 주석이 달린 `getTemperatureOption`(:70-78)은 Opus 4.7+만 거른다. Tauri backend 경로에서 Sonnet 5 + temperature 설정 시 **Anthropic 400** ("temperature is not supported..."). 실제 앱은 검수/번역이 대부분 이 경로.

### 수정안
- F7의 `resolveModelCallOptions` 통합으로 **자동 해결**(같은 가드 소스 공유).
- F7을 뒤로 미룰 경우의 최소 수정: `backendCompletion.ts:75`에 한 줄:
  ```ts
  if (cfg.provider === 'anthropic' && (/^claude-opus-4-(7|[89]|\d{2,})/.test(cfg.model) || /^claude-sonnet-5/.test(cfg.model))) return {};
  ```

### 검증
- 단위 테스트: cfg={provider:'anthropic', model:'claude-sonnet-5', temperature:0.3} → aiStream args에 temperature 부재. opus-4-7 동일. 구형 모델 → temperature 전달.

---

## F9. 프로그램적 smooth 스크롤이 stick-to-bottom을 해제 (useChatScroll.ts:54-62)

### 진단
- `handleMessagesScroll`이 매 스크롤 이벤트마다 `shouldStickToBottomRef.current = isAtBottom`(:60)을 기록하는데, `scrollToBottom('smooth')`가 발생시키는 **애니메이션 중간 프레임**은 bottom에서 100px 이상 떨어져 있어 ref가 false로 뒤집힌다. 결과: 스트리밍 follow(:47-51 가드)가 멈추고 scroll-to-bottom 버튼이 깜빡임. 버튼 클릭 시에도 첫 프레임에서 즉시 ref=false + 버튼 재표시(검증 확정).

### 수정안
프로그램적 스크롤 진행 플래그 + 사용자 개입 시 해제:
```ts
const isAutoScrollingRef = useRef(false);

const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
  const container = messagesContainerRef.current;
  if (!container) return;
  if (behavior === 'smooth') isAutoScrollingRef.current = true;
  container.scrollTo({ top: container.scrollHeight, behavior });
  shouldStickToBottomRef.current = true;
  setShowScrollToBottom(false);
}, []);

const handleMessagesScroll = useCallback(() => {
  const container = messagesContainerRef.current;
  if (!container) return;
  const { scrollTop, scrollHeight, clientHeight } = container;
  const isAtBottom = scrollHeight - scrollTop - clientHeight < BOTTOM_THRESHOLD_PX;
  if (isAutoScrollingRef.current) {
    if (isAtBottom) isAutoScrollingRef.current = false; // 애니메이션 도착
    return; // 자동 스크롤 프레임은 stickiness/버튼 상태를 건드리지 않음
  }
  shouldStickToBottomRef.current = isAtBottom;
  setShowScrollToBottom(!isAtBottom);
}, []);
```
사용자 개입(애니메이션 중 wheel/터치)이 플래그에 갇히지 않도록 컨테이너에 해제 리스너 추가(훅 내 effect):
```ts
useEffect(() => {
  const container = messagesContainerRef.current;
  if (!container) return;
  const cancelAutoScroll = () => { isAutoScrollingRef.current = false; };
  container.addEventListener('wheel', cancelAutoScroll, { passive: true });
  container.addEventListener('touchmove', cancelAutoScroll, { passive: true });
  return () => {
    container.removeEventListener('wheel', cancelAutoScroll);
    container.removeEventListener('touchmove', cancelAutoScroll);
  };
}, []);
```
- 주의: 이 effect는 컨테이너 ref가 마운트된 뒤 실행되어야 함 — ChatContent에서 ref가 조건부 렌더면 `chatPanelOpen`을 deps에 추가.
- `behavior 'auto'`(즉시)는 단일 이벤트로 bottom 도달 → 플래그 즉시 해제, 부작용 없음.

### 검증
- 수동/E2E: 긴 스트리밍 중 (i) 자동 follow가 끊기지 않는지, (ii) 위로 스크롤 → 버튼 표시 + follow 중지, (iii) 버튼 클릭 → 깜빡임 없이 하단 도달 + follow 재개, (iv) smooth 애니메이션 중 wheel로 위로 올리면 사용자 의도 우선(버튼 표시).
- jsdom은 smooth scroll 미구현이므로 단위 테스트로는 플래그 로직만(스크롤 이벤트 시뮬레이션) 검증, 실동작은 `/e2e-scenario` 채팅 시나리오로.

---

## F10. 위로 스크롤 중 내 메시지 전송 시 스크롤 안 됨 (useChatScroll.ts:39-43 + ChatContent)

### 진단
- 메시지 추가 스크롤이 `shouldStickToBottomRef`로 게이트(:40)되면서, 사용자가 위를 보다가 **자신이** 메시지를 보내도 화면이 따라가지 않는다. `sendCurrent`(ChatContent.tsx:344-364)에 스크롤 호출이 없고 ref를 true로 되돌리는 경로도 없음(검증 확정). 이전 동작(항상 스크롤) 대비 회귀 — 남의 메시지(어시스턴트 스트리밍)는 안 따라가는 게 맞지만 본인 전송은 따라가야 자연스러움.

### 수정안
- `ChatContent.tsx`의 `sendCurrent`에서 전송 트리거 직후 `scrollToBottom()` 호출 (useChatScroll이 반환하는 함수 — 이미 컴포넌트에서 사용 중인지 확인, :465 버튼에서 사용). 이 호출이 `shouldStickToBottomRef.current = true`도 설정하므로 이어지는 응답 스트리밍 follow까지 자연 복구된다.
- 삽입 위치: 메시지 전송 액션 dispatch 직후(입력 클리어와 같은 블록). 실패 early-return 뒤가 아닌, 실제 전송이 확정된 지점.

### 검증
- E2E/수동: 위로 스크롤한 상태에서 메시지 전송 → 즉시 하단으로 스크롤 + 응답 스트리밍 follow.

---

## F11. catch가 모든 예외를 'not found'로 표시 (ReviewPanel.tsx:341-354) — P3

### 진단 (검증: 좁은 형태로 확정)
- `applySuggestionToEditor`는 예상 실패를 **반환값**('not-found'/'missing-data')으로 신호하고 throw하지 않는다. catch(:344-354)는 예기치 못한 예외(현실적으로 `editor.view.dispatch` 중 plugin/React 오류)만 잡는데, 토스트가 `review.applyError.notFound`("텍스트를 찾을 수 없습니다...")라 **오진단 메시지**. `console.error`는 남기므로 디버깅 정보 유실은 아님 — 심각도 낮음.

### 수정안
- catch의 토스트만 교체:
  ```ts
  message: t('review.applyError.unexpected', '수정 제안 적용 중 오류가 발생했습니다.'),
  ```
- i18n 키 추가: `ko.json`/`en.json`의 `review.applyError`에 `unexpected` ("수정 제안 적용 중 오류가 발생했습니다." / "An unexpected error occurred while applying the fix.").

### 검증
- `applySuggestionToEditor`를 throw하도록 mock한 테스트에서 unexpected 토스트 발생, not-found 반환 시 기존 토스트 유지.

---

## F12. polish 스냅샷 상태 미정리 (EditorCanvasTipTap.tsx) — P3, 선택

### 진단 (검증: correctness 버그 아님 확정)
- `polishOriginalDocJson`/`polishPreviewDoc` 등이 close/apply 시 정리되지 않는다(ReviewPanel의 `handleRetranslateClose`(:510-516)와 비대칭). 단, 재열기 유일 경로인 `openPolishPreview`가 await 전에 항상 재스냅샷하므로 **stale 값이 apply에 도달할 수 없음** — 메모리에 문서 JSON 하나가 다음 폴리싱까지 상주하는 위생 문제.

### 수정안 (선택 적용)
- `handlePolishClose` 콜백 신설(ReviewPanel 패턴 미러링):
  ```ts
  const handlePolishClose = useCallback((): void => {
    setPolishPreviewOpen(false);
    setPolishPreviewDoc(null);
    setPolishOriginalDocJson(null);
    setPolishPreviewError(null);
    setPolishStreamingText(null);
  }, []);
  ```
- `onClose`(:1236-1238 인라인)와 `applyPolishDoc`의 `setPolishPreviewOpen(false)`(:690)를 `handlePolishClose()`로 교체. `applyPolishPreview`가 `polishPreviewDoc`을 **먼저 읽고** `applyPolishDoc`을 호출하는 순서인지 확인 후 적용(확인됨: 안전). `handlePolishCancel`은 abort 경로의 에러 표시를 위해 그대로 둔다.

---

## F13. thinking 토큰이 출력 예산을 잠식 → 검수/채팅 무음 truncation (runReview.ts:35, constants.ts:16) — P1

### 진단 (검증 완료 — F7 수정 여부와 무관하게 **현재 프로덕션에서 발생 가능**)
- `max_tokens`는 thinking + 가시 텍스트를 합산하는 **하드 캡**이다 (Anthropic adaptive thinking / GPT-5 reasoning 공통). `budget_tokens` 같은 별도 thinking 예산은 Sonnet 5/Opus 4.7+에서 제거(400)되어 존재하지 않음 — 레버는 `max_tokens`와 `effort`뿐.
- **검수**: `REVIEW_MAX_TOKENS = 4096`(runReview.ts:35)이 모든 경로(:98, :109, :137)에 적용된다. **Sonnet 5는 `thinking` 필드를 생략해도 기본 adaptive로 동작**하므로, Rust 백엔드가 thinking을 안 보내는 지금도 Sonnet 5 검수는 thinking 토큰을 4096 안에서 소모한다(effort 기본 high). 12k-char 청크에서 thinking이 1.5–3K 토큰을 쓰면 이슈 목록이 중간에 잘린다.
- **Truncation이 무음**: `parseReviewResult.ts:90-94`가 `---REVIEW_END---` 누락 시 `console.warn`만 남기고 partial을 파싱 — 잘린 뒤 이슈는 조용히 유실, 사용자에게 신호 없음.
- **채팅**: 채팅은 Tauri에서도 LangChain 경로(백엔드 short-circuit 없음)라 `client.ts:51`의 Opus 4.7+ adaptive thinking이 **실제 앱에서 live**. `DEFAULT_CHAT_MAX_TOKENS = 4096`(constants.ts:16)을 thinking이 잠식 → Opus 채팅 답변이 문장 중간에 잘릴 수 있다(이 커밋 이전 Opus 채팅은 thinking-off로 4096 전부 텍스트였음 — 회귀).
- 번역/폴리싱은 `max(1.5×input, 8192)`~64K 동적 예산 + truncation 감지 로직이 있어 상대적으로 안전.

### 수정안
1. `runReview.ts:35`: `REVIEW_MAX_TOKENS = 4096` → `16384`. (모든 경로가 스트리밍이라 타임아웃 무관. GPT-5 `max_completion_tokens`에도 동일 적용됨.)
2. `src/ai/constants.ts:16`: `DEFAULT_CHAT_MAX_TOKENS = 4096` → `8192`. (Opus 채팅 thinking 잠식 보상. OpenAI 채팅은 maxTokens 미설정 경로라 영향 없음 — client.ts:87 참조.)
3. (선택) `parseReviewResult.ts:90-94`의 truncation 감지를 `console.warn`에서 사용자 가시 신호로 승격 — 파서가 truncated 플래그를 반환하고 ReviewPanel이 토스트("검수 결과가 길이 제한으로 잘렸을 수 있습니다") 표시. 파서 반환 타입 변경이 수반되므로 별도 커밋.
4. (선택, YAGNI 정리) `client.ts:43-46, :84-87`의 `isReview` maxTokens fallback 분기는 도달 불가 확정(유일한 review 호출부가 항상 maxTokens 명시). F7 리팩터링에서 자연 정리되면 제거, 아니면 무해하므로 유지.

### 검증
- 단위: `runReview`가 aiStream/createChatModel에 16384를 전달(기존 `runReview.test.ts:108` 기대값 갱신).
- 런타임: 긴 문서(12k+ chars) 검수에서 `---REVIEW_END---` 마커가 응답 끝에 존재하는지 확인.

---

## 구현 순서 권장

1. **F6(c) → F6(a) → F6(b)**: normalizeForSearch → parse → apply 순 (하위 → 상위, 각 단계 테스트).
2. **F2 → F1 → F3**: reviewApply 계열 (공유 헬퍼 먼저).
3. **F5 → F4**: docBlockDiff → 모달 (F5가 F4의 부분 선택 안전성을 보강).
4. **F13-1,2 (토큰 상향)**: 독립적이고 위험 없음 — 먼저 넣어도 됨.
5. **F8 최소수정 or F7 전체**: F7 진행 시 F8 자동 포함. F7은 Rust+TS 크로스 레이어이므로 별도 커밋 + `/sync-types` + 런타임 검증 필수. F13-3(truncation 토스트)은 F7과 무관하게 별도.
6. **F9 → F10**: useChatScroll.
7. **F11, F12**: 마무리.

각 그룹은 독립 커밋. 커밋 전 체크: `npx tsc --noEmit && npm run test:run`, Rust 변경 시 `cargo test`, 최종적으로 `npm run test:ci:local`.

## 재검증 결과 정리 (전체 후보 처분)

- ~~EditorCanvasTipTap 스냅샷 revert~~ → **REFUTED** (수정 불필요, F12만 선택 정리).
- REVIEW_MAX_TOKENS/thinking 예산 → **CONFIRMED**, F13으로 확정 (Sonnet 5 기본 adaptive 때문에 현재도 발생 가능).
- client.ts:51 thinking 전면 활성화 → **CONFIRMED(축소)**: 실제 앱에서 live한 것은 Opus 채팅뿐. F13-2로 대응.
- client.ts:46 `isReview` maxTokens fallback dead branch → **CONFIRMED(trivial)**: F13-4 선택 정리.
- ReviewPanel catch 토스트 → **CONFIRMED(좁게)**: F11.
- stripWrappingQuotes 미스매치 pair 손상 → **REFUTED**; 불균형 다중 인용 손상은 **CONFIRMED** → F6(c).
