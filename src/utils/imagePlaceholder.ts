/**
 * 이미지 플레이스홀더 유틸리티
 *
 * 번역 요청 시 이미지 URL(특히 Base64)을 플레이스홀더로 대체하여 토큰을 절약하고,
 * 번역 완료 후 원본 URL을 복원합니다.
 *
 * 토큰 절약 효과:
 * - Base64 10KB: ~3,300 토큰 → 1-2 토큰 (99.9% 절약)
 * - Base64 50KB: ~16,500 토큰 → 1-2 토큰 (99.99% 절약)
 * - URL 200자: ~67 토큰 → 1-2 토큰 (97% 절약)
 */

/**
 * 이미지 추출 결과 타입
 */
export interface ImageExtractionResult {
  /** 플레이스홀더로 대체된 Markdown */
  sanitized: string;
  /** 플레이스홀더 → 원본 URL 매핑 */
  imageMap: Map<string, string>;
}

/**
 * Markdown 이미지 문법 패턴
 * - ![alt text](url) 또는 ![](url) 형식 매칭
 * - URL에 괄호가 포함된 경우도 처리 (백슬래시 이스케이프)
 */
const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Base64 데이터 URL 패턴
 */
const BASE64_PATTERN = /^data:image\//;

/**
 * 번역 전: Markdown에서 이미지 URL을 플레이스홀더로 대체
 *
 * Base64 이미지는 수만 자가 될 수 있으므로 반드시 대체 필요.
 * URL 이미지도 토큰 절약을 위해 대체합니다.
 *
 * @param markdown - 원본 Markdown 텍스트
 * @returns 플레이스홀더가 적용된 Markdown과 복원용 맵
 *
 * @example
 * const md = '# Title\n![alt](data:image/png;base64,...)';
 * const { sanitized, imageMap } = extractImages(md);
 * // sanitized: '# Title\n![alt](IMAGE_PLACEHOLDER_0)'
 * // imageMap: Map { 'IMAGE_PLACEHOLDER_0' => 'data:image/png;base64,...' }
 */
export function extractImages(markdown: string): ImageExtractionResult {
  const imageMap = new Map<string, string>();
  let index = 0;

  const sanitized = markdown.replace(IMAGE_REGEX, (_match, alt: string, url: string) => {
    const placeholder = `IMAGE_PLACEHOLDER_${index}`;
    imageMap.set(placeholder, url);
    index++;

    // alt text는 유지하고 URL만 플레이스홀더로 대체
    return `![${alt}](${placeholder})`;
  });

  return { sanitized, imageMap };
}

/**
 * 번역 후: 플레이스홀더를 원본 URL로 복원
 *
 * @param markdown - 플레이스홀더가 포함된 Markdown 텍스트
 * @param imageMap - extractImages에서 반환된 플레이스홀더 → URL 맵
 * @returns 원본 URL이 복원된 Markdown
 *
 * @example
 * const translated = '# 제목\n![대체 텍스트](IMAGE_PLACEHOLDER_0)';
 * const restored = restoreImages(translated, imageMap);
 * // restored: '# 제목\n![대체 텍스트](data:image/png;base64,...)'
 */
export function restoreImages(
  markdown: string,
  imageMap: Map<string, string>
): string {
  let result = markdown;

  for (const [placeholder, originalUrl] of imageMap) {
    // 플레이스홀더가 괄호 안에 있을 수 있으므로 정확한 매칭 필요
    const placeholderRegex = new RegExp(
      `\\]\\(${escapeRegExp(placeholder)}\\)`,
      'g'
    );
    result = result.replace(placeholderRegex, `](${originalUrl})`);
  }

  return result;
}

/**
 * 이미지 정보 추출 (디버깅/로깅용)
 *
 * @param markdown - Markdown 텍스트
 * @returns 이미지 정보 배열
 */
export function getImageInfo(
  markdown: string
): Array<{ alt: string; url: string; isBase64: boolean; size: number }> {
  const images: Array<{
    alt: string;
    url: string;
    isBase64: boolean;
    size: number;
  }> = [];

  let match: RegExpExecArray | null;
  const regex = new RegExp(IMAGE_REGEX.source, 'g');

  while ((match = regex.exec(markdown)) !== null) {
    const alt = match[1] ?? '';
    const url = match[2] ?? '';
    images.push({
      alt,
      url,
      isBase64: BASE64_PATTERN.test(url),
      size: url.length,
    });
  }

  return images;
}

/**
 * 토큰 절약량 추정
 *
 * @param imageMap - extractImages에서 반환된 맵
 * @returns 추정 절약 토큰 수
 */
export function estimateTokenSavings(imageMap: Map<string, string>): number {
  let totalOriginalChars = 0;
  let totalPlaceholderChars = 0;

  for (const [placeholder, originalUrl] of imageMap) {
    totalOriginalChars += originalUrl.length;
    totalPlaceholderChars += placeholder.length;
  }

  // 평균 3자당 1토큰으로 추정
  const originalTokens = Math.ceil(totalOriginalChars / 3);
  const placeholderTokens = Math.ceil(totalPlaceholderChars / 3);

  return Math.max(0, originalTokens - placeholderTokens);
}

/**
 * 정규식 특수문자 이스케이프
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
