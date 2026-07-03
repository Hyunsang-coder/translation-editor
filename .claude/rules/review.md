---
paths: ["src/ai/review/**/*", "src/components/review/**/*", "src/editor/extensions/ReviewHighlight.ts"]
alwaysApply: false
---

# Review Rules

번역 검수 기능 작업 시 적용되는 규칙.

## Critical Checklist

- [ ] `DEFAULT_REVIEW_CHUNK_SIZE` (12000) 일관성 유지
- [ ] JSON 파싱 시 brace counting 사용 (`extractJsonObject`)
- [ ] excerpt→위치 매칭은 `findExcerptRange()` (reviewApply.ts) 공용 사용 — ReviewHighlight와 Apply가 동일 로직 공유
- [ ] Cross-node 검색 시 `buildTextWithPositions()` 사용
- [ ] AI excerpt에서 Markdown 제거 시 `normalizeForSearch()` 사용

## Issue Types & Actions

| 케이스 | 버튼 | 동작 |
|-----|------|------|
| `targetExcerpt` + `suggestedFix` 있음 (부분 누락 포함) | 적용 | `targetExcerpt` → `suggestedFix` 교체 |
| 완전 누락 (`Target: (missing)` → targetExcerpt 없음) | 복사 | 삽입 위치 특정 불가 → `suggestedFix` 클립보드 복사 |

적용 버튼 노출은 이슈 **타입이 아니라 교체 앵커(targetExcerpt) 존재 여부**로 결정한다.

## JSON Parsing Pattern

```typescript
// Brace counting으로 JSON 추출 (greedy regex 금지)
function extractJsonObject(text: string): object | null {
  let braceCount = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (braceCount === 0) start = i; braceCount++; }
    else if (text[i] === '}') { braceCount--; if (braceCount === 0) return JSON.parse(text.slice(start, i + 1)); }
  }
}
```

## Apply Suggestion Flow

`applySuggestionToEditor(editor, issue)` (reviewApply.ts):

1. `deriveReplacementText()` - suggestedFix에서 HTML/인라인 Markdown/감싸는 따옴표 제거
2. `resolveSuggestionRange()` - 적용 범위 결정:
   - 정확 매칭 (`findExcerptRange`, 감싸는 따옴표 관용 포함, segmentGroupId 범위 제한)
   - 실패 시 `findBestSentenceMatch()` - 단어 Dice 유사도 ≥ 0.6 문장 전체 교체 (fuzzy).
     교체문이 문장 대비 40% 미만 길이면 유실 위험으로 포기
3. `tr.replaceWith()` - plain text 교체 (history 기록 → Ctrl+Z 가능)
4. 성공 시 `deleteIssue()` - 이슈 삭제 (fuzzy면 `review.fuzzyMatchApplied` 토스트)

검수 프롬프트는 Target/Suggestion을 **완전한 문장 단위**로 요구 (reviewTool.ts OUTPUT_FORMAT) —
문장 전체 교체가 안전하도록 하기 위함. 파서(parseReviewResult.ts)는 excerpt/suggestion의
감싸는 따옴표(직선·곡선)를 `stripWrappingQuotes()`로 제거.

하이라이트는 ReviewHighlight plugin이 `tr.docChanged` 시 자동 재계산하므로 별도 가드 불필요
(과거 cross-store subscription + `isApplyingSuggestion` 가드 패턴은 제거됨).

## Common Pitfalls

1. **하이라이트 위치 불일치**: plugin이 docChanged 시 재계산 — 못 찾는 이슈는 자연히 제거됨
2. **JSON 파싱 실패**: Brace counting 사용
3. **완전 누락 Apply 불가**: targetExcerpt가 없으면 삽입 위치를 특정할 수 없음 — "복사" 버튼으로 처리
   (부분 누락은 미완성 문장이 targetExcerpt로 잡히므로 적용 가능)
