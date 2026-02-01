# Issue: Review Apply "Text not found" Error

## 현상

리뷰 검수 후 "Apply" 버튼을 클릭하면 다음 오류가 발생하여 수정 제안이 적용되지 않음:

```
"Text not found in translation. The document may have changed."
(해당 텍스트를 번역문에서 찾을 수 없습니다. 문서가 변경되었을 수 있습니다.)
```

**i18n key:** `review.applyError.notFound`

---

## 데이터 흐름 분석

### 1. 검수 시 AI에게 전달되는 텍스트

**경로:**
```
buildAlignedChunks() → tipTapJsonToMarkdownForTranslation()
```

**파일:** `src/ai/tools/reviewTool.ts:46-63`

- TipTap JSON → **Markdown** 변환
- 리스트 아이템: `- ` 접두사 추가
- 볼드: `**text**` 형식
- 테이블: HTML `<table>` 형식 유지

**AI가 받는 텍스트 예시:**
```markdown
- View source and target documents simultaneously...
- Accurately confirm the document content using the get_source_documents and get_target_documents tools
```

### 2. AI가 반환하는 `targetExcerpt`

**프롬프트 지시사항** (`src/ai/tools/reviewTool.ts:386-390`):
```
## excerpt 작성 규칙 (필수!)
- targetExcerpt: 번역문(Target)에서 **그대로 복사** (30자 이내)
- 절대 요약하거나 재작성 금지! 원본 텍스트 그대로 복사할 것
- 시스템이 targetExcerpt로 문서 내 위치를 검색함 → 정확히 일치해야 함
```

**AI가 반환하는 JSON 예시:**
```json
{
  "targetExcerpt": "get_source_documents and get_target_documents tools",
  "suggestedFix": "get_source_document and get_target_document tools"
}
```

### 3. Apply 시 검색 로직

**파일:** `src/components/review/ReviewPanel.tsx:279-296`

```typescript
const searchText = normalizeForSearch(issue.targetExcerpt);
editor.commands.setSearchTerm(searchText);
const matches = editor.storage.searchHighlight?.matches || [];
if (matches.length === 0) {
  // 오류 발생!
}
```

### 4. 에디터에서 검색

**파일:** `src/editor/extensions/SearchHighlight.ts:138-190`

```typescript
// 에디터 텍스트 정규화
const { normalizedText, indexMap } = buildNormalizedTextWithMapping(text);
// 검색어 정규화
const normalizedSearchTerm = normalizeForSearch(searchTerm);
// 검색 (정확한 substring 매칭)
const index = searchIn.indexOf(searchFor, index);
```

---

## 근본 원인

### 1. AI가 excerpt를 정확히 복사하지 않음

지시사항에도 불구하고 AI가:
- 공백/구두점을 미세하게 변경
- 일부 텍스트를 생략하거나 추가
- 마크다운 서식을 포함하거나 제외

### 2. 형식 비대칭 (Format Asymmetry)

| 구분 | AI가 받는 형식 | 에디터 저장 형식 |
|------|---------------|-----------------|
| 리스트 | `- item` | `item` (마커 없음) |
| 볼드 | `**text**` | `text` (plain) |
| 테이블 | `<table>...</table>` | TipTap JSON |

AI는 Markdown을 보고 excerpt를 복사하지만, 에디터는 plain text를 저장.

### 3. 정규화 함수의 비대칭

