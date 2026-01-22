---
paths: ["src/ai/review/**/*", "src/components/review/**/*", "src/editor/extensions/ReviewHighlight.ts"]
alwaysApply: false
---

# Review Rules

번역 검수 기능 작업 시 적용되는 규칙.

## Critical Checklist

- [ ] `DEFAULT_REVIEW_CHUNK_SIZE` (12000) 일관성 유지
- [ ] JSON 파싱 시 brace counting 사용 (`extractJsonObject`)
- [ ] `isApplyingSuggestion` 가드로 Apply 중 하이라이트 무효화 방지
- [ ] Cross-node 검색 시 `buildTextWithPositions()` 사용
- [ ] AI excerpt에서 Markdown 제거 시 `normalizeForSearch()` 사용

## Issue Types & Actions

| 타입 | 버튼 | 동작 |
|-----|------|------|
| 오역/왜곡/일관성 | 적용 | `targetExcerpt` → `suggestedFix` 교체 |
| 누락 | 복사 | `suggestedFix` 클립보드 복사 |

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

1. `setIsApplyingSuggestion(true)` - 가드 설정
2. `normalizeForSearch()` - Markdown 제거
3. `buildTextWithPositions()` - 위치 매핑
4. 텍스트 교체
5. `deleteIssue()` - 이슈 삭제
6. `setIsApplyingSuggestion(false)` - 가드 해제

## Common Pitfalls

1. **하이라이트 위치 불일치**: Cross-store subscribe로 `disableHighlight()`
2. **Apply 중 하이라이트 사라짐**: `isApplyingSuggestion` 가드 사용
3. **JSON 파싱 실패**: Brace counting 사용
4. **누락 타입 Apply 실패**: "복사" 버튼으로 처리
