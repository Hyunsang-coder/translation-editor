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
function saveToCache(pageId: string, content: string | AdfDocument, format: PageContentFormat): void {
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
    pageCache.set(pageId, newCache);
    console.warn(`[confluence_page] Cached page ${pageId} (format: ${format}, cache size: ${pageCache.size})`);
  }
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
      console.warn('[confluence_page] Extracted body from JSON response');
    }
  } catch {
    // JSON이 아니면 그대로 사용 (순수 markdown)
  }

  // 3. 캐시에 저장
  saveToCache(pageId, markdown, 'markdown');

  return { format: 'markdown', content: markdown };
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
  const pageId = extractPageIdFromUrl(pageUrl);
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
      'Confluence 페이지를 원문(Source) 에디터 패널에 로드합니다. ' +
      '번역 작업을 시작할 원문 페이지 URL을 받아 ADF 형식으로 가져온 뒤 에디터에 표시합니다. ' +
      '예: "이 페이지 번역해줘 https://..." → confluence_load_page(pageUrl) 호출.',
    schema: z.object({
      pageUrl: z.string().describe('Confluence 페이지 URL (예: https://your-domain.atlassian.net/wiki/spaces/.../pages/123456)'),
    }),
  }
);
