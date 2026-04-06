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
import { loadAdfAsSourceDocument } from './confluenceTools';
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

function mcpErrorResponse(msg: string) {
  return { content: [{ type: 'text', text: msg }], isError: true };
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

