/**
 * oddeyesAppBridge 유닛 테스트
 *
 * 검증 대상:
 * 1. 존재하지 않는 메서드 호출 시 에러
 * 2. getStatus, getSource, getTarget 등 기본 핸들러 동작
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ForbiddenTerm, ProjectMemoryItem } from '@/types';

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

const setRulesSpy = vi.fn();
const appendRulesSpy = vi.fn();

vi.mock('@/stores/chatStore', () => ({
  useChatStore: {
    getState: () => ({
      translationRules: '',
      projectContext: '',
      setTranslationRules: setRulesSpy,
      appendToTranslationRules: appendRulesSpy,
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
  entriesByGlossary: {} as Record<string, typeof glossaryEntry[]>,
  loadLibrary: vi.fn(async () => undefined),
  loadEntries: vi.fn(async (glossaryId: string) => {
    glossaryStore.entriesByGlossary[glossaryId] = [glossaryEntry];
  }),
  createEntry: vi.fn(async () => glossaryEntry),
  updateEntry: vi.fn(async ({ entryId, source, target, notes, caseSensitive }) => ({
    ...glossaryEntry,
    id: entryId,
    source,
    target,
    notes: notes ?? null,
    caseSensitive: caseSensitive ?? false,
    updatedAt: 2,
  })),
  deleteEntry: vi.fn(async () => undefined),
  createGlossary: vi.fn(async () => ({
    id: 'g-new',
    name: 'Project glossary',
    description: null,
    entryCount: 0,
    createdAt: 2,
    updatedAt: 2,
  })),
  saveProjectSelection: vi.fn(async (_projectId: string, _ids: string[]) => undefined),
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

const memoryItem: ProjectMemoryItem = {
  id: 'm-1',
  projectId: 'test-project',
  category: 'domain',
  content: '배틀로얄 슈터 게임 UI 텍스트',
  normalizedHash: 'h1',
  status: 'active',
  source: 'user',
  createdAt: 1,
  updatedAt: 1,
};

const proposedMemoryItem: ProjectMemoryItem = {
  ...memoryItem,
  id: 'm-2',
  content: '오래된 사실',
  status: 'proposed',
};

const forbiddenTerm: ForbiddenTerm = {
  id: 'f-1',
  projectId: 'test-project',
  term: '유저',
  replacement: '플레이어',
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

const memoryStore = {
  activeProjectId: 'test-project' as string | null,
  loading: false,
  revision: 7,
  items: [memoryItem, proposedMemoryItem] as ProjectMemoryItem[],
  forbiddenTerms: [forbiddenTerm] as ForbiddenTerm[],
  hydrate: vi.fn(async () => undefined),
  addItem: vi.fn(async ({ category, content, source, status }) => ({
    item: { ...memoryItem, id: 'm-new', category, content, source, status },
    revision: 8,
    duplicate: false,
  })),
  replaceItem: vi.fn(async (targetItemId: string, { category, content, source }) => ({
    item: { ...memoryItem, id: targetItemId, category, content, source },
    revision: 9,
  })),
  deleteItem: vi.fn(async () => undefined),
  saveForbiddenTerm: vi.fn(async (input) => ({
    term: { ...forbiddenTerm, ...input },
    revision: 11,
  })),
  removeForbiddenTerm: vi.fn(async () => undefined),
};

vi.mock('@/stores/projectMemoryStore', () => ({
  useProjectMemoryStore: {
    getState: () => memoryStore,
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

describe('oddeyesAppBridge — getTranslationContext', () => {
  beforeEach(() => {
    initializeOddEyesAppBridge();
  });

  it('rules/승인된 메모리/켜진 금칙어를 반환하고 legacy projectContext는 노출하지 않는다', async () => {
    const result = await callBridge('oddeyes.getTranslationContext') as Record<string, unknown>;
    expect(result).toHaveProperty('translationRules');
    expect(result).not.toHaveProperty('projectContext');
    expect(result).not.toHaveProperty('translatorPersona');
    // 승인 전(proposed) 항목은 프롬프트에 들어가지 않으므로 여기서도 제외된다
    expect(result.projectMemory).toEqual([
      expect.objectContaining({ id: 'm-1', status: 'active' }),
    ]);
    expect(result.forbiddenTerms).toEqual([
      expect.objectContaining({ id: 'f-1', term: '유저', replacement: '플레이어' }),
    ]);
    expect(result.revision).toBe(7);
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
    setRulesSpy.mockClear();
    appendRulesSpy.mockClear();
  });

  it('제공된 필드만 replace로 갱신', async () => {
    const res = await callBridge('oddeyes.setTranslationContext', {
      translationRules: 'rule A',
    }) as Record<string, unknown>;
    expect(res.updated).toEqual(['translationRules']);
    expect(setRulesSpy).toHaveBeenCalledWith('rule A');
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
      translationRules: '',
    }) as Record<string, unknown>;
    expect(res.updated).toEqual(['translationRules']);
    expect(setRulesSpy).toHaveBeenCalledWith('');
  });

  it('legacy projectContext는 더 이상 쓰이지 않는다', async () => {
    const res = await callBridge('oddeyes.setTranslationContext', {
      projectContext: '죽은 값',
    }) as Record<string, unknown>;
    expect(res.updated).toEqual([]);
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
    glossaryStore.loadEntries.mockClear();
    glossaryStore.createEntry.mockClear();
    glossaryStore.updateEntry.mockClear();
    glossaryStore.deleteEntry.mockClear();
    glossaryStore.createGlossary.mockClear();
    glossaryStore.saveProjectSelection.mockClear();
    glossaryStore.entriesByGlossary = {};
  });

  it('lists project glossaries', async () => {
    const res = await callBridge('oddeyes.listProjectGlossaries') as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(res.projectId).toBe('test-project');
    expect(res.projectGlossaries).toEqual(glossaryStore.projectGlossaries);
  });

  it('lists glossary entries with default limit', async () => {
    const res = await callBridge('oddeyes.listGlossaryEntries', {
      glossaryId: 'g-1',
    }) as Record<string, unknown>;

    expect(res.ok).toBe(true);
    expect(glossaryStore.loadEntries).toHaveBeenCalledWith('g-1', undefined);
    expect(res.entries).toEqual([glossaryEntry]);
    expect(res.limit).toBe(100);
    expect(res.truncated).toBe(false);
  });

  it('truncates glossary entry list when over limit', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...glossaryEntry,
      id: `e-${i}`,
      source: `term-${i}`,
    }));
    glossaryStore.loadEntries.mockImplementationOnce(async (glossaryId: string) => {
      glossaryStore.entriesByGlossary[glossaryId] = many;
    });

    const res = await callBridge('oddeyes.listGlossaryEntries', {
      glossaryId: 'g-1',
      limit: 2,
    }) as Record<string, unknown>;

    expect(res.total).toBe(5);
    expect((res.entries as unknown[]).length).toBe(2);
    expect(res.truncated).toBe(true);
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

  it('updates a glossary entry', async () => {
    const res = await callBridge('oddeyes.updateGlossaryEntry', {
      glossaryId: 'g-1',
      entryId: 'e-1',
      source: 'Care Package',
      target: '보급품 상자',
    }) as Record<string, unknown>;

    expect(res.ok).toBe(true);
    expect(glossaryStore.updateEntry).toHaveBeenCalledWith(expect.objectContaining({
      glossaryId: 'g-1',
      entryId: 'e-1',
      source: 'Care Package',
      target: '보급품 상자',
    }));
    expect((res.entry as { target: string }).target).toBe('보급품 상자');
  });

  it('deletes a glossary entry', async () => {
    const res = await callBridge('oddeyes.deleteGlossaryEntry', {
      glossaryId: 'g-1',
      entryId: 'e-1',
    }) as Record<string, unknown>;

    expect(res.ok).toBe(true);
    expect(glossaryStore.deleteEntry).toHaveBeenCalledWith('g-1', 'e-1');
    expect(res.entryId).toBe('e-1');
  });

  it('rejects update without entryId', async () => {
    await expect(callBridge('oddeyes.updateGlossaryEntry', {
      glossaryId: 'g-1',
      source: 'A',
      target: 'B',
    })).rejects.toThrow('entryId is required');
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

  it('links a glossary to the project incrementally', async () => {
    glossaryStore.glossaries = [
      ...glossaryStore.glossaries,
      {
        id: 'g-2',
        name: 'Extra',
        description: null,
        entryCount: 0,
        createdAt: 3,
        updatedAt: 3,
      },
    ];
    glossaryStore.saveProjectSelection.mockImplementation(async (_projectId: string, ids: string[]) => {
      glossaryStore.projectGlossaries = ids.map((id: string, priority: number) => {
        const base = glossaryStore.glossaries.find((item) => item.id === id)!;
        return { ...base, priority };
      });
    });

    const res = await callBridge('oddeyes.linkProjectGlossary', {
      glossaryId: 'g-2',
    }) as Record<string, unknown>;

    expect(res.ok).toBe(true);
    expect(res.alreadyLinked).toBe(false);
    expect(glossaryStore.saveProjectSelection).toHaveBeenCalledWith('test-project', ['g-1', 'g-2']);
  });

  it('unlink is idempotent when already unlinked', async () => {
    glossaryStore.glossaries = [
      ...glossaryStore.glossaries,
      {
        id: 'g-2',
        name: 'Extra',
        description: null,
        entryCount: 0,
        createdAt: 3,
        updatedAt: 3,
      },
    ];

    const res = await callBridge('oddeyes.unlinkProjectGlossary', {
      glossaryId: 'g-2',
    }) as Record<string, unknown>;

    expect(res.ok).toBe(true);
    expect(res.alreadyUnlinked).toBe(true);
    expect(glossaryStore.saveProjectSelection).not.toHaveBeenCalled();
  });

  it('unlinks a linked glossary without deleting it', async () => {
    glossaryStore.saveProjectSelection.mockImplementation(async () => {
      glossaryStore.projectGlossaries = [];
    });

    const res = await callBridge('oddeyes.unlinkProjectGlossary', {
      glossaryId: 'g-1',
    }) as Record<string, unknown>;

    expect(res.ok).toBe(true);
    expect(res.alreadyUnlinked).toBe(false);
    expect(glossaryStore.saveProjectSelection).toHaveBeenCalledWith('test-project', []);
  });
});

describe('oddeyesAppBridge — project memory', () => {
  beforeEach(() => {
    initializeOddEyesAppBridge();
    memoryStore.activeProjectId = 'test-project';
    memoryStore.loading = false;
    memoryStore.items = [memoryItem, proposedMemoryItem];
    memoryStore.forbiddenTerms = [forbiddenTerm];
    memoryStore.hydrate.mockClear();
    memoryStore.addItem.mockClear();
    memoryStore.replaceItem.mockClear();
    memoryStore.deleteItem.mockClear();
    memoryStore.saveForbiddenTerm.mockClear();
    memoryStore.removeForbiddenTerm.mockClear();
  });

  it('기본 조회는 active만 반환하고 금칙어를 함께 준다', async () => {
    const res = await callBridge('oddeyes.listProjectMemory') as Record<string, unknown>;
    expect(res.total).toBe(1);
    expect(res.items).toEqual([expect.objectContaining({ id: 'm-1' })]);
    expect(res.forbiddenTerms).toEqual([expect.objectContaining({ id: 'f-1' })]);
    expect(res.revision).toBe(7);
  });

  it("status='all'은 승인 전 항목까지 포함", async () => {
    const res = await callBridge('oddeyes.listProjectMemory', { status: 'all' }) as Record<string, unknown>;
    expect(res.total).toBe(2);
  });

  it('query는 content 부분일치로 거른다', async () => {
    const res = await callBridge('oddeyes.listProjectMemory', {
      status: 'all', query: '오래된',
    }) as Record<string, unknown>;
    expect(res.items).toEqual([expect.objectContaining({ id: 'm-2' })]);
  });

  it('다른 프로젝트가 로드돼 있으면 hydrate 후 조회', async () => {
    memoryStore.activeProjectId = 'other-project';
    await callBridge('oddeyes.listProjectMemory');
    expect(memoryStore.hydrate).toHaveBeenCalledWith('test-project');
  });

  it('추가는 source=import / status=active로 즉시 반영된다', async () => {
    const res = await callBridge('oddeyes.addProjectMemoryItem', {
      category: 'audience', content: '  대상 독자는 신규 유입 플레이어  ',
    }) as Record<string, unknown>;
    expect(memoryStore.addItem).toHaveBeenCalledWith({
      category: 'audience',
      content: '대상 독자는 신규 유입 플레이어',
      source: 'import',
      status: 'active',
    });
    expect(res.item).toEqual(expect.objectContaining({ source: 'import' }));
    expect(res.duplicate).toBe(false);
  });

  it('알 수 없는 category는 거부', async () => {
    await expect(callBridge('oddeyes.addProjectMemoryItem', {
      category: 'nonsense', content: 'x',
    })).rejects.toThrow('Unknown category');
  });

  it('빈 content는 거부', async () => {
    await expect(callBridge('oddeyes.addProjectMemoryItem', { content: '   ' }))
      .rejects.toThrow('content is required');
  });

  it('replace는 기존 category를 물려받는다', async () => {
    await callBridge('oddeyes.replaceProjectMemoryItem', {
      targetItemId: 'm-1', content: '수정된 사실',
    });
    expect(memoryStore.replaceItem).toHaveBeenCalledWith('m-1', expect.objectContaining({
      category: 'domain', content: '수정된 사실', source: 'import',
    }));
  });

  it('없는 항목의 replace/delete는 거부', async () => {
    await expect(callBridge('oddeyes.replaceProjectMemoryItem', {
      targetItemId: 'ghost', content: 'x',
    })).rejects.toThrow('Unknown memory item: ghost');
    await expect(callBridge('oddeyes.deleteProjectMemoryItem', { itemId: 'ghost' }))
      .rejects.toThrow('Unknown memory item: ghost');
    expect(memoryStore.replaceItem).not.toHaveBeenCalled();
    expect(memoryStore.deleteItem).not.toHaveBeenCalled();
  });

  it('삭제는 항목을 완전히 제거한다', async () => {
    const res = await callBridge('oddeyes.deleteProjectMemoryItem', {
      itemId: 'm-1',
    }) as Record<string, unknown>;
    expect(memoryStore.deleteItem).toHaveBeenCalledWith('m-1');
    expect(res).toMatchObject({ ok: true, itemId: 'm-1', revision: 7 });
  });

  it('금칙어 신규 생성은 enabled 기본 true', async () => {
    const res = await callBridge('oddeyes.upsertForbiddenTerm', {
      term: '어그로', replacement: '도발',
    }) as Record<string, unknown>;
    expect(memoryStore.saveForbiddenTerm).toHaveBeenCalledWith({
      term: '어그로', replacement: '도발', enabled: true,
    });
    expect(res.revision).toBe(11);
  });

  it('금칙어 갱신은 id 검증 후 통과', async () => {
    await callBridge('oddeyes.upsertForbiddenTerm', {
      id: 'f-1', term: '유저', enabled: false,
    });
    expect(memoryStore.saveForbiddenTerm).toHaveBeenCalledWith({
      id: 'f-1', term: '유저', enabled: false,
    });
  });

  it('없는 금칙어 id는 갱신/삭제 모두 거부', async () => {
    await expect(callBridge('oddeyes.upsertForbiddenTerm', { id: 'ghost', term: 'x' }))
      .rejects.toThrow('Unknown forbidden term: ghost');
    await expect(callBridge('oddeyes.deleteForbiddenTerm', { id: 'ghost' }))
      .rejects.toThrow('Unknown forbidden term: ghost');
    expect(memoryStore.saveForbiddenTerm).not.toHaveBeenCalled();
    expect(memoryStore.removeForbiddenTerm).not.toHaveBeenCalled();
  });

  it('projectId 불일치 시 모든 메모리 도구가 거부', async () => {
    for (const method of [
      'oddeyes.listProjectMemory',
      'oddeyes.addProjectMemoryItem',
      'oddeyes.replaceProjectMemoryItem',
      'oddeyes.deleteProjectMemoryItem',
      'oddeyes.upsertForbiddenTerm',
      'oddeyes.deleteForbiddenTerm',
    ]) {
      await expect(callBridge(method, { projectId: 'other' }))
        .rejects.toThrow('Project mismatch');
    }
  });
});

describe('oddeyesAppBridge — getStatus 프로젝트 지식', () => {
  beforeEach(() => {
    initializeOddEyesAppBridge();
    memoryStore.activeProjectId = 'test-project';
    memoryStore.items = [memoryItem, proposedMemoryItem];
    memoryStore.forbiddenTerms = [forbiddenTerm];
  });

  it('로드된 프로젝트는 revision/카운트를 보고한다', async () => {
    const res = await callBridge('oddeyes.getStatus') as Record<string, unknown>;
    expect(res.projectMemoryRevision).toBe(7);
    expect(res.projectMemoryActiveCount).toBe(1);
    expect(res.forbiddenTermEnabledCount).toBe(1);
  });

  it('아직 로드 전이면 0이 아니라 null (오독 방지)', async () => {
    memoryStore.activeProjectId = null;
    const res = await callBridge('oddeyes.getStatus') as Record<string, unknown>;
    expect(res.projectMemoryRevision).toBeNull();
    expect(res.projectMemoryActiveCount).toBeNull();
    expect(res.forbiddenTermEnabledCount).toBeNull();
  });
});
