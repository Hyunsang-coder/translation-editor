# 검수 적용 기능 개선 분석

> 작성일: 2026-01-15
> 상태: **분석 완료, 구현 대기**

---

## 현재 문제

### 1. 누락(Omission) 유형에서 적용 실패

**증상**: "적용" 버튼 클릭 시 "해당 텍스트를 번역문에서 찾을 수 없습니다" 오류

**원인**:
- `targetExcerpt`는 "번역문에서 수정할 대상 텍스트"로 정의됨
- 누락 유형에서는 해당 텍스트가 번역문에 **존재하지 않음** (누락이니까)
- `indexOf` 검색 시 당연히 찾을 수 없음

### 2. 리스트/번호 문서에서 검색 실패

**증상**: 일반 문단은 OK, 리스트 항목에서 적용 실패

**원인**:
- 검수 AI는 **Markdown** 형식 문서를 받음 (`htmlToMarkdown` 변환)
- 에디터는 **plain text** 기반 검색 (HTML 태그 제외한 텍스트)
- Markdown과 plain text의 차이:
  ```
  Markdown: "1. Overview\n   1. Skeletal-only"
  Plain text: "OverviewSkeletal-only" (번호, 줄바꿈 없음)
  ```

### 3. Markdown 서식으로 인한 불일치

**예시**:
- AI 반환: `**Master_Cloth**` (볼드 마크다운)
- 에디터 텍스트: `Master_Cloth` (plain text)

---

## 데이터 흐름 분석

```
┌─────────────────────────────────────────────────────────────┐
│                        검수 프로세스                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 문서 준비                                                │
│     project.blocks[id].content (HTML)                       │
│           ↓ htmlToMarkdown()                                │
│     Markdown 형식 텍스트                                     │
│                                                             │
│  2. AI 검수                                                  │
│     buildAlignedChunks() → 세그먼트별 Markdown               │
│           ↓ streamAssistantReply()                          │
│     JSON 응답 { issues: [...] }                             │
│                                                             │
│  3. 하이라이트                                               │
│     issue.targetExcerpt                                     │
│           ↓ stripMarkdown()                                 │
│     buildTextWithPositions() → 에디터 plain text 검색        │
│           ↓ indexOf()                                       │
│     Decoration 생성                                          │
│                                                             │
│  4. 적용                                                     │
│     issue.targetExcerpt                                     │
│           ↓ stripMarkdown()                                 │
│     editor.commands.setSearchTerm() → 검색                   │
│           ↓ replaceMatch()                                  │
│     텍스트 교체                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 이슈 유형별 동작 분석

| 유형 | targetExcerpt | suggestedFix | 검색 가능? | 적용 방식 |
|------|--------------|--------------|-----------|----------|
| 오역 (error) | 잘못 번역된 텍스트 | 올바른 번역 | **가능** | 교체 |
| 왜곡 (distortion) | 강도/범위 변경 텍스트 | 올바른 번역 | **가능** | 교체 |
| 일관성 (consistency) | 불일치 용어 | 올바른 용어 | **가능** | 교체 |
| **누락 (omission)** | 번역에 없는 텍스트 | 추가할 텍스트 | **불가능** | ??? |

### 누락 유형의 근본 문제

현재 프롬프트:
```
"targetExcerpt": "번역문 30자 이내 (수정 대상 텍스트)"
```

누락에서 "수정 대상 텍스트"가 모호함:
- AI가 "누락된 내용"을 targetExcerpt에 넣음
- 그 텍스트는 번역문에 없으므로 검색 실패

---

## 개선 방안

### Option A: 프롬프트 재정의 (누락 유형 특별 처리)

**개념**: 누락에서 targetExcerpt를 "삽입 위치의 앵커 텍스트"로 재정의

```
누락의 경우:
- targetExcerpt: 삽입할 위치 **앞**에 있는 기존 번역문
- suggestedFix: targetExcerpt + 누락된 내용 포함

예시)
  원문: "1. 개요 2. 위치: /path 3. 팁"
  번역: "1. Overview 3. Tips" (위치 누락)

  targetExcerpt: "1. Overview"  ← 삽입 위치 앞 텍스트
  suggestedFix: "1. Overview\n2. Location: /path"  ← 앵커 + 누락 내용
```

**장점**:
- 기존 교체 로직 그대로 사용 가능
- 코드 변경 최소화

**단점**:
- AI가 정확히 따라야 함
- 프롬프트가 복잡해짐
- 앵커 텍스트 선택이 어려울 수 있음

**구현**:
- `reviewTool.ts` OUTPUT_FORMAT 수정
- 누락 유형 전용 예시 추가

---

### Option B: 유형별 분기 처리

**개념**: 누락 유형은 "적용" 대신 "복사"만 제공

```
오역/왜곡/일관성:
  - 하이라이트: Target에서 targetExcerpt
  - 적용: targetExcerpt → suggestedFix 교체

