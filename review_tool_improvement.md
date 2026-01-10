# ReviewTool 번역 검수 기능 개선

## 구현 진행 체크리스트

### ✅ 완료된 Phase (1~5)

| Phase | 내용 | 주요 파일 |
|-------|------|----------|
| 1 | REVIEW_INSTRUCTIONS 개선, Glossary 제한 완화 | `reviewTool.ts` |
| 2 | buildAlignedChunks, reviewStore, getReviewChunkTool | `reviewTool.ts`, `reviewStore.ts` |
| 3 | 검수 버튼, ReviewModal, ReviewResultsTable | `EditorCanvasTipTap.tsx`, `ReviewModal.tsx` |
| 4 | parseReviewResult, 중복 제거, 에러 핸들링 | `parseReviewResult.ts` |
| 5 | UI 개선 (일관성 타입, 컬럼 순서, 마크다운 제거) | `ReviewResultsTable.tsx` |

---

### 🚧 Phase 6: 검수 결과 하이라이트 기능 (안정형 설계)

**컨셉**: 자동 치환 ❌ → 하이라이트 + 수동 수정 ✅

**핵심 원칙** (PRD/TRD 정합):
- Non-Intrusive: 문서 자동 변경 없음, Decoration은 비영속
- 2분할 레이아웃 유지: 새 컬럼 추가 대신 ChatPanel에 Review 탭 추가
- JSON 출력 포맷: TRD 3.2에서 "검수는 JSON 리포트 허용"으로 명시

---

## Phase 6 구현 순서 (안정형)

> 각 단계가 독립적으로 가치를 제공하며, 이전 단계 없이도 배포 가능

### Step 1: 데이터 모델 + 스토어 확장

**목표**: ReviewIssue 확장 및 체크 상태 관리

#### 1-A. ReviewIssue 인터페이스 확장

```typescript
// src/stores/reviewStore.ts
export interface ReviewIssue {
  id: string;                    // 결정적 ID (중복 제거/상태 유지용)
  segmentOrder: number;
  segmentGroupId?: string;       // (신규) 세그먼트 단위 하이라이트용
  sourceExcerpt: string;         // 원문 구절
  targetExcerpt: string;         // (신규) 현재 번역 (하이라이트 대상)
  suggestedFix: string;          // (신규) 수정 제안 (참고용)
  type: IssueType;
  description: string;
  checked: boolean;              // (신규) 체크 상태
}
```

**ID 생성 전략 (결정적)**:
```typescript
// 중복 제거 + 체크 상태 유지에 유리
const id = hashContent(`${segmentOrder}|${type}|${sourceExcerpt}|${targetExcerpt}`);
```

#### 1-B. reviewStore 액션 추가

```typescript
interface ReviewActions {
  // 기존...
  toggleIssueCheck: (issueId: string) => void;
  setAllIssuesChecked: (checked: boolean) => void;
  getCheckedIssues: () => ReviewIssue[];
}
```

#### 체크리스트
- [x] ReviewIssue에 `id`, `segmentGroupId`, `targetExcerpt`, `suggestedFix`, `checked` 추가
- [x] `toggleIssueCheck`, `setAllIssuesChecked`, `getCheckedIssues` 액션 추가
- [x] `getAllIssues()` 중복 제거 키를 `id` 기반으로 변경

---

### Step 2: AI 출력 포맷 → JSON 전환

**목표**: 파싱 안정성 확보 (마크다운 테이블 → JSON)

#### 2-A. ReviewModal 프롬프트 변경 (⚠️ 중요)

> `reviewTool.ts`만 바꾸면 적용 안 됨. ReviewModal이 직접 호출하는 프롬프트를 변경해야 함.

```typescript
// src/components/modals/ReviewModal.tsx
const userMessage = `다음 번역을 검수하고, 반드시 아래 JSON 형식으로만 출력하세요.
설명이나 마크다운 없이 JSON만 출력합니다.

검수 대상:
${segmentsText}

출력 형식:
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

문제가 없으면: { "issues": [] }`;
```

#### 2-B. parseReviewResult 수정

