import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useReviewStore, type ReviewIntensity } from '@/stores/reviewStore';
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
// 검수자 역할 정의 (Phase 3: 과잉 검출 방지)
// ============================================

const REVIEWER_ROLE = `당신은 10년 경력의 전문 번역 검수자입니다.

## 검수 철학
- 번역자의 의도적 선택을 존중
- 과잉 검출보다 정확한 검출을 우선
- 의역과 오역을 명확히 구분
- 확신 없으면 문제 아님`;

// ============================================
// 검수 강도별 프롬프트 (강화됨: 카테고리 통합)
// ============================================

const INTENSITY_PROMPTS: Record<ReviewIntensity, string> = {
  minimal: `## 검출 기준: 명백한 오류만

검출:
- 의미가 정반대인 오역 (긍정↔부정, 허용↔금지)
- 금액, 날짜, 수량 등 팩트 오류
- 핵심 정보(조건, 경고) 완전 누락

허용 (검출 안 함):
- 어순 변경, 의역, 문체 차이
- 부가 설명 생략
- 뉘앙스 차이`,

  balanced: `## 검출 기준: 의미 전달 오류

검출:
- 오역 (의미가 달라진 경우)
- 정보 누락 (문장/절 단위)
- 의미 왜곡 (강도, 범위, 조건 변경)

허용 (검출 안 함):
- 자연스러운 의역
- 어순, 문체 차이
- 사소한 뉘앙스 차이`,

  thorough: `## 검출 기준: 세밀한 검토

검출:
- 모든 오역 (미세한 의미 차이 포함)
- 모든 누락 (사소한 정보 포함)
- 의미 왜곡 (강도, 범위, 조건)
- 용어 일관성 (같은 원어가 다르게 번역)
- 뉘앙스 변화

허용 (검출 안 함):
- 명백히 의도된 로컬라이제이션`,
};

// ============================================
// 과잉 검출 방지 가이드 (Phase 3)
// ============================================

const HALLUCINATION_GUARD = `## 과잉 검출 방지 (필수!)

검출 전 자문: "이것이 번역 오류인가, 번역자의 선택인가?"

문제 아닌 것:
- 어순 변경 (자연스러운 문장 구성)
- 존칭/경어 수준 조정
- 문화적 로컬라이제이션
- 명시적 주어 추가/생략
- 자연스러운 의역

확신 없음 = 문제 없음`;

// ============================================
// Few-shot 예시 (Phase 3: 과잉 검출 방지)
// ============================================

const FEW_SHOT_EXAMPLES = `## 예시

### 오역 (검출 O)
Source: "You must restart"
Target: "재시작할 수 있습니다"
→ must→can 의미 변경
{
  "issues": [{
    "segmentOrder": 1,
    "type": "오역",
    "sourceExcerpt": "You must restart",
    "targetExcerpt": "재시작할 수 있습니다",
    "problem": "의무(must)가 가능(can)으로 변경",
    "reason": "원문은 필수, 번역은 선택으로 의미 전달",
    "suggestedFix": "재시작해야 합니다"
  }]
}

### 의역 (검출 X)
Source: "It goes without saying"
Target: "두말할 나위 없이"
→ 자연스러운 의역, 의미 완전 전달
{ "issues": [] }`;

// ============================================
// 개선된 출력 형식 (Phase 3: 마커 기반)
// ============================================

const OUTPUT_FORMAT = `## 출력 형식 (엄격 준수!)

---REVIEW_START---
{
  "issues": [
    {
      "segmentOrder": 1,
      "type": "오역|누락|왜곡|일관성",
      "sourceExcerpt": "원문 30자 이내",
      "targetExcerpt": "번역문 30자 이내",
      "problem": "무엇이 문제인지 (1줄)",
      "reason": "왜 문제인지 (1줄)",
      "suggestedFix": "대체 텍스트만"
    }
  ]
}
---REVIEW_END---

## suggestedFix 작성 규칙 (필수!)
- suggestedFix는 targetExcerpt와 **정확히 같은 범위**의 텍스트
- 시스템이 targetExcerpt를 suggestedFix로 **1:1 교체**함
- 범위가 다르면 문장이 깨짐!

금지: 마커 외부 텍스트, 설명문, 마크다운
문제 없음: ---REVIEW_START---{ "issues": [] }---REVIEW_END---`;

// ============================================
// 프롬프트 생성 함수
// ============================================

/**
 * 검수 설정에 따른 동적 프롬프트 생성
 * 강도(intensity)만으로 검출 범위 결정 (카테고리 제거)
 */
export function buildReviewPrompt(intensity: ReviewIntensity): string {
  return [
    REVIEWER_ROLE,
    '',
    INTENSITY_PROMPTS[intensity],
    '',
    HALLUCINATION_GUARD,
    '',
    FEW_SHOT_EXAMPLES,
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
