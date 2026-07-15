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
      project: { id: 'test-project', metadata: { title: 'Test', domain: 'game' } },
      sourceDocument: '<p>old source</p>',
      targetDocument: '<p>old target</p>',
      sourceDocJson: null,
      targetDocJson: null,
    }),
  },
}));

const setPersonaSpy = vi.fn();
const setRulesSpy = vi.fn();
const setContextSpy = vi.fn();
const appendRulesSpy = vi.fn();

vi.mock('@/stores/chatStore', () => ({
  useChatStore: {
    getState: () => ({
      translationRules: '',
      projectContext: '',
      translatorPersona: '',
      setTranslatorPersona: setPersonaSpy,
      appendToTranslatorPersona: vi.fn(),
      setTranslationRules: setRulesSpy,
      appendToTranslationRules: appendRulesSpy,
      setProjectContext: setContextSpy,
      appendToProjectContext: vi.fn(),
    }),
  },
}));

const setPreviewSpy = vi.fn();

vi.mock('@/stores/translationPreviewStore', () => ({
  useTranslationPreviewStore: {
    getState: () => ({
      open: false,
      docJson: null,
      setPreview: setPreviewSpy,
    }),
  },
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      sourceEditor: null,
      targetEditor: null,
    }),
  },
}));

vi.mock('@/tauri/glossary', () => ({
  searchGlossary: vi.fn(() => []),
}));

const glossaryEntry = {
  id: 'e-1',
  glossaryId: 'g-1',
  source: 'Care Package',
  target: '보급 상자',
  notes: null,
  domain: 'game',
  caseSensitive: false,
  createdAt: 1,
  updatedAt: 1,
};

