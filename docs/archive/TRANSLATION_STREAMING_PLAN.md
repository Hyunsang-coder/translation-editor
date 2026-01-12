# 번역 스트리밍 구현 계획

## 개요

현재 번역은 스켈레톤 → 전체 결과 표시 방식입니다.
**실시간 스트리밍**으로 변경하여 UX를 개선합니다.

```
[현재]
번역 요청 → 스켈레톤 대기 → 전체 결과 표시

[변경 후]
번역 요청 → 실시간 타이핑 효과 → 완료 후 Diff 표시
```

---

## 구현 계획

### 1. translateDocument.ts 수정

`model.invoke()` → `model.stream()` 변경 + 콜백 추가

```typescript
export async function translateWithStreaming(
  params: TranslateParams,
  onToken?: (text: string) => void,
): Promise<{ doc: TipTapDocJson; raw: string }> {
  const sourceMarkdown = tipTapJsonToMarkdown(params.sourceDocJson);
  
  // 스트리밍 API 호출
  let accumulated = '';
  const stream = await model.stream(messages);
  
  for await (const chunk of stream) {
    const delta = extractChunkContent(chunk);
    if (delta) {
      accumulated += delta;
      onToken?.(accumulated);  // 실시간 콜백
    }
  }
  
  // 완료 후 변환
  const markdown = extractTranslationMarkdown(accumulated);
  return { doc: markdownToTipTapJson(markdown), raw: accumulated };
}
```

### 2. TranslatePreviewModal.tsx 수정

스트리밍 텍스트 표시 영역 추가

```typescript
interface Props {
  // ...기존 props
  streamingText?: string;  // 스트리밍 중 Markdown 텍스트
}

// 렌더링
{isLoading && streamingText ? (
  <div className="markdown-preview whitespace-pre-wrap font-mono text-sm">
    {streamingText}
  </div>
) : isLoading ? (
  <SkeletonParagraph />
) : (
  // 기존 Preview/Diff
)}
```

### 3. 호출부 연결

번역 버튼 → `translateWithStreaming()` 호출 + 콜백으로 상태 업데이트

---

## 예상 작업 시간

| 단계 | 시간 |
|------|------|
| translateDocument.ts 수정 | 30분 |
| TranslatePreviewModal.tsx 수정 | 30분 |
| 호출부 연결 | 15분 |
| 테스트 | 30분 |
| **총합** | **~2시간** |

---

## 구현 순서

1. [x] `translateDocument.ts`에 스트리밍 함수 추가
2. [x] `TranslatePreviewModal.tsx`에 `streamingText` prop 추가
3. [x] 번역 호출부에서 콜백 연결
4. [x] 취소(abort) 시 상태 정리 확인
