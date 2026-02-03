import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useReviewStore, type ReviewIntensity } from '@/stores/reviewStore';
import { htmlToTipTapJson, tipTapJsonToMarkdownForTranslation } from '@/utils/markdownConverter';
import { searchGlossary } from '@/tauri/glossary';
import type { ITEProject } from '@/types';

// ============================================
// 세그먼트 기반 청킹 (Phase 2)
// ============================================

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
    // HTML → TipTap JSON → Markdown 변환 (복잡한 테이블도 HTML로 보존)
    // 번역용 함수 사용: 셀 내 리스트/다중 paragraph가 있는 테이블도 완전 보존
    const sourceText = seg.sourceIds
      .map(id => {
        const html = project.blocks[id]?.content || '';
        if (!html.trim()) return '';
        const json = htmlToTipTapJson(html);
        return tipTapJsonToMarkdownForTranslation(json);
      })
      .join('\n');
    const targetText = seg.targetIds
      .map(id => {
        const html = project.blocks[id]?.content || '';
        if (!html.trim()) return '';
        const json = htmlToTipTapJson(html);
        return tipTapJsonToMarkdownForTranslation(json);
      })
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

    // HTML → TipTap JSON → Markdown 변환 (복잡한 테이블도 HTML로 보존)
    const sourceText = seg.sourceIds
      .map(id => {
        const html = project.blocks[id]?.content || '';
        if (!html.trim()) return '';
        const json = htmlToTipTapJson(html);
        return tipTapJsonToMarkdownForTranslation(json);
      })
      .join('\n');
    const targetText = seg.targetIds
      .map(id => {
        const html = project.blocks[id]?.content || '';
        if (!html.trim()) return '';
        const json = htmlToTipTapJson(html);
        return tipTapJsonToMarkdownForTranslation(json);
      })
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
 * Two-Pass Review 방법론
 * Pass 1: Segment-Based Detection - 과검출 허용하며 모든 의심 항목 기록
 * Pass 2: Critical Filtering - False Positive 제거, 최종 이슈 확정
 */

const TWO_PASS_REVIEW_PROMPT = `# Translation Review System

## Core Methodology: Two-Pass Review

**Pass 1: Segment-Based Detection**
1. 원문을 의미 단위(문장/절)로 분할
2. 각 세그먼트에 대응하는 번역 부분 식별
3. 1:1 대조하며 잠재 이슈 검출
4. 모든 의심 항목 기록 (과검출 허용)

**Pass 2: Critical Filtering**
1. Pass 1 이슈 각각 재검토
2. 필터링 질문 적용:
   - 실제 의미 손실이 있는가?
   - 타겟 언어에서 자연스러운 생략/변형인가?
   - 문화적 적응으로 정당화되는가?
3. 오탐(False Positive) 제거
4. 최종 이슈 목록 확정

---

## Issue Types

| Type | Description |
|------|-------------|
| Omission | 원문 정보가 번역에서 누락 |
| Addition | 원문에 없는 내용 추가 |
| Nuance Shift | 톤, 강조점, 긴급성, 확신도 변형 |
| Terminology | 프로젝트 글로서리/표준 용어와 불일치 |
| Mistranslation | 명백한 의미 오역 |

---

## Severity Levels

| Level | Criteria |
|-------|----------|
| Critical | 핵심 정보 누락, 의미 왜곡, 비즈니스 영향 |
| Major | 중요 세부사항 누락, 명확한 톤 변형 |
| Minor | 미세한 뉘앙스 차이, 스타일 선호 수준 |

---

## False Positive Prevention

**이슈 아님으로 판정하는 경우:**
- 타겟 언어에서 자연스러운 생략 (예: 한국어 주어 생략)
- 문화적 적응으로 정당화되는 변형
- 동일 의미의 다른 표현
- 타겟 독자에게 더 명확한 의역

**실제 이슈로 판정하는 경우:**
- 정보 손실 발생
- 독자가 다른 행동/이해를 하게 될 가능성
- 기술적 정확성 훼손
- 프로젝트 글로서리 위반`;

// ============================================
// 검수 강도별 프롬프트
// ============================================

const REVIEW_INTENSITY_PROMPTS: Record<ReviewIntensity, string> = {
  minimal: `## 검출 기준: Critical 이슈만

검출 대상:
- 명백한 오역 (의미가 정반대)
- 핵심 정보 완전 누락
- 비즈니스 영향이 있는 오류

Pass 2에서 Major/Minor는 모두 제거`,

  balanced: `## 검출 기준: Critical + Major 이슈

검출 대상:
- 모든 Critical 이슈
- 중요 세부사항 누락/변형
- 용어 불일치 (글로서리 위반)

Pass 2에서 Minor는 제거`,

  thorough: `## 검출 기준: 모든 이슈

검출 대상:
- Critical, Major, Minor 모두 보고
- 미세한 뉘앙스 차이도 포함
- 스타일 선호 수준까지 검토

단, False Positive는 여전히 제거`,
};

// ============================================
// 출력 형식 (Markdown 기반)
// ============================================

const OUTPUT_FORMAT = `## Output Format

---REVIEW_START---
## Translation Review Result

### Issue #1
- **Source**: "[원문 해당 부분]"
- **Target**: "[번역문 해당 부분]" 또는 (missing)
- **Type**: [Omission/Addition/Nuance Shift/Terminology/Mistranslation]
- **Severity**: [Critical/Major/Minor]
- **SegmentGroupId**: [세그먼트 ID]
- **Explanation**: [문제 설명]
- **Suggestion**: [수정된 번역문 - 필수!]

---

## Summary
- Critical: [N]
- Major: [N]
- Minor: [N]
---REVIEW_END---

**출력 예시 (반드시 이 형식을 따르세요):**
---REVIEW_START---
## Translation Review Result

### Issue #1
- **Source**: "fully stealth heists"
- **Target**: "도둑질을 실행하도록"
- **Type**: Mistranslation
- **Severity**: Critical
- **SegmentGroupId**: seg-001
- **Explanation**: 'fully stealth heists'는 '완전히 은밀하게 강도를 수행하다'는 의미인데, '도둑질을 실행하도록'으로 번역되어 '은밀함(stealth)'의 핵심 개념이 누락되었습니다.
- **Suggestion**: 완전히 은밀하게 강도를 진행

---
---REVIEW_END---

**이슈 없을 경우:**
---REVIEW_START---
## Translation Review Result

Review complete. No issues found.

- Segments reviewed: [N]
- Issues detected: 0
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
 * 검수 설정에 따른 동적 프롬프트 생성
 * Two-Pass Review 방법론 기반
 */
export function buildReviewPrompt(intensity: ReviewIntensity): string {
  return [
    TWO_PASS_REVIEW_PROMPT,
    '',
    REVIEW_INTENSITY_PROMPTS[intensity],
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
    const chunks = buildAlignedChunks(project, maxChars);
    const firstChunk = chunks[0];
    if (!firstChunk) {
      throw new Error('원문 또는 번역문이 없습니다. 문서를 먼저 로드해주세요.');
    }

    // Translation Rules, Project Context, Attachments 가져오기
    const { translationRules, projectContext, attachments } = useChatStore.getState();

    // 검수 설정 가져오기
    const { intensity } = useReviewStore.getState();

    // Glossary 검색 (첫 번째 청크 기반)
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

    // 검수 설정 기반 동적 프롬프트 생성
    const dynamicInstructions = buildReviewPrompt(intensity);

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

    const chunks = buildAlignedChunks(project);

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
