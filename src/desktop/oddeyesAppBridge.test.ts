/**
 * oddeyesAppBridge — setSourceDocument 유닛 테스트
 *
 * 검증 대상:
 * 1. markdown content → setSourceDocument + setSourceDocJson 호출
 * 2. adf content → adfToTipTap 경유 → store 업데이트
 * 3. tiptap_json content → 직접 store 업데이트
 * 4. filePath + adf → read_text_file invoke → adfToTipTap → store
 * 5. filePath + markdown → read_text_file invoke → markdownToTipTapJson → store
 * 6. content/filePath 둘 다 없으면 에러
 * 7. loadConfluencePage → invoke → adfToTipTap → store
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── store mock ──────────────────────────────────────────────────────────────
const mockSetSourceDocument = vi.fn();
const mockSetSourceDocJson = vi.fn();

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      project: { id: 'test-project', metadata: { title: 'Test' } },
      sourceDocument: '<p>old source</p>',
      targetDocument: '<p>old target</p>',
      sourceDocJson: null,
      targetDocJson: null,
      setSourceDocument: mockSetSourceDocument,
      setSourceDocJson: mockSetSourceDocJson,
    }),
  },
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: {
    getState: () => ({
      translationRules: '',
      projectContext: '',
      translatorPersona: '',
    }),
  },
}));

vi.mock('@/stores/translationPreviewStore', () => ({
  useTranslationPreviewStore: {
    getState: () => ({
      open: false,
      docJson: null,
      setPreview: vi.fn(),
    }),
  },
}));

vi.mock('@/tauri/glossary', () => ({
  searchGlossary: vi.fn(() => []),
}));

vi.mock('@/utils/hash', () => ({
  hashContent: vi.fn(() => 'mock-hash-123'),
}));

// ── adfToTipTap mock ────────────────────────────────────────────────────────
const mockTipTapDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'converted' }] }] };
vi.mock('@/utils/adfToTipTap', () => ({
  adfToTipTap: vi.fn(() => mockTipTapDoc),
}));

// ── markdownConverter mock ──────────────────────────────────────────────────
vi.mock('@/utils/markdownConverter', () => ({
  htmlToTipTapJson: vi.fn(() => ({ type: 'doc', content: [] })),
  markdownToTipTapJson: vi.fn(() => mockTipTapDoc),
  markdownToTipTapJsonForTranslation: vi.fn(() => mockTipTapDoc),
  tipTapJsonToHtml: vi.fn(() => '<p>converted html</p>'),
  tipTapJsonToMarkdownForTranslation: vi.fn(() => 'converted markdown'),
}));

// ── Tauri invoke mock ───────────────────────────────────────────────────────
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@/desktop/translationPreviewActions', () => ({
  applyDesktopTranslationPreview: vi.fn(),
  discardDesktopTranslationPreview: vi.fn(),
}));

import { initializeOddEyesAppBridge } from './oddeyesAppBridge';
import { adfToTipTap } from '@/utils/adfToTipTap';
import { markdownToTipTapJson, tipTapJsonToHtml } from '@/utils/markdownConverter';

// ── helper ──────────────────────────────────────────────────────────────────
function callBridge(method: string, params?: Record<string, unknown>) {
  return window.__ODDEYES_APP_BRIDGE__!.handleRequest(method, params);
}

const sampleAdf = { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] };

describe('oddeyesAppBridge — setSourceDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeOddEyesAppBridge();
  });

  it('markdown content → store에 변환된 HTML + JSON 저장', async () => {
    const result = await callBridge('oddeyes.setSourceDocument', {
      content: '# Hello',
      format: 'markdown',
    });

    expect(markdownToTipTapJson).toHaveBeenCalledWith('# Hello');
    expect(tipTapJsonToHtml).toHaveBeenCalled();
    expect(mockSetSourceDocument).toHaveBeenCalledWith('<p>converted html</p>');
    expect(mockSetSourceDocJson).toHaveBeenCalled();
    expect(result).toHaveProperty('ok', true);
    expect(result).toHaveProperty('sourceRevision');
  });

  it('adf content (object) → adfToTipTap 경유', async () => {
    const result = await callBridge('oddeyes.setSourceDocument', {
      content: sampleAdf,
      format: 'adf',
    });

    expect(adfToTipTap).toHaveBeenCalledWith(sampleAdf);
    expect(mockSetSourceDocument).toHaveBeenCalled();
    expect(mockSetSourceDocJson).toHaveBeenCalled();
    expect(result).toHaveProperty('ok', true);
  });

  it('adf content (string) → JSON.parse + adfToTipTap', async () => {
    const result = await callBridge('oddeyes.setSourceDocument', {
      content: JSON.stringify(sampleAdf),
      format: 'adf',
    });

    expect(adfToTipTap).toHaveBeenCalledWith(sampleAdf);
    expect(result).toHaveProperty('ok', true);
  });

  it('tiptap_json content → 직접 store에 저장', async () => {
    const tipTapContent = { type: 'doc', content: [{ type: 'paragraph' }] };

    const result = await callBridge('oddeyes.setSourceDocument', {
      content: tipTapContent,
      format: 'tiptap_json',
    });

    expect(adfToTipTap).not.toHaveBeenCalled();
    expect(mockSetSourceDocJson).toHaveBeenCalled();
    expect(result).toHaveProperty('ok', true);
  });

  it('filePath + adf → read_text_file invoke → adfToTipTap', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify(sampleAdf));

    const result = await callBridge('oddeyes.setSourceDocument', {
      filePath: '/tmp/page.json',
      format: 'adf',
    });

    expect(mockInvoke).toHaveBeenCalledWith('read_text_file', { path: '/tmp/page.json' });
    expect(adfToTipTap).toHaveBeenCalledWith(sampleAdf);
    expect(mockSetSourceDocument).toHaveBeenCalled();
    expect(result).toHaveProperty('ok', true);
  });

  it('filePath + markdown → read_text_file → markdownToTipTapJson', async () => {
    mockInvoke.mockResolvedValueOnce('# From file');

    const result = await callBridge('oddeyes.setSourceDocument', {
      filePath: '/tmp/doc.md',
      format: 'markdown',
    });

    expect(mockInvoke).toHaveBeenCalledWith('read_text_file', { path: '/tmp/doc.md' });
    expect(markdownToTipTapJson).toHaveBeenCalledWith('# From file');
    expect(result).toHaveProperty('ok', true);
  });

  it('content/filePath 둘 다 없으면 에러', async () => {
    await expect(
      callBridge('oddeyes.setSourceDocument', { format: 'markdown' }),
    ).rejects.toThrow('Either filePath or content is required.');
  });

  it('format 기본값은 markdown', async () => {
    await callBridge('oddeyes.setSourceDocument', { content: 'plain text' });

    expect(markdownToTipTapJson).toHaveBeenCalledWith('plain text');
  });
});

describe('oddeyesAppBridge — loadConfluencePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeOddEyesAppBridge();
  });

  it('Rust command 호출 → ADF 변환 → source store 업데이트', async () => {
    mockInvoke.mockResolvedValueOnce({
      title: 'Test Page',
      body: {
        atlas_doc_format: {
          value: JSON.stringify(sampleAdf),
        },
      },
    });

    const result = await callBridge('oddeyes.loadConfluencePage', {
      pageUrl: 'https://test.atlassian.net/wiki/spaces/SP/pages/123456/Test',
    });

    expect(mockInvoke).toHaveBeenCalledWith('load_confluence_page_as_source', {
      pageUrl: 'https://test.atlassian.net/wiki/spaces/SP/pages/123456/Test',
    });
    expect(adfToTipTap).toHaveBeenCalledWith(sampleAdf);
    expect(mockSetSourceDocument).toHaveBeenCalled();
    expect(mockSetSourceDocJson).toHaveBeenCalled();
    expect(result).toHaveProperty('ok', true);
  });

  it('ADF 콘텐츠 없으면 에러', async () => {
    mockInvoke.mockResolvedValueOnce({ title: 'Empty', body: {} });

    await expect(
      callBridge('oddeyes.loadConfluencePage', {
        pageUrl: 'https://test.atlassian.net/wiki/spaces/SP/pages/999/Empty',
      }),
    ).rejects.toThrow('ADF 콘텐츠를 가져올 수 없습니다.');
  });

  it('pageUrl 없으면 에러', async () => {
    await expect(
      callBridge('oddeyes.loadConfluencePage', {}),
    ).rejects.toThrow('pageUrl is required');
  });
});

describe('oddeyesAppBridge — 존재하지 않는 메서드', () => {
  beforeEach(() => {
    initializeOddEyesAppBridge();
  });

  it('알 수 없는 메서드 호출 시 에러', async () => {
    await expect(
      callBridge('oddeyes.nonExistentMethod'),
    ).rejects.toThrow('Method not found: oddeyes.nonExistentMethod');
  });
});