누락:
  - 하이라이트: Source에서 sourceExcerpt (원문에서 누락된 부분)
  - 적용: "복사" 버튼 → suggestedFix 클립보드 복사
  - 사용자가 적절한 위치에 수동 삽입
```

**장점**:
- 안전하고 현실적
- 잘못된 위치에 삽입될 위험 없음
- 구현 간단

**단점**:
- 완전 자동화 아님
- 사용자 수동 작업 필요

**구현**:
- `ReviewResultsTable.tsx`: 누락 유형에서 "적용" → "복사" 버튼
- `ReviewPanel.tsx`: `handleCopySuggestion` 추가
- `ReviewHighlight.ts`: 누락일 때 Source 에디터 하이라이트

---

### Option C: 앵커 필드 추가

**개념**: 삽입 위치를 명시하는 새 필드 추가

```json
{
  "type": "누락",
  "sourceExcerpt": "원문에서 누락된 부분",
  "targetExcerpt": "",  // 빈 문자열 (없으니까)
  "suggestedFix": "추가할 번역문",
  "anchorText": "삽입 위치 기준 텍스트",
  "insertPosition": "after"  // "before" | "after"
}
```

**장점**:
- 명확한 데이터 구조
- 자동 삽입 가능

**단점**:
- 프롬프트 수정 필요
- 파싱 로직 수정 필요
- 적용 로직 수정 필요

**구현**:
- `reviewTool.ts`: OUTPUT_FORMAT에 anchorText, insertPosition 추가
- `parseReviewResult.ts`: 새 필드 파싱
- `reviewStore.ts`: ReviewIssue 타입 확장
- `ReviewPanel.tsx`: 삽입 로직 구현

---

### Option D: Context 기반 스마트 검색

**개념**: targetExcerpt를 못 찾으면 주변 컨텍스트로 위치 추정

```
1. targetExcerpt로 검색 시도
2. 실패 시:
   - sourceExcerpt의 앞뒤 문장 추출
   - 해당 문장들의 번역을 Target에서 검색
   - 그 사이에 suggestedFix 삽입
