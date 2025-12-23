import type { ITEProject } from '@/types';
import { stripHtml } from '@/utils/hash';

export interface SourceDocumentBuildResult {
  text: string;
  /**
   * source blockId별 초기 offset range (UTF-16)
   * - 저장 시 역투영에 사용
   */
  blockRanges: Record<string, { startOffset: number; endOffset: number }>;
}

/**
 * Source는 참고용이므로 Target과 매칭/브릿지하지 않고,
 * 단순히 읽기 쉬운 단일 문서(plain text)로 구성합니다.
 *
 * - 빈 블록도 포함하여 인덱스 일관성 유지
 * - 블록별 offset range를 함께 반환하여 저장 시 정확한 역투영 가능
 */
export function buildSourceDocument(project: ITEProject): SourceDocumentBuildResult {
  const orderedSegments = [...project.segments].sort((a, b) => a.order - b.order);

  let text = '';
  const blockRanges: Record<string, { startOffset: number; endOffset: number }> = {};
  let isFirst = true;

  orderedSegments.forEach((seg) => {
    seg.sourceIds.forEach((id) => {
      const b = project.blocks[id];
      if (!b) return;

      if (!isFirst) {
        text += '\n\n';
      }
      isFirst = false;

      const content = b.content;
      const startOffset = text.length;
      text += content;
      const endOffset = text.length;
      blockRanges[id] = { startOffset, endOffset };
    });
  });

  return { text, blockRanges };
}


