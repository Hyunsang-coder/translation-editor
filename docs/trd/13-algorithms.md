# 13. 알고리즘 명세 (Algorithm Specifications)

## 13.1 개요

### Why
- 번역/검수/검수 적용에 사용되는 핵심 알고리즘을 명세화하여 유지보수성을 높입니다.
- 새 팀원 온보딩 시 코드 이해 시간을 단축합니다.
- 알고리즘 변경 시 영향 범위를 파악할 수 있습니다.

### How
- 각 알고리즘의 입력/출력/처리 흐름을 명시합니다.
- 구현 파일과 매핑하여 코드 탐색을 용이하게 합니다.

---

## 13.2 번역 알고리즘 (Translation)

### 파이프라인 개요

```
TipTap JSON → Markdown → [이미지 플레이스홀더] → LLM → Markdown → [이미지 복원] → TipTap JSON
```

### 처리 단계

| 단계 | 처리 내용 | 구현 파일 |
|------|-----------|-----------|
| 1. 입력 변환 | TipTap JSON → Markdown (`tiptap-markdown` extension) | `markdownConverter.ts` |
| 2. 이미지 플레이스홀더 | Base64 이미지 URL → `IMAGE_PLACEHOLDER_N` (토큰 ~99.99% 절약) | `imagePlaceholder.ts` |
| 3. 토큰 추정 | 입력 토큰 계산 → 동적 `max_tokens` 산출 | `translateDocument.ts` |
| 4. 청킹 판단 | 8K 토큰 이상 → 청크 분할 | `chunking/splitter.ts` |
| 5. LLM 호출 | SystemMessage + UserMessage (채팅 히스토리 없음) | `translateDocument.ts` |
| 6. 출력 추출 | `---TRANSLATION_START/END---` 구분자로 번역 결과 추출 | `markdownConverter.ts` |
| 7. Truncation 감지 | 열린 코드블록, `finish_reason: length` 체크 | `translateDocument.ts` |
| 8. 출력 변환 | Markdown → TipTap JSON + 이미지 복원 | `markdownConverter.ts` |

### 동적 max_tokens 계산

```
MAX_CONTEXT = 400,000 (GPT-5 기준)
SAFETY_MARGIN = 0.9 (10%)

availableOutputTokens = (MAX_CONTEXT × SAFETY_MARGIN) - totalInputTokens
minOutputTokens = max(estimatedInputTokens × 1.5, 8192)
calculatedMaxTokens = max(minOutputTokens, min(availableOutputTokens, 65536))
```

### 스트리밍 번역

```
.stream() → for await (chunk) {
  텍스트 토큰 → 누적 후 onToken 콜백 (마커 이후 텍스트만)
  완료 시 → extractTranslationMarkdown() → markdownToTipTapJson()
}
```

---

## 13.3 청킹 알고리즘 (Context-aware Chunking)

### Why
- 대용량 문서 번역 시 토큰 제한 문제 해결
- 코드블록/리스트/인용구 등 구조적 요소의 무결성 보장

### 분할 규칙

