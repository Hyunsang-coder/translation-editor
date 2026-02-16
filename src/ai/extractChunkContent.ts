import type { AIMessageChunk } from '@langchain/core/messages';

/**
 * AIMessageChunk에서 텍스트 콘텐츠 추출
 */
export function extractChunkContent(chunk: AIMessageChunk): string {
  const content = chunk.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (typeof c === 'object' && c && 'text' in c) return String((c as { text: unknown }).text ?? '');
        return '';
      })
      .join('');
  }
  return '';
}
