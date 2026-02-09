# Review Feature Audit

검수(Review) 기능 코드 리뷰 결과. 2026-02-09 기준.

## 대상 파일

| 파일 | 라인 | 역할 |
|------|------|------|
| `src/ai/review/runReview.ts` | 114 | 검수 전용 API 호출 (도구 없이 단순 1회) |
| `src/ai/review/parseReviewResult.ts` | 333 | AI 응답 → ReviewIssue[] 파싱 (3단계 폴백) |
| `src/ai/tools/reviewTool.ts` | 475 | 청킹, 프롬프트, LangChain 도구 정의 |
| `src/stores/reviewStore.ts` | 426 | Zustand 상태 + 캐시 + 액션 |
| `src/components/review/ReviewPanel.tsx` | 692 | 메인 UI + 청크 루프 + 재번역 |
| `src/components/review/ReviewResultsTable.tsx` | 336 | 이슈 테이블 + severity 필터 |
| `src/editor/extensions/ReviewHighlight.ts` | 235 | ProseMirror 데코레이션 (에디터 하이라이트) |
| `src/components/review/reviewApply.ts` | 32 | 세그먼트 ID 정규화 유틸 |
| `src/ai/review/parseReviewResult.test.ts` | 409 | 파싱 테스트 (20+ 케이스) |

**총 규모**: ~3,200줄

---

## 아키텍처 요약

```
ReviewPanel (UI)
  ↓ handleRunReview()
buildAlignedChunksAsync() → 12KB 단위 청킹
  ↓ for each chunk
runReview() → LangChain stream (도구 없이 직접)
  ↓ AI 응답
parseReviewResult() → ReviewIssue[]
  ↓
reviewStore.addResult() → highlightNonce++
  ↓
ReviewHighlight (ProseMirror plugin) → 에디터 데코레이션
ReviewResultsTable → severity 필터링 + 테이블 표시
```

**Two-Pass Review**: Pass 1(세그먼트별 검출, 과검출 허용) → Pass 2(오탐 제거, 최종 확정)

---

## 프롬프트 분석

### 구조 (reviewTool.ts:173-317)

```
buildReviewPrompt() = TWO_PASS_REVIEW_PROMPT
                    + REVIEW_DETECTION_PROMPT
                    + OUTPUT_FORMAT
```

- **TWO_PASS_REVIEW_PROMPT**: 방법론, Issue Types(5종), Severity(3단계), False Positive 기준
- **REVIEW_DETECTION_PROMPT**: "모든 이슈 검출" 지시 (Minor 포함)
- **OUTPUT_FORMAT**: `---REVIEW_START/END---` 마커, Markdown 형식, 예시 2개

### 사용자 메시지 구조 (runReview.ts:56-86)

```
## 번역 방향 (Source/Target 언어 + 경고)
## 번역 규칙 (있을 때만)
## 용어집 (있을 때만)
## 검수 대상 ([#N] Source/Target 쌍)
출력 형식 지시
```

### 장점

1. Two-Pass 프레임으로 AI에게 "검출 → 필터링" 사고 순서 부여
2. False Positive 판정 기준이 구체적 (한국어 주어 생략, 문화적 적응 등)
3. Source/Target excerpt 혼동 방지 경고 (`runReview.ts:65-68`)
4. 마커 기반 출력으로 안정적 파싱 경계 확보

---

## 발견된 이슈

### P1: 높음 — 기능 영향

#### 1. 에러 감지 오탐 (parseReviewResult.ts:250-261)

```typescript
const errorPatterns = [
  /error\s*:\s*/i,    // ← "This is not an error: ..." 오탐
  // ...
];
```

**문제**: AI가 정상 검수 응답에서 "error"라는 단어를 사용하면 전체 응답이 에러로 처리되어 `throw Error`. 마커(`---REVIEW_START/END---`) 내부 콘텐츠에도 적용됨.

**영향**: 정상 검수 결과가 버려지고 사용자에게 "오류가 감지되었습니다" 표시.

**수정안**: 마커 추출 후 마커 외부 텍스트에만 에러 감지 적용. 또는 마커가 존재하면 에러 감지 스킵.

```typescript
// 마커가 있으면 정상 응답으로 간주
const markedContent = extractMarkedContent(aiResponse);
if (!markedContent && detectAiErrorResponse(aiResponse)) {
  throw new Error('...');
}
```

#### 2. Excerpt 따옴표 파싱 잘림 (parseReviewResult.ts:114)