| 영역 | 분할 가능 여부 |
|------|----------------|
| 코드블록 내부 (``` 사이) | ❌ 금지 |
| 리스트 연속 구간 | ❌ 금지 |
| Blockquote 내부 | ❌ 금지 |
| Heading 직전 | ✅ 안전 |
| 블록 외부 빈 줄 | ✅ 안전 |

### 분할 알고리즘

```typescript
for (line of lines) {
  // 코드블록 경계 추적
  if (line.startsWith('```')) inCodeBlock = !inCodeBlock
  if (inCodeBlock) continue  // 분할 금지

  // 리스트/Blockquote 연속성 추적
  if (isListItem(line)) inList = true
  if (line.startsWith('>')) inBlockquote = true

  // 안전한 분할점 판단
  isSafeSplitPoint = !inCodeBlock && !inList && !inBlockquote 
                     && (line.isEmpty || isHeading)

  // 토큰 목표 도달 + 안전한 분할점
  if (isSafeSplitPoint && currentTokens >= targetTokens) {
    saveChunk()
  }
}
```

### 설정값

| 상수 | 값 | 설명 |
|------|-----|------|
| `CHUNKING_THRESHOLD` | 8,000 토큰 | 청킹 시작 임계값 |
| `targetChunkTokens` | 6,000 토큰 | 청크 목표 크기 |
| `minChunkTokens` | 2,000 토큰 | 최소 청크 크기 |

### 구현 파일
- `src/ai/chunking/splitter.ts` - 분할 로직
- `src/ai/chunking/merger.ts` - 병합 로직
- `src/ai/chunking/orchestrator.ts` - 청크별 번역 조율

---

## 13.4 검수 알고리즘 (Review)

### 파이프라인 개요

```
Project → 세그먼트 정렬 청킹 → [청크별 AI 검수] → JSON 파싱 → 이슈 중복 제거 → 하이라이트 매칭
```

### 세그먼트 기반 청킹

```typescript
for (segment of orderedSegments) {
  sourceText = HTML → Markdown 변환
  targetText = HTML → Markdown 변환
  segmentSize = sourceText.length + targetText.length

  if (currentChunk.totalChars + segmentSize > maxCharsPerChunk) {
    chunks.push(currentChunk)  // 새 청크 시작
    currentChunk = { chunkIndex: chunks.length, segments: [] }
  }
  currentChunk.segments.push({ groupId, order, sourceText, targetText })
}
```

| 상수 | 값 | 설명 |
|------|-----|------|
| `DEFAULT_REVIEW_CHUNK_SIZE` | 12,000자 | 청크 최대 문자 수 |

### 검수 강도별 프롬프트

| 강도 | 검출 기준 |
|------|-----------|
| `minimal` | 명백한 오류만 (의미 정반대, 팩트 누락) |
| `balanced` | 중요한 오류 (큰 의미 차이, 중요 정보 누락) |
| `thorough` | 세밀한 검토 (미세한 뉘앙스 차이도 검출) |

### 검수 카테고리

| 카테고리 | 설명 | 기본값 |
|----------|------|--------|
| `mistranslation` | 오역 (의미 다름) | ON |
| `omission` | 누락 (완전히 빠짐) | ON |
| `distortion` | 왜곡 (강도/범위 변경) | OFF |
| `consistency` | 일관성 (용어 불일치) | ON |

### AI 출력 형식

```json
{
  "issues": [
    {
      "segmentOrder": 1,
      "type": "오역|누락|왜곡|일관성",
      "sourceExcerpt": "원문 30자 이내",
      "targetExcerpt": "번역문 30자 이내 (수정 대상)",
      "problem": "문제 설명",
      "reason": "원인",
      "suggestedFix": "targetExcerpt와 1:1 교체할 텍스트"
    }
  ]
}
```

### 구현 파일
- `src/ai/tools/reviewTool.ts` - 검수 도구 및 프롬프트
- `src/ai/review/parseReviewResult.ts` - JSON 파싱
- `src/stores/reviewStore.ts` - 상태 관리

---

## 13.5 JSON 파싱 알고리즘

### Why
- AI 응답에서 JSON을 안정적으로 추출
- 불완전한 JSON이나 마크다운 혼합 응답 처리

### 균형 중괄호 매칭

```typescript
function extractJsonObject(text: string): string | null {
  // 1. "issues" 키워드 위치 탐색
  const issuesIndex = text.indexOf('"issues"')
  if (issuesIndex === -1) return null

  // 2. "issues" 앞의 가장 가까운 '{' 탐색
  let startIndex = -1
  for (let i = issuesIndex - 1; i >= 0; i--) {
    if (text[i] === '{') { startIndex = i; break }
  }

  // 3. 중괄호 카운팅으로 균형 잡힌 범위 추출
  let depth = 0
  for (let i = startIndex; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return text.slice(startIndex, i + 1)
    }
  }
  return null
}
```

### 폴백 전략

1. JSON 파싱 시도
2. 실패 시 마크다운 테이블 파싱

### 구현 파일
- `src/ai/review/parseReviewResult.ts`

---

## 13.6 이슈 ID 생성 (결정적 해시)

### Why
- 중복 이슈 제거
- 체크 상태 유지 (청크별 결과 병합 시)

### 알고리즘

```typescript
function generateIssueId(segmentOrder, type, sourceExcerpt, targetExcerpt): string {
  const content = `${segmentOrder}|${type}|${sourceExcerpt}|${targetExcerpt}`
  return hashContent(content)
}

