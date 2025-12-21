import type { ITEProject } from '@/types';
import { stripHtml } from '@/utils/hash';

/**
 * Source는 참고용이므로 Target과 매칭/브릿지하지 않고,
 * 단순히 읽기 쉬운 단일 문서(plain text)로 구성합니다.
 */
export function buildSourceDocument(project: ITEProject): string {
  const orderedSegments = [...project.segments].sort((a, b) => a.order - b.order);
  const parts: string[] = [];

  orderedSegments.forEach((seg) => {
    seg.sourceIds.forEach((id) => {
      const b = project.blocks[id];
      if (!b) return;
      const plain = stripHtml(b.content);
      if (plain.length > 0) parts.push(plain);
    });
  });

  return parts.join('\n\n');
}


