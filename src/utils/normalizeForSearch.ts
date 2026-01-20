/**
 * 검색을 위한 텍스트 정규화 함수
 *
 * AI가 반환하는 excerpt에 마크다운 서식이 포함되어 있고,
 * 에디터는 plain text 기반으로 검색하므로 불일치가 발생합니다.
 *
 * 이 함수는:
 * 1. HTML 엔티티 변환 (&nbsp; 등)
 * 2. 마크다운 서식 제거 (bold, italic, code, strikethrough, links 등)
 * 3. 리스트/헤딩 마커 제거
 * 4. 특수 공백 문자 정규화 (Unicode non-breaking spaces 등)
 * 5. 공백 정규화 (연속 공백 → 단일 공백)
 *
 * @param text - 정규화할 텍스트 (AI 응답의 excerpt 등)
 * @returns 정규화된 plain text
 */
export function normalizeForSearch(text: string): string {
  return (
    text
      // 1. HTML 엔티티 변환
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      // 2. 마크다운 서식 제거 (순서 중요: ** 먼저 처리 후 * 처리)
      .replace(/\*\*(.+?)\*\*/g, '$1') // **bold** → bold
      .replace(/\*(.+?)\*/g, '$1') // *italic* → italic
      .replace(/__(.+?)__/g, '$1') // __bold__ → bold
      .replace(/_(.+?)_/g, '$1') // _italic/underline_ → italic
      .replace(/~~(.+?)~~/g, '$1') // ~~strikethrough~~ → strikethrough
      .replace(/`(.+?)`/g, '$1') // `code` → code
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [text](url) → text
      // 3. 리스트/헤딩 마커 제거
      .replace(/^#{1,6}\s+/gm, '') // # Heading → Heading
      .replace(/^\s*[-*+]\s+/gm, '') // - item → item
      .replace(/^\s*\d+\.\s+/gm, '') // 1. item → item
      // 4. 특수 공백 문자 정규화 (Unicode)
      // \u00A0: non-breaking space, \u2000-\u200A: various width spaces
      // \u202F: narrow no-break space, \u205F: medium mathematical space, \u3000: ideographic space
      .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      // 5. 줄바꿈 통일 및 공백 정규화
      .replace(/\r\n|\r/g, ' ') // CRLF, CR → 공백
      .replace(/\s+/g, ' ') // 연속 공백/줄바꿈 → 단일 공백
      .trim()
  );
}

/**
 * 표시용 마크다운 서식 제거 (description 등)
 *
 * normalizeForSearch와 달리 리스트/헤딩 마커는 유지하고
 * 인라인 서식만 제거합니다.
 *
 * @param text - 서식을 제거할 텍스트
 * @returns 인라인 마크다운 서식이 제거된 텍스트
 */
export function stripMarkdownInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold** → bold
    .replace(/\*(.+?)\*/g, '$1') // *italic* → italic
    .replace(/__(.+?)__/g, '$1') // __bold__ → bold
    .replace(/_(.+?)_/g, '$1') // _underline_ → underline
    .replace(/~~(.+?)~~/g, '$1') // ~~strikethrough~~ → strikethrough
    .replace(/`(.+?)`/g, '$1') // `code` → code
    .replace(/\[(.+?)\]\(.+?\)/g, '$1'); // [text](url) → text
}
