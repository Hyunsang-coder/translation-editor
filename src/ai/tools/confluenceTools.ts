/**
 * Confluence 전용 도구
 *
 * confluence_load_page: 페이지를 ADF(폴백: Markdown)로 가져와 원문 에디터 패널에 로드한다.
 * 페이지 fetch는 MCP tool을 Tauri command로 직접 호출하므로 본문이 LLM 컨텍스트에
 * 노출되지 않고, 같은 페이지 재요청을 위해 모듈 수준 캐시를 둔다.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { extractPageIdFromUrl } from '@/utils/wordCounter';
import type { AdfDocument } from '@/utils/adfParser';
import { isValidAdfDocument } from '@/utils/adfParser';
import { adfToTipTap } from '@/utils/adfToTipTap';
import { markdownToTipTapJson, tipTapJsonToHtml } from '@/utils/markdownConverter';
import { useProjectStore } from '@/stores/projectStore';

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

// 캐시된 cloudId (TTL: 5분 — 계정 전환 시 stale 데이터 방지)
let cachedCloudId: string | null = null;
let cachedCloudIdAt = 0;
const CLOUD_ID_TTL_MS = 5 * 60 * 1000; // 5분


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
 * - ADF와 Markdown 별도 저장 (형식별 분리 캐시)
 */
interface CachedPage {
  /** ADF 형식 콘텐츠 (있는 경우) */
  adf?: AdfDocument;
  /** Markdown 형식 콘텐츠 (있는 경우) */
  markdown?: string;
  /** 페이지 제목 (응답에 포함된 경우) */
  title?: string;
  /** 캐시 시간 */
  cachedAt: number;
}
const PAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const MAX_PAGE_CACHE_SIZE = 50;
const pageCache = new Map<string, CachedPage>();

/**
 * 페이지 캐시에서 조회 (TTL 확인)
 * 선호 형식을 우선 반환, 없으면 다른 형식 반환
 */
function getFromCache(pageId: string, preferredFormat: PageContentFormat = 'adf'): PageContent | null {
  const cached = pageCache.get(pageId);
  if (!cached) return null;

  const isExpired = Date.now() - cached.cachedAt > PAGE_CACHE_TTL_MS;
  if (isExpired) {
    pageCache.delete(pageId);
    return null;
  }

  // 선호 형식 먼저 확인
  if (preferredFormat === 'adf' && cached.adf) {
    console.warn(`[confluence_page] Cache HIT for page ${pageId} (format: adf)`);
    return { format: 'adf', content: cached.adf };
  }
  if (preferredFormat === 'markdown' && cached.markdown) {
    console.warn(`[confluence_page] Cache HIT for page ${pageId} (format: markdown)`);
    return { format: 'markdown', content: cached.markdown };
  }

  // 선호 형식이 없으면 다른 형식 반환
  if (cached.adf) {
    console.warn(`[confluence_page] Cache HIT for page ${pageId} (format: adf, fallback)`);
    return { format: 'adf', content: cached.adf };
  }
  if (cached.markdown) {
    console.warn(`[confluence_page] Cache HIT for page ${pageId} (format: markdown, fallback)`);
    return { format: 'markdown', content: cached.markdown };
  }

  return null;
}

/**
 * 페이지 캐시에 저장 (형식별 분리)
 */
function saveToCache(
  pageId: string,
  content: string | AdfDocument,
  format: PageContentFormat,
  title?: string,
): void {
  // 캐시 크기 제한: 오래된 항목부터 제거 (Map은 삽입 순서 유지)
  if (pageCache.size >= MAX_PAGE_CACHE_SIZE && !pageCache.has(pageId)) {
    const oldestKey = pageCache.keys().next().value;
    if (oldestKey) pageCache.delete(oldestKey);
  }

  const existing = pageCache.get(pageId);
  const now = Date.now();

  if (existing && (now - existing.cachedAt <= PAGE_CACHE_TTL_MS)) {
    // 기존 캐시가 유효하면 형식 추가 + 타임스탬프 갱신
    if (format === 'adf') {
      existing.adf = content as AdfDocument;
    } else {
      existing.markdown = content as string;
    }
    if (title) existing.title = title;
    existing.cachedAt = now;
    console.warn(`[confluence_page] Updated cache for page ${pageId} (added ${format})`);
  } else {
    // 새 캐시 생성
    const newCache: CachedPage = { cachedAt: now };
    if (format === 'adf') {
      newCache.adf = content as AdfDocument;
    } else {
      newCache.markdown = content as string;
    }
    if (title) newCache.title = title;
    pageCache.set(pageId, newCache);
    console.warn(`[confluence_page] Cached page ${pageId} (format: ${format}, cache size: ${pageCache.size})`);
  }
}

