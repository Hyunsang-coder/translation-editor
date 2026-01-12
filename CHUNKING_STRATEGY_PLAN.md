# 청킹 전략 개선 계획

## 조사 결과 요약

### 업계 모범 사례 (Rich Context 번역)

#### 1. JSON 직접 번역이 표준
- TipTap JSON, Notion Rich Text JSON 등 구조화된 포맷으로 번역
- 텍스트 노드만 번역, 구조(marks, type, attrs)는 유지
- **현재 구현과 일치함** ✅

#### 2. 청킹 전략 권장사항
| 출처 | 권장 청크 크기 | 핵심 전략 |
|------|---------------|----------|
| Pinecone | 1,000-2,000 토큰 | 의미적 청킹, 문장 경계 존중 |
| LangChain | 문서 특성에 따라 적응 | RecursiveCharacterTextSplitter |
| OpenAI DevTeam | XML 태그로 구조 표시 | 구분자(delimiter) 사용 |

#### 3. 오버랩 전략
- **청크 간 2-3 문장 반복**으로 맥락 연속성 보장
- 번역 일관성(용어, 어조) 향상
- 병합 시 중복 제거 필수

#### 4. 알려진 한계
- ChatGPT: 특수 심볼 ~1% 손실 가능
- HTML 마크업: 태그 경계에서 문장 병합 발생
- **대응책**: 번역 후 검토 단계, 구조 검증

#### 5. JSON Mode vs Structured Output
| 항목 | JSON Mode (현재 사용) | Structured Output |
|------|---------------------|-------------------|
| 복잡한 중첩 구조 | **더 적합** | 깊은 중첩에서 문제 |
| TipTap JSON | **권장** | 호환성 이슈 있음 |

---

## 현재 상태 분석

### 기존 구현 (`src/ai/chunking/`)
- **splitter.ts**: 문서 분할 로직 (노드 경계 기반)
- **merger.ts**: 청크 병합 로직
- **orchestrator.ts**: 번역 오케스트레이션
- **types.ts**: 타입 및 상수 정의

### 현재 설정값
| 항목 | 값 | 비고 |
|------|-----|------|
| CHUNKING_THRESHOLD | 3,000 토큰 | 청킹 시작 임계값 |
| targetChunkTokens | 8,192 토큰 | 이상적 청크 크기 |
| maxChunkTokens | 16,384 토큰 | 최대 안전 한계 |
| 토큰 추정 | chars / 3 + 20% | 대략적 근사치 |

### 식별된 문제점
1. **토큰 추정 정확도 부족**: 단순 문자/3 비율, 언어별 차이 미반영
2. **의미적 청킹 미지원**: 문장 경계 무시, 노드 단위로만 분할
3. **오버랩 전략 없음**: 청크 간 맥락 단절 가능
4. **Review와 Translation 청킹 불일치**: Review는 문자 기반(10K chars)

---

## 개선 계획

### Phase 1: 의미적 청킹 (Semantic Chunking)

**목표**: 문장/단락 경계를 존중하는 지능적 분할

#### 1.1 문장 경계 감지
**파일**: `src/ai/chunking/splitter.ts`

```typescript
/** 축약어 예외 목록 (문장 끝으로 오인 방지) */
const ABBREVIATIONS = new Set([
  'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.',
  'etc.', 'e.g.', 'i.e.', 'vs.',
  'Inc.', 'Ltd.', 'Co.', 'Corp.',
]);

/**
 * 문장 경계 위치 탐지
 * @returns 문장 끝 위치(인덱스) 배열
 */
function findSentenceBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  
  // 문장 종결 패턴
  const sentenceEndPattern = /([.!?。！？])\s+/g;
  
  let match;
  while ((match = sentenceEndPattern.exec(text)) !== null) {
    const endPos = match.index + match[1].length;
    
    // 축약어 체크
    const precedingText = text.slice(Math.max(0, endPos - 10), endPos);
    const isAbbreviation = [...ABBREVIATIONS].some(abbr => 
      precedingText.endsWith(abbr)
    );
    
    if (!isAbbreviation) {
      // 다음 문자가 대문자거나 줄바꿈이면 문장 끝으로 확정
      const nextChar = text[endPos + 1];
      if (!nextChar || /[A-Z가-힣\n]/.test(nextChar)) {
        boundaries.push(endPos);
      }
    }
  }
  
  return boundaries;
}
```

#### 1.2 인라인 노드 안전 분할 규칙

> ⚠️ **주의**: TipTap의 paragraph는 여러 인라인 노드(text, link, mention, code 등)를 포함합니다.
> 문장 경계가 인라인 노드 중간에 있으면 분할하면 안 됩니다.

**분할 금지 인라인 노드**:
```typescript
const ATOMIC_INLINE_TYPES = new Set([
  'link',       // 링크 텍스트는 분할 금지
  'mention',    // @멘션은 단일 단위
  'code',       // 인라인 코드
  'image',      // 인라인 이미지
  'hardBreak',  // 줄바꿈
]);
```

