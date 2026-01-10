import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { stripHtml } from '@/utils/hash';
import { searchGlossary } from '@/tauri/glossary';
import type { ITEProject } from '@/types';

// ============================================
// 세그먼트 기반 청킹 (Phase 2)
// ============================================

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

// Note: resolveSourceDocumentText, resolveTargetDocumentText, autoSliceLargeDocument
// are no longer used after switching to segment-based chunking (Phase 2)
// Kept for reference but removed to avoid unused variable warnings

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

const ReviewToolArgsSchema = z.object({
  maxChars: z.number().int().min(2000).max(30000).optional().describe('원문/번역문 각각 반환할 최대 문자 수 (기본 12000)'),
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
    const maxChars = parsed.maxChars ?? 12000;

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

    return {
      instructions: REVIEW_INSTRUCTIONS,
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
