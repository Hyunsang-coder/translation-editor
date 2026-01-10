# ReviewTool 번역 검수 정확도 개선 계획

## 구현 진행 체크리스트

### Phase 1: Quick Wins
- [x] A. REVIEW_INSTRUCTIONS 개선 (`src/ai/tools/reviewTool.ts`)
- [x] B. Glossary 검색 제한 완화 (2000→4000, 20→40)

### Phase 2: Core Improvements
- [x] A. buildAlignedChunks 함수 구현
- [x] B. reviewStore.ts 생성
- [x] C. getReviewChunkTool 추가
- [x] D. reviewTranslationTool 개선

### Phase 3: UI 구현
- [x] A. 검수 버튼 추가 (EditorCanvasTipTap)
- [x] B. ReviewModal.tsx 생성
- [x] C. ReviewResultsTable.tsx 생성

### Phase 4: 결과 처리 및 Polish
- [x] A. parseReviewResult.ts 생성
- [x] B. 중복 제거 및 에러 핸들링 추가

### Phase 5: UI 개선
- [x] A. IssueType에 `consistency`(일관성) 추가
- [x] B. 컬럼 순서 변경: 이슈 | 유형 | 원문 | 설명
- [x] C. 이슈 번호 순차 표시 (1, 2, 3)
- [x] D. 원문 컬럼 너비 3배 증가
- [x] E. 마크다운 태그 제거
- [x] F. i18n 키 추가

### 기타
- [x] i18n 번역 키 추가 (ko.json, en.json)
- [x] chat.ts에 getReviewChunkTool 바인딩 추가

---

## 1. 문제 분석 요약

### 1.1 핵심 문제점

| 문제 | 원인 | 영향도 |
|------|------|--------|
| **문서 중간 부분 누락** | `autoSliceLargeDocument`가 head(62%)+tail(38%)로 자름 | 심각 |
| **원문-번역문 정렬 불일치** | Source/Target 각각 독립적으로 슬라이싱 | 심각 |
| **구조 정보 미활용** | `blockRanges`, `segmentStartOffsets` 무시 | 중간 |
| **Glossary 검색 제한** | 쿼리 2000자, 결과 20개 제한 | 중간 |
| **보수적 검수 지침** | "확실한 경우에만" 표시 → Recall 저하 | 중간 |

### 1.2 활용 가능한 기존 인프라

- `SegmentGroup` 구조: `sourceIds` + `targetIds` + `order`로 정렬된 쌍 제공
- `buildSourceDocument/buildTargetDocument`: `blockRanges` 반환 (현재 미활용)
- `chat.ts`의 tool calling loop: 최대 8스텝 반복 실행 가능
- `documentTools.ts`의 `query/aroundChars` 파라미터: 특정 구절 주변 발췌

---

## 2. 개선 방안 상세

### 2.1 Phase 1: Quick Wins (1-2일)

#### A. REVIEW_INSTRUCTIONS 개선
**파일**: `src/ai/tools/reviewTool.ts` (62-124행)

**변경 내용**:
```typescript
const REVIEW_INSTRUCTIONS = `당신은 한국어-영어 바이링구얼 20년 차 전문 번역가입니다.
주어진 **원문**과 **번역문**을 비교하여 번역 품질을 검수합니다.

### 1. 검수 범위와 기준

**검출 대상 (확신도 70% 이상)**:
- 🔴 **심각한 오역**: 의미가 반대이거나 완전히 다른 경우
- 🟠 **중요 정보 누락**: 수량, 조건, 제한, 예외, 주의사항 등
- 🟡 **강도/정도 왜곡**: must→can, always→sometimes 등
- 🟡 **주체/대상 변경**: 행위자나 대상이 바뀐 경우
- 🟡 **범위/조건 변경**: 부분↔전체, 조건부↔무조건
- 🟡 **사실 관계 변경**: 시제, 인과관계, 부정/긍정 역전

