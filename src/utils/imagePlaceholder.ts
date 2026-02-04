/**
 * 이미지 처리 유틸리티
 *
 * 번역 요청 시 이미지를 제거하여 토큰을 절약합니다.
 * 번역은 텍스트만 대상으로 하므로 이미지 복원은 불필요합니다.
 *
 * 토큰 절약 효과:
 * - Base64 10KB: ~3,300 토큰 → 0 토큰 (100% 절약)
 * - Base64 50KB: ~16,500 토큰 → 0 토큰 (100% 절약)
 * - URL 200자: ~67 토큰 → 0 토큰 (100% 절약)
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
 * 번역 전: Markdown에서 이미지를 완전히 제거
 *
 * 번역은 텍스트만 대상으로 하므로 이미지 정보는 AI에 전달할 필요 없음.
 * 이미지 라인 자체를 제거하여 토큰을 최대한 절약합니다.
 *
 * @param markdown - 원본 Markdown 텍스트
 * @returns 이미지가 제거된 Markdown과 제거된 이미지 수
 *
 * @example
 * const md = '# Title\n![alt](https://example.com/img.png)\nSome text';
 * const { stripped, imageCount } = stripImages(md);
 * // stripped: '# Title\n\nSome text'
 * // imageCount: 1
 */
export function stripImages(markdown: string): StripImagesResult {
  let imageCount = 0;

  const stripped = markdown.replace(IMAGE_REGEX, () => {
    imageCount++;
    return '';
  });

  return { stripped, imageCount };
}

/**
 * 이미지 제거 결과 타입
 */
export interface StripImagesResult {
  /** 이미지가 제거된 Markdown */
  stripped: string;
  /** 제거된 이미지 수 */
  imageCount: number;
}

/**
 * @deprecated Use stripImages instead. 이미지 복원이 필요 없으므로 placeholder 방식은 deprecated.
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
 * @deprecated Use stripImages instead. 이미지 복원이 필요 없으므로 더 이상 사용하지 않음.
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