function hashContent(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash  // 32bit 정수로 변환
  }
  return Math.abs(hash).toString(36)
}
```

### 구현 파일
- `src/stores/reviewStore.ts`

---

## 13.7 검수 적용 알고리즘 (Apply Suggestion)

### 적용 가능 유형

| 유형 | 처리 방식 |
|------|-----------|
| 오역/왜곡/일관성 | 자동 교체 (Apply 버튼) |
| 누락 | 클립보드 복사 (Copy 버튼) |

### 적용 처리 흐름

```typescript
1. normalizeForSearch(targetExcerpt)      // 마크다운 서식 제거
2. editor = editorRegistry.getTargetEditor()
3. editor.commands.setSearchTerm(searchText)
4. editor.commands.replaceMatch(suggestedFix)  // 첫 번째 매치 교체
5. deleteIssue(issueId)                   // 이슈 삭제
6. toast.success()                        // 성공 알림
```

### 마크다운 정규화 (`normalizeForSearch`)

```typescript
text
  .replace(/\*\*(.+?)\*\*/g, '$1')  // **bold** → bold
  .replace(/\*(.+?)\*/g, '$1')     // *italic* → italic
  .replace(/~~(.+?)~~/g, '$1')     // ~~strike~~ → strike
  .replace(/`(.+?)`/g, '$1')       // `code` → code
  .replace(/\[(.+?)\]\(.+?\)/g, '$1')  // [text](url) → text
  .replace(/^#{1,6}\s+/gm, '')     // # Heading → Heading
  .replace(/^\s*[-*+]\s+/gm, '')   // - item → item
  .replace(/\s+/g, ' ')            // 공백 정규화
  .trim()
```

### 하이라이트 무효화 방지

```typescript
// 수정 적용 시 문서 변경으로 인한 하이라이트 비활성화 방지
setIsApplyingSuggestion(true)
editor.commands.replaceMatch(suggestedFix)
setTimeout(() => setIsApplyingSuggestion(false), 500)
```

### 구현 파일
- `src/components/review/ReviewResultsTable.tsx` - UI 및 적용 로직
- `src/utils/normalizeForSearch.ts` - 정규화 유틸

---

## 13.8 하이라이트 매칭 전략

### 매칭 우선순위

1. `segmentGroupId`가 있으면 → 해당 세그먼트의 target 텍스트에서 `targetExcerpt` 검색
2. 1단계 실패 → 전체 문서에서 substring 검색 (첫 매치)
3. 2단계 실패 → 하이라이트 없이 "매칭 실패" 표시

### 노드 경계 처리

```typescript
// TipTap 노드 경계를 넘는 텍스트 검색을 위해
// 전체 텍스트/위치 매핑 구축
buildTextWithPositions(doc) → { text: string, positions: number[] }
```

### 구현 파일
- `src/editor/extensions/ReviewHighlight.ts`

---

## 13.9 파일 매핑 요약

| 기능 | 파일 |
|------|------|
| 번역 실행 | `src/ai/translateDocument.ts` |
| 청크 분할 | `src/ai/chunking/splitter.ts` |
| 청크 병합 | `src/ai/chunking/merger.ts` |
| 청크 오케스트레이션 | `src/ai/chunking/orchestrator.ts` |
| 검수 도구/프롬프트 | `src/ai/tools/reviewTool.ts` |
| 검수 결과 파싱 | `src/ai/review/parseReviewResult.ts` |
| 검수 상태 관리 | `src/stores/reviewStore.ts` |
| Markdown 변환 | `src/utils/markdownConverter.ts` |
| 이미지 플레이스홀더 | `src/utils/imagePlaceholder.ts` |
| 검색 정규화 | `src/utils/normalizeForSearch.ts` |
| 하이라이트 Decoration | `src/editor/extensions/ReviewHighlight.ts` |
