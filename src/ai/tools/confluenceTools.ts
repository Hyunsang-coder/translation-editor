/**
 * Confluence 전용 도구
 *
 * confluence_word_count: MCP tool을 Tauri command로 직접 호출하여 페이지를 fetch한 뒤
 * TypeScript에서 단어 수만 계산하여 JSON 결과만 LLM에 반환.
 *
 * 핵심: MCP tool 결과가 LangChain을 거치지 않으므로 LLM 컨텍스트에 노출되지 않음.
 * (LangChain tool로 호출하면 결과가 AI에게 전달됨)
 *
 * TRD 참조: docs/plans/confluence-word-count-v2.md
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import {
  countWords,
  extractPageIdFromUrl,
  formatWordCountResult,
  type ContentTypeFilter,
  type LanguageFilter,
  type WordCountBreakdown,
} from '@/utils/wordCounter';
import type { AdfDocument } from '@/utils/adfParser';
import {
  extractText,
  extractSection,
  extractUntilSection,
  filterByContentType,
  wrapAsDocument,
  isValidAdfDocument,
  listAvailableSections,
} from '@/utils/adfParser';

/**
 * 페이지별 결과 타입
 */
interface PageResult {
  pageId: string;
  totalWords: number;
  breakdown: WordCountBreakdown;
  error?: string;
  availableSections?: string[];
  note?: string;
}

/**
 * 전체 응답 타입
 */
interface ConfluenceWordCountResponse {
  pages: PageResult[];
  aggregate?: {
    totalWords: number;
    breakdown: WordCountBreakdown;
  };
  filters: {
    language: LanguageFilter;
    excludeTechnical: boolean;
    sectionHeading?: string;
    contentType?: ContentTypeFilter;
  };
}

/**
 * MCP 도구 호출 결과 타입
 */
interface McpContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
}

interface McpToolResult {
  content: McpContent[];
  isError: boolean;
}

/**
 * Zod 스키마
 */
const confluenceWordCountSchema = z.object({
  pageIds: z
    .array(z.string())
    .min(1)
    .max(10)
    .describe(
      'Confluence 페이지 ID 또는 URL 배열. 예: ["123456"] 또는 ["https://xxx.atlassian.net/wiki/spaces/SPACE/pages/123456/Title"]'
    ),
  language: z
    .enum(['all', 'english', 'korean', 'chinese', 'japanese', 'cjk'])
    .optional()
    .default('all')
    .describe(
      '카운팅할 언어 필터. "all"=전체, "english"=영어만, "korean"=한국어만, "cjk"=한중일 합산'
    ),
  excludeTechnical: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      '비단어 토큰 제외 (MS Word 스타일). true(기본)=순수 숫자(2025, 4096)와 순수 기호(/, ->, &)만 제외. 기술 용어(3ds, UV, .fbx 등)는 단어로 카운트.'
    ),
  sectionHeading: z
    .string()
    .optional()
    .describe(
      '특정 섹션만 카운팅 (Markdown heading 텍스트). 예: "Overview", "Requirements". 생략 시 전체 페이지.'
    ),
  untilSection: z
    .string()
    .optional()
    .describe(
      '처음부터 해당 섹션 직전까지 카운팅. 예: "Details"면 Details 섹션 이전까지. sectionHeading과 동시 사용 불가.'
    ),
  contentType: z
    .enum(['all', 'table', 'text'])
    .optional()
    .default('all')
    .describe(
      '카운팅할 콘텐츠 타입. "all"=전체 (기본), "table"=표 안의 내용만, "text"=표 제외한 텍스트만'
    ),
  outputFormat: z
    .enum(['json', 'summary'])
    .optional()
    .default('json')
    .describe(
      '출력 형식. "json"=상세 JSON (기본), "summary"=간결한 텍스트'
    ),
});

type ConfluenceWordCountArgs = z.infer<typeof confluenceWordCountSchema>;

// 캐시된 cloudId (세션 동안 유지)
let cachedCloudId: string | null = null;