const glossaryStore = {
  activeProjectId: 'test-project' as string | null,
  loading: false,
  glossaries: [
    {
      id: 'g-1',
      name: 'PUBG',
      description: null,
      entryCount: 0,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  projectGlossaries: [
    {
      id: 'g-1',
      name: 'PUBG',
      description: null,
      entryCount: 0,
      priority: 0,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  loadLibrary: vi.fn(async () => undefined),
  createEntry: vi.fn(async () => glossaryEntry),
  createGlossary: vi.fn(async () => ({
    id: 'g-new',
    name: 'Project glossary',
    description: null,
    entryCount: 0,
    createdAt: 2,
    updatedAt: 2,
  })),
  saveProjectSelection: vi.fn(async () => undefined),
};

vi.mock('@/stores/glossaryStore', () => ({
  useGlossaryStore: {
    getState: () => glossaryStore,
  },
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

const ingestSpy = vi.fn();
vi.mock('@/stores/reviewStore', () => ({
  useReviewStore: {
    getState: () => ({ ingestExternalReview: ingestSpy, getAllIssues: () => [] }),
  },
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

describe('oddeyesAppBridge — setReviewIssues', () => {
  beforeEach(() => {
    initializeOddEyesAppBridge();
    ingestSpy.mockClear();
  });

  it('severity/type 정규화 + excerpt 없는 항목 드롭', async () => {
    const res = await callBridge('oddeyes.setReviewIssues', {
      issues: [
        { sourceExcerpt: 's1', targetExcerpt: 't1', type: '오역', severity: '🔴', description: 'd1' },
        { sourceExcerpt: 's2', targetExcerpt: '',   type: '누락', severity: '🟡', description: 'd2' },
      ],
    }) as Record<string, unknown>;
    expect(res.count).toBe(1);
    expect(res.dropped).toBe(1);
    expect(ingestSpy).toHaveBeenCalledWith(expect.objectContaining({
      issues: [expect.objectContaining({ type: 'mistranslation', severity: 'critical' })],
    }));
  });

  it('projectId 불일치 시 거부 (함정 5)', async () => {
    await expect(callBridge('oddeyes.setReviewIssues', { projectId: 'other', issues: [] }))
      .rejects.toThrow('Project mismatch');
  });
});

describe('oddeyesAppBridge — setTranslationPreview (L3)', () => {
  beforeEach(() => {
    initializeOddEyesAppBridge();
    setPreviewSpy.mockClear();
  });

  it('set 시점의 projectId와 revision을 자동 캡처해 store에 기록', async () => {
    const res = await callBridge('oddeyes.setTranslationPreview', {
      content: '# translated',
    }) as Record<string, unknown>;

    expect(res.ok).toBe(true);
    expect(setPreviewSpy).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'test-project',
      // hashContent가 mock이므로 상수 해시 — set 시점 현재 revision이 자동 기록됨
      sourceRevision: 'mock-hash-123',
      targetRevision: 'mock-hash-123',
    }));
  });

  it('projectId 불일치 시 거부 (setReviewIssues와 대칭)', async () => {
    await expect(callBridge('oddeyes.setTranslationPreview', {
      projectId: 'other-project',
      content: '# translated',
    })).rejects.toThrow('Project mismatch');
    expect(setPreviewSpy).not.toHaveBeenCalled();
  });

  it('호출자가 넘긴 targetRevision이 현재와 다르면 거부', async () => {
    await expect(callBridge('oddeyes.setTranslationPreview', {
      targetRevision: 'stale-revision',
      content: '# translated',
    })).rejects.toThrow('target document revision mismatch');
    expect(setPreviewSpy).not.toHaveBeenCalled();
  });

  it('호출자가 넘긴 targetRevision이 현재와 같으면 통과', async () => {
    const res = await callBridge('oddeyes.setTranslationPreview', {
      targetRevision: 'mock-hash-123',
      content: '# translated',
    }) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(setPreviewSpy).toHaveBeenCalledTimes(1);
  });
});

describe('oddeyesAppBridge — setTranslationContext', () => {
  beforeEach(() => {
    initializeOddEyesAppBridge();
    setPersonaSpy.mockClear();
    setRulesSpy.mockClear();
    setContextSpy.mockClear();
    appendRulesSpy.mockClear();
  });

  it('제공된 필드만 replace로 갱신', async () => {
    const res = await callBridge('oddeyes.setTranslationContext', {
      translationRules: 'rule A',
    }) as Record<string, unknown>;
    expect(res.updated).toEqual(['translationRules']);
    expect(setRulesSpy).toHaveBeenCalledWith('rule A');
    expect(setPersonaSpy).not.toHaveBeenCalled();
    expect(setContextSpy).not.toHaveBeenCalled();
  });

  it('mode=append는 appendTo* 호출', async () => {
    await callBridge('oddeyes.setTranslationContext', {
      translationRules: 'extra rule', mode: 'append',
    });
    expect(appendRulesSpy).toHaveBeenCalledWith('extra rule');
    expect(setRulesSpy).not.toHaveBeenCalled();
  });

  it('projectId 불일치 시 거부', async () => {
    await expect(callBridge('oddeyes.setTranslationContext', { projectId: 'other' }))
      .rejects.toThrow('Project mismatch');
  });

  it('빈 문자열 replace는 허용(비우기)', async () => {
    const res = await callBridge('oddeyes.setTranslationContext', {
      translatorPersona: '',
    }) as Record<string, unknown>;
    expect(res.updated).toEqual(['translatorPersona']);
    expect(setPersonaSpy).toHaveBeenCalledWith('');
  });

  it('mode=append에서 빈 문자열은 스킵', async () => {
    const res = await callBridge('oddeyes.setTranslationContext', {
      translationRules: '   ', mode: 'append',
    }) as Record<string, unknown>;
    expect(res.updated).toEqual([]);
    expect(appendRulesSpy).not.toHaveBeenCalled();
  });
});

describe('oddeyesAppBridge — glossary', () => {
  beforeEach(() => {
    initializeOddEyesAppBridge();
    glossaryStore.activeProjectId = 'test-project';
    glossaryStore.loading = false;
    glossaryStore.projectGlossaries = [
      {
        id: 'g-1',
        name: 'PUBG',
        description: null,
        entryCount: 0,
        priority: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    glossaryStore.glossaries = [
      {
        id: 'g-1',
        name: 'PUBG',
        description: null,
        entryCount: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    glossaryStore.loadLibrary.mockClear();
    glossaryStore.createEntry.mockClear();
    glossaryStore.createGlossary.mockClear();
    glossaryStore.saveProjectSelection.mockClear();
  });

  it('lists project glossaries', async () => {
    const res = await callBridge('oddeyes.listProjectGlossaries') as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(res.projectId).toBe('test-project');
    expect(res.projectGlossaries).toEqual(glossaryStore.projectGlossaries);
  });

  it('adds a glossary entry to the linked glossary', async () => {
    const res = await callBridge('oddeyes.addGlossaryEntry', {
      source: 'Care Package',
      target: '보급 상자',
    }) as Record<string, unknown>;

    expect(res.ok).toBe(true);
    expect(glossaryStore.createEntry).toHaveBeenCalledWith(expect.objectContaining({
      glossaryId: 'g-1',
      source: 'Care Package',
      target: '보급 상자',
      domain: 'game',
    }));
    expect(glossaryStore.createGlossary).not.toHaveBeenCalled();
  });

  it('creates and links a glossary when none are linked', async () => {
    glossaryStore.projectGlossaries = [];
    glossaryStore.saveProjectSelection.mockImplementation(async () => {
      glossaryStore.projectGlossaries = [
        {
          id: 'g-new',
          name: 'Project glossary',
          description: null,
          entryCount: 0,
          priority: 0,
          createdAt: 2,
          updatedAt: 2,
        },
      ];
    });

    const res = await callBridge('oddeyes.addGlossaryEntry', {
      source: 'Blue Zone',
      target: '블루존',
    }) as Record<string, unknown>;

    expect(glossaryStore.createGlossary).toHaveBeenCalled();
    expect(glossaryStore.saveProjectSelection).toHaveBeenCalledWith('test-project', ['g-new']);
    expect(glossaryStore.createEntry).toHaveBeenCalledWith(expect.objectContaining({
      glossaryId: 'g-new',
      source: 'Blue Zone',
      target: '블루존',
    }));
    expect(res.createdGlossary).toBe(true);
  });

  it('rejects unknown glossaryId', async () => {
    await expect(callBridge('oddeyes.addGlossaryEntry', {
      glossaryId: 'missing',
      source: 'A',
      target: 'B',
    })).rejects.toThrow('Unknown glossaryId');
  });

  it('rejects projectId mismatch', async () => {
    await expect(callBridge('oddeyes.addGlossaryEntry', {
      projectId: 'other',
      source: 'A',
      target: 'B',
    })).rejects.toThrow('Project mismatch');
  });
});
