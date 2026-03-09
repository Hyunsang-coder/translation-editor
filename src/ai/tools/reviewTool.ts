import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { htmlToTipTapJson, tipTapJsonToMarkdownForTranslation } from '@/utils/markdownConverter';
import { stripImages } from '@/utils/imagePlaceholder';
import { searchGlossary } from '@/tauri/glossary';
import type { ITEProject } from '@/types';

// ============================================
// 세그먼트 기반 청킹 (Phase 2)
// ============================================

// ── Review Chunk Cache ──────────────────────
// review_translation → get_review_chunk 사이에서
// buildAlignedChunks의 HTML→MD 변환 반복을 방지하는 캐시.
// review_translation 호출 시 캐시가 채워지고,
// get_review_chunk 호출 시 재사용된다.
let _chunkCache: {
  projectId: string;
  maxChars: number;
  chunks: AlignedChunk[];
} | null = null;

/** 리뷰 청크 캐시를 무효화한다. 새 리뷰 시작 시 또는 테스트에서 호출. */
export function clearReviewChunkCache(): void {
  _chunkCache = null;
}

/**
 * 캐시된 청크를 반환하거나, 캐시 미스 시 buildAlignedChunks를 수행하고 캐시한다.
 */
function getCachedChunks(project: ITEProject, maxChars: number): AlignedChunk[] {
  if (
    _chunkCache &&
    _chunkCache.projectId === project.id &&
    _chunkCache.maxChars === maxChars
  ) {
    return _chunkCache.chunks;
  }
  const chunks = buildAlignedChunks(project, maxChars);
  _chunkCache = { projectId: project.id, maxChars, chunks };
  return chunks;
}

/**
 * 청킹 기본값 (review_translation과 get_review_chunk에서 일관되게 사용)
 */
export const DEFAULT_REVIEW_CHUNK_SIZE = 12000;

export interface AlignedSegment {
  groupId: string;
  order: number;
  sourceText: string;
  targetText: string;
}

export interface AlignedChunk {
  chunkIndex: number;
  segments: AlignedSegment[];
  totalChars: number;
}

type ProjectSegment = ITEProject['segments'][number];

function toMarkdownText(project: ITEProject, blockIds: string[]): string {
  return stripImages(blockIds
    .map((id) => {
      const html = project.blocks[id]?.content || '';
      if (!html.trim()) return '';
      const json = htmlToTipTapJson(html);
      return tipTapJsonToMarkdownForTranslation(json);
    })
    .join('\n')).stripped;
}

function toAlignedSegment(project: ITEProject, seg: ProjectSegment): AlignedSegment {
  return {
    groupId: seg.groupId,
    order: seg.order,
    sourceText: toMarkdownText(project, seg.sourceIds),
    targetText: toMarkdownText(project, seg.targetIds),
  };
}

/**
 * 프로젝트의 세그먼트를 정렬된 청크로 분할
 * - 원문-번역문 쌍을 유지하면서 청크 단위로 분할
 * - 각 청크는 maxCharsPerChunk 이하의 문자 수를 가짐
 */
export function buildAlignedChunks(
  project: ITEProject,
  maxCharsPerChunk: number = DEFAULT_REVIEW_CHUNK_SIZE
): AlignedChunk[] {
  const orderedSegments = [...project.segments].sort((a, b) => a.order - b.order);
  const chunks: AlignedChunk[] = [];
  let currentChunk: AlignedChunk = { chunkIndex: 0, segments: [], totalChars: 0 };

  for (const seg of orderedSegments) {
    // HTML → TipTap JSON → Markdown 변환 (복잡한 테이블/리스트 구조 보존)
    const alignedSegment = toAlignedSegment(project, seg);
    const segmentSize = alignedSegment.sourceText.length + alignedSegment.targetText.length;

    // 청크 크기 초과 시 새 청크 시작
    if (currentChunk.totalChars + segmentSize > maxCharsPerChunk && currentChunk.segments.length > 0) {
      chunks.push(currentChunk);
      currentChunk = { chunkIndex: chunks.length, segments: [], totalChars: 0 };
    }

    currentChunk.segments.push(alignedSegment);
    currentChunk.totalChars += segmentSize;
  }

  if (currentChunk.segments.length > 0) chunks.push(currentChunk);
  return chunks;
}

