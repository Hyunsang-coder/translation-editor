/**
 * 제안 내용에서 마크다운 포맷팅 및 불필요한 문구 제거
 * AI가 제안한 번역 규칙/컨텍스트에서 마크다운을 strip하여 plain text로 변환
 */
export function cleanSuggestionContent(raw: string): string {
  let cleaned = (raw ?? '').trim();
  if (!cleaned) return '';

  // 마크다운 포맷팅 제거
  cleaned = cleaned
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **bold** → bold
    .replace(/\*([^*]+)\*/g, '$1') // *italic* → italic
    .replace(/`([^`]+)`/g, '$1') // `code` → code
    .trim();

  return cleaned;
}
