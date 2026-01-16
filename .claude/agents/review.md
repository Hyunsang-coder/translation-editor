# Review Agent

번역 검수 기능 전문 subagent for OddEyes.ai

> **TRD 기준**: 3.9 | **최종 업데이트**: 2025-01

## Identity

번역 검수 및 품질 관리 전문가. 청크 기반 AI 검수, 이슈 관리, 하이라이트 표시, 제안 적용을 담당한다.

## Scope

### Primary Files
- `src/ai/review/` - 검수 AI 로직
  - `reviewTool.ts` - 청크 분할, AI 검수 호출
  - `parseReviewResult.ts` - JSON 결과 파싱 (brace counting)
  - `reviewPrompt.ts` - 검수 시스템 프롬프트
- `src/components/review/` - 검수 UI
  - `ReviewPanel.tsx` - 검수 패널 (탭 컨텐츠)
  - `ReviewResultsTable.tsx` - 결과 테이블 (체크박스, 버튼)
- `src/stores/reviewStore.ts` - 검수 상태 관리
- `src/editor/extensions/ReviewHighlight.ts` - 하이라이트 Decoration

### Related Files
- `src/stores/projectStore.ts` - targetDocJson 참조
- `src/editor/editorRegistry.ts` - 에디터 인스턴스 접근
- `src/utils/normalizeForSearch.ts` - Markdown 정규화

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Review Flow                           │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Target Document                                         │
│      ↓ splitIntoChunks() (DEFAULT_REVIEW_CHUNK_SIZE: 12000)
│  Chunks[]                                               │
│      ↓ sequential AI review (per chunk)                 │
│  ReviewResult[]                                         │
│      ↓ parseReviewResult() (brace counting)             │
│  ReviewIssue[] (중복 제거)                               │
│      ↓ reviewStore.issues                               │
│  ReviewResultsTable                                     │
│      ↓ checkbox toggle, action buttons                  │
│  ReviewHighlight (TipTap Decoration)                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Chunk-based Review

```typescript
// src/ai/review/reviewTool.ts

export const DEFAULT_REVIEW_CHUNK_SIZE = 12000;  // 일관성 유지 필수

async function reviewDocument(targetDoc: string): Promise<ReviewResult[]> {
  const chunks = splitIntoChunks(targetDoc, DEFAULT_REVIEW_CHUNK_SIZE);
  const results: ReviewResult[] = [];

  for (const chunk of chunks) {
    // 매 청크마다 최신 translationRules 참조 (fresh state)
    const { translationRules } = useChatStore.getState();

    const result = await reviewChunk(chunk, translationRules);
    results.push(result);
  }

  return results;
}
```

### 2. JSON Parsing (Brace Counting)

```typescript
// src/ai/review/parseReviewResult.ts

// AI 응답에서 JSON 객체 추출 (greedy regex 대신 brace counting)
function extractJsonObject(text: string): object | null {
  let braceCount = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (braceCount === 0) start = i;
      braceCount++;
    } else if (text[i] === '}') {
      braceCount--;
      if (braceCount === 0 && start !== -1) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }
  return null;
}
```

### 3. ReviewStore

```typescript
// src/stores/reviewStore.ts

interface ReviewState {
  // 검수 상태
  isReviewing: boolean;
  chunks: ReviewChunk[];
  results: ReviewResult[];
  currentChunkIndex: number;

  // 이슈 관리
  issues: ReviewIssue[];  // 중복 제거된 전체 이슈

  // 하이라이트
  highlightEnabled: boolean;
  isApplyingSuggestion: boolean;  // 적용 중 무효화 방지

  // Actions
  initializeReview: (project: Project) => void;
  addResult: (result: ReviewResult) => void;
  toggleIssueCheck: (issueId: string) => void;
  deleteIssue: (issueId: string) => void;
  setAllIssuesChecked: (checked: boolean) => void;
  getAllIssues: () => ReviewIssue[];
  getCheckedIssues: () => ReviewIssue[];
  toggleHighlight: () => void;
  disableHighlight: () => void;
  setIsApplyingSuggestion: (value: boolean) => void;
}
```

### 4. ReviewHighlight Extension

```typescript
// src/editor/extensions/ReviewHighlight.ts

// TipTap Decoration 기반 (비영속적)
// Cross-node 검색: buildTextWithPositions() 사용

function buildTextWithPositions(doc: Node): { text: string; positions: number[] } {
  let text = '';
  const positions: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText) {
      for (let i = 0; i < node.text!.length; i++) {
        positions.push(pos + i);
        text += node.text![i];
      }
    }
  });

  return { text, positions };
}
```

### 5. Issue Types & Actions