/**
 * URL(또는 ID) → Confluence 페이지 ID
 *
 * 짧은 링크(`/wiki/x/Fc1bBw`)는 숫자 ID가 아니라 인코딩된 ID를 그대로 넘긴다 —
 * getConfluencePage가 tiny link ID를 받아 해석한다. 그 외는 기존 규칙(`/pages/123`, 숫자).
 */
function resolvePageId(input: string): string {
  const tinyLink = input.match(/\/wiki\/x\/([A-Za-z0-9_-]+)/);
  if (tinyLink?.[1]) return tinyLink[1];

  return extractPageIdFromUrl(input);
}

/**
 * Atlassian cloudId 가져오기 (MCP tool로 조회)
 */
async function getCloudId(): Promise<string> {
  if (cachedCloudId && Date.now() - cachedCloudIdAt < CLOUD_ID_TTL_MS) {
    return cachedCloudId;
  }
  // TTL 만료 또는 미캐시 → 재조회
  cachedCloudId = null;

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
      cachedCloudIdAt = Date.now();
      return cachedCloudId;
    }
  } catch {
    const match = text.match(/"id"\s*:\s*"([^"]+)"/);
    if (match?.[1]) {
      cachedCloudId = match[1];
      cachedCloudIdAt = Date.now();
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
  // 1. 캐시 확인 (ADF 우선)
  const cached = getFromCache(pageId, 'adf');
  if (cached !== null) {
    return cached;
  }

  // 2. API 호출
  const cloudId = await getCloudId();

  // 2a. ADF 형식 먼저 시도
  try {
    console.warn('[confluence_page] Trying ADF format first...');
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
          console.warn('[confluence_page] ADF format success');
          saveToCache(pageId, adfDoc, 'adf');
          return { format: 'adf', content: adfDoc };
        }
      } catch {
        console.warn('[confluence_page] Failed to parse ADF response as JSON');
      }
    }
  } catch (e) {
    console.warn('[confluence_page] ADF request failed:', e instanceof Error ? e.message : String(e));
  }

  // 2b. Markdown 폴백
  console.warn('[confluence_page] Falling back to Markdown format...');
  const { markdown } = await fetchMarkdownViaMcp(pageId, cloudId);

  return { format: 'markdown', content: markdown };
}

/**
 * Markdown 형식으로 페이지 가져오기 (캐시 저장 포함)
 *
 * ADF 폴백 경로와 confluence_get_page가 공유한다. 제목은 응답 JSON에 있을 때만 얻는다.
 */
async function fetchMarkdownViaMcp(
  pageId: string,
  cloudId: string,
): Promise<{ title: string | null; markdown: string }> {
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
  let title: string | null = null;
  try {
    const parsed = JSON.parse(rawText);
    if (parsed.body && typeof parsed.body === 'string') {
      markdown = parsed.body;
      console.warn('[confluence_page] Extracted body from JSON response');
    }
    if (typeof parsed.title === 'string') title = parsed.title;
  } catch {
    // JSON이 아니면 그대로 사용 (순수 markdown)
  }

  saveToCache(pageId, markdown, 'markdown', title ?? undefined);

  return { title, markdown };
}

/**
 * 페이지 본문을 Markdown으로 조회 (캐시 우선)
 *
 * ADF는 confluence_get_page에 쓰지 않는다 — 모델에게 줄 값이므로 JSON 구조가 아니라
 * 읽을 수 있는 텍스트여야 하고, 캡에 걸려 잘려도 Markdown은 손상이 눈에 보인다.
 */
async function fetchPageMarkdown(pageId: string): Promise<{ title: string | null; markdown: string }> {
  const cached = getFromCache(pageId, 'markdown');
  if (cached?.format === 'markdown') {
    return { title: pageCache.get(pageId)?.title ?? null, markdown: cached.content };
  }

  const cloudId = await getCloudId();
  return fetchMarkdownViaMcp(pageId, cloudId);
}