```typescript
const sourceMatch = trimmed.match(/\*\*Source\*\*:\s*"?([^"]*)"?/i);
```

**문제**: `[^"]*`는 첫 `"` 에서 멈춤. Excerpt에 따옴표가 포함되면 잘림.
- 예: `**Source**: "He said "hello""` → `He said ` 만 캡처

**영향**: excerpt 불완전 → 에디터 하이라이트 실패.

**수정안**: 마지막 따옴표까지 매칭하는 패턴으로 변경.

```typescript
// 옵션 1: 따옴표로 감싸진 경우 마지막 따옴표까지
/\*\*Source\*\*:\s*"(.+)"\s*$/i
// 옵션 2: 따옴표 없는 경우도 포함
/\*\*Source\*\*:\s*"?(.*?)"?\s*$/i
```

#### 3. maxTokens 응답 잘림 미감지 (runReview.ts:50)

```typescript
const model = createChatModel(undefined, { useFor: 'translation', maxTokens: 4096 });
```

**문제**: 이슈가 많은 청크에서 4096 토큰 초과 시 응답이 중간에 잘림. 마커(`---REVIEW_END---`)가 없는 불완전 응답 생성.

**영향**: 잘린 마지막 이슈가 불완전하게 파싱되거나, 후반 이슈가 모두 누락됨.

**수정안**:
- `---REVIEW_END---` 마커 존재 여부로 잘림 감지
- 잘린 경우 경고 로그 + 부분 결과 사용 (마커 없이 파싱)
- 또는 `maxTokens`를 `8192`로 상향

#### 4. segmentOrder 항상 0 (parseReviewResult.ts:170)

```typescript
issues.push({
  id: generateIssueId(0, typeStr, sourceExcerpt, targetExcerpt),
  segmentOrder: 0,
  // ...
});
```

**문제**: Markdown 파싱에서 `segmentOrder`가 항상 0. `### Issue #N`의 N을 추출하지 않음.

**영향**:
- 같은 타입+excerpt 조합이 다른 세그먼트에 있으면 ID 충돌 → 중복 제거 시 하나가 소실
- `segmentOrder` 기반 정렬/필터링 불가

**수정안**: Issue 블록 분리 시 번호 캡처.

```typescript
const issueBlocks = content.split(/###\s*Issue\s*#?(\d*)/i);
// 또는 AI 응답의 SegmentGroupId로 order 역산
```

---

### P2: 중간 — 품질/성능

#### 5. 프로덕션 console.log 잔존 (ReviewHighlight.ts:61-66, 152-159)

```typescript
console.log(`[ReviewHighlight:${excerptField}] fullText (first 500):`, ...);
console.log(`[ReviewHighlight:${excerptField}] issues count:`, ...);
// ... 이슈당 1회씩 추가 로그
```

**문제**: 에디터 문서 변경마다 + 이슈 수만큼 로그 출력. 10개 이슈 × 타이핑 시 매 트랜잭션 = 대량 로그.

**수정안**: `DEBUG` 플래그 또는 제거.

```typescript
const DEBUG = import.meta.env.DEV && false; // 필요 시 true로 토글
if (DEBUG) console.log(...);
```

#### 6. Glossary 첫 청크만 검색 (ReviewPanel.tsx:166-189)

**문제**: 4000자 기준으로 첫 번째 청크의 텍스트만 glossary 검색에 사용. 10개 청크 문서의 후반부 용어는 검색 안 됨.

**영향**: 후반부 청크에서 용어 불일치 이슈 누락 가능.

**수정안**:
- 옵션 A: 청크별 glossary 검색 (API 호출 증가)
- 옵션 B: 전체 문서 기반 1회 검색 (첫 8000자 등 더 큰 범위)
- 옵션 C: 현행 유지하되 주석으로 의도 명시

#### 7. severityFilter가 Set 타입 (reviewStore.ts:75)

```typescript
severityFilter: new Set<IssueSeverity>(['critical', 'major']),
```

**문제**: `toggleSeverityFilter`에서 `new Set()` 생성 → Zustand shallow 비교 시 항상 새 참조 → 구독자 전체 리렌더.

**수정안**: `Record<IssueSeverity, boolean>` 또는 배열로 변경.

```typescript
severityFilter: { critical: true, major: true, minor: false } as Record<IssueSeverity, boolean>,
```

#### 8. 프롬프트 언어 혼용 (reviewTool.ts:173-299)

