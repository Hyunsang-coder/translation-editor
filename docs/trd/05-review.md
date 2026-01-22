# 5. 번역 검수 (Translation Review)

## 5.1 개요

### Why
- 번역 완료 후 오역, 누락, 왜곡, 일관성 문제를 AI가 자동으로 검출하여 번역사의 검토 시간을 단축합니다.
- 검수 결과를 에디터에서 시각적으로 확인하며 수정할 수 있어야 합니다.

### How
- 문서를 청크로 분할하여 순차적으로 AI 검수 요청
- 검수 결과는 JSON 형식으로 파싱하여 테이블로 표시
- 체크된 이슈만 에디터에서 하이라이트 (TipTap Decoration)

---

## 5.2 핵심 원칙

- **Non-Intrusive**: 문서 자동 변경 없음, Decoration은 비영속적
- **전용 UI로만 실행**: 채팅에서 검수 요청 불가, Review 탭에서만 실행
  - 채팅에서 검수 요청 시 "Review 탭을 사용해주세요" 안내
- **2분할 레이아웃 유지**: 새 컬럼 추가 대신 SettingsSidebar에 Review 탭 추가
- **JSON 출력 포맷**: TRD 3.2에서 "검수는 JSON 리포트 허용"으로 명시

---

## 5.3 UI 구성

### Review 탭
- SettingsSidebar의 기능 탭으로 추가 (Settings | Review)
- Settings 사이드바 내에서 탭 전환 형태로 관리
- 검수 시작 시에만 Review 탭 표시, 닫으면 Settings 탭으로 복귀

### 검수 시작
- 버튼 클릭으로 검수 시작, 취소 가능

