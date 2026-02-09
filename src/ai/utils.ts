// 최대 출력 크기 상수
export const MAX_TOOL_OUTPUT_CHARS = 8000;

/**
 * 큰 결과 자동 트렁케이션
 * 앞쪽 70%, 뒤쪽 30%를 유지하고 중간에 [truncated] 마커 삽입
 */
export function truncateToolOutput(content: string, maxChars = MAX_TOOL_OUTPUT_CHARS): string {
  if (content.length <= maxChars) return content;

  const marker = '\n...[truncated]...\n';
  const budget = maxChars - marker.length;
  const head = content.slice(0, Math.floor(budget * 0.7));
  const tail = content.slice(-Math.floor(budget * 0.3));
  return `${head}${marker}${tail}`;
}