**안전한 분할 위치 탐지**:
```typescript
interface SafeSplitPoint {
  /** paragraph.content 내 인덱스 (텍스트 노드 다음) */
  nodeIndex: number;
  /** 해당 텍스트 노드 내 문자 위치 */
  charOffset: number;
  /** 분할 품질 (낮을수록 좋음) */
  quality: number;
}

function findSafeSplitPoints(paragraph: TipTapNode): SafeSplitPoint[] {
  const points: SafeSplitPoint[] = [];
  
  if (!paragraph.content) return points;
  
  for (let i = 0; i < paragraph.content.length; i++) {
    const node = paragraph.content[i];
    
    // 1. 원자적 인라인 노드 뒤는 좋은 분할점
    if (ATOMIC_INLINE_TYPES.has(node.type)) {
      points.push({ nodeIndex: i + 1, charOffset: 0, quality: 2 });
      continue;
    }
    
    // 2. 텍스트 노드 내 문장 경계 탐색
    if (node.type === 'text' && node.text) {
      const boundaries = findSentenceBoundaries(node.text);
      for (const boundary of boundaries) {
        points.push({ nodeIndex: i, charOffset: boundary, quality: 1 });
      }
    }
  }
  
  return points.sort((a, b) => a.quality - b.quality);
}
```

**Paragraph 분할 (인라인 노드 보존)**:
```typescript
function splitParagraphAtSentence(
  paragraph: TipTapNode,
  targetTokens: number
): TipTapNode[] {
  const splitPoints = findSafeSplitPoints(paragraph);
  
  if (splitPoints.length === 0) {
    // 안전한 분할점 없음 → 분할하지 않음
    return [paragraph];
  }
  
  // 토큰 목표에 가장 가까운 분할점 선택
  let bestPoint: SafeSplitPoint | null = null;
  let bestTokenDiff = Infinity;
  
  for (const point of splitPoints) {
    const firstHalf = buildParagraphSlice(paragraph, 0, point);
    const tokens = estimateNodeTokens(firstHalf);
    const diff = Math.abs(tokens - targetTokens);
    
    if (diff < bestTokenDiff) {
      bestTokenDiff = diff;
      bestPoint = point;
    }
  }
  
  if (!bestPoint) return [paragraph];
  
  return [
    buildParagraphSlice(paragraph, 0, bestPoint),
    buildParagraphSlice(paragraph, bestPoint, null),
  ];
}

function buildParagraphSlice(
  paragraph: TipTapNode,
  start: SafeSplitPoint | 0,
  end: SafeSplitPoint | null
): TipTapNode {
  // 인라인 노드를 보존하면서 content 슬라이스
  // 텍스트 노드는 charOffset으로 분할
  // marks는 유지
}
```

#### 1.3 분할 우선순위 개선
**현재**: heading > horizontalRule > blockquote > list > paragraph

**개선안**:
```typescript
SPLIT_PRIORITY = {
  heading: 1,           // 최적
  horizontalRule: 1,    // 명시적 구분선
  blockquote_end: 2,    // blockquote 끝
  paragraph_sentence: 3, // 문장 경계의 paragraph
  bulletList: 4,        // 리스트 전체
  paragraph: 5,         // 일반 paragraph
  listItem: 6,          // 비권장
}
```

---

### Phase 2: 오버랩 전략 (Context Overlap)

**목표**: 청크 간 맥락 연속성 보장

#### 2.0 선결 조건: 노드 ID 체계 (Source Anchor)

> ⚠️ **Critical**: 오버랩 중복 제거를 위해서는 안정적인 노드 식별 체계가 **필수**입니다.
> 번역 후 텍스트가 변경되므로 텍스트 기반 매칭은 불안정합니다.

**파일**: `src/ai/chunking/types.ts`

```typescript
/**
 * 청킹 전용 노드 ID 체계
 * - 번역 전에 주입, 번역 후에도 유지
 * - 오버랩 중복 제거의 anchor 역할
 */
interface ChunkNodeMeta {
  /** 청킹 시점의 고유 ID (예: "chunk-0-node-3") */
  __chunkNodeId: string;
  /** 오버랩 영역인지 여부 (true면 병합 시 제거 대상) */
  __isOverlap?: boolean;
  /** 원본 청크 인덱스 */
  __sourceChunkIndex?: number;
}

// TipTapNode 확장
interface TipTapNodeWithMeta extends TipTapNode {
  attrs?: Record<string, unknown> & Partial<ChunkNodeMeta>;
}
```

**ID 주입 로직**:
```typescript
function injectNodeIds(
  doc: TipTapDocJson,
  chunkIndex: number
): TipTapDocJson {
  let nodeCounter = 0;
  
  function addIdToNode(node: TipTapNode): TipTapNode {
    const id = `chunk-${chunkIndex}-node-${nodeCounter++}`;
    return {
      ...node,
      attrs: {
        ...node.attrs,
        __chunkNodeId: id,
        __sourceChunkIndex: chunkIndex,
      },
      content: node.content?.map(addIdToNode),
    };
  }
  
  return {
    ...doc,
    content: doc.content.map(addIdToNode),
  };
}
```