**허용되는 의역 (검출 제외)**:
- 어순, 스타일, 표현 방식만 다른 자연스러운 의역
- 중복 표현 제거, 사소한 수식어 생략 (핵심 의미 보존 시)
- 맞춤법/철자 오류 (의미 무관)

### 2. 검수 방식

1. **전체 훑기**: 원문 전체 구조 파악 (섹션, 문단, 핵심 포인트)
2. **1:1 대조**: 원문의 각 문장/구절이 번역문에 대응되는지 확인
3. **용어 일관성**: Glossary 제공 시 용어 사용 일관성 체크
4. **맥락 검증**: Project Context 참고하여 맥락 적합성 확인

### 3. 출력 형식

**문제 발견 시**:

| 세그먼트 | 원문 구절 | 문제 유형 | 설명 |
|----------|----------|----------|------|
| #N | 원문 35자 이내... | 오역/누락/왜곡 | 간결한 설명 |

**통계**: 총 N건 (오역 X, 누락 Y, 왜곡 Z)

**문제 없음 시**:
\`오역이나 누락이 발견되지 않았습니다.\`

### 4. 확신도 기준
- **70-84%**: 표에 포함하되 "가능성" 표현 사용
- **85-100%**: 확정적 표현 사용
- **70% 미만**: 표에 포함하지 않음

### 5. 참고 자료 활용
- **Translation Rules**: 번역 스타일/포맷 규칙 준수 여부
- **Project Context**: 도메인 지식, 맥락 정보 활용
- **Glossary**: 용어 번역 일관성 체크
- **Attachments**: 참고 자료 기반 정확성 검증`;
```

**효과**: Precision-Recall 균형 개선, 위치 정보 추가

#### B. Glossary 검색 제한 완화
**파일**: `src/ai/tools/reviewTool.ts` (161-167행)

**변경 내용**:
```typescript
// Before
const query = [...].slice(0, 2000);
const hits = await searchGlossary({ limit: 20 });

// After
const query = [...].slice(0, 4000);  // 2000 → 4000
const hits = await searchGlossary({ limit: 40 });  // 20 → 40
```

---

### 2.2 Phase 2: Core Improvements (4-5일)

#### A. 세그먼트 기반 청킹 함수 구현
**파일**: `src/ai/tools/reviewTool.ts` (새 함수 추가)

```typescript
interface AlignedChunk {
  chunkIndex: number;
  segments: Array<{
    groupId: string;
    order: number;
    sourceText: string;
    targetText: string;
  }>;
  totalChars: number;
}

function buildAlignedChunks(
  project: ITEProject,
  maxCharsPerChunk: number = 10000
): AlignedChunk[] {
  const orderedSegments = [...project.segments].sort((a, b) => a.order - b.order);
  const chunks: AlignedChunk[] = [];
  let currentChunk: AlignedChunk = { chunkIndex: 0, segments: [], totalChars: 0 };

  for (const seg of orderedSegments) {
    const sourceText = seg.sourceIds
      .map(id => stripHtml(project.blocks[id]?.content || ''))
      .join('\n');
    const targetText = seg.targetIds
      .map(id => stripHtml(project.blocks[id]?.content || ''))
      .join('\n');
    const segmentSize = sourceText.length + targetText.length;

    // 청크 크기 초과 시 새 청크 시작
    if (currentChunk.totalChars + segmentSize > maxCharsPerChunk && currentChunk.segments.length > 0) {
      chunks.push(currentChunk);
      currentChunk = { chunkIndex: chunks.length, segments: [], totalChars: 0 };
    }

    currentChunk.segments.push({
      groupId: seg.groupId,
      order: seg.order,
      sourceText,
      targetText,
    });
    currentChunk.totalChars += segmentSize;
  }

  if (currentChunk.segments.length > 0) chunks.push(currentChunk);
  return chunks;
}
```

#### B. 청크 캐싱 및 상태 관리
**파일**: `src/stores/reviewStore.ts` (새 파일)

```typescript
interface ReviewState {
  chunks: AlignedChunk[];
  currentChunkIndex: number;
  results: ReviewResult[];
  isReviewing: boolean;
  progress: { completed: number; total: number };
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  chunks: [],
  currentChunkIndex: 0,
  results: [],
  isReviewing: false,
  progress: { completed: 0, total: 0 },

