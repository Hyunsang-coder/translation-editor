/**
 * Confluence 단어 카운팅 유틸리티
 *
 * 번역 분량 산정을 위해 텍스트의 단어 수를 카운팅합니다.
 * - 번역 불필요 콘텐츠 제외 (코드 블록, URL, 이미지)
 * - 표, 접힌 섹션 등 번역 필요 콘텐츠는 포함
 * - 모든 언어를 공백 구분 단어 수로 카운팅
 *
 * TRD 참조: docs/trd/09-specialized.md 9.3절, docs/trd/13-algorithms.md 13.10절
 */

import { stripHtml } from './hash';

/**
 * 번역 불필요 콘텐츠 전처리 (TRD 13.10 preprocessContent)
 * 코드 블록, URL, 이미지 등 제거. 표/접힌 섹션 텍스트는 유지.
 *
 * @param content 원본 콘텐츠
 * @returns 전처리된 텍스트
 */
export function preprocessContent(content: string): string {
  return content
    // 이미지/미디어 제거 (번역 불필요)
    .replace(/<img[^>]*>/gi, '')
    .replace(/<video[\s\S]*?<\/video>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<ac:image[\s\S]*?\/>/gi, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')           // Markdown ![alt](url)

    // 코드 블록 제거 (번역 불필요)
    .replace(/<code>[\s\S]*?<\/code>/gi, '')
    .replace(/<pre>[\s\S]*?<\/pre>/gi, '')
    .replace(/```[\s\S]*?```/g, '')            // 펜스 코드 블록
    .replace(/`[^`]+`/g, '')                   // 인라인 코드

    // Confluence code 매크로만 제거 (expand 등 다른 매크로는 유지)
    .replace(/<ac:structured-macro[^>]*ac:name="code"[\s\S]*?<\/ac:structured-macro>/gi, '')

    // URL 제거 (링크 텍스트는 유지)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // [text](url) → text
    .replace(/<a[^>]*>([^<]*)<\/a>/gi, '$1')   // <a>text</a> → text
    .replace(/https?:\/\/[^\s]+/g, '')         // 순수 URL

    // 공백 정규화
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 언어별 카운팅 결과 (모두 단어 수)
 */
export interface WordCountBreakdown {
  /** 영어 단어 수 */
  english: number;
  /** 한국어 단어 수 */
  korean: number;
  /** 중국어 단어 수 */
  chinese: number;
  /** 일본어 단어 수 */
  japanese: number;
}

/**
 * 단어 카운팅 결과
 */
export interface WordCountResult {
  /** 요청된 필터에 따른 총 카운트 */
  totalWords: number;
  /** 언어별 세부 카운트 */
  breakdown: WordCountBreakdown;
  /** 섹션 제목 (섹션 필터 사용 시) */
  sectionTitle?: string;
}

/**
 * 페이지별 카운팅 결과
 */
export interface PageWordCountResult {
  /** 페이지 ID 또는 URL */
  pageId: string;
  /** 카운팅 결과 */
  result: WordCountResult;
  /** 에러 메시지 (실패 시) */
  error?: string;
}

/**
 * 언어 필터 타입
 */
export type LanguageFilter = 'all' | 'english' | 'korean' | 'chinese' | 'japanese' | 'cjk';

/**
 * 언어 판별용 정규식 패턴 (단어 내 문자 검사)
 * TRD 13.10 참조
 */
const LANG_CHAR_PATTERNS = {
  // 한글: 완성형 한글 + 자모 + 호환용 자모
  korean: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/,
  // 중국어: CJK 통합 한자 + 확장A + 호환용 한자
  chinese: /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/,
  // 일본어: 히라가나 + 가타카나 + 가타카나 확장
  japanese: /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/,
  // 영어/라틴 알파벳
  english: /[a-zA-Z]/,
} as const;

/**
 * 특정 섹션 추출
 * TRD 13.10 extractSection 함수 참조
 *
 * @param content 전체 콘텐츠
 * @param headingText 찾을 Heading 텍스트
 * @returns 해당 섹션의 콘텐츠 또는 null (못 찾은 경우)
 */
export function extractSection(content: string, headingText: string): string | null {
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let targetLevel: number | null = null;
  let startIndex: number | null = null;
  let endIndex: number | null = null;

  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1]?.length ?? 0;
    const text = (match[2] ?? '').trim();

    if (startIndex === null) {
      // 타겟 Heading 찾기 (대소문자 무시)
      if (text.toLowerCase() === headingText.toLowerCase()) {
        targetLevel = level;
        startIndex = match.index + match[0].length;
      }
    } else {
      // 다음 동급/상위 Heading에서 종료
      if (level <= targetLevel!) {
        endIndex = match.index;
        break;
      }
    }
  }

  if (startIndex === null) return null;
  return content.slice(startIndex, endIndex ?? undefined).trim();
}

/**
 * 전체 단어 수 카운팅
 * preprocessContent → stripHtml → 공백 split → 카운트
 *
 * @param text 텍스트 (HTML 또는 plain text)
 * @returns 총 단어 수
 */
export function countTotalWords(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  const cleaned = preprocessContent(text);
  const plainText = stripHtml(cleaned);
  return plainText.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * 언어별 단어 카운팅 수행 (TRD 13.10 countByLanguage)
 * 모든 언어를 공백 구분 단어 수로 카운팅
 *
 * @param text 텍스트 (HTML 또는 plain text)
 * @returns 언어별 단어 수
 */
export function countByLanguage(text: string): WordCountBreakdown {
  if (!text || text.trim().length === 0) {
    return { english: 0, korean: 0, chinese: 0, japanese: 0 };
  }

  const cleaned = preprocessContent(text);
  const plainText = stripHtml(cleaned);
  const words = plainText.trim().split(/\s+/).filter(Boolean);

  const breakdown: WordCountBreakdown = {
    english: 0,
    korean: 0,
    chinese: 0,
    japanese: 0,
  };

  for (const word of words) {
    // 단어에 포함된 문자로 언어 판별
    if (LANG_CHAR_PATTERNS.korean.test(word)) {
      breakdown.korean++;
    } else if (LANG_CHAR_PATTERNS.chinese.test(word)) {
      breakdown.chinese++;
    } else if (LANG_CHAR_PATTERNS.japanese.test(word)) {
      breakdown.japanese++;
    } else if (LANG_CHAR_PATTERNS.english.test(word)) {
      breakdown.english++;
    }
    // 숫자만 있는 단어는 어떤 언어에도 포함되지 않음 (but totalWords에는 포함)
  }

  return breakdown;
}

/**
 * 필터에 따른 총 카운트 계산
 *
 * @param breakdown 언어별 카운트
 * @param filter 언어 필터
 * @returns 필터에 맞는 총 카운트
 */
export function calculateTotal(breakdown: WordCountBreakdown, filter: LanguageFilter): number {
  switch (filter) {
    case 'english':
      return breakdown.english;
    case 'korean':
      return breakdown.korean;
    case 'chinese':
      return breakdown.chinese;
    case 'japanese':
      return breakdown.japanese;
    case 'cjk':
      return breakdown.korean + breakdown.chinese + breakdown.japanese;
    case 'all':
    default:
      return breakdown.english + breakdown.korean + breakdown.chinese + breakdown.japanese;
  }
}

/**
 * URL 또는 ID에서 Confluence 페이지 ID 추출
 * TRD 13.10 extractPageIdFromUrl 함수 참조
 *
 * @param input 페이지 ID 또는 URL
 * @returns 페이지 ID
 * @throws 유효하지 않은 입력 시 에러
 */
export function extractPageIdFromUrl(input: string): string {
  // URL 형식: https://xxx.atlassian.net/wiki/spaces/SPACE/pages/123456/Title
  const urlMatch = input.match(/\/pages\/(\d+)/);
  if (urlMatch && urlMatch[1]) return urlMatch[1];

  // 이미 숫자 ID인 경우
  if (/^\d+$/.test(input.trim())) return input.trim();

  throw new Error(`유효하지 않은 Confluence 페이지 ID 또는 URL: ${input}`);
}

/**
 * 단일 콘텐츠 카운팅
 *
 * @param content 콘텐츠 텍스트
 * @param options 옵션 (언어 필터, 섹션 필터)
 * @returns 카운팅 결과
 */
export function countWords(
  content: string,
  options: {
    language?: LanguageFilter;
    sectionHeading?: string;
  } = {}
): WordCountResult {
  const { language = 'all', sectionHeading } = options;

  // 섹션 필터 적용
  let targetContent = content;
  if (sectionHeading) {
    const section = extractSection(content, sectionHeading);
    if (section === null) {
      return {
        totalWords: 0,
        breakdown: { english: 0, korean: 0, chinese: 0, japanese: 0 },
        sectionTitle: sectionHeading,
      };
    }
    targetContent = section;
  }

  // 언어별 카운팅
  const breakdown = countByLanguage(targetContent);

  // 'all' 필터는 실제 전체 단어 수 (숫자만 있는 단어 포함)
  // 언어별 필터는 해당 언어 단어만
  const totalWords = language === 'all'
    ? countTotalWords(targetContent)
    : calculateTotal(breakdown, language);

  return {
    totalWords,
    breakdown,
    ...(sectionHeading ? { sectionTitle: sectionHeading } : {}),
  };
}

/**
 * 여러 결과 합산
 *
 * @param results 페이지별 결과 배열
 * @param filter 언어 필터
 * @returns 합산된 결과
 */
export function aggregateResults(
  results: PageWordCountResult[],
  filter: LanguageFilter = 'all'
): WordCountResult {
  const totalBreakdown: WordCountBreakdown = {
    english: 0,
    korean: 0,
    chinese: 0,
    japanese: 0,
  };

  for (const { result, error } of results) {
    if (error) continue;
    totalBreakdown.english += result.breakdown.english;
    totalBreakdown.korean += result.breakdown.korean;
    totalBreakdown.chinese += result.breakdown.chinese;
    totalBreakdown.japanese += result.breakdown.japanese;
  }

  return {
    totalWords: calculateTotal(totalBreakdown, filter),
    breakdown: totalBreakdown,
  };
}

/**
 * 카운팅 결과 포맷팅 (사람이 읽기 쉬운 형태)
 *
 * @param result 카운팅 결과
 * @param filter 적용된 필터
 * @returns 포맷팅된 문자열
 */
export function formatWordCountResult(
  result: WordCountResult,
  filter: LanguageFilter = 'all'
): string {
  const { totalWords, breakdown, sectionTitle } = result;

  const lines: string[] = [];

  if (sectionTitle) {
    lines.push(`📑 섹션: "${sectionTitle}"`);
  }

  // 필터별 결과 표시 (모든 단위는 '단어'로 통일)
  switch (filter) {
    case 'english':
      lines.push(`📝 영어: ${totalWords.toLocaleString()} 단어`);
      break;
    case 'korean':
      lines.push(`📝 한국어: ${totalWords.toLocaleString()} 단어`);
      break;
    case 'chinese':
      lines.push(`📝 중국어: ${totalWords.toLocaleString()} 단어`);
      break;
    case 'japanese':
      lines.push(`📝 일본어: ${totalWords.toLocaleString()} 단어`);
      break;
    case 'cjk':
      lines.push(`📝 CJK: ${totalWords.toLocaleString()} 단어`);
      lines.push(`   (한국어: ${breakdown.korean.toLocaleString()}, 중국어: ${breakdown.chinese.toLocaleString()}, 일본어: ${breakdown.japanese.toLocaleString()})`);
      break;
    case 'all':
    default:
      lines.push(`📊 총 단어 수: ${totalWords.toLocaleString()}`);
      lines.push(`   - 영어: ${breakdown.english.toLocaleString()}`);
      lines.push(`   - 한국어: ${breakdown.korean.toLocaleString()}`);
      lines.push(`   - 중국어: ${breakdown.chinese.toLocaleString()}`);
      lines.push(`   - 일본어: ${breakdown.japanese.toLocaleString()}`);
  }

  return lines.join('\n');
}

/**
 * 여러 페이지 결과 포맷팅
 *
 * @param results 페이지별 결과
 * @param filter 적용된 필터
 * @returns 포맷팅된 문자열
 */
export function formatMultiPageResults(
  results: PageWordCountResult[],
  filter: LanguageFilter = 'all'
): string {
  const lines: string[] = [];

  // 개별 페이지 결과
  for (const { pageId, result, error } of results) {
    if (error) {
      lines.push(`❌ 페이지 ${pageId}: ${error}`);
    } else {
      lines.push(`📄 페이지 ${pageId}:`);
      lines.push(formatWordCountResult(result, filter).split('\n').map(l => '   ' + l).join('\n'));
    }
    lines.push('');
  }

  // 총합 (2개 이상 페이지)
  const successResults = results.filter(r => !r.error);
  if (successResults.length > 1) {
    const aggregated = aggregateResults(results, filter);
    lines.push('━'.repeat(40));
    lines.push('📊 전체 합계:');
    lines.push(formatWordCountResult(aggregated, filter).split('\n').map(l => '   ' + l).join('\n'));
  }

  return lines.join('\n');
}
