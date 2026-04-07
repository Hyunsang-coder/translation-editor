/**
 * oddeyesAppBridge 유닛 테스트
 *
 * 검증 대상:
 * 1. 존재하지 않는 메서드 호출 시 에러
 * 2. getStatus, getSource, getTarget 등 기본 핸들러 동작
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── store mock ──────────────────────────────────────────────────────────────
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      project: { id: 'test-project', metadata: { title: 'Test' } },
      sourceDocument: '<p>old source</p>',
      targetDocument: '<p>old target</p>',
      sourceDocJson: null,
      targetDocJson: null,
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

vi.mock('@/utils/markdownConverter', () => ({
  htmlToTipTapJson: vi.fn(() => ({ type: 'doc', content: [] })),
  markdownToTipTapJsonForTranslation: vi.fn(() => ({ type: 'doc', content: [] })),
  tipTapJsonToMarkdownForTranslation: vi.fn(() => 'converted markdown'),
}));

vi.mock('@/desktop/translationPreviewActions', () => ({
  applyDesktopTranslationPreview: vi.fn(),
  discardDesktopTranslationPreview: vi.fn(),
}));

import { initializeOddEyesAppBridge } from './oddeyesAppBridge';

// ── helper ──────────────────────────────────────────────────────────────────
function callBridge(method: string, params?: Record<string, unknown>) {
  return window.__ODDEYES_APP_BRIDGE__!.handleRequest(method, params);
}

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

describe('oddeyesAppBridge — getStatus', () => {
  beforeEach(() => {
    initializeOddEyesAppBridge();
  });

  it('프로젝트 상태 반환', async () => {
    const result = await callBridge('oddeyes.getStatus') as Record<string, unknown>;
    expect(result.ready).toBe(true);
    expect(result.projectId).toBe('test-project');
    expect(result.projectTitle).toBe('Test');
  });
});

describe('oddeyesAppBridge — getSource', () => {
  beforeEach(() => {
    initializeOddEyesAppBridge();
  });

  it('소스 문서 스냅샷 반환', async () => {
    const result = await callBridge('oddeyes.getSource') as Record<string, unknown>;
    expect(result.format).toBe('markdown');
    expect(result).toHaveProperty('revision');
    expect(result).toHaveProperty('empty');
  });
});
