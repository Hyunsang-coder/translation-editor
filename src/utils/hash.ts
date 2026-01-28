/**
 * 컨텐츠 해시 유틸리티
 * 블록 변경 감지를 위한 해시 생성
 */

/**
 * 간단한 문자열 해시 생성
 * @param content - 해시할 콘텐츠
 * @returns 해시 문자열
 */
export function hashContent(content: string): string {
  let hash = 0;

  if (content.length === 0) {
    return hash.toString(36);
  }

  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return Math.abs(hash).toString(36);
}

/**
 * HTML 태그를 제거하고 텍스트만 추출
 * - 블록 태그(p, div, h1-6, li 등) 뒤에는 줄바꿈을 추가하여 텍스트 구조 유지
 * - 테이블 셀(td, th) 뒤에는 공백을 추가하여 단어 분리 유지
 * - HTML 엔티티(&nbsp;, &lt; 등)를 일반 문자로 변환
 * @param html - HTML 문자열
 * @returns 순수 텍스트
 */
export function stripHtml(html: string): string {
  if (!html) return '';

  const text = html
    .replace(/<\/p>|<\/div>|<\/h[1-6]>|<\/li>|<\/blockquote>|<\/pre>|<\/tr>/gi, '\n')
    .replace(/<\/td>|<\/th>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '');

  // HTML 엔티티 디코딩
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&copy;': '©',
    '&reg;': '®'
  };

  return text
    .replace(/&[a-z0-9#]+;/gi, (entity) => entities[entity] || entity)
    .replace(/\n\s*\n/g, '\n\n') // 중복 줄바꿈 정리
    .trim();
}

/**
 * 두 콘텐츠가 동일한지 비교
 * @param content1 - 첫 번째 콘텐츠
 * @param content2 - 두 번째 콘텐츠
 * @returns 동일 여부
 */
export function isContentEqual(content1: string, content2: string): boolean {
  return hashContent(content1) === hashContent(content2);
}

