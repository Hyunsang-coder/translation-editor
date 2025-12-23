import type { ITEProject } from '@/types';
import { stripHtml } from '@/utils/hash';

export interface TargetDocumentBuildResult {
  text: string;
  /**
   * SegmentGroup별 시작 offset(UTF-16 code unit 기준)
   * - Monaco model.getPositionAt(offset) 입력으로 바로 사용 가능
   */
  segmentStartOffsets: Record<string, number>;
  /**
   * target blockId별 초기 offset range (UTF-16)
   * - tracked range(decorations) 생성에 사용
   */
  blockRanges: Record<string, { startOffset: number; endOffset: number }>;
}

/**
 * 기존 blocks/segments(프로토타입 데이터 모델)에서
 * Target 단일 문서(plain text)를 구성합니다.
 *
 * - Segment 순서는 order 기준
 * - Segment 내부 target block들은 등장 순서대로 이어붙임
 * - block 사이: '\\n'
 * - segment 사이: '\\n\\n'
 */
export function buildTargetDocument(project: ITEProject): TargetDocumentBuildResult {
  const orderedSegments = [...project.segments].sort((a, b) => a.order - b.order);

  let text = '';
  const segmentStartOffsets: Record<string, number> = {};
  const blockRanges: Record<string, { startOffset: number; endOffset: number }> = {};

  orderedSegments.forEach((seg, segIndex) => {
    segmentStartOffsets[seg.groupId] = text.length;

    seg.targetIds.forEach((id, blockIndex) => {
      const b = project.blocks[id];
      if (!b) return;
      const content = b.content;
      const startOffset = text.length;
      text += content;
      const endOffset = text.length;
      blockRanges[id] = { startOffset, endOffset };

      if (blockIndex < seg.targetIds.length - 1) {
        text += '\n';
      }
    });

    if (segIndex < orderedSegments.length - 1) {
      text += '\n\n';
    }
  });

  return { text, segmentStartOffsets, blockRanges };
}