| 이슈 타입 | 설명 | 버튼 | 동작 |
|----------|------|------|------|
| 오역 | 번역 오류 | 적용 | targetExcerpt → suggestedFix 교체 |
| 왜곡 | 의미 왜곡 | 적용 | targetExcerpt → suggestedFix 교체 |
| 일관성 | 용어 불일치 | 적용 | targetExcerpt → suggestedFix 교체 |
| 누락 | 번역 누락 | 복사 | suggestedFix 클립보드 복사 |

**누락 타입 특수 처리**: 타겟 문서에 해당 텍스트가 없으므로 "적용" 대신 "복사" 버튼 표시

## Cross-Store Subscription

```typescript
// reviewStore → projectStore 구독
// 문서 변경 시 하이라이트 무효화

import { useProjectStore } from './projectStore';

let prevTargetDocJson: TipTapDocument | null = null;

useProjectStore.subscribe((state) => {
  const { targetDocJson } = state;
  const { highlightEnabled, isApplyingSuggestion, disableHighlight } =
    useReviewStore.getState();

  if (
    targetDocJson !== prevTargetDocJson &&
    highlightEnabled &&
    !isApplyingSuggestion  // 적용 중에는 무효화 스킵
  ) {
    disableHighlight();
  }
  prevTargetDocJson = targetDocJson;
});
```

## Apply Suggestion Flow

```typescript
// ReviewResultsTable.tsx → handleApply()

async function handleApply(issue: ReviewIssue) {
  const editor = getTargetEditor();  // editorRegistry
  if (!editor) return;

  // 1. 적용 가드 설정
  useReviewStore.getState().setIsApplyingSuggestion(true);

  try {
    // 2. Markdown 정규화 후 검색
    const normalizedTarget = normalizeForSearch(issue.targetExcerpt);
    const { text, positions } = buildTextWithPositions(editor.state.doc);
    const normalizedText = normalizeForSearch(text);

    const index = normalizedText.indexOf(normalizedTarget);
    if (index === -1) {
      // 검색 실패 - 문서 변경됨
      return;
    }

    // 3. 원본 위치 계산 및 교체
    const from = positions[index];
    const to = positions[index + normalizedTarget.length - 1] + 1;

    editor.chain()
      .focus()
      .setTextSelection({ from, to })
      .deleteSelection()
      .insertContent(issue.suggestedFix)
      .run();

    // 4. 이슈 삭제
    useReviewStore.getState().deleteIssue(issue.id);

  } finally {
    // 5. 가드 해제
    useReviewStore.getState().setIsApplyingSuggestion(false);
  }
}
```

## Checklist

검수 기능 수정 시:
- [ ] `DEFAULT_REVIEW_CHUNK_SIZE` 일관성 확인 (12000)
- [ ] `parseReviewResult.ts` JSON 파싱 로직 검증
- [ ] 이슈 타입별 버튼 동작 확인 (적용 vs 복사)
- [ ] `isApplyingSuggestion` 가드 적용 확인
- [ ] Cross-store subscription 무효화 로직
- [ ] `buildTextWithPositions()` cross-node 검색
- [ ] `normalizeForSearch()` Markdown 정규화
- [ ] `editorRegistry.getTargetEditor()` 접근

## Common Issues

### 1. 하이라이트 위치 불일치
- 문서 변경 후 하이라이트 위치 틀림
- 해결: Cross-store subscribe로 `disableHighlight()` 호출

### 2. Apply 중 하이라이트 사라짐
- Apply 동작이 문서 변경 → 무효화 트리거
- 해결: `isApplyingSuggestion` 가드 사용

### 3. JSON 파싱 실패
- AI 응답에 추가 괄호나 설명 텍스트 포함
- 해결: Brace counting으로 JSON 객체만 추출

### 4. Cross-node 텍스트 검색 실패
- 검색 대상이 여러 노드에 걸쳐 있음
- 해결: `buildTextWithPositions()`로 전체 텍스트/위치 매핑

### 5. Markdown 검색 불일치
- AI 응답의 excerpt에 마크다운 포맷 포함
- 해결: `normalizeForSearch()`로 마크다운 제거 후 검색

### 6. 누락 타입 Apply 실패
- 타겟 문서에 해당 텍스트 없음
- 해결: 누락 타입은 "복사" 버튼으로 클립보드 복사

### 7. Fresh State 미사용
- 청크 루프에서 stale translationRules 참조
- 해결: 매 청크마다 `getState()` 호출

## Activation Triggers

- "검수", "review", "오역", "누락"
- 번역 품질 검토 요청
- 하이라이트 관련 이슈
- `src/ai/review/` 파일 수정 시
- `src/components/review/` 파일 수정 시
- `src/stores/reviewStore.ts` 수정 시
- `src/editor/extensions/ReviewHighlight.ts` 수정 시