```typescript
// src/ai/review/parseReviewResult.ts
export function parseReviewResult(aiResponse: string): ReviewIssue[] {
  // 1. JSON 파싱 시도
  const jsonMatch = aiResponse.match(/\{[\s\S]*"issues"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return (parsed.issues ?? []).map((issue: any) => ({
        id: hashContent(`${issue.segmentOrder}|${issue.type}|${issue.sourceExcerpt}|${issue.targetExcerpt}`),
        segmentOrder: issue.segmentOrder ?? 0,
        segmentGroupId: issue.segmentGroupId,
        sourceExcerpt: issue.sourceExcerpt ?? '',
        targetExcerpt: issue.targetExcerpt ?? '',
        suggestedFix: issue.suggestedFix ?? '',
        type: categorizeIssueType(issue.type ?? ''),
        description: issue.description ?? '',
        checked: false,
      }));
    } catch { /* fallback to markdown */ }
  }
  
  // 2. 기존 마크다운 테이블 파싱 (폴백)
  return parseMarkdownTable(aiResponse);
}
```

#### 체크리스트
- [x] ReviewModal의 `userMessage`에 JSON 출력 형식 강제
- [x] parseReviewResult에 JSON 파싱 로직 추가 (마크다운 폴백 유지)
- [ ] reviewTool.ts의 REVIEW_INSTRUCTIONS도 JSON 형식으로 업데이트 (참고용) - 선택사항

---

### Step 3: ChatPanel에 Review 탭 추가

**목표**: Modal → 탭 전환 (2분할 레이아웃 유지)

#### 3-A. 레이아웃 결정

```
┌─────────────────────────────────────────────────────────┐
│ [Editor: Source | Target]      │  [Chat Panel]          │
│                                │  ┌──────────────────┐  │
│                                │  │ Settings │ Chat │ Review │
│                                │  ├──────────────────┤  │
│                                │  │  (탭 콘텐츠)      │  │
│                                │  └──────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

- Settings 탭처럼 "기능 탭"으로 추가 (채팅 탭 3개 제한과 별개)
- Review 탭 선택 시 검수 UI로 전환
- 채팅 탭과 Review 탭은 전환형 (동시 표시 X)

#### 3-B. 상태 관리

```typescript
// src/stores/uiStore.ts
interface UIState {
  // 기존...
  reviewPanelOpen: boolean;      // Review 탭 활성 여부
}

// 또는 ChatPanel 내부 상태로 관리
// activeTab: 'settings' | 'chat' | 'review'
```

#### 3-C. ReviewPanel 컴포넌트

```typescript
// src/components/review/ReviewPanel.tsx
// ReviewModal의 콘텐츠를 추출하여 패널 형태로 리팩토링
// - 검수 시작/취소 버튼
// - 진행 상태 표시
// - ReviewResultsTable
// - 하이라이트 버튼
```

#### 체크리스트
- [x] ChatPanel에 `activeTab` 상태 확장 (`'settings' | 'chat' | 'review'`)
- [x] Review 탭 UI 추가 (탭 헤더)
- [x] ReviewPanel 컴포넌트 생성 (ReviewModal 콘텐츠 추출)
- [x] ReviewModal 제거 또는 deprecated 처리
- [x] EditorCanvasTipTap에서 검수 버튼 → Review 탭 열기로 변경

---

### Step 4: 테이블 UI 업데이트

**목표**: 체크박스 + 새 컬럼 추가

#### 4-A. 테이블 컬럼 변경

| 체크 | # | 유형 | 원문 | 현재 번역 | 수정 제안 | 설명 |
|:----:|:-:|:----:|------|----------|----------|------|
| ☑️ | 1 | 오역 | 1~5cm | 1-12cm | 1~5cm | 숫자 변환 오류 |
| ☐ | 2 | 누락 | 제주까지 | (없음) | 제주까지 추가 | 지명 누락 |

**컬럼 너비:**
- 체크: `w-10`
- #: `w-8`
- 유형: `w-16`
- 원문/현재 번역/수정 제안: `flex-1` (균등 분배)
- 설명: 숨김 또는 hover 표시

#### 4-B. React key 변경

```typescript
// 기존: key={`${issue.segmentOrder}-${idx}`}
// 변경: key={issue.id}
```

#### 체크리스트
- [x] ReviewResultsTable에 체크박스 컬럼 추가
- [x] targetExcerpt, suggestedFix 컬럼 추가
- [x] React key를 `issue.id`로 변경
- [x] "전체 선택/해제" 기능 추가

---

### Step 5: TipTap 하이라이트 (Decoration)

**목표**: 체크된 이슈의 targetExcerpt를 에디터에 하이라이트

#### 5-A. 하이라이트 매칭 전략

```
1단계: segmentGroupId가 있으면
       → 해당 세그먼트의 target 텍스트에서 targetExcerpt 검색

2단계: 1단계 실패 시
       → 전체 문서에서 targetExcerpt substring 검색 (첫 매치)

3단계: 2단계도 실패 시
       → 하이라이트 없이 패널에 "매칭 실패" 표시 (무해)