/**
 * 페이지 콘텐츠 형식
 */
type PageContentFormat = 'markdown' | 'adf';

/**
 * 페이지 콘텐츠 (Markdown 또는 ADF)
 */
type PageContent =
  | { format: 'markdown'; content: string }
  | { format: 'adf'; content: AdfDocument };

/**
 * 페이지 콘텐츠 캐시 (TTL: 5분)
 * - 같은 세션 내 동일 페이지 반복 요청 시 API 호출 절약
 * - 5분 후 자동 만료 (페이지 내용 변경 반영)
 * - ADF 우선, Markdown 폴백 형식 지원
 */
interface CachedPage {
  content: string | AdfDocument;
  format: PageContentFormat;
  cachedAt: number;
}
const PAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const pageCache = new Map<string, CachedPage>();

/**
 * 페이지 캐시에서 조회 (TTL 확인)
 */
function getFromCache(pageId: string): PageContent | null {
  const cached = pageCache.get(pageId);
  if (!cached) return null;

  const isExpired = Date.now() - cached.cachedAt > PAGE_CACHE_TTL_MS;
  if (isExpired) {
    pageCache.delete(pageId);
    return null;
  }

  console.log(`[confluence_word_count] Cache HIT for page ${pageId} (format: ${cached.format})`);

  if (cached.format === 'adf') {
    return { format: 'adf', content: cached.content as AdfDocument };
  }
  return { format: 'markdown', content: cached.content as string };
}

/**
 * 페이지 캐시에 저장
 */
function saveToCache(pageId: string, content: string | AdfDocument, format: PageContentFormat): void {
  pageCache.set(pageId, { content, format, cachedAt: Date.now() });
  console.log(`[confluence_word_count] Cached page ${pageId} (format: ${format}, cache size: ${pageCache.size})`);
}

/**
 * 캐시 초기화 (테스트 또는 수동 리셋용)
 */
export function clearPageCache(): void {
  pageCache.clear();
  console.log('[confluence_word_count] Page cache cleared');
}

/**
 * Atlassian cloudId 가져오기 (MCP tool로 조회)
 */
async function getCloudId(): Promise<string> {
  if (cachedCloudId) return cachedCloudId;

  const result = await invoke<McpToolResult>('mcp_call_tool', {
    name: 'getAccessibleAtlassianResources',
    arguments: {},
  });

  if (result.isError) {
    throw new Error('Atlassian 리소스 조회 실패: ' + result.content.map((c) => c.text || '').join('\n'));
  }

  const text = result.content.map((c) => c.text || '').join('');
  try {
    const resources = JSON.parse(text);
    if (Array.isArray(resources) && resources.length > 0 && resources[0].id) {
      cachedCloudId = resources[0].id as string;
      return cachedCloudId;
    }
  } catch {
    const match = text.match(/"id"\s*:\s*"([^"]+)"/);
    if (match?.[1]) {
      cachedCloudId = match[1];
      return cachedCloudId;
    }
  }

  throw new Error('Atlassian cloudId를 찾을 수 없습니다');
}

/**
 * MCP tool로 Confluence 페이지 콘텐츠 가져오기 (Tauri command 직접 호출)
 * LangChain을 거치지 않으므로 LLM 컨텍스트에 노출되지 않음
 *
 * 캐싱: 5분 TTL로 같은 페이지 반복 요청 시 API 호출 절약
 *
 * ADF 우선 요청:
 * 1. ADF 형식으로 먼저 요청 (더 정확한 구조 정보)
 * 2. ADF 파싱 실패 시 Markdown으로 폴백
 */
