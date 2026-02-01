/**
 * 유니코드 문자 정규화 패턴
 * ReviewHighlight, SearchHighlight에서도 사용하므로 export
 */
export const UNICODE_NORMALIZE_PATTERNS = {
  // 곡선/전각 큰따옴표 → 직선 "
  doubleQuotes: /[\u201C\u201D\u201E\u201F\u2033\u2036\uFF02]/g,
  // 곡선/전각 작은따옴표 → 직선 '
  singleQuotes: /[\u2018\u2019\u201A\u201B\u2032\u2035\uFF07]/g,
  // CJK 꺾쇠 따옴표「」→ 직선 "
  cjkCornerBrackets: /[\u300C\u300D]/g,
  // CJK 겹꺾쇠 따옴표『』→ 직선 "
  cjkDoubleCornerBrackets: /[\u300E\u300F]/g,
  // en-dash, em-dash, 전각 하이픈 → hyphen
  dashes: /[\u2013\u2014\u2015\uFF0D]/g,
  // 특수 공백 문자 (non-breaking space, various width spaces, ideographic space)
  specialSpaces: /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g,
} as const;

/**
 * 유니코드 따옴표/대시/공백 정규화 적용 (1:1 치환)
 * 문자열 길이가 변하지 않으므로 인덱스 매핑에 안전
 */
export function applyUnicodeNormalization(text: string): string {
  return text
    .replace(UNICODE_NORMALIZE_PATTERNS.specialSpaces, ' ')
    .replace(UNICODE_NORMALIZE_PATTERNS.doubleQuotes, '"')
    .replace(UNICODE_NORMALIZE_PATTERNS.singleQuotes, "'")
    .replace(UNICODE_NORMALIZE_PATTERNS.cjkCornerBrackets, '"')
    .replace(UNICODE_NORMALIZE_PATTERNS.cjkDoubleCornerBrackets, '"')
    .replace(UNICODE_NORMALIZE_PATTERNS.dashes, '-');
}

/**
 * 검색을 위한 텍스트 정규화 함수
 *
 * AI가 반환하는 excerpt에 마크다운 서식이 포함되어 있고,
 * 에디터는 plain text 기반으로 검색하므로 불일치가 발생합니다.
 *
 * 이 함수는:
 * 1. HTML 엔티티 변환 (&nbsp; 등)
 * 2. 유니코드 문자 정규화 (따옴표, 대시, 공백)
 * 3. 마크다운 서식 제거 (bold, italic, code, strikethrough, links 등)
 * 4. 리스트/헤딩 마커 제거
 * 5. 공백 정규화 (연속 공백 → 단일 공백)
 *
 * @param text - 정규화할 텍스트 (AI 응답의 excerpt 등)
 * @returns 정규화된 plain text
 */
export function normalizeForSearch(text: string): string {
  return (
    text
      // 1. HTML 태그 제거 (AI 응답에 <code>, <strong> 등 포함될 수 있음)
      .replace(/<[^>]+>/g, '')
      // 2. HTML 엔티티 변환
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      // 3. 유니코드 문자 정규화 (applyUnicodeNormalization과 동일)
      .replace(UNICODE_NORMALIZE_PATTERNS.doubleQuotes, '"')
      .replace(UNICODE_NORMALIZE_PATTERNS.singleQuotes, "'")
      .replace(UNICODE_NORMALIZE_PATTERNS.cjkCornerBrackets, '"')
      .replace(UNICODE_NORMALIZE_PATTERNS.cjkDoubleCornerBrackets, '"')
      .replace(UNICODE_NORMALIZE_PATTERNS.dashes, '-')
      // 4. 마크다운 서식 제거 (순서 중요: ** 먼저 처리 후 * 처리)
      .replace(/\*\*(.+?)\*\*/g, '$1') // **bold** → bold
      .replace(/\*(.+?)\*/g, '$1') // *italic* → italic
      .replace(/__(.+?)__/g, '$1') // __bold__ → bold
      // _italic_ 제거 - 단어 경계에서만 (snake_case 보호)
      // (?<![a-zA-Z0-9]) = 앞에 영숫자 없음, (?![a-zA-Z0-9]) = 뒤에 영숫자 없음
      .replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, '$1')
      .replace(/~~(.+?)~~/g, '$1') // ~~strikethrough~~ → strikethrough
      .replace(/`(.+?)`/g, '$1') // `code` → code
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [text](url) → text
      // 5. 리스트/헤딩 마커 제거
      .replace(/^#{1,6}\s+/gm, '') // # Heading → Heading
      .replace(/^\s*[-*+]\s+/gm, '') // - item → item
      .replace(/^\s*\d+\.\s+/gm, '') // 1. item → item
      // 6. 특수 공백 문자 정규화 (Unicode)
      .replace(UNICODE_NORMALIZE_PATTERNS.specialSpaces, ' ')
      // 7. 줄바꿈 통일 및 공백 정규화
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
    // _italic_ 제거 - 단어 경계에서만 (snake_case 보호)
    .replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, '$1')
    .replace(/~~(.+?)~~/g, '$1') // ~~strikethrough~~ → strikethrough
    .replace(/`(.+?)`/g, '$1') // `code` → code
    .replace(/\[(.+?)\]\(.+?\)/g, '$1'); // [text](url) → text
}