#### 2.1 오버랩 설정
**파일**: `src/ai/chunking/types.ts`

```typescript
interface ChunkConfig {
  // 기존 설정...
  overlapSentences: number;  // 청크 간 반복할 문장 수 (기본: 2)
  overlapTokens: number;     // 최대 오버랩 토큰 (기본: 300)
  maxOverlapRatio: number;   // 청크 대비 최대 오버랩 비율 (기본: 0.3)
}
```

#### 2.2 오버랩 적용 로직
**파일**: `src/ai/chunking/splitter.ts`

```typescript
interface OverlapInfo {
  /** 오버랩 노드들 (이전 청크에서 가져온 것) */
  overlapNodes: TipTapNode[];
  /** 오버랩 노드들의 ID 목록 (병합 시 제거용) */
  overlapNodeIds: string[];
}

function applyOverlap(
  chunks: TranslationChunk[],
  config: ChunkConfig
): TranslationChunk[] {
  return chunks.map((chunk, index) => {
    if (index === 0) return chunk; // 첫 청크는 오버랩 없음
    
    const prevChunk = chunks[index - 1];
    const overlapNodes = extractOverlapNodes(
      prevChunk.nodes,
      config.overlapSentences,
      config.overlapTokens
    );
    
    // 오버랩 노드에 마커 추가
    const markedOverlapNodes = overlapNodes.map(node => ({
      ...node,
      attrs: { ...node.attrs, __isOverlap: true },
    }));
    
    // 오버랩 비율 제한 검사
    const overlapTokens = markedOverlapNodes.reduce(
      (sum, n) => sum + estimateNodeTokens(n), 0
    );
    if (overlapTokens > chunk.estimatedTokens * config.maxOverlapRatio) {
      // 오버랩이 너무 크면 축소
      return chunk; // 또는 일부만 적용
    }
    
    return {
      ...chunk,
      nodes: [...markedOverlapNodes, ...chunk.nodes],
      overlapNodeIds: markedOverlapNodes.map(n => n.attrs?.__chunkNodeId),
    };
  });
}
```

#### 2.3 병합 시 중복 제거 (ID 기반)
**파일**: `src/ai/chunking/merger.ts`

```typescript
/**
 * 오버랩 영역 제거 (노드 ID 기반)
 * 
 * 전략:
 * 1. __isOverlap: true 마커가 있는 노드 제거
 * 2. 또는 __chunkNodeId로 중복 식별
 */
function deduplicateOverlap(
  chunks: TranslationChunk[]
): TipTapNode[] {
  const seenNodeIds = new Set<string>();
  const result: TipTapNode[] = [];
  
  for (const chunk of chunks) {
    if (chunk.status !== 'success' || !chunk.result) continue;
    
    for (const node of chunk.result.content) {
      const nodeId = node.attrs?.__chunkNodeId;
      const isOverlap = node.attrs?.__isOverlap;
      
      // 오버랩 마커가 있으면 제거
      if (isOverlap) continue;
      
      // 이미 본 노드면 제거 (ID 기반 중복 제거)
      if (nodeId && seenNodeIds.has(nodeId)) continue;
      
      if (nodeId) seenNodeIds.add(nodeId);
      
      // 메타데이터 제거 후 추가
      result.push(stripChunkMeta(node));
    }
  }
  
  return result;
}

function stripChunkMeta(node: TipTapNode): TipTapNode {
  if (!node.attrs) return node;
  
  const { __chunkNodeId, __isOverlap, __sourceChunkIndex, ...restAttrs } = node.attrs;
  return {
    ...node,
    attrs: Object.keys(restAttrs).length > 0 ? restAttrs : undefined,
    content: node.content?.map(stripChunkMeta),
  };
}
```

#### 2.4 Fallback: 노드 ID 없을 때

번역 모델이 `__chunkNodeId`를 제거하거나 변경하는 경우를 대비한 fallback:

```typescript
/**
 * 텍스트 해시 기반 중복 감지 (fallback)
 * - 노드 ID가 없을 때만 사용
 * - 구조적 유사성으로 오버랩 영역 추정
 */
function detectOverlapByStructure(
  prevChunkEnd: TipTapNode[],
  currChunkStart: TipTapNode[],
  overlapSentences: number
): number {
  // 이전 청크 마지막 N개 노드의 구조 해시
  const prevHashes = prevChunkEnd
    .slice(-overlapSentences)
    .map(n => hashNodeStructure(n));
  
  // 현재 청크 시작부터 매칭 시도
  for (let i = 0; i < Math.min(overlapSentences, currChunkStart.length); i++) {
    const currHash = hashNodeStructure(currChunkStart[i]);
    if (prevHashes.includes(currHash)) {
      return i + 1; // 중복 시작 위치
    }
  }
  
  return 0; // 중복 없음
}

function hashNodeStructure(node: TipTapNode): string {
  // 구조만 해시 (텍스트 제외)
  return JSON.stringify({
    type: node.type,
    marks: node.marks?.map(m => m.type),
    childTypes: node.content?.map(c => c.type),
  });
}
```