async function fetchConfluencePageViaMcp(pageId: string): Promise<PageContent> {
  // 1. 캐시 확인
  const cached = getFromCache(pageId);
  if (cached !== null) {
    return cached;
  }

  // 2. API 호출
  const cloudId = await getCloudId();

  // 2a. ADF 형식 먼저 시도
  try {
    console.log('[confluence_word_count] Trying ADF format first...');
    const adfResult = await invoke<McpToolResult>('mcp_call_tool', {
      name: 'getConfluencePage',
      arguments: { cloudId, pageId, contentFormat: 'adf' },
    });

    if (!adfResult.isError) {
      const rawText = adfResult.content
        .map((c) => (c.type === 'text' ? c.text || '' : ''))
        .join('\n');

      // ADF 응답 파싱 시도
      try {
        const parsed = JSON.parse(rawText);
        // MCP 응답이 { body: AdfDocument } 형식인 경우
        const adfDoc = parsed.body ?? parsed;

        if (isValidAdfDocument(adfDoc)) {
          console.log('[confluence_word_count] ADF format success');
          saveToCache(pageId, adfDoc, 'adf');
          return { format: 'adf', content: adfDoc };
        }
      } catch {
        console.warn('[confluence_word_count] Failed to parse ADF response as JSON');
      }
    }
  } catch (e) {
    console.warn('[confluence_word_count] ADF request failed:', e instanceof Error ? e.message : String(e));
  }

  // 2b. Markdown 폴백
  console.log('[confluence_word_count] Falling back to Markdown format...');
  const result = await invoke<McpToolResult>('mcp_call_tool', {
    name: 'getConfluencePage',
    arguments: { cloudId, pageId, contentFormat: 'markdown' },
  });

  if (result.isError) {
    throw new Error(result.content.map((c) => c.text || '').join('\n'));
  }

  const rawText = result.content
    .map((c) => (c.type === 'text' ? c.text || '' : ''))
    .join('\n');

  // MCP 응답이 JSON인 경우 body 필드 추출
  let markdown = rawText;
  try {
    const parsed = JSON.parse(rawText);
    if (parsed.body && typeof parsed.body === 'string') {
      markdown = parsed.body;
      console.log('[confluence_word_count] Extracted body from JSON response');
    }
  } catch {
    // JSON이 아니면 그대로 사용 (순수 markdown)
  }

  // 3. 캐시에 저장
  saveToCache(pageId, markdown, 'markdown');

  return { format: 'markdown', content: markdown };
}

/**
 * ADF 문서에서 텍스트 추출 (섹션/콘텐츠 타입 필터 적용)
 */
function extractTextFromAdfWithFilters(
  adfDoc: AdfDocument,
  options: {
    sectionHeading?: string;
    untilSection?: string;
    contentType?: ContentTypeFilter;
  }
): { text: string; sectionFound: boolean } {
  const { sectionHeading, untilSection, contentType = 'all' } = options;

  let targetDoc: AdfDocument = adfDoc;
  let sectionFound = true;

  // 1. 섹션 필터 적용
  if (untilSection) {
    const result = extractUntilSection(adfDoc, untilSection);
    if (!result.found) {
      sectionFound = false;
    } else {
      targetDoc = wrapAsDocument(result.content);
    }
  } else if (sectionHeading) {
    const result = extractSection(adfDoc, sectionHeading);
    if (!result.found) {
      sectionFound = false;
    } else {
      targetDoc = wrapAsDocument(result.content);
    }
  }

  if (!sectionFound) {
    return { text: '', sectionFound: false };
  }

  // 2. 콘텐츠 타입 필터 적용
  if (contentType === 'table') {
    targetDoc = filterByContentType(targetDoc, 'table');
  } else if (contentType === 'text') {
    // 표 제외 - 'text' 필터 사용
    targetDoc = filterByContentType(targetDoc, 'text');
  }

  // 3. 텍스트 추출 (코드 블록 제외)
  const text = extractText(targetDoc, { excludeTypes: ['codeBlock'] });

  return { text, sectionFound: true };
}

/**
 * 단일 페이지 처리
 */