```

#### 5-B. Decoration 구현 (비영속)

```typescript
// TipTap Decoration 사용
// - 문서 데이터에 포함되지 않음
// - Review 탭 닫으면 자동 해제
// - 검색 결과 하이라이트와 유사한 패턴
```

#### 5-C. 하이라이트 트리거

```typescript
// "표시" 버튼 클릭 시
// 또는 체크된 이슈 변경 시 자동 업데이트
const highlightCheckedIssues = () => {
  const checked = reviewStore.getCheckedIssues();
  // targetExcerpt로 위치 찾기 → Decoration 적용
};
```

#### 체크리스트
- [x] TipTapEditor에 Decoration 관리 로직 추가
- [x] 하이라이트 색상/스타일 정의 (CSS)
- [x] ReviewPanel에 "표시" 버튼 추가
- [ ] 매칭 실패 시 토스트/상태 표시 (선택사항)
- [x] Review 탭 닫을 때 Decoration 해제

---

### Step 6: i18n + 마무리

#### 체크리스트
- [x] `ko.json`, `en.json`에 Review 탭 관련 키 추가
- [x] 에러 메시지, 버튼 라벨 번역
- [x] 접근성(aria-label) 추가

---

## 수정 파일 목록 (최종)

| 파일 | 변경 내용 | Step |
|------|----------|:----:|
| `src/stores/reviewStore.ts` | ReviewIssue 확장, 체크 관리 액션 | 1 |
| `src/components/modals/ReviewModal.tsx` | 프롬프트 JSON 형식 강제 | 2 |
| `src/ai/review/parseReviewResult.ts` | JSON 파싱 로직 추가 | 2 |
| `src/ai/tools/reviewTool.ts` | REVIEW_INSTRUCTIONS 업데이트 (참고용) | 2 |
| `src/components/panels/ChatPanel.tsx` | Review 탭 추가 | 3 |
| `src/components/review/ReviewPanel.tsx` | (신규) Review 탭 콘텐츠 | 3 |
| `src/components/editor/EditorCanvasTipTap.tsx` | 검수 버튼 → Review 탭 열기 | 3 |
| `src/components/review/ReviewResultsTable.tsx` | 체크박스 + 새 컬럼 | 4 |
| `src/components/editor/TipTapEditor.tsx` | Decoration 로직 | 5 |
| `src/i18n/locales/*.json` | 번역 키 추가 | 6 |

---

## 아키텍처 참고

### 주요 파일 위치
```
src/
├── ai/
│   ├── review/
│   │   └── parseReviewResult.ts   # AI 응답 파싱 (JSON + 마크다운)
│   └── tools/
│       └── reviewTool.ts          # 검수 도구 정의
├── stores/
│   ├── reviewStore.ts             # 검수 상태 + 체크 관리
│   └── uiStore.ts                 # (선택) 리뷰 탭 상태
└── components/
    ├── panels/
    │   └── ChatPanel.tsx          # Settings | Chat | Review 탭
    ├── review/
    │   ├── ReviewPanel.tsx        # (신규) Review 탭 콘텐츠
    │   └── ReviewResultsTable.tsx # 결과 테이블 + 체크박스
    └── editor/
        ├── EditorCanvasTipTap.tsx # 검수 버튼 연결
        └── TipTapEditor.tsx       # Decoration 하이라이트
```

### 데이터 흐름
```
[검수 버튼] → Review 탭 열기 + reviewStore.initializeReview()
    ↓
[검수 시작] → AI 호출 (JSON 형식 강제)
    ↓
[응답 파싱] → parseReviewResult() (JSON 우선, 마크다운 폴백)
    ↓
[결과 저장] → reviewStore.addResult() (id 기반 중복 제거)
    ↓
[테이블 표시] → ReviewResultsTable (체크박스 + 새 컬럼)
    ↓
[체크 선택] → toggleIssueCheck()
    ↓
[표시 클릭] → Target 에디터에 Decoration 하이라이트
    ↓
[수동 수정] → 사용자가 하이라이트 보며 직접 편집
```

---

## 리스크 및 대응

| 리스크 | 대응 |
|--------|------|
| 모델이 JSON 형식을 안 지킬 수 있음 | 마크다운 테이블 폴백 파싱 유지 |
| targetExcerpt 매칭 실패 | 매칭 실패를 정상 플로우로 처리 (토스트만) |
| 체크 상태 유실 (청크 합칠 때) | 결정적 id로 상태 유지 |
| 탭 전환 시 검수 진행 상태 유실 | reviewStore에서 상태 관리 (컴포넌트 독립) |