---

### Phase 2.5: 번역 일관성 보장 (Cross-Chunk Consistency)

**목표**: 청크 간 용어, 어조, 스타일 일관성 유지

> ⚠️ **토큰 예산 관리**: 컨텍스트(글로서리, 참조, 스타일)와 오버랩을 함께 사용하면
> 후반 청크에서 토큰 소모가 급증할 수 있습니다. **우선순위 기반 탈락 규칙**이 필수입니다.

#### 2.5.0 컨텍스트 토큰 예산 관리

```typescript
interface ContextBudget {
  /** 총 컨텍스트 예산 (토큰) */
  total: number;
  /** 항목별 최대 할당 */
  allocation: {
    glossary: number;      // 글로서리 용어
    previousTerms: number; // 이전 청크 번역 용어
    lastSentences: number; // 이전 청크 마지막 문장
    styleHints: number;    // 스타일/어조 힌트
  };
  /** 우선순위 (낮을수록 먼저 포함) */
  priority: ('glossary' | 'previousTerms' | 'lastSentences' | 'styleHints')[];
}

const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  total: 800,  // 최대 800 토큰
  allocation: {
    glossary: 300,       // 가장 중요
    previousTerms: 200,  // 일관성 핵심
    lastSentences: 200,  // 맥락 연속성
    styleHints: 100,     // 선택적
  },
  priority: ['glossary', 'previousTerms', 'lastSentences', 'styleHints'],
};
```

**예산 초과 시 탈락 규칙**:
```typescript
function buildContextWithBudget(
  context: FullChunkContext,
  budget: ContextBudget
): TrimmedContext {
  let remainingBudget = budget.total;
  const result: TrimmedContext = {};
  
  for (const category of budget.priority) {
    const maxForCategory = Math.min(
      budget.allocation[category],
      remainingBudget
    );
    
    if (maxForCategory <= 0) continue;
    
    const trimmed = trimToTokenBudget(context[category], maxForCategory);
    result[category] = trimmed.content;
    remainingBudget -= trimmed.actualTokens;
  }
  
  return result;
}

function trimToTokenBudget(
  items: ContextItem[],
  maxTokens: number
): { content: ContextItem[]; actualTokens: number } {
  const result: ContextItem[] = [];
  let tokens = 0;
  
  // 중요도 순으로 정렬된 상태로 가정
  for (const item of items) {
    const itemTokens = estimateTokenCount(JSON.stringify(item));
    if (tokens + itemTokens > maxTokens) break;
    
    result.push(item);
    tokens += itemTokens;
  }
  
  return { content: result, actualTokens: tokens };
}
```

#### 2.5.1 글로서리 강화 주입
**파일**: `src/ai/chunking/orchestrator.ts`

```typescript
interface ChunkContext {
  chunkIndex: number;
  totalChunks: number;
  glossaryTermsUsed: string[];      // 이 청크에서 사용된 용어
  previousTranslations: Map<string, string>;  // 이전 청크 번역 결과
}

// 각 청크 번역 시 컨텍스트 전달
function buildChunkPrompt(
  chunk: DocumentChunk,
  context: ChunkContext,
  glossary: GlossaryEntry[],
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET
): string {
  // 1. 해당 청크에 등장하는 글로서리 용어 추출
  // 2. 이전 청크에서 번역된 주요 용어 참조
  // 3. 예산 내에서 컨텍스트 구성
  // 4. 시스템 프롬프트에 일관성 지침 추가
}
```

#### 2.5.2 어조/스타일 일관성
```typescript
interface TranslationStyle {
  formality: 'formal' | 'casual' | 'neutral';
  targetAudience: string;
  keyTerms: Map<string, string>;  // 원문 → 번역 매핑 (최대 10개)
}

// 첫 번째 청크에서 스타일 추출, 이후 청크에 적용
function extractStyleFromFirstChunk(
  translatedChunk: TipTapDoc
): TranslationStyle

function applyStyleToPrompt(
  basePrompt: string,
  style: TranslationStyle
): string
```

#### 2.5.3 청크 간 참조 시스템
```typescript
// 이전 청크의 마지막 번역된 문장들을 참조용으로 제공
interface ChunkReference {
  lastSentences: string[];  // 이전 청크 마지막 2-3 문장 (번역 결과)
  usedTerms: Array<{
    source: string;
    target: string;
    context: string;
  }>;
}

function buildReferenceContext(
  previousChunks: TranslatedChunk[],
  maxTerms: number = 10,  // 용어 수 제한
  maxSentences: number = 3  // 문장 수 제한
): ChunkReference {
  // 최근 N개 청크만 참조 (전체 참조 금지)
  const recentChunks = previousChunks.slice(-3);
  
  // 용어는 빈도순으로 상위 N개만
  // 문장은 직전 청크의 마지막 N개만
}
```

#### 2.5.4 청크 수 증가에 따른 동적 조정

