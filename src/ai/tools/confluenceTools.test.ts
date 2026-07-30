/**
 * confluenceTools.ts — loadAdfAsSourceDocument 유닛 테스트
 *
 * 모킹 전략:
 * - fetchConfluencePageViaMcp: 내부 함수이므로 모듈 내 의존성 mock
 * - adfToTipTap, markdownToTipTapJson, tipTapJsonToHtml: 변환 함수 mock
 * - useProjectStore: store 액션 mock
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── store mock ──────────────────────────────────────────────────────────────
const mockSetSourceDocument = vi.fn();
const mockSetSourceDocJson = vi.fn();

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      setSourceDocument: mockSetSourceDocument,
      setSourceDocJson: mockSetSourceDocJson,
    }),
  },
}));

// ── wordCounter mock (extractPageIdFromUrl) ─────────────────────────────────
vi.mock('@/utils/wordCounter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/wordCounter')>();
  return {
    ...actual,
    extractPageIdFromUrl: vi.fn((url: string) => {
      // 실제 로직 그대로 (테스트에서 URL 검증 포함)
      const match = url.match(/\/pages\/(\d+)/);
      return match ? match[1] : null;
    }),
  };
});

// ── adfToTipTap mock ────────────────────────────────────────────────────────
vi.mock('@/utils/adfToTipTap', () => ({
  adfToTipTap: vi.fn(() => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ADF content' }] }] })),
}));

// ── markdownConverter mock ──────────────────────────────────────────────────
vi.mock('@/utils/markdownConverter', () => ({
  markdownToTipTapJson: vi.fn(() => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'MD content' }] }] })),
  tipTapJsonToHtml: vi.fn(() => '<p>converted html</p>'),
  isValidTipTapDocJson: vi.fn(() => true),
}));

// ── Tauri invoke mock (fetchConfluencePageViaMcp 내부에서 사용) ─────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// ── 실제 테스트 대상 import (mock 이후) ────────────────────────────────────
import {
  confluenceGetPageTool,
  confluenceSearchTool,
  loadAdfAsSourceDocument,
} from './confluenceTools';
import { adfToTipTap } from '@/utils/adfToTipTap';
import { markdownToTipTapJson, tipTapJsonToHtml } from '@/utils/markdownConverter';
import { invoke } from '@tauri-apps/api/core';

// ── ADF fixture ─────────────────────────────────────────────────────────────
const sampleAdf = {
  version: 1,
  type: 'doc' as const,
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Hello Confluence' }] },
  ],
};

// MCP 응답 헬퍼
function mcpAdfResponse(adf: object) {
  return { content: [{ type: 'text', text: JSON.stringify({ body: adf }) }], isError: false };
}

function mcpMarkdownResponse(md: string) {
  return { content: [{ type: 'text', text: md }], isError: false };
}

// ============================================================================

describe('loadAdfAsSourceDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── ADF 경로 ─────────────────────────────────────────────────────────────

  describe('ADF 포맷 성공 경로', () => {
    beforeEach(() => {
      // getCloudId → accessible-resources 호출
      // getConfluencePage(adf) 성공
      vi.mocked(invoke)
        .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify([{ id: 'cloud-123' }]) }], isError: false }) // getAccessibleAtlassianResources
        .mockResolvedValueOnce(mcpAdfResponse(sampleAdf)); // getConfluencePage(adf)
    });

    it('adfToTipTap을 경유하여 변환한다', async () => {
      await loadAdfAsSourceDocument('https://example.atlassian.net/wiki/spaces/X/pages/123456/Title');
      expect(adfToTipTap).toHaveBeenCalledWith(expect.objectContaining({ type: 'doc' }));
    });

    it('markdownToTipTapJson을 호출하지 않는다', async () => {
      await loadAdfAsSourceDocument('https://example.atlassian.net/wiki/spaces/X/pages/123456/Title');
      expect(markdownToTipTapJson).not.toHaveBeenCalled();
    });

    it('tipTapJsonToHtml을 호출한다', async () => {
      await loadAdfAsSourceDocument('https://example.atlassian.net/wiki/spaces/X/pages/123456/Title');
      expect(tipTapJsonToHtml).toHaveBeenCalled();
    });

    it('setSourceDocument에 HTML을 저장한다', async () => {
      await loadAdfAsSourceDocument('https://example.atlassian.net/wiki/spaces/X/pages/123456/Title');
      expect(mockSetSourceDocument).toHaveBeenCalledWith('<p>converted html</p>');
    });

    it('setSourceDocJson에 TipTap JSON을 저장한다', async () => {
      await loadAdfAsSourceDocument('https://example.atlassian.net/wiki/spaces/X/pages/123456/Title');
      expect(mockSetSourceDocJson).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'doc' })
      );
    });

    it('setSourceDocument와 setSourceDocJson 모두 호출된다', async () => {
      await loadAdfAsSourceDocument('https://example.atlassian.net/wiki/spaces/X/pages/123456/Title');
      expect(mockSetSourceDocument).toHaveBeenCalledTimes(1);
      expect(mockSetSourceDocJson).toHaveBeenCalledTimes(1);
    });
  });

  // ── Markdown 폴백 경로 ───────────────────────────────────────────────────
  // 캐시 충돌 방지: ADF 성공 테스트와 다른 pageId(999999) 사용

  describe('Markdown 폴백 경로', () => {
    const FALLBACK_URL = 'https://example.atlassian.net/wiki/spaces/X/pages/999999/FallbackTitle';

    beforeEach(() => {
      vi.mocked(invoke)
        .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify([{ id: 'cloud-123' }]) }], isError: false }) // getAccessibleAtlassianResources
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'not valid json {{' }], isError: false }) // getConfluencePage(adf) — JSON 파싱 실패
        .mockResolvedValueOnce(mcpMarkdownResponse('# Hello\n\nMarkdown content')); // getConfluencePage(markdown) 폴백
    });

    it('markdownToTipTapJson을 경유하여 변환한다', async () => {
      await loadAdfAsSourceDocument(FALLBACK_URL);
      expect(markdownToTipTapJson).toHaveBeenCalledWith(expect.stringContaining('Hello'));
    });

    it('adfToTipTap을 호출하지 않는다', async () => {
      await loadAdfAsSourceDocument(FALLBACK_URL);
      expect(adfToTipTap).not.toHaveBeenCalled();
    });

    it('store에 결과를 저장한다', async () => {
      await loadAdfAsSourceDocument(FALLBACK_URL);
      expect(mockSetSourceDocument).toHaveBeenCalledTimes(1);
      expect(mockSetSourceDocJson).toHaveBeenCalledTimes(1);
    });
  });

  // ── 에러 경로 ────────────────────────────────────────────────────────────

  describe('에러 처리', () => {
    it('pageId를 추출할 수 없는 URL이면 에러를 던진다', async () => {
      await expect(
        loadAdfAsSourceDocument('https://not-a-confluence-url.com/foo')
      ).rejects.toThrow();
    });

    it('에러 시 store 액션이 호출되지 않는다', async () => {
      await loadAdfAsSourceDocument('https://bad-url.com').catch(() => {});
      expect(mockSetSourceDocument).not.toHaveBeenCalled();
      expect(mockSetSourceDocJson).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// confluence_search / confluence_get_page
//
// cloudId·페이지 캐시가 모듈 수준이라 mockResolvedValueOnce 체인은 실행 순서에
// 의존한다. 도구 이름으로 분기하는 구현 mock을 쓰고 pageId는 테스트마다 다르게 둔다.
// ============================================================================

interface McpCallArgs {
  name: string;
  arguments?: Record<string, unknown>;
}

function mockMcp(handlers: Record<string, unknown>): void {
  // 앞선 describe가 큐에 남긴 mockResolvedValueOnce를 비운다 — clearAllMocks는
  // 호출 기록만 지우고 once 큐는 남겨서, 그 값이 구현 mock보다 먼저 반환된다.
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (_cmd, args) => {
    const { name } = args as unknown as McpCallArgs;
    const response = handlers[name];
    if (!response) throw new Error(`unexpected MCP tool: ${name}`);
    return response as never;
  });
}

const RESOURCES_RESPONSE = {
  content: [{ type: 'text', text: JSON.stringify([{ id: 'cloud-123' }]) }],
  isError: false,
};

function rovoResponse(results: unknown[]) {
  return { content: [{ type: 'text', text: JSON.stringify({ results }) }], isError: false };
}

function confluenceResult(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `ari:cloud:confluence:cloud-123:page/${1000 + index}`,
    title: `Page ${index}`,
    text: `body ${index}`,
    url: `https://example.atlassian.net/wiki/spaces/X/pages/${1000 + index}/Page`,
    ...overrides,
  };
}

describe('confluence_search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Jira 결과를 걸러내고 Confluence 페이지만 반환한다', async () => {
    mockMcp({
      search: rovoResponse([
        confluenceResult(1),
        { id: 'ari:cloud:jira:cloud-123:issue/915309', title: 'Jira issue', url: 'https://x/browse/A-1' },
      ]),
    });

    const output = await confluenceSearchTool.invoke({ query: 'glossary' });

    expect(output).toContain('Page 1');
    expect(output).not.toContain('Jira issue');
  });

  it('URL로 열 수 없는 결과도 ARI의 페이지 ID를 함께 준다', async () => {
    // 공간 홈은 /spaces/X/overview로 와서 URL에 /pages/<id>가 없다.
    mockMcp({
      search: rovoResponse([
        confluenceResult(1, { url: 'https://example.atlassian.net/wiki/spaces/X/overview' }),
      ]),
    });

    const output = await confluenceSearchTool.invoke({ query: 'glossary' });

    expect(output).toContain('(ID: 1001)');
  });

  it('결과 건수를 10건으로 제한한다', async () => {
    mockMcp({
      search: rovoResponse(Array.from({ length: 20 }, (_, i) => confluenceResult(i + 1))),
    });

    const output = await confluenceSearchTool.invoke({ query: 'glossary' });

    expect(output).toContain('10. Page 10');
    expect(output).not.toContain('11. Page 11');
  });

  it('발췌의 공백을 정규화하고 200자로 자른다', async () => {
    mockMcp({
      search: rovoResponse([confluenceResult(1, { text: `첫줄\n\n둘째줄  ${'가'.repeat(300)}` })]),
    });

    const output = await confluenceSearchTool.invoke({ query: 'glossary' });

    expect(output).toContain('첫줄 둘째줄');
    expect(output).not.toContain('\n\n둘째줄');
    // 제목·URL 줄을 뺀 발췌 줄만 길이를 센다.
    const snippetLine = output.split('\n').at(-1)!.trim();
    expect(snippetLine).toHaveLength(200);
  });

  it('출력이 상한을 넘으면 표시 건수를 줄이고 몇 건만 보여줬는지 알린다', async () => {
    // 제목·URL이 긴 결과가 모이면 registry 캡(4,000)을 넘어 조용히 잘려나간다.
    mockMcp({
      search: rovoResponse(
        Array.from({ length: 10 }, (_, i) =>
          confluenceResult(i + 1, { title: '긴제목'.repeat(60), text: '내용'.repeat(200) }),
        ),
      ),
    });

    const output = await confluenceSearchTool.invoke({ query: 'glossary' });

    expect(output).toContain('길이 제한으로 상위');
    expect(output.length).toBeLessThan(4_000);
  });

  it('Confluence 결과가 없으면 없다고 알린다', async () => {
    mockMcp({
      search: rovoResponse([{ id: 'ari:cloud:jira:cloud-123:issue/1', title: 'Jira only' }]),
    });

    await expect(confluenceSearchTool.invoke({ query: 'glossary' })).resolves.toBe('검색 결과가 없습니다.');
  });

  it('응답이 JSON이 아니면 원문을 그대로 넘긴다', async () => {
    mockMcp({ search: { content: [{ type: 'text', text: 'plain text response' }], isError: false } });

    await expect(confluenceSearchTool.invoke({ query: 'glossary' })).resolves.toBe('plain text response');
  });

  it('isError면 에러를 던진다', async () => {
    mockMcp({ search: { content: [{ type: 'text', text: 'rate limited' }], isError: true } });

    await expect(confluenceSearchTool.invoke({ query: 'glossary' })).rejects.toThrow('rate limited');
  });
});

describe('confluence_get_page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('본문을 Markdown으로 반환하고 제목을 헤딩으로 붙인다', async () => {
    mockMcp({
      getAccessibleAtlassianResources: RESOURCES_RESPONSE,
      getConfluencePage: {
        content: [{ type: 'text', text: JSON.stringify({ title: '용어 정리', body: '## 표기\n\nPUBG' }) }],
        isError: false,
      },
    });

    const output = await confluenceGetPageTool.invoke({
      pageUrl: 'https://example.atlassian.net/wiki/spaces/X/pages/700001/Terms',
    });

    expect(output).toBe('# 용어 정리\n\n## 표기\n\nPUBG');
  });

  it('짧은 링크(/wiki/x/)의 인코딩된 ID를 그대로 pageId로 넘긴다', async () => {
    mockMcp({
      getAccessibleAtlassianResources: RESOURCES_RESPONSE,
      getConfluencePage: { content: [{ type: 'text', text: 'tiny body' }], isError: false },
    });

    await confluenceGetPageTool.invoke({ pageUrl: 'https://example.atlassian.net/wiki/x/Fc1bBw' });

    expect(invoke).toHaveBeenCalledWith('mcp_call_tool', {
      name: 'getConfluencePage',
      arguments: { cloudId: 'cloud-123', pageId: 'Fc1bBw', contentFormat: 'markdown' },
    });
  });

  it('제목이 없으면 본문만 반환한다', async () => {
    mockMcp({
      getAccessibleAtlassianResources: RESOURCES_RESPONSE,
      getConfluencePage: { content: [{ type: 'text', text: 'raw markdown body' }], isError: false },
    });

    const output = await confluenceGetPageTool.invoke({
      pageUrl: 'https://example.atlassian.net/wiki/spaces/X/pages/700002/NoTitle',
    });

    expect(output).toBe('raw markdown body');
  });

  it('원문 패널을 건드리지 않는다', async () => {
    mockMcp({
      getAccessibleAtlassianResources: RESOURCES_RESPONSE,
      getConfluencePage: { content: [{ type: 'text', text: 'read only' }], isError: false },
    });

    await confluenceGetPageTool.invoke({
      pageUrl: 'https://example.atlassian.net/wiki/spaces/X/pages/700003/ReadOnly',
    });

    expect(mockSetSourceDocument).not.toHaveBeenCalled();
    expect(mockSetSourceDocJson).not.toHaveBeenCalled();
  });
});

