import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useReviewStore, type ReviewIntensity, type ReviewCategories } from '@/stores/reviewStore';
import { htmlToMarkdown } from '@/utils/markdownConverter';
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
    // HTML → Markdown 변환으로 포맷 정보 유지 (제목, 리스트, 볼드 등)
    const sourceText = seg.sourceIds
      .map(id => htmlToMarkdown(project.blocks[id]?.content || ''))
      .join('\n');
    const targetText = seg.targetIds
      .map(id => htmlToMarkdown(project.blocks[id]?.content || ''))
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

// Note: resolveSourceDocumentText, resolveTargetDocumentText, autoSliceLargeDocument
// are no longer used after switching to segment-based chunking (Phase 2)
// Kept for reference but removed to avoid unused variable warnings

// ============================================
// 검수 강도별 프롬프트
// ============================================

const INTENSITY_PROMPTS: Record<ReviewIntensity, string> = {
  minimal: `## 검출 기준: 명백한 오류만
- 의미가 정반대인 오역
- 금액/날짜/수량 등 팩트 누락
- 애매하면 검출하지 않음
- 의역/스타일 차이는 모두 허용`,

  balanced: `## 검출 기준: 중요한 오류
- 의미가 크게 달라진 오역
- 중요 정보(조건, 예외, 주의사항) 누락
- 확실한 경우만 검출
- 자연스러운 의역은 허용`,

  thorough: `## 검출 기준: 세밀한 검토
- 의미 차이가 있는 모든 오역
- 정보 누락 (사소한 것 포함)
- 강도/범위 변경 (must→can 등)
- 미세한 뉘앙스 차이도 검출`,
};

// ============================================
// 검수 항목별 지침
// ============================================

const CATEGORY_PROMPTS: Record<keyof ReviewCategories, string> = {
  mistranslation: `**오역**: 원문과 번역문의 의미가 다른 경우`,
  omission: `**누락**: 원문에 있는 정보가 번역문에 없는 경우`,
  distortion: `**왜곡**: 강도(must→can), 범위(전체→부분), 조건 등이 변경된 경우`,
  consistency: `**일관성**: 같은 용어가 다르게 번역된 경우 (Glossary 기준)`,
};

// ============================================
// 개선된 출력 형식
// ============================================

const OUTPUT_FORMAT = `## 출력 형식

문제 발견 시 JSON으로 출력:
{
  "issues": [
    {
      "segmentOrder": 1,
      "type": "오역|누락|왜곡|일관성",
      "sourceExcerpt": "원문 30자 이내",
      "targetExcerpt": "번역문 30자 이내 (수정 대상 텍스트)",
      "problem": "무엇이 문제인지 (1줄)",
      "reason": "왜 문제인지 - 원문과 대비 (1줄)",
      "impact": "독자가 받을 오해 (1줄)",
      "suggestedFix": "targetExcerpt를 대체할 정확한 번역문만 (설명/지시문 없이)"
    }
  ]
}

## suggestedFix 작성 규칙 (중요!)
- targetExcerpt를 직접 대체할 텍스트만 작성
- 설명, 지시문, 따옴표, 마크다운 서식 없이 순수 번역문만
- 예시:
  - ✅ 좋음: targetExcerpt "사용자 인터페이스" → suggestedFix: "UI"
  - ✅ 좋음: targetExcerpt "할 수 있습니다" → suggestedFix: "해야 합니다"
  - ❌ 나쁨: "'사용자 인터페이스'를 'UI'로 바꾸세요"
  - ❌ 나쁨: "**UI**로 변경 권장"
  - ❌ 나쁨: "UI (약어 사용 권장)"

문제 없음: { "issues": [] }`;

// ============================================
// 프롬프트 생성 함수
// ============================================

/**
 * 검수 설정에 따른 동적 프롬프트 생성
 */
export function buildReviewPrompt(
  intensity: ReviewIntensity,
  categories: ReviewCategories,
): string {
  // 활성화된 검수 항목만 포함
  const enabledCategories = Object.entries(categories)
    .filter(([, enabled]) => enabled)
    .map(([key]) => CATEGORY_PROMPTS[key as keyof ReviewCategories])
    .join('\n');

  // 활성화된 항목이 없으면 경고
  if (!enabledCategories) {
    return `검수할 항목이 선택되지 않았습니다. 검수 설정에서 하나 이상의 항목을 활성화해주세요.`;
  }

  return `당신은 번역 품질 검수자입니다.

${INTENSITY_PROMPTS[intensity]}

## 검수 항목 (이것만 검출)
${enabledCategories}

## 검출하지 않는 것
- 어순, 문체, 표현 방식 차이
- 자연스러운 의역
- 위에서 지정하지 않은 항목

${OUTPUT_FORMAT}`;
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
    const { intensity, categories } = useReviewStore.getState();

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
    const dynamicInstructions = buildReviewPrompt(intensity, categories);

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