```typescript
function adjustBudgetByChunkCount(
  baseBudget: ContextBudget,
  totalChunks: number,
  currentChunkIndex: number
): ContextBudget {
  // 청크가 많을수록 컨텍스트 예산 축소
  if (totalChunks <= 5) return baseBudget;
  
  const scaleFactor = Math.max(0.5, 1 - (totalChunks - 5) * 0.05);
  
  return {
    ...baseBudget,
    total: Math.floor(baseBudget.total * scaleFactor),
    allocation: {
      glossary: Math.floor(baseBudget.allocation.glossary * scaleFactor),
      previousTerms: Math.floor(baseBudget.allocation.previousTerms * scaleFactor),
      lastSentences: Math.floor(baseBudget.allocation.lastSentences * scaleFactor),
      styleHints: Math.floor(baseBudget.allocation.styleHints * scaleFactor),
    },
  };
}
```

---

### Phase 3: 토큰 추정 정확도 개선

**목표**: 실제 토큰 수에 가까운 추정

#### 3.1 언어별 토큰 비율
**파일**: `src/ai/chunking/splitter.ts`

> ⚠️ **수식 주의**: `TOKENS_PER_CHAR`는 "1자당 토큰 수"를 의미합니다.
> - 한글: 1자 ≈ 0.5 토큰 (BPE에서 한글은 2-3자가 1토큰으로 묶임)
> - 영어: 1자 ≈ 0.25 토큰 (평균 4자 = 1토큰)
> - **최종 수식**: `length * tokensPerChar * jsonOverhead`

```typescript
const TOKENS_PER_CHAR = {
  korean: 0.5,     // 한글 1자 ≈ 0.5 토큰 (2자 = 1토큰)
  english: 0.25,   // 영어 1자 ≈ 0.25 토큰 (4자 = 1토큰)
  mixed: 0.33,     // 혼합 텍스트 (현재 구현의 1/3과 유사)
  json_overhead: 1.2,  // JSON 구조 오버헤드 20%
}

function estimateTokenCount(text: string, lang?: 'ko' | 'en'): number {
  if (text.length === 0) return 0;
  
  const koreanCharCount = countKoreanChars(text);
  const koreanRatio = koreanCharCount / text.length;
  
  // 가중 평균: 한글 비율에 따라 tokensPerChar 계산
  const tokensPerChar = 
    koreanRatio * TOKENS_PER_CHAR.korean +
    (1 - koreanRatio) * TOKENS_PER_CHAR.english;
  
  // length * tokensPerChar * overhead
  return Math.ceil(text.length * tokensPerChar * TOKENS_PER_CHAR.json_overhead);
}

function countKoreanChars(text: string): number {
  // 한글 유니코드 범위: 가-힣 (AC00-D7AF), ㄱ-ㅎ (3130-318F)
  return (text.match(/[\uAC00-\uD7AF\u3130-\u318F]/g) || []).length;
}
```

> **참고**: 위 수식은 GPT-4/Claude 계열 모델의 BPE 토크나이저 기준입니다.
> 정확한 검증은 tiktoken 라이브러리로 할 수 있습니다.

#### 3.2 실제 토큰 검증 (선택적)
```typescript
// tiktoken 또는 OpenAI tokenizer API 사용
// 프로덕션에서는 추정치 사용, 개발 중 검증
async function validateTokenEstimate(text: string): Promise<{
  estimated: number;
  actual: number;
  accuracy: number;
}>
```

---

### Phase 4: 동적 청크 크기 조정

**목표**: 문서 특성에 따른 적응적 청킹

#### 4.1 문서 복잡도 분석 개선
**파일**: `src/ai/chunking/splitter.ts`

```typescript
interface DocumentAnalysis {
  totalTokens: number;
  avgParagraphTokens: number;
  nestingDepth: number;
  codeBlockRatio: number;
  listItemCount: number;
  languageMix: 'korean' | 'english' | 'mixed';
}

function analyzeDocument(doc: TipTapDoc): DocumentAnalysis
```

#### 4.2 적응적 청크 크기
```typescript
function calculateOptimalChunkSize(analysis: DocumentAnalysis): number {
  let target = DEFAULT_CHUNK_CONFIG.targetChunkTokens;

  // 코드 블록 많으면 작게
  if (analysis.codeBlockRatio > 0.3) target *= 0.7;

  // 깊은 중첩이면 작게
  if (analysis.nestingDepth > 3) target *= 0.8;

  // 단순 산문이면 크게
  if (analysis.listItemCount === 0 && analysis.nestingDepth <= 1) {
    target *= 1.2;
  }

  return Math.min(target, DEFAULT_CHUNK_CONFIG.maxChunkTokens);
}
```

---

### Phase 5: Review 청킹 통합

**목표**: Translation과 Review의 청킹 전략 일관성

#### 5.1 공통 청킹 인터페이스
**파일**: `src/ai/chunking/types.ts`

