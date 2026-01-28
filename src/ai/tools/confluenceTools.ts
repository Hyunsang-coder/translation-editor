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
  type LanguageFilter,
  type WordCountBreakdown,
} from '@/utils/wordCounter';

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
});

type ConfluenceWordCountArgs = z.infer<typeof confluenceWordCountSchema>;

// 캐시된 cloudId (세션 동안 유지)
let cachedCloudId: string | null = null;

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
 */
async function fetchConfluencePageViaMcp(pageId: string): Promise<string> {
  const cloudId = await getCloudId();

  // MCP tool을 Tauri command로 직접 호출 (LangChain 안 거침)
  const result = await invoke<McpToolResult>('mcp_call_tool', {
    name: 'getConfluencePage',
    arguments: { cloudId, pageId, contentFormat: 'markdown' },
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
  const { language = 'all', excludeTechnical = true } = args;

  try {
    // 1. 페이지 ID 추출
    const pageId = extractPageIdFromUrl(pageIdOrUrl);

    // 2. MCP tool로 페이지 markdown 가져오기 (Tauri command 직접 호출)
    let markdown: string;
    try {
      markdown = await fetchConfluencePageViaMcp(pageId);
    } catch (e) {
      return {
        pageId,
        totalWords: 0,
        breakdown: { english: 0, korean: 0, chinese: 0, japanese: 0 },
        error: `페이지를 가져올 수 없습니다: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // 3. 단어 카운팅 (markdown을 직접 카운팅)
    console.log('[confluence_word_count] Markdown length:', markdown.length);
    console.log('[confluence_word_count] Markdown preview (first 1000 chars):', markdown.slice(0, 1000));

    const countResult = countWords(markdown, { language, excludeTechnical });
    console.log('[confluence_word_count] Count result:', countResult);

    return {
      pageId,
      totalWords: countResult.totalWords,
      breakdown: countResult.breakdown,
    };
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
 * confluence_word_count 도구
 */
export const confluenceWordCountTool = tool(
  async (args: ConfluenceWordCountArgs): Promise<string> => {
    const { pageIds, language = 'all', excludeTechnical = true } = args;

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
      '언어별(language) 필터링을 지원합니다. ' +
      '페이지 내용 참고/인용이 필요하면 getConfluencePage를 사용하세요.',
    schema: confluenceWordCountSchema,
  }
);