### 결과 테이블
- 체크박스 + 이슈 정보 (컬럼: 체크 | # | 유형 | 수정 제안 | 설명)

### 하이라이트 토글
- 체크된 이슈만 Target 에디터에서 하이라이트

### 수정 제안 적용
- 이슈별 액션 버튼 (적용/복사/무시)

---

## 5.4 데이터 모델

```typescript
interface ReviewIssue {
  id: string;                    // 결정적 ID (hashContent로 생성)
  segmentOrder: number;
  segmentGroupId?: string;       // 세그먼트 단위 하이라이트용
  sourceExcerpt: string;         // 원문 구절 (35자 이내)
  targetExcerpt: string;         // 현재 번역 (하이라이트 대상)
  suggestedFix: string;          // 수정 제안
  type: 'error' | 'omission' | 'distortion' | 'consistency';
  description: string;
  checked: boolean;              // 체크 상태
}
```

---

## 5.5 AI 출력 형식

```json
{
  "issues": [
    {
      "segmentOrder": 0,
      "segmentGroupId": "...",
      "type": "오역|누락|왜곡|일관성",
      "sourceExcerpt": "원문 35자 이내",
      "targetExcerpt": "현재 번역 35자 이내",
      "suggestedFix": "수정 제안",
      "description": "간결한 설명"
    }
  ]
}
```

---

## 5.6 하이라이트 매칭 전략

1. segmentGroupId가 있으면 해당 세그먼트의 target 텍스트에서 targetExcerpt 검색
2. 1단계 실패 시 전체 문서에서 targetExcerpt substring 검색 (첫 매치)
3. 2단계도 실패 시 하이라이트 없이 패널에 "매칭 실패" 표시 (무해)
4. **노드 경계 처리**: `buildTextWithPositions()`로 전체 텍스트/위치 매핑을 구축하여 TipTap 노드 경계를 넘는 텍스트도 검색 가능

---

## 5.7 구현 파일

| 파일 | 역할 |
|------|------|
| `src/stores/reviewStore.ts` | 검수 상태 관리 (체크, 하이라이트, 중복 제거) |
| `src/stores/uiStore.ts` | UI 상태 관리 (패널 위치, 크기, 탭 상태 등) |
| `src/components/panels/SettingsSidebar.tsx` | Settings/Review 사이드바 (탭 전환) |
| `src/components/panels/FloatingChatPanel.tsx` | 플로팅 Chat 패널 (react-rnd) |
| `src/components/chat/ChatContent.tsx` | Chat 기능 컨텐츠 |
| `src/components/ui/FloatingChatButton.tsx` | 플로팅 Chat 버튼 (드래그 가능) |
| `src/components/review/ReviewPanel.tsx` | Review 탭 콘텐츠 |
| `src/components/review/ReviewResultsTable.tsx` | 결과 테이블 + 체크박스 |
| `src/ai/review/runReview.ts` | 검수 전용 API 호출 함수 (도구 없이 단순 1회 호출) |
| `src/ai/review/parseReviewResult.ts` | AI 응답 JSON/마크다운 파싱 |
| `src/editor/extensions/ReviewHighlight.ts` | TipTap Decoration 하이라이트 |
| `src/editor/editorRegistry.ts` | 에디터 인스턴스 글로벌 레지스트리 |
| `src/utils/normalizeForSearch.ts` | 마크다운 정규화 유틸리티 |

---

## 5.8 상태 관리 (reviewStore)

- `initializeReview(project)`: 프로젝트를 청크로 분할, 상태 초기화
- `addResult(result)`: 청크별 검수 결과 추가
- `toggleIssueCheck(issueId)`: 이슈 체크 상태 토글
- `deleteIssue(issueId)`: 개별 이슈 삭제 (Apply 시 자동 호출)
- `setAllIssuesChecked(checked)`: 전체 선택/해제
- `getAllIssues()`: 중복 제거된 전체 이슈 목록
- `getCheckedIssues()`: 체크된 이슈만 반환
- `toggleHighlight()`: 하이라이트 활성화/비활성화
- `disableHighlight()`: Review 탭 닫을 때 호출 (highlightNonce 증가로 에디터 새로고침)
- **하이라이트 자동 재계산**: ProseMirror plugin이 `tr.docChanged` 감지 시 자동으로 decoration 재계산 (cross-store subscription 불필요)

---

## 5.9 요청 취소 및 리소스 관리

- **AbortController**: 검수 요청 시 `AbortController` 생성, 취소/닫기 시 `abort()` 호출
- **AbortSignal 전달**: `streamAssistantReply` 호출 시 `abortSignal: controller.signal` 명시적 전달
- **청크 크기 일관성**: `DEFAULT_REVIEW_CHUNK_SIZE` 상수(12000)로 초기화와 후속 청킹 기준 통일
- **최신 상태 참조**: 청크 처리 루프 내에서 `useChatStore.getState()`로 최신 `translationRules`/`projectContext` 참조 (클로저 캡처된 값 대신)
- **파싱 에러 복구**: `parseReviewResult()` try-catch 래핑으로 파싱 실패 시에도 다음 청크 계속 진행

---

## 5.10 JSON 파싱 안정성

- **균형 중괄호 매칭**: greedy 정규식 대신 `extractJsonObject()`에서 중괄호 카운팅으로 정확한 JSON 범위 추출
- **segmentOrder 타입 처리**: 문자열("1")도 `parseInt`로 변환하여 숫자로 처리
- **마크다운 폴백**: JSON 파싱 실패 시 마크다운 테이블 형식으로 폴백

---

## 5.11 검수 항목 검증

- **hasEnabledCategories**: 검수 카테고리가 하나 이상 선택되어야 검수 실행 가능
- **버튼 비활성화**: 카테고리 미선택 시 버튼 disabled 처리 및 툴팁 표시

---

## 5.12 수정 제안 적용 (Apply Suggestion)

### 적용 대상
- 오역(error), 왜곡(distortion), 일관성(consistency) 타입

### 처리 흐름
1. `normalizeForSearch(targetExcerpt)`로 마크다운 서식 제거
2. `editorRegistry.getTargetEditor()`로 에디터 인스턴스 획득
3. `editor.commands.setSearchTerm(searchText)`로 검색
4. `editor.commands.replaceMatch(suggestedFix)`로 첫 번째 매치 교체
5. 이슈 삭제 및 성공 토스트 표시

### 검색 실패 시
- 에러 토스트 표시 ("번역문에서 해당 텍스트를 찾을 수 없습니다")

### 빈 suggestedFix
- 삭제 확인 다이얼로그 표시 후 진행

---

## 5.13 누락 유형 복사 (Copy for Omission)

- **대상**: 누락(omission) 타입 (번역문에 없는 텍스트이므로 자동 교체 불가)
- **처리**: suggestedFix를 클립보드에 복사
- **UX**: "복사" 버튼 표시, 복사 성공 시 안내 토스트 ("클립보드에 복사되었습니다. 적절한 위치에 붙여넣어 주세요.")

---

## 5.14 마크다운 정규화 (normalizeForSearch)

- **목적**: AI 응답의 excerpt에 포함된 마크다운 서식 제거
- **구현**: `src/utils/normalizeForSearch.ts`
- **처리 항목**:
  - HTML 엔티티: `&nbsp;`, `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;` 변환
  - 인라인 서식: `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](url)` 제거
  - 블록 마커: `# Heading`, `- item`, `1. item` 제거
  - Unicode 특수 공백: `\u00A0` (non-breaking space), `\u2000-\u200A` (다양한 너비 공백), `\u3000` (전각 공백) 정규화
  - 줄바꿈 통일: CRLF, CR → 공백
  - 공백 정규화: 연속 공백 → 단일 공백

---

## 5.14.1 양방향 정규화 (Bidirectional Normalization)

### Why
- AI의 `targetExcerpt`와 에디터 텍스트 사이에 공백/특수문자 차이가 있으면 하이라이트 실패
- 한쪽만 정규화하면 여전히 불일치 발생

### How
- 에디터 텍스트도 정규화하되, 원본 위치 매핑을 유지
- `buildNormalizedTextWithMapping()`: 정규화된 텍스트의 각 인덱스가 원본 텍스트의 어느 인덱스에 해당하는지 추적

### What
```typescript
// ReviewHighlight.ts
function buildNormalizedTextWithMapping(originalText: string): {
  normalizedText: string;  // 정규화된 텍스트
  indexMap: number[];      // normalizedText[i] → originalText index
}
```

### 동작 흐름
```
에디터 텍스트: "번역된  텍스트입니다."  (공백 2개)
     ↓ buildNormalizedTextWithMapping()
정규화 텍스트: "번역된 텍스트입니다."   (공백 1개)
인덱스 매핑:   [0,1,2,3,5,6,7,8,9,10,11,12]  (인덱스 4 스킵)

AI excerpt: "번역된 텍스트입니다."
     ↓ normalizeForSearch()
검색 텍스트: "번역된 텍스트입니다."

정규화 텍스트에서 검색 → index=0 찾음
인덱스 매핑으로 원본 위치 복원 → from=0, to=12
Decoration 생성
```

---

## 5.15 검수 전용 API (runReview)

### Why
- 기존 채팅 인프라(Tool Calling, Responses API)는 검수에 불필요한 오버헤드를 발생시킵니다.
- 검수는 단순 JSON 응답만 필요하므로, 도구 호출 없이 직접 API 호출이 효율적입니다.

### How
- `src/ai/review/runReview.ts`에서 전용 함수 제공
- `createChatModel({ useFor: 'translation' })`로 Responses API 비활성화
- 도구(Tool) 바인딩 없이 단순 스트리밍 호출

### What

```typescript
interface RunReviewParams {
  segments: AlignedSegment[];
  intensity: ReviewIntensity;
  translationRules?: string;
  glossary?: string;
  abortSignal?: AbortSignal;
  onToken?: (accumulated: string) => void;
}

async function runReview(params: RunReviewParams): Promise<string>
```

### 성능 개선
- Tool Calling 루프 제거 → 응답 시간 단축
- Responses API 비활성화 → 불필요한 후처리 생략
- 청크당 단일 API 호출 → 예측 가능한 latency

---

## 5.16 하이라이트 자동 재계산

### 동작 원리
- `ReviewHighlight.ts`의 ProseMirror plugin이 `tr.docChanged` 감지 시 자동으로 decoration 재계산
- 수정 적용 후 해당 이슈는 `deleteIssue()`로 삭제되어 다음 재계산 시 하이라이트에서 제외
- 수동 편집 시에도 찾을 수 있는 이슈는 계속 하이라이트, 텍스트가 변경되어 못 찾으면 자연스럽게 제거

### 장점
- Cross-store subscription 불필요 (코드 단순화)
- 수동 편집 후에도 다른 이슈 하이라이트 유지
- `isApplyingSuggestion` 플래그 불필요

---

## 5.17 검수 진행 UX

### 진행 상태 표시
- **로딩 애니메이션**: 도트 3개 bounce 애니메이션
- **경과 시간**: 초 단위 표시 (`elapsedSeconds`)
- **진행률 바**: 청크 기준 (완료/전체) + 퍼센트
- **스트리밍 텍스트**: AI 응답 실시간 확인 가능 (접이식 `<details>`)

### 스트리밍 텍스트 표시
```typescript
// reviewStore
streamingText: string  // 현재 청크의 AI 스트리밍 응답 텍스트

// runReview 호출 시
runReview({
  ...params,
  onToken: (text) => setStreamingText(text),
});
```

- 검수 진행 중: 접이식으로 실시간 응답 확인
- 검수 완료 후: 마지막 청크 응답 유지 (디버깅용)

---

## 5.18 마커 기반 JSON 추출 (Phase 3)

### Why
- AI 응답에 JSON 외 텍스트가 포함되어 파싱 실패하는 케이스 방지
- 명확한 경계 마커로 안정적인 추출

### 출력 형식
```
---REVIEW_START---
{
  "issues": [...]
}
---REVIEW_END---
```

### 추출 우선순위
1. `---REVIEW_START/END---` 마커 기반 추출
2. brace counting 기반 추출 (기존)
3. 마크다운 테이블 파싱 (fallback)

### 구현 파일
- `src/ai/review/parseReviewResult.ts` - `extractMarkedJson()`

---

## 5.19 폴리싱 모드 (Polishing Mode)

### Why
- 원문 없이 번역문만 검토하는 "폴리싱" 작업 지원
- 문법/오탈자 검사, 어색한 문장 감지 등 번역문 품질 개선에 집중

### How
- 검수 모드를 두 카테고리로 분류:
  - **대조 검수** (원문↔번역문): minimal, balanced, thorough
  - **폴리싱** (번역문만): grammar, fluency
- `isPolishingMode()` 헬퍼로 모드 구분
- 폴리싱 모드는 `sourceText` 없이 `targetText`만 전송

### What

#### ReviewIntensity 타입
```typescript
type ReviewIntensity =
  | 'minimal' | 'balanced' | 'thorough'  // 대조 검수
  | 'grammar' | 'fluency';                // 폴리싱
```

#### 모드 판별 헬퍼
```typescript
function isPolishingMode(intensity: ReviewIntensity): boolean {
  return intensity === 'grammar' || intensity === 'fluency';
}
```

#### 폴리싱 프롬프트
- **grammar**: 문법/오탈자 검사 (맞춤법, 띄어쓰기, 문법 오류, 오탈자)
- **fluency**: 어색한 문장 감지 (어색한 표현, 번역투, 어순 문제, 중복 표현)

#### 메시지 형식 차이
```
# 대조 검수
[#1]
Source: 원문 텍스트
Target: 번역문 텍스트

# 폴리싱
[#1]
Text: 번역문 텍스트
```

#### 출력 형식
폴리싱 모드의 이슈 타입:
- `문법`: 문법 오류
- `오탈자`: 맞춤법/철자 오류
- `어색`: 부자연스러운 표현
- `번역투`: 외국어 번역체
- `중복`: 불필요한 반복

```json
{
  "issues": [
    {
      "segmentOrder": 1,
      "type": "문법",
      "targetExcerpt": "문제 있는 부분",
      "suggestedFix": "수정 제안",
      "description": "설명"
    }
  ]
}
```

### UI 변경
- 드롭다운에 optgroup으로 카테고리 구분
- Headless UI Select 컴포넌트 사용

### 구현 파일
- `src/stores/reviewStore.ts` - `ReviewIntensity` 타입, `isPolishingMode()` 헬퍼
- `src/ai/tools/reviewTool.ts` - 폴리싱 프롬프트 (POLISHER_ROLE_*, POLISH_PROMPTS)
- `src/ai/review/runReview.ts` - 폴리싱 모드 분기 처리
- `src/components/review/ReviewPanel.tsx` - IntensitySelect optgroup UI