/**
 * 비동기 버전의 buildAlignedChunks
 * - 메인 스레드 블로킹 방지를 위해 청크 단위로 yield
 * - AbortSignal 지원으로 취소 가능
 * - 대량 문서에서 UI 응답성 유지
 */
export async function buildAlignedChunksAsync(
  project: ITEProject,
  maxCharsPerChunk: number = DEFAULT_REVIEW_CHUNK_SIZE,
  signal?: AbortSignal
): Promise<AlignedChunk[]> {
  // 즉시 취소 확인
  if (signal?.aborted) {
    throw new Error('Aborted');
  }

  const orderedSegments = [...project.segments].sort((a, b) => a.order - b.order);
  const chunks: AlignedChunk[] = [];
  let currentChunk: AlignedChunk = { chunkIndex: 0, segments: [], totalChars: 0 };

  // 배치 크기: 10개 세그먼트마다 yield
  const BATCH_SIZE = 10;

  for (let i = 0; i < orderedSegments.length; i++) {
    // 취소 확인
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const seg = orderedSegments[i]!;

    // HTML → TipTap JSON → Markdown 변환 → 이미지 제거 (토큰 절약)
    const alignedSegment = toAlignedSegment(project, seg);
    const segmentSize = alignedSegment.sourceText.length + alignedSegment.targetText.length;

    // 청크 크기 초과 시 새 청크 시작
    if (currentChunk.totalChars + segmentSize > maxCharsPerChunk && currentChunk.segments.length > 0) {
      chunks.push(currentChunk);
      currentChunk = { chunkIndex: chunks.length, segments: [], totalChars: 0 };
    }

    currentChunk.segments.push(alignedSegment);
    currentChunk.totalChars += segmentSize;

    // 배치마다 이벤트 루프에 제어권 양보 (UI 블로킹 방지)
    if ((i + 1) % BATCH_SIZE === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  if (currentChunk.segments.length > 0) chunks.push(currentChunk);
  return chunks;
}

// Note: resolveSourceDocumentText, resolveTargetDocumentText, autoSliceLargeDocument
// are no longer used after switching to segment-based chunking (Phase 2)
// Kept for reference but removed to avoid unused variable warnings

// ============================================
// Two-Pass Review Prompt (새 검수 시스템)
// ============================================

/**
 * Translation Review Prompt
 * 전문 번역가 시각으로 실질적 문제만 보고
 */

const TWO_PASS_REVIEW_PROMPT = `# Translation Review

당신은 경력 10년차 전문 번역 검수자입니다. 아래 2-Pass 구조로 검수를 진행하세요.

---

## Pass 1: Rapid Scan (구조 정합성 점검)

세그먼트 단위로 원문(Source)과 번역문(Target)을 정렬해 큰 문제를 먼저 잡습니다.

점검 항목:
- 단락이 통째로 빠진 경우
- 분량 차이가 과도한 경우 (±50% 이상)
- 대응되지 않는 섹션

Pass 1에서 심각한 구조적 문제가 발견되면 해당 세그먼트에 Severity 5로 즉시 플래그합니다.

---

## Pass 2: Granular Fidelity Audit (세밀한 품질 점검)

Pass 1을 통과한 세그먼트를 하나씩 4가지 항목으로 점검합니다.

### ① Omission Check (누락 점검)
번역문의 핵심 명사 3개·동사 2개를 추출하고, 원문의 모든 개념이 담겨 있는지 확인합니다.
- 빠진 개념은 원문에서 직접 인용해 명시합니다.
- **특정 단어가 없는 것 ≠ 누락** (의역/자연스러운 생략은 제외)

### ② Nuance Audit (뉘앙스 점검)
- 감정 강도 (중립 vs 긴박)
- 격식 수준 (formal vs informal)
- 내포된 톤 (권위, 아이러니, 향수 등)

### ③ Terminology Consistency (용어 일관성)
글로서리와 대조해 전문 용어·UI 텍스트·브랜드명 표기를 검증합니다.

### ④ Adaptation Assessment (번역 적응 판정)
변경 사항이:
- **JUSTIFIED**: 언어 구조상 필요한 적응 → 이슈 아님
- **QUESTIONABLE**: 의심스러운 생략 → 이슈로 보고
- **UNNECESSARY**: 불필요한 단순화 → 이슈로 보고

---

## Adversarial Validation (Severity 3점 이상 세그먼트)

Severity 3점 이상으로 플래그된 세그먼트에 한해 내부적으로 다음 3단계를 거칩니다:
1. **Initial Critique**: 문제를 명확히 지적
2. **Defense**: 번역가의 선택이 정당화될 수 있는 반론 구성
3. **Final Judgment**: 양쪽을 종합해 최종 판정 (오탐 방지)

이 과정은 내부 추론으로만 사용하고, 출력에는 Final Judgment 결과만 반영합니다.

---

## 보고하지 마세요

- 의미가 같은 다른 표현 ("진행하다" vs "수행하다")
- 자연스러운 의역/생략 (한국어 주어 생략 등)
- 이미 자연스러운 번역의 "더 나은" 대안
- 스타일 선호 차이

이슈가 없으면 없다고 보고하세요. 억지로 찾지 마세요.`;

// ============================================
// Severity 기준 (1~5점 스케일)
// ============================================

const REVIEW_DETECTION_PROMPT = `## Severity (1~5점 스케일)

- **5 (Critical)**: 독자가 원문과 다른 행동/결정을 내릴 수 있는 오류
  → 수치/날짜/고유명사 오류, 핵심 의미 반전, 핵심 정보 완전 누락
- **4 (Major)**: 독자가 의미는 파악하지만 명백히 어색하거나 부정확한 오류
  → 문법 오류, 직역투, 세부 정보 누락, 용어 불일치
- **3 (Moderate)**: 뉘앙스·톤 차이, 경미한 어색함 (Adversarial Validation 대상)
- **2 (Minor)**: 스타일 차이지만 독자 경험에 영향 없음
- **1 (Trivial)**: 거의 무시 가능한 수준`;

// ============================================
// 출력 형식 (Markdown 기반)
// ============================================

const OUTPUT_FORMAT = `## Output Format

---REVIEW_START---
## Translation Review Result

### Issue #1
- **Source**: "[원문 해당 부분]"
- **Target**: "[번역문 해당 부분]" 또는 (missing)
- **Type**: [Omission/Addition/Mistranslation/Grammar/Awkward/Terminology]
- **Severity**: [1~5]
- **SegmentGroupId**: [세그먼트 ID]
- **Explanation**: [1줄, 20자 이내로 핵심만]
- **Suggestion**: [수정된 번역문 - 필수!]

---

## Summary
- Critical (5): [N]
- Major (4): [N]
- Moderate (3): [N]
- Minor (1~2): [N]
- Verdict: [ACCEPT / MINOR REVISIONS / MAJOR REVISIONS / REJECT]
---REVIEW_END---

**Verdict 기준:**
- ACCEPT: 5점·4점 이슈 없음
- MINOR REVISIONS: 4점 이슈 1~2개 또는 3점 이슈만 있음
- MAJOR REVISIONS: 4점 이슈 3개 이상 또는 5점 이슈 1개
- REJECT: 5점 이슈 3개 이상 또는 구조적 문제

**출력 예시 (반드시 이 형식을 따르세요):**
---REVIEW_START---
## Translation Review Result

### Issue #1
- **Source**: "fully stealth heists"
- **Target**: "도둑질을 실행하도록"
- **Type**: Mistranslation
- **Severity**: 5
- **SegmentGroupId**: seg-001
- **Explanation**: '은밀함' 의미 누락
- **Suggestion**: 완전히 은밀하게 강도를 진행

---

## Summary
- Critical (5): 1
- Major (4): 0
- Moderate (3): 0
- Minor (1~2): 0
- Verdict: MAJOR REVISIONS
---REVIEW_END---

**이슈 없을 경우:**
---REVIEW_START---
## Translation Review Result

Review complete. No issues found.

- Segments reviewed: [N]
- Issues detected: 0

## Summary
- Verdict: ACCEPT
---REVIEW_END---

## 작성 규칙 (필수!)
- Source/Target excerpt: 원문/번역문에서 **문자 그대로 복사** (50자 이내)
- **Suggestion 필수!**: 각 이슈에 올바른 번역 수정안을 반드시 제시 (빈 값 금지)
- SegmentGroupId: 해당 세그먼트의 ID (반드시 포함!)
- 마커(---REVIEW_START/END---) 외부에 텍스트 금지`;

// ============================================
// 프롬프트 생성 함수
// ============================================

/**
 * 검수 프롬프트 생성 (실질적 오류만 보고)
 */
export function buildReviewPrompt(): string {
  return [
    TWO_PASS_REVIEW_PROMPT,
    '',
    REVIEW_DETECTION_PROMPT,
    '',
    OUTPUT_FORMAT,
  ].join('\n');
}

const ReviewToolArgsSchema = z.object({
  maxChars: z.number().int().min(2000).max(30000).optional().describe(`원문/번역문 각각 반환할 최대 문자 수 (기본 ${DEFAULT_REVIEW_CHUNK_SIZE})`),
});

/**
 * 번역 검수 도구 (개선됨)
 * - 세그먼트 기반 청킹으로 원문-번역문 정렬 유지
 * - 첫 번째 청크와 함께 전체 청크 수 반환
 * - 추가 청크는 get_review_chunk 도구로 가져옴
 */
export const reviewTranslationTool = tool(
  async (rawArgs) => {
    const args = ReviewToolArgsSchema.safeParse(rawArgs ?? {});
    const parsed = args.success ? args.data : {};
    const maxChars = parsed.maxChars ?? DEFAULT_REVIEW_CHUNK_SIZE;

    const { project } = useProjectStore.getState();
    if (!project) {
      throw new Error('프로젝트가 로드되지 않았습니다.');
    }

    // 세그먼트 기반 청킹 (원문-번역문 정렬 유지)
    // 리뷰 시작 시 캐시 초기화 후 새로 생성 (gotcha #28: 항상 최신 문서 사용)
    clearReviewChunkCache();
    const chunks = getCachedChunks(project, maxChars);
    const firstChunk = chunks[0];
    if (!firstChunk) {
      throw new Error('원문 또는 번역문이 없습니다. 문서를 먼저 로드해주세요.');
    }

    // Translation Rules, Project Context, Attachments 가져오기
    const { translationRules, projectContext, attachments } = useChatStore.getState();

    // Trade-off: glossary lookup uses only the first chunk to keep prompt size manageable.
    // Multi-chunk glossary would require per-chunk search or merging, adding latency with diminishing returns.
    let glossaryText = '';
    try {
      if (project.id) {
        const chunkText = firstChunk.segments
          .map((s) => `${s.sourceText}\n${s.targetText}`)
          .join('\n')
          .slice(0, 4000);
        if (chunkText.trim().length > 0) {
          const hits = await searchGlossary({
            projectId: project.id,
            query: chunkText,
            domain: project.metadata.domain,
            limit: 40,
          });
          if (hits.length > 0) {
            glossaryText = hits
              .map((e) => `- ${e.source} = ${e.target}${e.notes ? ` (${e.notes})` : ''}`)
              .join('\n');
          }
        }
      }
    } catch {
      // Glossary 검색 실패 시 무시
    }

    // Attachments 텍스트 추출
    const attachmentsText = attachments
      ?.filter((a) => a.extractedText)
      .map((a) => `[${a.filename}]\n${a.extractedText}`)
      .join('\n\n') || '';

    // 검수 프롬프트 생성 (항상 모든 이슈 검출)
    const dynamicInstructions = buildReviewPrompt();

    return {
      instructions: dynamicInstructions,
      totalChunks: chunks.length,
      currentChunk: {
        index: 0,
        segmentCount: firstChunk.segments.length,
        segments: firstChunk.segments.map((seg) => ({
          id: seg.groupId,
          order: seg.order,
          source: seg.sourceText,
          target: seg.targetText,
        })),
      },
      translationRules: translationRules?.trim() || undefined,
      projectContext: projectContext?.trim() || undefined,
      glossary: glossaryText || undefined,
      attachments: attachmentsText || undefined,
      note: chunks.length > 1
        ? `문서가 ${chunks.length}개 청크로 분할되었습니다. get_review_chunk 도구로 나머지 청크를 가져와 순차 검수하세요.`
        : undefined,
    };
  },
  {
    name: 'review_translation',
    description:
      '원문과 번역문을 비교하여 번역 품질을 검수합니다. ' +
      '누락, 오역, 용어 일관성 문제를 찾아 지적합니다. ' +
      '이 도구는 원문/번역문을 가져와 검수 지침과 함께 반환하며, 모델이 이를 분석하여 검수 결과를 생성합니다.',
    schema: ReviewToolArgsSchema,
  },
);

// ============================================
// 청크 기반 검수 도구 (Phase 2C)
// ============================================

const GetReviewChunkArgsSchema = z.object({
  chunkIndex: z.number().int().min(0).describe('청크 인덱스 (0부터 시작)'),
});

/**
 * 검수할 다음 청크를 가져오는 도구
 * - 문서가 길면 청크 단위로 순차 검수
 * - review_translation 호출 후 추가 청크가 필요할 때 사용
 */
export const getReviewChunkTool = tool(
  async (rawArgs) => {
    const args = GetReviewChunkArgsSchema.safeParse(rawArgs ?? {});
    if (!args.success) {
      throw new Error('잘못된 인자입니다. chunkIndex는 0 이상의 정수여야 합니다.');
    }
    const { chunkIndex } = args.data;

    const { project } = useProjectStore.getState();
    if (!project) {
      throw new Error('프로젝트가 로드되지 않았습니다.');
    }

    // 캐시된 청크 사용 (review_translation에서 이미 생성됨)
    // 캐시 미스 시에도 정상 동작 (buildAlignedChunks 수행 후 캐싱)
    const chunks = getCachedChunks(project, DEFAULT_REVIEW_CHUNK_SIZE);

    if (chunkIndex >= chunks.length) {
      return {
        error: 'No more chunks',
        totalChunks: chunks.length,
        message: '모든 청크 검수가 완료되었습니다. 최종 결과를 종합해주세요.',
      };
    }

    const chunk = chunks[chunkIndex]!;
    return {
      chunkIndex,
      totalChunks: chunks.length,
      segmentCount: chunk.segments.length,
      segments: chunk.segments.map((seg) => ({
        id: seg.groupId,
        order: seg.order,
        source: seg.sourceText,
        target: seg.targetText,
      })),
    };
  },
  {
    name: 'get_review_chunk',
    description:
      '검수할 다음 청크를 가져옵니다. ' +
      '문서가 길면 청크 단위로 순차 검수하세요. ' +
      'review_translation 호출 시 totalChunks > 1이면 이 도구를 사용하여 나머지 청크를 검수합니다.',
    schema: GetReviewChunkArgsSchema,
  },
);