async function processPage(
  pageIdOrUrl: string,
  args: ConfluenceWordCountArgs
): Promise<PageResult> {
  const { language = 'all', excludeTechnical = true } = args;

  try {
    // 1. 페이지 ID 추출
    const pageId = extractPageIdFromUrl(pageIdOrUrl);

    // 2. MCP tool로 페이지 콘텐츠 가져오기 (ADF 우선, Markdown 폴백)
    let pageContent: PageContent;
    try {
      pageContent = await fetchConfluencePageViaMcp(pageId);
    } catch (e) {
      return {
        pageId,
        totalWords: 0,
        breakdown: { english: 0, korean: 0, chinese: 0, japanese: 0 },
        error: `페이지를 가져올 수 없습니다: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // 3. 단어 카운팅 (ADF 또는 Markdown)
    let countResult;
    let sectionNotFound = false;

    if (pageContent.format === 'adf') {
      // ADF 형식: 구조적 필터링 후 텍스트 추출
      console.log('[confluence_word_count] Processing ADF document');

      // 디버깅: ADF 구조 및 사용 가능한 섹션 출력
      const availableSections = listAvailableSections(pageContent.content, { includeLevel: true });
      console.log('[confluence_word_count] Available sections:', JSON.stringify(availableSections, null, 2));
      console.log('[confluence_word_count] Top-level node types:', pageContent.content.content.map(n => n.type).slice(0, 20));

      const filterOptions: {
        sectionHeading?: string;
        untilSection?: string;
        contentType?: ContentTypeFilter;
      } = {};
      if (args.sectionHeading) filterOptions.sectionHeading = args.sectionHeading;
      if (args.untilSection) filterOptions.untilSection = args.untilSection;
      if (args.contentType) filterOptions.contentType = args.contentType;

      const { text, sectionFound } = extractTextFromAdfWithFilters(pageContent.content, filterOptions);

      if (!sectionFound) {
        sectionNotFound = true;
        countResult = {
          totalWords: 0,
          breakdown: { english: 0, korean: 0, chinese: 0, japanese: 0 },
          sectionTitle: args.sectionHeading || args.untilSection,
        };
      } else {
        console.log('[confluence_word_count] Extracted text length:', text.length);
        console.log('[confluence_word_count] Extracted text preview (first 1000 chars):', text.slice(0, 1000));

        // ADF에서 추출한 텍스트에 countWords 적용 (섹션/콘텐츠 타입 필터는 이미 적용됨)
        countResult = countWords(text, {
          language,
          excludeTechnical,
          // 섹션/콘텐츠 타입 필터는 ADF 레벨에서 이미 적용됨
        });
      }
    } else {
      // Markdown 형식: 기존 로직 사용
      const markdown = pageContent.content;
      console.log('[confluence_word_count] Processing Markdown document');
      console.log('[confluence_word_count] Markdown length:', markdown.length);
      console.log('[confluence_word_count] Markdown preview (first 1000 chars):', markdown.slice(0, 1000));

      countResult = countWords(markdown, {
        language,
        excludeTechnical,
        ...(args.sectionHeading ? { sectionHeading: args.sectionHeading } : {}),
        ...(args.untilSection ? { untilSection: args.untilSection } : {}),
        ...(args.contentType && args.contentType !== 'all' ? { contentType: args.contentType } : {}),
      });

      if (countResult.totalWords === 0 && countResult.sectionTitle) {
        sectionNotFound = true;
      }
    }

    console.log('[confluence_word_count] Count result:', countResult);

    // 섹션 필터 적용 시 섹션을 찾지 못한 경우 note 추가
    const result: PageResult = {
      pageId,
      totalWords: countResult.totalWords,
      breakdown: countResult.breakdown,
    };

    if (sectionNotFound) {
      if (args.untilSection) {
        result.note = `섹션 "${args.untilSection}"을(를) 찾지 못했습니다. 페이지의 헤딩 이름을 확인해주세요.`;
      } else if (args.sectionHeading) {
        result.note = `섹션 "${args.sectionHeading}"을(를) 찾지 못했습니다. 전체 페이지를 카운팅하려면 sectionHeading을 생략하세요.`;
      }
    }

    return result;
  } catch (e) {
    return {
      pageId: pageIdOrUrl,
      totalWords: 0,
      breakdown: { english: 0, korean: 0, chinese: 0, japanese: 0 },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 여러 페이지 결과 합산
 */
function aggregateResults(pages: PageResult[]): { totalWords: number; breakdown: WordCountBreakdown } {
  const breakdown: WordCountBreakdown = {
    english: 0,
    korean: 0,
    chinese: 0,
    japanese: 0,
  };

  for (const page of pages) {
    if (!page.error || page.totalWords > 0) {
      breakdown.english += page.breakdown.english;
      breakdown.korean += page.breakdown.korean;
      breakdown.chinese += page.breakdown.chinese;
      breakdown.japanese += page.breakdown.japanese;
    }
  }

  const totalWords = breakdown.english + breakdown.korean + breakdown.chinese + breakdown.japanese;

  return { totalWords, breakdown };
}

/**
 * summary 형식 출력 생성
 */
function formatSummaryOutput(
  response: ConfluenceWordCountResponse
): string {
  const lines: string[] = [];
  const { language } = response.filters;

  // 단일 페이지
  if (response.pages.length === 1) {
    const page = response.pages[0]!;
    if (page.error) {
      return `❌ 오류: ${page.error}`;
    }
    const result = {
      totalWords: page.totalWords,
      breakdown: page.breakdown,
    };
    lines.push(formatWordCountResult(result, language));
    if (page.note) {
      lines.push(`\n⚠️ ${page.note}`);
    }
    return lines.join('');
  }

  // 복수 페이지
  for (const page of response.pages) {
    if (page.error) {
      lines.push(`❌ ${page.pageId}: ${page.error}`);
    } else {
      lines.push(`📄 ${page.pageId}: ${page.totalWords.toLocaleString()} 단어`);
    }
  }

  if (response.aggregate) {
    lines.push('');
    lines.push(`📊 총합: ${response.aggregate.totalWords.toLocaleString()} 단어`);
  }

  return lines.join('\n');
}

/**
 * confluence_word_count 도구
 */
export const confluenceWordCountTool = tool(
  async (args: ConfluenceWordCountArgs): Promise<string> => {
    const {
      pageIds,
      language = 'all',
      excludeTechnical = true,
      sectionHeading,
      contentType = 'all',
      outputFormat = 'json',
    } = args;

    // 각 페이지 처리
    const pageResults = await Promise.all(
      pageIds.map((pageIdOrUrl) => processPage(pageIdOrUrl, args))
    );

    // 응답 구성
    const response: ConfluenceWordCountResponse = {
      pages: pageResults,
      filters: {
        language,
        excludeTechnical,
        ...(sectionHeading ? { sectionHeading } : {}),
        ...(contentType !== 'all' ? { contentType } : {}),
      },
    };

    // 복수 페이지인 경우 합산
    if (pageResults.length > 1) {
      response.aggregate = aggregateResults(pageResults);
    }

    // 출력 형식에 따라 반환
    if (outputFormat === 'summary') {
      return formatSummaryOutput(response);
    }
    return JSON.stringify(response);
  },
  {
    name: 'confluence_word_count',
    description:
      'Confluence 페이지의 단어 수를 카운팅합니다. 번역 분량 산정에 사용. ' +
      '페이지 본문 전체가 아닌 단어 수만 반환하므로 토큰을 절약합니다. ' +
      '주요 파라미터: pageIds(필수), language, sectionHeading, untilSection, contentType, outputFormat. ' +
      '예: "Details 전까지" → untilSection="Details". "Overview 섹션만" → sectionHeading="Overview". ' +
      '"표만" → contentType="table". "간단히" → outputFormat="summary". ' +
      '페이지 내용 참고/인용이 필요하면 getConfluencePage를 사용하세요.',
    schema: confluenceWordCountSchema,
  }
);
