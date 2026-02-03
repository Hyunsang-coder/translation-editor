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
      // 4. 마크다운 이스케이프 제거 (AI가 \~ \* \_ 등으로 이스케이프할 수 있음)
      .replace(/\\([~*_`\[\]()#>+\-!|])/g, '$1') // \~ → ~, \* → * 등
      // 5. 마크다운 서식 제거 (순서 중요: ** 먼저 처리 후 * 처리)
      .replace(/\*\*(.+?)\*\*/g, '$1') // **bold** → bold
      .replace(/\*(.+?)\*/g, '$1') // *italic* → italic
      .replace(/__(.+?)__/g, '$1') // __bold__ → bold
      // _italic_ 제거 - 단어 경계에서만 (snake_case 보호)
      // (?<![a-zA-Z0-9]) = 앞에 영숫자 없음, (?![a-zA-Z0-9]) = 뒤에 영숫자 없음
      .replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, '$1')
      .replace(/~~(.+?)~~/g, '$1') // ~~strikethrough~~ → strikethrough
      .replace(/`(.+?)`/g, '$1') // `code` → code
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [text](url) → text
      // 6. 리스트/헤딩 마커 제거
      .replace(/^#{1,6}\s+/gm, '') // # Heading → Heading
      .replace(/^\s*[-*+]\s+/gm, '') // - item → item
      .replace(/^\s*\d+\.\s+/gm, '') // 1. item → item
      // 7. 특수 공백 문자 정규화 (Unicode)
      .replace(UNICODE_NORMALIZE_PATTERNS.specialSpaces, ' ')
      // 8. 줄바꿈 통일 및 공백 정규화
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

/**
 * 정규화된 텍스트와 원본 위치 매핑 결과
 */
export interface NormalizedTextResult {
  /** 정규화된 텍스트 */
  normalizedText: string;
  /** normalizedText[i] → originalText의 인덱스 매핑 */
  indexMap: number[];
}

/**
 * 에디터 텍스트 정규화 및 원본 인덱스 매핑 구축
 *
 * ReviewHighlight와 SearchHighlight에서 공통으로 사용.
 * 정규화 과정에서 문자가 제거/변환되므로, 정규화된 텍스트의 각 인덱스가
 * 원본 텍스트의 어느 인덱스에 해당하는지 추적합니다.
 *
 * 정규화 과정:
 * 1. 유니코드 문자 정규화 (따옴표, 대시, 공백 - 1:1 치환)
 * 2. CRLF/CR → 공백
 * 3. 연속 공백 → 단일 공백
 * 4. 앞뒤 공백 제거 (trim)
 *
 * @param originalText - 원본 텍스트
 * @returns normalizedText: 정규화된 텍스트, indexMap: normalizedText[i] → originalText index
 */
export function buildNormalizedTextWithMapping(originalText: string): NormalizedTextResult {
  // 1. 유니코드 문자 정규화 (1:1 매핑 유지)
  const processed = applyUnicodeNormalization(originalText);

  // 2. CRLF, CR → 일반 공백 (1:1 또는 2:1 매핑)
  const indexMap: number[] = [];
  let normalizedText = '';

  let i = 0;
  while (i < processed.length) {
    const char = processed[i];
    const nextChar = processed[i + 1];

    // CRLF 처리 (2문자 → 1공백)
    if (char === '\r' && nextChar === '\n') {
      normalizedText += ' ';
      indexMap.push(i);
      i += 2;
      continue;
    }

    // CR만 있는 경우 (1문자 → 1공백)
    if (char === '\r') {
      normalizedText += ' ';
      indexMap.push(i);
      i++;
      continue;
    }

    // 일반 문자
    normalizedText += char;
    indexMap.push(i);
    i++;
  }

  // 3. 연속 공백 축소 (여러 공백 → 1공백)
  const finalText: string[] = [];
  const finalIndexMap: number[] = [];
  let prevWasSpace = false;

  for (let j = 0; j < normalizedText.length; j++) {
    const char = normalizedText[j]!;
    const originalIdx = indexMap[j]!;
    const isSpace = /\s/.test(char);

    if (isSpace) {
      if (!prevWasSpace) {
        finalText.push(' ');
        finalIndexMap.push(originalIdx);
      }
      // 연속 공백은 스킵 (매핑에서 제외)
      prevWasSpace = true;
    } else {
      finalText.push(char);
      finalIndexMap.push(originalIdx);
      prevWasSpace = false;
    }
  }

  // 4. 앞뒤 공백 제거 (trim)
  let startTrim = 0;
  let endTrim = finalText.length;

  while (startTrim < finalText.length && /\s/.test(finalText[startTrim]!)) {
    startTrim++;
  }
  while (endTrim > startTrim && /\s/.test(finalText[endTrim - 1]!)) {
    endTrim--;
  }

  return {
    normalizedText: finalText.slice(startTrim, endTrim).join(''),
    indexMap: finalIndexMap.slice(startTrim, endTrim),
  };
}