  initializeReview: (project: ITEProject) => {
    const chunks = buildAlignedChunks(project);
    set({ chunks, currentChunkIndex: 0, results: [], progress: { completed: 0, total: chunks.length } });
  },

  addResult: (result: ReviewResult) => {
    const { results, progress } = get();
    set({
      results: [...results, result],
      progress: { ...progress, completed: progress.completed + 1 }
    });
  },
}));
```

#### C. 청크 도구 추가
**파일**: `src/ai/tools/reviewTool.ts`

```typescript
export const getReviewChunkTool = tool(
  async ({ chunkIndex }) => {
    const { chunks } = useReviewStore.getState();
    if (chunkIndex >= chunks.length) {
      return {
        error: 'No more chunks',
        totalChunks: chunks.length,
        message: '모든 청크 검수가 완료되었습니다. 최종 결과를 종합해주세요.'
      };
    }

    const chunk = chunks[chunkIndex];
    return {
      chunkIndex,
      totalChunks: chunks.length,
      segmentCount: chunk.segments.length,
      segments: chunk.segments.map(seg => ({
        id: seg.groupId,
        order: seg.order,
        source: seg.sourceText,
        target: seg.targetText,
      })),
    };
  },
  {
    name: 'get_review_chunk',
    description: '검수할 다음 청크를 가져옵니다. 문서가 길면 청크 단위로 순차 검수하세요.',
    schema: z.object({
      chunkIndex: z.number().int().min(0).describe('청크 인덱스 (0부터 시작)'),
    }),
  },
);
```

#### D. reviewTranslationTool 개선
**파일**: `src/ai/tools/reviewTool.ts`

```typescript
export const reviewTranslationTool = tool(
  async (rawArgs) => {
    const { project } = useProjectStore.getState();
    if (!project) throw new Error('프로젝트가 로드되지 않았습니다.');

    // 청크 분할 및 초기화
    const chunks = buildAlignedChunks(project);
    useReviewStore.getState().initializeReview(project);

    // 첫 번째 청크 반환 + 메타데이터
    const firstChunk = chunks[0];

    // Glossary, Rules, Context 수집 (기존 로직)
    const { translationRules, projectContext, attachments } = useChatStore.getState();
    let glossaryText = await searchGlossaryForDocument(project, firstChunk);

    return {
      instructions: REVIEW_INSTRUCTIONS,
      totalChunks: chunks.length,
      currentChunk: {
        index: 0,
        segments: firstChunk.segments,
      },
      translationRules: translationRules?.trim() || undefined,
      projectContext: projectContext?.trim() || undefined,
      glossary: glossaryText || undefined,
      note: chunks.length > 1
        ? `문서가 ${chunks.length}개 청크로 분할되었습니다. get_review_chunk 도구로 나머지 청크를 가져와 순차 검수하세요.`
        : undefined,
    };
  },
  // ... (기존 schema 유지)
);
```

---

### 2.3 Phase 3: UI 구현 (2-3일)

#### A. 검수 버튼 추가
**파일**: `src/components/panels/TargetPanel.tsx` (또는 툴바 컴포넌트)

```typescript
// 번역 버튼 옆에 검수 버튼 추가
<Button
  variant="outline"
  onClick={() => setIsReviewModalOpen(true)}
  disabled={!hasContent}
>
  <CheckCircle className="w-4 h-4 mr-2" />
  검수