**`normalizeForSearch()`** (검색어용) - `src/utils/normalizeForSearch.ts:50-87`:
- HTML 태그 제거
- 마크다운 서식 제거 (`**`, `*`, `` ` ``, `~~`)
- **리스트 마커 제거** (`- `, `1. `)
- 공백 정규화

**`buildNormalizedTextWithMapping()`** (에디터 텍스트용) - `src/editor/extensions/SearchHighlight.ts:70-132`:
- 유니코드 정규화
- CRLF → 공백
- 연속 공백 축소
- **리스트 마커 제거 안함** (에디터에는 이미 없음)

이론상 양쪽 다 plain text가 되어야 하지만, AI가 정확히 복사하지 않으면 불일치 발생.

---

## 구체적 예시 (스크린샷 기준)

**원문 (Source):**
```
get_source_document, get_target_document 도구
```

**번역문 (Target) - 에디터에 있는 텍스트:**
```
get_source_documents and get_target_documents tools
```

**AI가 반환한 targetExcerpt (추정):**

AI가 정확히 무엇을 반환했는지 알 수 없지만, 에디터의 텍스트와 **미세하게 다를 가능성**:

| 가능한 불일치 | 예시 |
|--------------|------|
| 공백 차이 | `"get_source_documents  and"` vs `"get_source_documents and"` |
| 일부 생략 | `"get_source_documents and get_target_documents"` (tools 누락) |
| 마크다운 포함 | `` `get_source_documents` `` (백틱 포함) |
| 대소문자 | 이론상 case-insensitive 검색이지만 버그 가능 |

---

## 디버깅 방법

### 1. SearchHighlight 로그 확인

**파일:** `src/editor/extensions/SearchHighlight.ts:289-294`

```typescript
console.log('[SearchHighlight:setSearchTerm]', {
  term,
  normalizedTerm: normalizeForSearch(term),
  matchCount: storage.matches.length,
  caseSensitive: storage.caseSensitive,
});
```

### 2. ReviewHighlight 로그 확인

**파일:** `src/editor/extensions/ReviewHighlight.ts:172-178`

```typescript
console.log(`[ReviewHighlight:${excerptField}] issue #${idx}:`, {
  raw: rawSearchText,
  stripped: searchText,
  found: normalizedIndex !== -1,
  normalizedIndex,
  type: issue.type,
});
```

### 3. 확인 필요 사항

1. `raw` (AI가 반환한 원본)와 `stripped` (정규화 후)의 차이
2. 에디터 전체 텍스트에 해당 문자열이 실제로 있는지
3. `normalizedFullText`에서 검색 시 왜 못 찾는지
4. AI 응답 원본 확인 (ReviewPanel의 streamingText)

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/components/review/ReviewPanel.tsx` | Apply 버튼 핸들러 |
| `src/editor/extensions/SearchHighlight.ts` | 검색/교체 로직 |
| `src/editor/extensions/ReviewHighlight.ts` | 하이라이트 로직 |
| `src/utils/normalizeForSearch.ts` | 텍스트 정규화 |
| `src/ai/tools/reviewTool.ts` | AI 프롬프트 및 청킹 |
| `src/ai/review/runReview.ts` | 검수 API 호출 |
| `src/ai/review/parseReviewResult.ts` | AI 응답 파싱 |

---

## 잠재적 해결 방안

### 1. 퍼지 매칭 (Fuzzy Matching)
- 정확한 substring 매칭 대신 유사도 기반 매칭
- Levenshtein distance 등 활용
- 임계값(예: 70% 유사도) 이상이면 매칭으로 간주

### 2. 세그먼트 기반 매칭
- `segmentGroupId`를 활용하여 특정 블록 내에서만 검색
- 검색 범위를 좁혀 정확도 향상

### 3. AI 프롬프트 강화
- excerpt 작성 규칙을 더 명확하게
- Few-shot 예시 추가
- 정규화된 형태로 반환하도록 지시

### 4. 양방향 정규화 동기화
- AI 입력 시 사용하는 정규화와 검색 시 사용하는 정규화를 동일하게
- 또는 AI에게 "검색 키"를 별도로 제공

### 5. 폴백 메커니즘
- 매칭 실패 시 클립보드에 수정 제안 복사
- 사용자가 수동으로 적용할 수 있도록

---

## 요약

| 단계 | 내용 | 문제 가능성 |
|------|------|------------|
| AI 입력 | Markdown 변환된 텍스트 | - |
| AI 출력 | `targetExcerpt` | **AI가 정확히 복사 안함** |
| 정규화 | `normalizeForSearch()` | 정규화해도 불일치 남음 |
| 검색 | `indexOf()` | **정확한 substring 매칭 실패** |

**핵심 문제:** AI가 프롬프트 지시사항대로 텍스트를 "정확히" 복사하지 않아, 정규화 후에도 에디터 텍스트와 불일치 발생.