```

**장점**:
- 가장 지능적인 방식
- 기존 데이터 구조 유지

**단점**:
- 구현 복잡
- 오류 가능성 높음
- 번역 순서가 원문과 다를 경우 실패

---

## 안정성 관점에서의 Option 평가

| Option | 안정성 | 변경 범위 | AI 의존성 | 위험 요소 |
|--------|--------|----------|----------|----------|
| **A (프롬프트 재정의)** | ❌ 낮음 | 작음 | 높음 | AI가 앵커를 정확히 선택할지 보장 없음 |
| **B (유형별 분기)** | ✅ 높음 | 작음 | 없음 | 수동 작업 필요 (의도적 제약) |
| **C (앵커 필드 추가)** | △ 중간 | 큼 | 높음 | 파싱/적용 로직 복잡도 증가 |
| **D (Context 기반 검색)** | ❌ 낮음 | 큼 | 중간 | 번역 순서 변경 시 실패 |

---

## 권장 구현 순서 (안정성 최우선)

**핵심 원칙**: "잘못된 자동 적용"보다 "안전한 수동 개입"이 낫다.

### Phase 1: 검색 정규화 개선 (공통 문제 해결)

**우선순위 최상** - 현재 `stripMarkdown`이 불완전해서 오역/왜곡/일관성 유형에서도 실패 가능

1. `normalizeForSearch` 함수로 개선:
   ```typescript
   function normalizeForSearch(text: string): string {
     return text
       // 마크다운 서식 제거
       .replace(/\*\*(.+?)\*\*/g, '$1')     // bold
       .replace(/\*(.+?)\*/g, '$1')         // italic
       .replace(/__(.+?)__/g, '$1')         // bold alt
       .replace(/_(.+?)_/g, '$1')           // italic/underline
       .replace(/~~(.+?)~~/g, '$1')         // strikethrough
       .replace(/`(.+?)`/g, '$1')           // inline code
       .replace(/\[(.+?)\]\(.+?\)/g, '$1')  // links
       // 리스트/헤딩 마커 제거
       .replace(/^#{1,6}\s+/gm, '')         // headings
       .replace(/^\s*[-*+]\s+/gm, '')       // unordered list
       .replace(/^\s*\d+\.\s+/gm, '')       // ordered list
       // 공백 정규화
       .replace(/\s+/g, ' ')                // 연속 공백 → 단일 공백
       .trim();
   }
   ```

2. 적용 위치:
   - `ReviewHighlight.ts`: `stripMarkdown` → `normalizeForSearch`
   - `ReviewResultsTable.tsx`: 동일
   - `ReviewPanel.tsx`: `handleApplySuggestion` 내부

### Phase 2: 누락 유형 UI 분리 (Option B 핵심)

1. `ReviewResultsTable.tsx`:
   ```tsx
   {issue.type === 'omission' ? (
     <button onClick={() => onCopy?.(issue)}>
       {t('review.copy', '복사')}
     </button>
   ) : (
     <button onClick={() => onApply?.(issue)}>
       {t('review.apply', '적용')}
     </button>
   )}
   ```

2. `ReviewPanel.tsx`:
   - `handleCopySuggestion` 함수 추가
   - 복사 시 토스트: "클립보드에 복사되었습니다. 적절한 위치에 붙여넣어 주세요."

**장점**:
- 잘못된 위치에 삽입될 위험 0%
- 코드 변경 최소 (UI 버튼 조건문 1개)
- 테스트가 간단함

### Phase 3: 검색 실패 시 Fallback 전략

검색이 실패해도 사용자 작업이 중단되지 않도록 graceful degradation:

```typescript
// handleApplySuggestion 개선
const matches = editor.storage.searchHighlight?.matches || [];
if (matches.length === 0) {
  // 검색 실패 → 복사로 폴백
  await navigator.clipboard.writeText(issue.suggestedFix);
  addToast({
    type: 'warning',
    message: t('review.applyError.fallbackCopy', 
      '해당 텍스트를 찾을 수 없어 클립보드에 복사했습니다.'),
  });
  editor.commands.setSearchTerm('');
  return;
}
```

### Phase 4: (선택) 누락 유형 Source 하이라이트

1. Source 에디터에도 `ReviewHighlight` 확장 적용
2. 유형에 따라 동적으로 excerptField 결정:
   - 누락: `sourceExcerpt` → Source 에디터
   - 나머지: `targetExcerpt` → Target 에디터

---

## 권장하지 않는 것 (안정성 저해)

### Option A (프롬프트 개선) - 보류

- AI가 앵커를 정확히 선택할 보장이 없음
- 프롬프트 복잡도가 올라갈수록 예측 불가능성 증가
- 테스트/검증이 어려움 (AI 응답이 매번 다름)

### Fuzzy 검색 - 신중하게

- Levenshtein 거리 기반 검색은 **오탐 위험**이 있음
- "비슷한 텍스트"를 잘못 교체하면 데이터 손실
- 필요하다면 임계값을 매우 보수적으로 설정 (90%+ 일치)

### Option C (앵커 필드) - 변경 범위 큼

- 타입, 프롬프트, 파싱, 적용 로직 모두 수정 필요
- 회귀 위험 높음

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/ai/tools/reviewTool.ts` | 검수 프롬프트, OUTPUT_FORMAT |
| `src/ai/review/parseReviewResult.ts` | AI 응답 파싱 |
| `src/stores/reviewStore.ts` | ReviewIssue 타입, 상태 관리 |
| `src/editor/extensions/ReviewHighlight.ts` | 하이라이트 로직 |
| `src/components/review/ReviewPanel.tsx` | 적용 로직 |
| `src/components/review/ReviewResultsTable.tsx` | UI |

---

## 테스트 케이스

### Phase 1: 검색 정규화 (회귀 테스트)
- [ ] 일반 문단 → 적용 성공
- [ ] 리스트 항목 (`1. item`, `- item`) → 적용 성공
- [ ] 헤딩 (`# Title`) → 적용 성공
- [ ] 볼드/이탤릭 포함 (`**bold**`, `*italic*`) → 적용 성공
- [ ] 링크 포함 (`[text](url)`) → 적용 성공
- [ ] 코드 포함 (`` `code` ``) → 적용 성공

### Phase 2: 누락 유형 UI 분리
- [ ] 누락 이슈 → "복사" 버튼 표시 (적용 버튼 없음)
- [ ] 복사 클릭 → 클립보드에 복사 + 토스트
- [ ] 오역/왜곡/일관성 → "적용" 버튼 표시 (기존 동작)

### Phase 3: Fallback 동작
- [ ] 검색 실패 시 → 복사로 폴백 + warning 토스트
- [ ] 복사 후 → 검색어 초기화

### Phase 4: (선택) Source 하이라이트
- [ ] 누락 이슈 체크 → Source 에디터에서 하이라이트
- [ ] 오역/왜곡/일관성 체크 → Target 에디터에서 하이라이트

### 엣지 케이스
- [ ] 동일 텍스트 여러 개 → 첫 번째만 교체
- [ ] 특수문자 포함 (`$100`, `file.txt`, `C++`) → 정상 검색
- [ ] 빈 suggestedFix → 삭제 확인 다이얼로그
- [ ] 코드 블록 내 텍스트 → 적용 성공
- [ ] 연속 공백/줄바꿈 포함 → 정규화 후 검색 성공

### 안정성 검증
- [ ] 기존 오역/왜곡/일관성 적용이 깨지지 않았는지 (회귀)
- [ ] 잘못된 위치에 삽입되는 경우가 없는지
- [ ] 모든 케이스에서 사용자 작업이 완료 가능한지 (graceful degradation)