```typescript
interface ChunkingStrategy {
  mode: 'translation' | 'review';
  threshold: number;
  targetSize: number;
  respectSentenceBoundaries: boolean;
  overlapEnabled: boolean;
}

const TRANSLATION_STRATEGY: ChunkingStrategy = {
  mode: 'translation',
  threshold: 3000,
  targetSize: 8192,
  respectSentenceBoundaries: true,
  overlapEnabled: true,
}

const REVIEW_STRATEGY: ChunkingStrategy = {
  mode: 'review',
  threshold: 2000,  // Review는 더 작게
  targetSize: 4096,
  respectSentenceBoundaries: true,
  overlapEnabled: false,  // Review는 독립적
}
```

#### 5.2 Review 청킹 마이그레이션
**파일**: `src/ai/tools/reviewTool.ts`

```typescript
// 기존: 문자 기반 10,000 chars
// 변경: 토큰 기반, 공통 splitter 사용
function buildAlignedChunks(
  project: Project,
  strategy: ChunkingStrategy = REVIEW_STRATEGY
): AlignedChunk[]
```

---

## 수정 대상 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/ai/chunking/types.ts` | 오버랩 설정, ChunkNodeMeta, ContextBudget, 전략 인터페이스 추가 |
| `src/ai/chunking/splitter.ts` | 노드 ID 주입, 문장 경계 감지, 인라인 노드 안전 분할, 토큰 추정 개선, 적응적 크기 |
| `src/ai/chunking/merger.ts` | ID 기반 오버랩 중복 제거, 구조 해시 fallback, 메타데이터 제거 |
| `src/ai/chunking/orchestrator.ts` | 컨텍스트 예산 관리, 우선순위 기반 탈락, 청크별 프롬프트 빌더 |
| `src/ai/tools/reviewTool.ts` | 공통 청킹 전략 사용 (Phase 5) |

---

## 검증 계획

### 단위 테스트
1. 문장 경계 감지 정확도 (한국어/영어)
   - 축약어 예외 처리 (Mr., Dr., etc.)
   - 한국어 종결어미 (~다, ~요, ~까)
2. 토큰 추정 정확도 (실제 대비 ±10%)
   - 한글 전용, 영어 전용, 혼합 문서
   - tiktoken 기준 검증
3. 오버랩 적용/제거 일관성
   - **노드 ID 주입/보존 확인**
   - **`__isOverlap` 마커 기반 제거**
   - **Fallback: 구조 해시 기반 중복 감지**
4. 인라인 노드 안전 분할
   - 링크/멘션/코드 경계 보존
   - `findSafeSplitPoints()` 정확도
5. 컨텍스트 예산 관리
   - 예산 초과 시 우선순위 기반 탈락
   - 청크 수 증가에 따른 동적 조정
6. 다양한 문서 구조에서 청킹 결과

### 통합 테스트
1. 긴 문서 번역 (50+ 단락) - 서식 유지 확인
2. 중첩 구조 문서 - 리스트/인용문 무결성
3. 혼합 언어 문서 - 토큰 추정 정확도
4. Review 기능 - 새 청킹 전략 호환성
5. **노드 ID 손실 시나리오** - fallback 동작 검증
6. **초장문 리스트 항목** - 분할/재결합 검증

### 수동 검증
```bash
npm run tauri:dev
# 1. 긴 Source 문서 작성 (다양한 서식 포함)
# 2. 번역 실행 → Preview 모달에서 청크 수 확인
# 3. Apply 후 Target 문서 서식 검증
# 4. Review 실행 → 청크 분할 일관성 확인
```

---

## 구현 순서 (번역 품질 우선)

1. **Phase 1**: 의미적 청킹 ⭐ - 문장 경계 존중으로 번역 품질 직접 개선
2. **Phase 2**: 오버랩 전략 ⭐ - 맥락 연속성으로 일관된 번역
3. **Phase 2.5**: 번역 일관성 보장 ⭐ - 청크 간 용어/어조 통일
4. **Phase 3**: 토큰 추정 개선 - 예측 가능한 청킹
5. **Phase 4**: 동적 청크 크기 - 문서 특성 최적화 (선택적)
6. **Phase 5**: Review 통합 - 코드 일관성 (선택적)

---

## 예상 효과

| 개선 항목 | 기대 효과 |
|----------|----------|
| 의미적 청킹 | 문장 중간 끊김 방지, 번역 품질 향상 |
| 오버랩 전략 | 청크 간 맥락 연속성, 일관된 용어 사용 |
| 토큰 추정 개선 | 청크 크기 예측 정확도 ±10% 이내 |
| 동적 조정 | 문서 특성에 최적화된 분할 |
| Review 통합 | 일관된 사용자 경험, 코드 중복 제거 |
| 일관성 보장 | 청크 간 용어/어조 통일, 글로서리 활용 극대화 |

---

## 위험 및 제약사항 분석

### 🔴 고위험