</Button>
```

#### B. 검수 결과 모달
**파일**: `src/components/modals/ReviewModal.tsx` (새 파일)

```typescript
interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ReviewModal({ isOpen, onClose }: ReviewModalProps) {
  const { progress, results, isReviewing } = useReviewStore();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>번역 검수 결과</DialogTitle>
          {isReviewing && (
            <Progress value={(progress.completed / progress.total) * 100} />
          )}
        </DialogHeader>

        <div className="space-y-4">
          {results.length === 0 && !isReviewing ? (
            <p className="text-muted-foreground">검수를 시작하세요.</p>
          ) : (
            <ReviewResultsTable results={results} />
          )}
        </div>

        <DialogFooter>
          <Button onClick={startReview} disabled={isReviewing}>
            {isReviewing ? '검수 중...' : '검수 시작'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

#### C. 검수 결과 테이블 컴포넌트
**파일**: `src/components/review/ReviewResultsTable.tsx` (새 파일)

```typescript
interface ReviewResultsTableProps {
  results: ReviewResult[];
}

export function ReviewResultsTable({ results }: ReviewResultsTableProps) {
  const allIssues = results.flatMap(r => r.issues);

  if (allIssues.length === 0) {
    return <p className="text-green-600">오역이나 누락이 발견되지 않았습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>세그먼트</TableHead>
          <TableHead>원문</TableHead>
          <TableHead>문제 유형</TableHead>
          <TableHead>설명</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {allIssues.map((issue, idx) => (
          <TableRow key={idx} className={issueTypeColor(issue.type)}>
            <TableCell>#{issue.segmentOrder}</TableCell>
            <TableCell className="max-w-[200px] truncate">{issue.sourceExcerpt}</TableCell>
            <TableCell>{issue.type}</TableCell>
            <TableCell>{issue.description}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

---

### 2.4 Phase 4: 결과 처리 및 Polish (1-2일)

#### A. 결과 파싱 로직
**파일**: `src/ai/review/parseReviewResult.ts` (새 파일)

```typescript
interface ParsedIssue {
  segmentOrder: number;
  sourceExcerpt: string;
  type: '오역' | '누락' | '왜곡';
  description: string;
}

export function parseReviewResult(aiResponse: string): ParsedIssue[] {
  // 마크다운 테이블 파싱
  const tableRegex = /\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|/g;
  const rows = aiResponse.match(tableRegex) || [];

  // 헤더 제외하고 데이터 행만 파싱
  return rows.slice(2).map(row => {
    const cells = row.split('|').filter(c => c.trim());
    return {
      segmentOrder: parseInt(cells[0]?.replace('#', '') || '0'),
      sourceExcerpt: cells[1]?.trim() || '',
      type: categorizeIssueType(cells[2]?.trim() || ''),
      description: cells[3]?.trim() || '',
    };
  });
}
```

#### B. 중복 제거 로직
```typescript
export function deduplicateIssues(issues: ParsedIssue[]): ParsedIssue[] {
  const seen = new Map<string, ParsedIssue>();

  for (const issue of issues) {
    const key = `${issue.segmentOrder}-${issue.sourceExcerpt.slice(0, 20)}`;
    if (!seen.has(key)) {
      seen.set(key, issue);
    }
  }

  return Array.from(seen.values());
}
```

#### C. 에러 핸들링
```typescript
// reviewStore에 추가
handleChunkError: (chunkIndex: number, error: Error) => {
  set(state => ({
    results: [...state.results, {
      chunkIndex,
      issues: [],
      error: error.message,
    }],
    progress: { ...state.progress, completed: state.progress.completed + 1 }
  }));
}
```

---

## 3. 파일 수정 목록

### 신규 파일
| 파일 | 설명 |
|------|------|
| `src/stores/reviewStore.ts` | 검수 상태 관리 |
| `src/components/modals/ReviewModal.tsx` | 검수 결과 모달 |
| `src/components/review/ReviewResultsTable.tsx` | 결과 테이블 |
| `src/ai/review/parseReviewResult.ts` | AI 응답 파싱 |

### 수정 파일
| 파일 | 변경 내용 |
|------|----------|
| `src/ai/tools/reviewTool.ts` | REVIEW_INSTRUCTIONS 개선, 청킹 로직, getReviewChunkTool 추가 |
| `src/ai/chat.ts` | getReviewChunkTool 바인딩 추가 |
| `src/components/panels/TargetPanel.tsx` | 검수 버튼 추가 |
| `src/i18n/locales/ko.json` | 검수 관련 번역 키 추가 |
| `src/i18n/locales/en.json` | 검수 관련 번역 키 추가 |

---

## 4. 구현 로드맵

```
Week 1:
├─ Day 1-2: Phase 1 (Quick Wins)
│  ├─ REVIEW_INSTRUCTIONS 개선
│  └─ Glossary 제한 완화
│
├─ Day 3-5: Phase 2 (Core)
│  ├─ buildAlignedChunks 함수 구현
│  ├─ reviewStore 생성
│  └─ getReviewChunkTool 추가

Week 2:
├─ Day 1-2: Phase 3 (UI)
│  ├─ ReviewModal 구현
│  ├─ ReviewResultsTable 구현
│  └─ 검수 버튼 추가
│
├─ Day 3: Phase 4 (Polish)
│  ├─ 결과 파싱 로직
│  ├─ 중복 제거
│  └─ 에러 핸들링
│
└─ Day 4: 테스트 및 버그 수정
```

---

## 5. 검증 방법

### 5.1 단위 테스트
```typescript
// buildAlignedChunks 테스트
describe('buildAlignedChunks', () => {
  it('should split large document into multiple chunks', () => {
    const mockProject = createMockProject(50); // 50 segments
    const chunks = buildAlignedChunks(mockProject, 5000);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('should maintain source-target alignment', () => {
    const chunks = buildAlignedChunks(mockProject);
    for (const chunk of chunks) {
      for (const seg of chunk.segments) {
        expect(seg.sourceText).toBeDefined();
        expect(seg.targetText).toBeDefined();
      }
    }
  });
});
```

### 5.2 통합 테스트
1. **작은 문서 (< 10,000자)**: 단일 청크로 처리되는지 확인
2. **중간 문서 (10,000-50,000자)**: 2-5개 청크로 분할되는지 확인
3. **큰 문서 (> 50,000자)**: 다중 청크 순차 검수 완료 확인

### 5.3 수동 테스트 시나리오
1. 번역 버튼 옆에 "검수" 버튼이 표시되는지 확인
2. 검수 버튼 클릭 시 모달이 열리는지 확인
3. "검수 시작" 클릭 시 진행률 표시 확인
4. 검수 완료 후 결과 테이블에 문제가 표시되는지 확인
5. 오역/누락/왜곡 유형별로 색상 구분되는지 확인

### 5.4 API 호출 비용 모니터링
- 청크당 토큰 사용량 로깅
- 전체 검수 비용 요약 표시

---

## 6. 예상 효과

| 지표 | 현재 | 개선 후 |
|------|------|--------|
| 문서 커버리지 | ~40% (head+tail) | 100% |
| Source-Target 정렬 | 미보장 | 세그먼트 단위 보장 |
| 검출 정확도 (Recall) | 낮음 (보수적 지침) | 개선 (70% threshold) |
| Glossary 커버리지 | 2000자 쿼리 | 4000자+ 청크별 검색 |
| 사용자 경험 | 없음 | 전용 모달 + 진행률 표시 |

---

## 7. 리스크 및 완화 방안

| 리스크 | 완화 방안 |
|--------|----------|
| API 호출 비용 증가 | 청크 크기 조절 (10,000 → 15,000), 빠른 검수 모드 옵션 |
| 모델의 도구 사용 불일관성 | 시스템 프롬프트에 명시적 지침 추가 |
| 청크 경계 중복 검출 | 세그먼트 단위 분할로 중복 최소화 + 후처리 중복 제거 |
| 8스텝 제한 초과 | 매우 긴 문서는 경고 표시 + 수동 재시작 옵션 |