**문제**: 시스템 프롬프트가 영어 헤딩(`## Issue Types`, `## Severity Levels`) + 한국어 본문. AI 응답 언어가 불안정해질 수 있음.

**수정안**: 전체를 영어 또는 한국어로 통일. 또는 마지막에 "응답은 한국어로 작성" 명시.

---

### P3: 낮음 — 개선 권장

#### 9. handleRunReview deps에 project 객체 (ReviewPanel.tsx:238-245)

```typescript
}, [project, startReview, finishReview, ...]);
```

**문제**: `project` 객체 참조가 변경될 때마다 useCallback 재생성. 빈번한 프로젝트 업데이트 시 불필요한 재생성.

**수정안**: `project?.id`만 의존하거나, 콜백 내부에서 `useProjectStore.getState().project` 사용.

#### 10. TranslatePreviewModal에 getState() 직접 호출 (ReviewPanel.tsx:629-630)

```typescript
sourceHtml={useProjectStore.getState().sourceDocument}
originalHtml={useProjectStore.getState().targetDocument}
```

**문제**: 렌더 함수 내 `getState()`는 React 반응성 우회. 모달 열린 상태에서 문서 변경 시 stale data.

**참고**: 의도적일 수 있음 (모달에 스냅샷 전달). 주석 추가 권장.

#### 11. hashContent 32비트 해시 (reviewStore.ts:28-36)

```typescript
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
```

**문제**: djb2 해시 32비트. 이슈 수가 적어 실무적 문제는 낮으나 이론적 충돌 가능.

**수정안**: 현행 유지 가능. 문제 발생 시 `crypto.subtle.digest('SHA-1', ...)` 또는 더 긴 ID.

#### 12. 경과 시간 초기화 (ReviewPanel.tsx:117-128)

**문제**: `isReviewing`이 false 되면 즉시 `setElapsedSeconds(0)`. 결과 화면에서 총 소요 시간 표시 불가.

**수정안**: 별도 `totalElapsed` 상태를 `finishReview` 시 저장.

#### 13. 테스트 커버리지 부분적

| 영역 | 테스트 여부 |
|------|-------------|
| `parseReviewResult` | 있음 (20+ 케이스) |
| `buildAlignedChunks` | 없음 |
| `ReviewPanel` 로직 | 없음 |
| `ReviewHighlight` | 없음 |
| `reviewStore` 액션 | 없음 |

**권장**: `buildAlignedChunks`와 `createReviewDecorations` 단위 테스트 추가.

---

## 잘 된 점 (유지)

1. **stale closure 방지** — 청크 루프 내 `useChatStore.getState()` (Issue #13 Fix)
2. **파싱 에러 격리** — `parseReviewResult` try-catch로 청크별 격리 (Issue #8 Fix)
3. **3단계 폴백 파싱** — 마커 → Markdown → JSON, AI 응답 포맷 변동에 견고
4. **비동기 청킹** — `buildAlignedChunksAsync`로 UI 블로킹 방지
5. **AbortController 정리** — abort 후 즉시 null 설정, 메모리 누수 방지
6. **nonce 패턴** — `highlightNonce`로 에디터 새로고침 트리거 깔끔
7. **탭 전환 시 상태 보존** — `initializedProjectId` 체크로 불필요한 재초기화 방지
8. **세그먼트 범위 필터링** — 하이라이트 시 `segmentGroupId`로 오매칭 방지
9. **이미지 제거** — `stripImages()`로 토큰 절약 (청킹 단계에서)
10. **결정적 ID** — 중복 제거 + 체크 상태 유지에 활용

---

## 수정 우선순위

| 순위 | 이슈 # | 설명 | 난이도 |
|------|--------|------|--------|
| 1 | #1 | 에러 감지 오탐 — 정상 응답 버림 | 낮음 |
| 2 | #5 | 프로덕션 console.log — 성능 영향 | 낮음 |
| 3 | #2 | Excerpt 따옴표 파싱 — 하이라이트 실패 | 낮음 |
| 4 | #3 | maxTokens 잘림 미감지 — 이슈 누락 | 중간 |
| 5 | #4 | segmentOrder 0 — ID 충돌 가능 | 중간 |
| 6 | #7 | Set 타입 severityFilter — 리렌더 | 중간 |
| 7 | #6 | Glossary 첫 청크만 — 용어 누락 | 중간 |
| 8 | #8 | 프롬프트 언어 혼용 | 낮음 |