#### 1. 오버랩 중복 제거 실패
- **위험**: 병합 시 중복 문장이 남거나, 필요한 문장이 삭제됨
- **영향**: 문서 무결성 손상, 의미 훼손
- **완화 전략**:
  - ✅ **노드 ID 체계 도입** (Phase 2.0): `__chunkNodeId` 주입
  - ✅ **오버랩 마커** (`__isOverlap: true`): 병합 시 명시적 제거
  - ✅ **Fallback**: 구조 해시 기반 중복 감지 (ID 손실 시)
  - 병합 후 노드 수 검증

#### 2. 번역 모델이 노드 ID를 손실/변경
- **위험**: LLM이 `attrs.__chunkNodeId`를 제거하거나 변경
- **영향**: ID 기반 dedupe 실패
- **완화 전략**:
  - 시스템 프롬프트에 "attrs 보존" 지침 추가
  - ✅ **Fallback**: 구조 해시 기반 중복 감지 (Phase 2.4)
  - 번역 전후 노드 수 비교로 이상 감지

#### 3. 문장 경계 오탐지
- **위험**: "Mr. Smith" 등 축약어를 문장 끝으로 오인
- **영향**: 문장 중간 끊김, 번역 품질 저하
- **완화 전략**:
  - ✅ 축약어 예외 목록 (Mr., Dr., etc., e.g., i.e.)
  - 한국어 종결어미 패턴 검증 (~다, ~요, ~까)
  - ✅ 후행 문자 검사 (대문자/줄바꿈 확인)

#### 4. 인라인 노드 경계 파손
- **위험**: 링크/멘션/코드 중간에서 분할 시도
- **영향**: 서식 손상, 깨진 마크업
- **완화 전략**:
  - ✅ **ATOMIC_INLINE_TYPES**: 분할 금지 인라인 노드 정의 (Phase 1.2)
  - ✅ **findSafeSplitPoints()**: 텍스트 노드 경계에서만 분할

### 🟡 중위험

#### 3. 토큰 추정 불일치
- **위험**: 실제 토큰 수가 예상보다 많아 청크 초과
- **영향**: API 오류, 재시도 필요
- **완화 전략**:
  - 20% 안전 마진 유지
  - 청크 크기 동적 축소 (실패 시)
  - tiktoken 선택적 검증

#### 4. 일관성 컨텍스트 누적
- **위험**: 청크가 많을수록 참조 컨텍스트 증가 → 토큰 소비 증가
- **영향**: 후반 청크에서 컨텍스트 부족
- **완화 전략**:
  - ✅ **ContextBudget 시스템** (Phase 2.5.0): 총 800 토큰 예산
  - ✅ **우선순위 기반 탈락**: glossary > previousTerms > lastSentences > styleHints
  - ✅ **동적 조정**: 청크 수 증가 시 예산 자동 축소 (5청크 초과 시 5%씩 감소)
  - ✅ **최근 N개 청크만 참조**: 전체 이력 대신 최근 3개 청크

### 🟢 저위험

#### 5. 성능 저하
- **위험**: 문장 경계 분석, 오버랩 처리로 지연
- **영향**: 체감 속도 저하
- **완화 전략**:
  - 청킹은 번역 전 1회만 실행
  - 캐싱 (동일 문서 재번역 시)
  - 비동기 처리

#### 6. 기존 코드 호환성
- **위험**: 현재 청킹 로직에 의존하는 코드 파손
- **영향**: 기존 기능 오작동
- **완화 전략**:
  - 기존 인터페이스 유지 (내부 구현만 변경)
  - 점진적 마이그레이션
  - 피처 플래그로 롤백 가능

---

## 엣지 케이스 처리

| 케이스 | 현상 | 대응 |
|--------|------|------|
| 빈 청크 | 분할 후 내용 없는 청크 생성 | 빈 청크 필터링, 병합 |
| 초장문 단락 | 단일 paragraph가 targetTokens 초과 | 문장 단위 강제 분할 |
| 연속 짧은 문장 | 오버랩이 전체 청크보다 클 수 있음 | 오버랩 비율 제한 (최대 30%) |
| 코드 블록 내 마침표 | 코드 주석이 문장으로 오인 | 코드 블록 내부 분할 금지 |
| 리스트 항목 | 항목별 마침표가 문장 경계로 오인 | 리스트 컨테이너 내부 분할 금지 |
| 링크 텍스트 | URL에 마침표 포함 | 링크 노드 내부 분할 금지 |
| **초장문 리스트 항목** | 단일 listItem이 maxTokens 초과 | 아래 fallback 적용 |
| **노드 ID 손실** | 번역 모델이 attrs 제거 | 구조 해시 기반 fallback |

### 초장문 리스트 항목 Fallback

단일 `listItem`이 `maxChunkTokens`를 초과하는 경우 (예: 매우 긴 설명이 포함된 항목):