// ============================================================================
// loadAdfAsSourceDocument — Confluence 페이지를 원문 패널에 로드
// ============================================================================

/**
 * Confluence 페이지 URL → 원문 에디터 패널에 로드
 *
 * ADF 수신 시: adfToTipTap() 경유
 * Markdown 폴백 시: markdownToTipTapJson() 경유
 * 결과를 projectStore의 sourceDocument(HTML) + sourceDocJson(TipTap JSON)에 저장
 */
export async function loadAdfAsSourceDocument(pageUrl: string): Promise<void> {
  const pageId = resolvePageId(pageUrl);
  if (!pageId) {
    throw new Error(`Confluence 페이지 ID를 추출할 수 없습니다: ${pageUrl}`);
  }

  const pageContent = await fetchConfluencePageViaMcp(pageId);

  let tipTapJson: ReturnType<typeof adfToTipTap> | ReturnType<typeof markdownToTipTapJson>;

  if (pageContent.format === 'adf') {
    tipTapJson = adfToTipTap(pageContent.content as AdfDocument);
  } else {
    tipTapJson = markdownToTipTapJson(pageContent.content as string);
  }

  const html = tipTapJsonToHtml(tipTapJson);

  const { setSourceDocument, setSourceDocJson } = useProjectStore.getState();
  setSourceDocument(html);
  setSourceDocJson(tipTapJson);
}

/**
 * confluence_load_page LangChain 도구
 *
 * 채팅에서 "이 Confluence 페이지 원문으로 불러와줘" 요청 시 agent가 호출.
 * 결과 텍스트만 AI에게 반환 — 페이지 내용은 LLM에 노출되지 않음.
 */
export const confluenceLoadPageTool = tool(
  async ({ pageUrl }: { pageUrl: string }): Promise<string> => {
    await loadAdfAsSourceDocument(pageUrl);
    return '원문 패널에 Confluence 페이지를 로드했습니다. 에디터에서 확인하세요.';
  },
  {
    name: 'confluence_load_page',
    description:
      'Confluence 페이지를 원문(Source) 에디터 패널에 로드합니다. 현재 원문 문서를 덮어씁니다. ' +
      '번역을 시작할 때만 사용하세요 — 내용을 읽고 답하기만 할 때는 confluence_get_page를 쓰세요. ' +
      '예: "이 페이지 번역해줘 https://..." → confluence_load_page(pageUrl) 호출.',
    schema: z.object({
      pageUrl: z.string().describe('Confluence 페이지 URL (예: https://your-domain.atlassian.net/wiki/spaces/.../pages/123456)'),
    }),
  }
);

// ============================================================================
// confluence_search / confluence_get_page — 참고용 조회 (본문이 LLM에 전달됨)
// ============================================================================

/** Rovo Search 결과 항목 (mcp.atlassian.com `search` 응답) */
interface RovoSearchResult {
  id?: string;
  title?: string;
  text?: string;
  url?: string;
}

/**
 * 모델에 넘길 검색 결과 개수·발췌 길이.
 *
 * Rovo는 20건을 통째로 주는데(원본 ~7,000자) registry 캡 4,000자에 걸려 뒷부분이
 * 잘린다. 잘린 조각을 주는 대신 건수와 발췌를 우리가 줄인다 — 부족하면 모델이
 * confluence_get_page로 본문을 읽으면 된다.
 */
const SEARCH_RESULT_LIMIT = 10;
const SEARCH_SNIPPET_CHARS = 200;
/**
 * 출력 총량 상한. registry 캡(4,000)보다 낮게 잡아 미들웨어 절단이 일어나지 않게 한다 —
 * 제목·URL이 긴 결과가 10건 모이면 1건당 700자를 넘길 수 있고, 그때 절단은 몇 건이
 * 사라졌는지 알려주지 않는다.
 */
const SEARCH_OUTPUT_CHARS = 3_500;

/**
 * ARI에서 페이지 ID 추출 (`ari:cloud:confluence:<cloudId>:page/433752286` → `433752286`)
 *
 * URL만으로는 열 수 없는 결과가 있다 — 공간 홈은 `/spaces/X/overview`로 와서
 * `/pages/<id>`가 없다. ID를 함께 주면 confluence_get_page가 그대로 받는다.
 */
