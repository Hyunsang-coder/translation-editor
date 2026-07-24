import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addProjectMemoryItem,
  archiveProjectMemoryItem,
  loadProjectMemory,
  migrateLegacyProjectMemory,
  replaceProjectMemoryItem,
  upsertForbiddenTerm,
} from '@/tauri/projectMemory';
import { useProjectMemoryStore } from './projectMemoryStore';

vi.mock('@/tauri/projectMemory', () => ({
  loadProjectMemory: vi.fn(),
  migrateLegacyProjectMemory: vi.fn(),
  addProjectMemoryItem: vi.fn(),
  replaceProjectMemoryItem: vi.fn(),
  archiveProjectMemoryItem: vi.fn(),
  upsertForbiddenTerm: vi.fn(),
  deleteForbiddenTerm: vi.fn(),
}));

const memoryItem = {
  id: 'memory-1',
  projectId: 'project-1',
  category: 'audience' as const,
  content: 'Enterprise administrators',
  normalizedHash: 'hash-1',
  status: 'active' as const,
  source: 'user' as const,
  createdAt: 1,
  updatedAt: 1,
};

const forbiddenTerm = {
  id: 'term-1',
  projectId: 'project-1',
  term: 'blacklist',
  replacement: 'denylist',
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

function emptySnapshot(projectId = 'project-1') {
  return {
    projectId,
    items: [],
    forbiddenTerms: [],
    revision: 0,
  };
}

describe('projectMemoryStore', () => {
  beforeEach(() => {
    useProjectMemoryStore.getState().reset();
    vi.clearAllMocks();
  });

  it('hydrates project memory and forbidden terms together', async () => {
    vi.mocked(loadProjectMemory).mockResolvedValue({
      ...emptySnapshot(),
      items: [memoryItem],
      forbiddenTerms: [forbiddenTerm],
      revision: 3,
    });

    await useProjectMemoryStore.getState().hydrate('project-1');

    const state = useProjectMemoryStore.getState();
    expect(state.items).toEqual([memoryItem]);
    expect(state.forbiddenTerms).toEqual([forbiddenTerm]);
    expect(state.revision).toBe(3);
  });

  it('ignores a stale hydration that resolves after a project switch', async () => {
    let resolveFirst!: (value: ReturnType<typeof emptySnapshot>) => void;
    vi.mocked(loadProjectMemory)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(emptySnapshot('project-2'));

    const first = useProjectMemoryStore.getState().hydrate('project-1');
    await useProjectMemoryStore.getState().hydrate('project-2');
    resolveFirst(emptySnapshot('project-1'));
    await first;

    expect(useProjectMemoryStore.getState().activeProjectId).toBe('project-2');
  });

  it('migrates legacy project context only when structured memory is empty', async () => {
    vi.mocked(loadProjectMemory)
      .mockResolvedValueOnce(emptySnapshot())
      .mockResolvedValueOnce({
        ...emptySnapshot(),
        items: [{ ...memoryItem, category: 'general', source: 'legacy' }],
        revision: 1,
      });
    vi.mocked(migrateLegacyProjectMemory).mockResolvedValue(true);

    await useProjectMemoryStore.getState().hydrate(
      'project-1',
      '  Existing project context  ',
    );

    expect(migrateLegacyProjectMemory).toHaveBeenCalledWith({
      projectId: 'project-1',
      content: 'Existing project context',
    });
    expect(useProjectMemoryStore.getState().items[0]?.source).toBe('legacy');
  });

  it('uses backend dedupe result without creating a second active row', async () => {
    useProjectMemoryStore.setState({
      activeProjectId: 'project-1',
      items: [memoryItem],
      revision: 1,
    });
    vi.mocked(addProjectMemoryItem).mockResolvedValue({
      item: memoryItem,
      revision: 1,
      duplicate: true,
    });

    const result = await useProjectMemoryStore.getState().addItem({
      category: 'audience',
      content: ' Enterprise administrators ',
      source: 'chat',
    });

    expect(result.duplicate).toBe(true);
    expect(useProjectMemoryStore.getState().items).toHaveLength(1);
  });

  it('replace archives the old item and links the replacement', async () => {
    const archived = { ...memoryItem, status: 'archived' as const, updatedAt: 2 };
    const replacement = {
      ...memoryItem,
      id: 'memory-2',
      content: 'Enterprise IT administrators',
      normalizedHash: 'hash-2',
      supersedesId: memoryItem.id,
      updatedAt: 2,
    };
    useProjectMemoryStore.setState({
      activeProjectId: 'project-1',
      items: [memoryItem],
      revision: 1,
    });
    vi.mocked(replaceProjectMemoryItem).mockResolvedValue({
      archived,
      item: replacement,
      revision: 2,
    });

    await useProjectMemoryStore.getState().replaceItem(memoryItem.id, {
      category: 'audience',
      content: replacement.content,
      source: 'chat',
    });

    expect(useProjectMemoryStore.getState().items).toEqual([archived, replacement]);
    expect(useProjectMemoryStore.getState().revision).toBe(2);
  });

  it('archives memory and upserts forbidden terms', async () => {
    useProjectMemoryStore.setState({
      activeProjectId: 'project-1',
      items: [memoryItem],
      revision: 1,
    });
    vi.mocked(archiveProjectMemoryItem).mockResolvedValue({
      item: { ...memoryItem, status: 'archived', updatedAt: 2 },
      revision: 2,
    });
    vi.mocked(upsertForbiddenTerm).mockResolvedValue({
      term: forbiddenTerm,
      revision: 3,
    });

    await useProjectMemoryStore.getState().archiveItem(memoryItem.id);
    await useProjectMemoryStore.getState().saveForbiddenTerm({
      term: 'blacklist',
      replacement: 'denylist',
      enabled: true,
    });

    expect(useProjectMemoryStore.getState().items[0]?.status).toBe('archived');
    expect(useProjectMemoryStore.getState().forbiddenTerms).toEqual([forbiddenTerm]);
    expect(useProjectMemoryStore.getState().revision).toBe(3);
  });
});