```typescript
function handleOversizedListItem(
  listItem: TipTapNode,
  maxTokens: number
): TipTapNode[] {
  const tokens = estimateNodeTokens(listItem);
  
  if (tokens <= maxTokens) return [listItem];
  
  // listItem 내부의 paragraph들을 분할
  if (!listItem.content) return [listItem];
  
  const result: TipTapNode[] = [];
  let currentContent: TipTapNode[] = [];
  let currentTokens = 0;
  
  for (const child of listItem.content) {
    const childTokens = estimateNodeTokens(child);
    
    if (currentTokens + childTokens > maxTokens && currentContent.length > 0) {
      // 현재까지의 내용으로 새 listItem 생성
      result.push({
        type: 'listItem',
        content: currentContent,
        attrs: { ...listItem.attrs, __splitPart: result.length },
      });
      currentContent = [];
      currentTokens = 0;
    }
    
    // 단일 child가 maxTokens 초과하면 paragraph 분할 시도
    if (childTokens > maxTokens && child.type === 'paragraph') {
      const splitChildren = splitParagraphAtSentence(child, maxTokens / 2);
      for (const splitChild of splitChildren) {
        currentContent.push(splitChild);
        currentTokens += estimateNodeTokens(splitChild);
        
        if (currentTokens > maxTokens * 0.8) {
          result.push({
            type: 'listItem',
            content: currentContent,
            attrs: { ...listItem.attrs, __splitPart: result.length },
          });
          currentContent = [];
          currentTokens = 0;
        }
      }
    } else {
      currentContent.push(child);
      currentTokens += childTokens;
    }
  }
  
  // 남은 내용 처리
  if (currentContent.length > 0) {
    result.push({
      type: 'listItem',
      content: currentContent,
      attrs: { ...listItem.attrs, __splitPart: result.length },
    });
  }
  
  // 분할 결과 로깅 (디버깅용)
  console.warn(
    `[Chunking] Oversized listItem split into ${result.length} parts ` +
    `(original: ${tokens} tokens, max: ${maxTokens})`
  );
  
  return result;
}
```

> ⚠️ **주의**: 리스트 항목 분할은 문서 구조를 변경합니다. 
> 병합 시 `__splitPart` 마커로 원래 하나의 항목이었음을 추적하고,
> 가능하면 번역 후 재결합을 시도합니다.

---

## Open Questions / 결정 필요 사항

### Q1: TipTap 노드 ID 관리 방식

**현재 상황**: 기존 `TipTapNode` 인터페이스에 ID 필드가 없음.

**제안**: 번역 전에 synthetic ID (`__chunkNodeId`)를 `attrs`에 주입하고, 번역 후 제거.

**결정 필요**:
- [ ] attrs 주입 방식으로 진행 (권장)
- [ ] TipTap 에디터 레벨에서 ID 관리 (UniqueID 확장 사용)
- [ ] 별도 매핑 테이블 유지 (복잡도 높음)

### Q2: 토크나이저 기준 모델

**현재 상황**: GPT-4, Claude 등 여러 모델 지원. 각 모델의 토크나이저가 다름.

**제안**: 
- 기본: 보수적인 추정치 사용 (현재 `chars / 3 * 1.2`)
- 선택적: tiktoken으로 GPT 모델용 정확한 계산

**결정 필요**:
- [ ] 모델별 토크나이저 분기 (정확하지만 복잡)
- [ ] 단일 보수적 추정치 유지 (권장, 20% 마진으로 안전)
- [ ] tiktoken 런타임 의존성 추가

### Q3: Review 청킹의 문맥 공유 범위

**현재 상황**: 계획서에서 Review는 "독립적 청킹 (overlapEnabled: false)"으로 설계.

**고려 사항**:
- Review는 Source-Target 정렬된 페어 단위로 분석
- 용어/문체 일관성 검토에는 문맥이 필요할 수 있음

**결정 필요**:
- [ ] 완전 독립 (현재 계획): 각 청크가 독립적으로 검토
- [ ] 경량 컨텍스트: 글로서리만 공유, 오버랩 없음 (권장)
- [ ] Translation과 동일: 오버랩 + 전체 컨텍스트 (토큰 비용 높음)

---

## 롤백 계획

```typescript
// 피처 플래그로 새 청킹 전략 제어
const CHUNKING_FEATURES = {
  semanticChunking: false,          // Phase 1: 문장 경계 + 인라인 노드 안전 분할
  nodeIdInjection: false,           // Phase 2.0: 노드 ID 주입
  overlapStrategy: false,           // Phase 2: 오버랩 적용/제거
  contextBudgetManagement: false,   // Phase 2.5: 컨텍스트 예산 관리
  crossChunkConsistency: false,     // Phase 2.5: 글로서리/스타일 일관성
  improvedTokenEstimation: false,   // Phase 3: 언어별 토큰 추정
  adaptiveChunkSize: false,         // Phase 4: 동적 청크 크기
}

// 모든 플래그 false → 기존 동작과 동일
```

- **롤백 트리거**: 번역 실패율 > 5% 또는 서식 손실 발생
- **롤백 방법**: 해당 피처 플래그 false로 변경
- **모니터링**: 청크별 성공률, 평균 청크 크기, 번역 시간, **노드 ID 보존율** 로깅
- **독립 롤백**: `nodeIdInjection`만 비활성화하면 ID 없이 기존 방식으로 동작