function pageIdFromAri(ari: string | undefined): string | null {
  // page/blogpost로 한정한다 — comment·attachment ID를 pageId로 건네면 조회가 실패한다.
  return ari?.match(/:(?:page|blogpost)\/(\d+)$/)?.[1] ?? null;
}

function formatSearchResults(results: RovoSearchResult[]): string {
  const candidates = results.slice(0, SEARCH_RESULT_LIMIT);
  const blocks: string[] = [];
  let used = 0;

  for (const [index, result] of candidates.entries()) {
    const snippet = (result.text ?? '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_SNIPPET_CHARS);
    const pageId = pageIdFromAri(result.id);
    const block = [
      `${index + 1}. ${result.title ?? '(제목 없음)'}${pageId ? ` (ID: ${pageId})` : ''}`,
      `   ${result.url ?? '(URL 없음)'}`,
      snippet ? `   ${snippet}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');

    if (blocks.length > 0 && used + block.length > SEARCH_OUTPUT_CHARS) break;
    blocks.push(block);
    used += block.length + 2; // '\n\n'
  }

  if (blocks.length < candidates.length) {
    blocks.push(`(길이 제한으로 상위 ${blocks.length}건만 표시했습니다. 더 좁은 검색어를 쓰세요.)`);
  }

  return blocks.join('\n\n');
}

/**
 * confluence_search LangChain 도구
 *
 * Rovo Search(`search`)를 Tauri command로 직접 호출한다. MCP 서버 도구를 그대로
 * 바인딩하지 않는 이유는 ① 서버 설명이 장문이라 tools 프리픽스가 커지고 ② 결과 형태·
 * 건수를 우리가 통제해야 캡에서 잘리지 않기 때문이다.
 */
export const confluenceSearchTool = tool(
  async ({ query }: { query: string }): Promise<string> => {
    const result = await invoke<McpToolResult>('mcp_call_tool', {
      name: 'search',
      arguments: { query },
    });

    const text = result.content.map((c) => c.text || '').join('');
    if (result.isError) {
      throw new Error(`Confluence 검색 실패: ${text}`);
    }

    let results: RovoSearchResult[];
    try {
      results = JSON.parse(text).results;
    } catch {
      // 응답 형태가 바뀌었으면 원문을 그대로 넘긴다(캡은 미들웨어가 적용).
      return text;
    }
    if (!Array.isArray(results)) return text;

    // Rovo Search는 Jira 이슈까지 섞어 반환하고 파라미터로는 좁힐 수 없다.
    // ARI(`ari:cloud:confluence:...`)로 Confluence만 남긴다.
    const pages = results.filter((r) => r.id?.includes(':confluence:'));
    if (pages.length === 0) return '검색 결과가 없습니다.';

    return formatSearchResults(pages);
  },
  {
    name: 'confluence_search',
    description:
      '사내 Confluence 위키를 검색해 관련 페이지의 제목·페이지 ID·URL·발췌를 반환합니다. ' +
      '용례·사내 표기·참고 문서를 찾을 때 사용하세요. ' +
      '본문 전체가 필요하면 결과의 URL이나 ID로 confluence_get_page를 호출하세요.',
    schema: z.object({
      query: z.string().describe('검색어 (자연어 키워드)'),
    }),
  }
);

/**
 * confluence_get_page LangChain 도구
 *
 * 페이지 본문을 Markdown으로 모델에 넘긴다. 원문 패널을 건드리지 않는 읽기 전용 도구.
 */
export const confluenceGetPageTool = tool(
  async ({ pageUrl }: { pageUrl: string }): Promise<string> => {
    const pageId = resolvePageId(pageUrl);
    const { title, markdown } = await fetchPageMarkdown(pageId);

    return [title ? `# ${title}` : null, markdown]
      .filter((part): part is string => part !== null)
      .join('\n\n');
  },
  {
    name: 'confluence_get_page',
    description:
      'Confluence 페이지 URL의 본문을 읽어옵니다(읽기 전용 — 문서를 변경하지 않습니다). ' +
      '사용자가 준 URL이나 confluence_search 결과 URL을 넘기세요. ' +
      '짧은 링크(/wiki/x/...)도 지원합니다.',
    schema: z.object({
      pageUrl: z.string().describe('Confluence 페이지 URL 또는 페이지 ID'),
    }),
  }
);
