/**
 * Confluence 전용 도구
 *
 * confluence_word_count: MCP로 페이지를 fetch한 뒤 프로그래밍적으로 단어 수만 계산하여
 * JSON 결과만 LLM에 반환. 본문 전체가 컨텍스트에 들어가는 것을 방지하여 토큰 절약.
 *
 * TRD 참조: docs/plans/confluence-word-count-v2.md
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import {
  countWords,
  extractPageIdFromUrl,
  type LanguageFilter,
  type WordCountBreakdown,
} from '@/utils/wordCounter';
import {
  extractContentByType,
  filterSections,
  type ContentType,
  type SectionMode,
} from '@/utils/htmlContentExtractor';

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
    sections?: string[];
    sectionMode?: SectionMode;
    contentType: ContentType;
    excludeTechnical: boolean;
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
  sections: z
    .array(z.string())
    .optional()
    .describe(
      '필터링할 섹션 제목(heading 텍스트) 배열. sectionMode와 함께 사용. 대소문자 무시. 예: ["API Reference", "설치 방법"]'
    ),
  sectionMode: z
    .enum(['include', 'exclude'])
    .optional()
    .default('include')
    .describe(
      '"include"=지정한 섹션들만 카운팅, "exclude"=지정한 섹션들을 제외하고 카운팅. sections가 없으면 무시됨'
    ),
  contentType: z
    .enum(['all', 'tables', 'lists', 'paragraphs', 'headings'])
    .optional()
    .default('all')
    .describe(
      '콘텐츠 유형 필터. "tables"=표 안 텍스트만, "lists"=리스트만, "paragraphs"=본문만, "headings"=제목만'
    ),
  excludeTechnical: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      '비단어 토큰 제외 (MS Word 스타일). true(기본)=순수 숫자(2025, 4096)와 순수 기호(/, ->, &)만 제외. 기술 용어(3ds, UV, .fbx 등)는 단어로 카운트.'
    ),
});

type ConfluenceWordCountArgs = z.infer<typeof confluenceWordCountSchema>;

/**
 * MCP를 통해 Confluence 페이지 HTML 가져오기
 */
async function fetchConfluencePage(pageId: string): Promise<string> {
  const result = await invoke<McpToolResult>('mcp_call_tool', {
    name: 'getConfluencePage',
    arguments: { pageId },
  });

  if (result.isError) {
    throw new Error(result.content.map((c) => c.text || '').join('\n'));
  }

  return result.content
    .map((c) => (c.type === 'text' ? c.text || '' : ''))
    .join('\n');
}

/**
 * 단일 페이지 처리
 */
async function processPage(
  pageIdOrUrl: string,
  args: ConfluenceWordCountArgs
): Promise<PageResult> {
  const { language = 'all', sections, sectionMode = 'include', contentType = 'all', excludeTechnical = true } = args;

  try {
    // 1. 페이지 ID 추출
    const pageId = extractPageIdFromUrl(pageIdOrUrl);

    // 2. MCP로 페이지 HTML 가져오기
    let html: string;
    try {
      html = await fetchConfluencePage(pageId);
    } catch (e) {
      return {
        pageId,
        totalWords: 0,
        breakdown: { english: 0, korean: 0, chinese: 0, japanese: 0 },
        error: `페이지를 가져올 수 없습니다: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // 3. 섹션 필터링
    let filteredHtml = html;
    let sectionError: string | undefined;
    let availableSections: string[] | undefined;

    if (sections && sections.length > 0) {
      const filterResult = filterSections(html, sections, sectionMode);
      filteredHtml = filterResult.html;
      sectionError = filterResult.error;
      availableSections = filterResult.availableSections;
    }

    // 4. 콘텐츠 타입 필터링
    const contentText = extractContentByType(filteredHtml, contentType);

    // 콘텐츠 타입 결과가 없는 경우
    if (!contentText && contentType !== 'all' && filteredHtml.length > 0) {
      return {
        pageId,
        totalWords: 0,
        breakdown: { english: 0, korean: 0, chinese: 0, japanese: 0 },
        note: `지정한 콘텐츠 타입(${contentType})의 내용이 없습니다`,
        ...(availableSections ? { availableSections } : {}),
      };
    }

    // 5. 단어 카운팅 (기술적 식별자 필터 적용)
    const countResult = countWords(contentText, { language, excludeTechnical });

    const result: PageResult = {
      pageId,
      totalWords: countResult.totalWords,
      breakdown: countResult.breakdown,
    };

    if (sectionError) {
      result.error = sectionError;
      if (availableSections) {
        result.availableSections = availableSections;
      }
    }

    return result;
  } catch (e) {
    // 페이지 ID 추출 실패 등
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
    // 에러 없는 페이지만 합산
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
 * confluence_word_count 도구
 */
export const confluenceWordCountTool = tool(
  async (args: ConfluenceWordCountArgs): Promise<string> => {
    const { pageIds, language = 'all', sections, sectionMode = 'include', contentType = 'all', excludeTechnical = true } = args;

    // 각 페이지 처리
    const pageResults = await Promise.all(
      pageIds.map((pageIdOrUrl) => processPage(pageIdOrUrl, args))
    );

    // 응답 구성
    const response: ConfluenceWordCountResponse = {
      pages: pageResults,
      filters: {
        language,
        ...(sections && sections.length > 0 ? { sections, sectionMode } : {}),
        contentType,
        excludeTechnical,
      },
    };

    // 복수 페이지인 경우 합산
    if (pageResults.length > 1) {
      response.aggregate = aggregateResults(pageResults);
    }

    return JSON.stringify(response);
  },
  {
    name: 'confluence_word_count',
    description:
      'Confluence 페이지의 단어 수를 카운팅합니다. 번역 분량 산정에 사용. ' +
      '페이지 본문 전체가 아닌 단어 수만 반환하므로 토큰을 절약합니다. ' +
      '섹션별(sections), 언어별(language), 콘텐츠 유형별(contentType) 필터링을 지원합니다. ' +
      '페이지 내용 참고/인용이 필요하면 getConfluencePage를 사용하세요.',
    schema: confluenceWordCountSchema,
  }
);
