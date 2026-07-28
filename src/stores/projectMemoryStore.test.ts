import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addProjectMemoryItem,
  deleteProjectMemoryItem,
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
  deleteProjectMemoryItem: vi.fn(),
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

  it('replace updates the item in place without adding a row', async () => {
    const updated = {
      ...memoryItem,
      content: 'Enterprise IT administrators',
      normalizedHash: 'hash-2',
      updatedAt: 2,
    };
    useProjectMemoryStore.setState({
      activeProjectId: 'project-1',
      items: [memoryItem],
      revision: 1,
    });
    vi.mocked(replaceProjectMemoryItem).mockResolvedValue({
      item: updated,
      revision: 2,
    });

    await useProjectMemoryStore.getState().replaceItem(memoryItem.id, {
      category: 'audience',
      content: updated.content,
      source: 'chat',
    });

    expect(useProjectMemoryStore.getState().items).toEqual([updated]);
    expect(useProjectMemoryStore.getState().revision).toBe(2);
  });

  it('upserts forbidden terms', async () => {
    useProjectMemoryStore.setState({
      activeProjectId: 'project-1',
      items: [memoryItem],
      revision: 1,
    });
    vi.mocked(upsertForbiddenTerm).mockResolvedValue({
      term: forbiddenTerm,
      revision: 3,
    });

    await useProjectMemoryStore.getState().saveForbiddenTerm({
      term: 'blacklist',
      replacement: 'denylist',
      enabled: true,
    });

    expect(useProjectMemoryStore.getState().forbiddenTerms).toEqual([forbiddenTerm]);
    expect(useProjectMemoryStore.getState().revision).toBe(3);
  });

  it('removes deleted memory from the list', async () => {
    useProjectMemoryStore.setState({
      activeProjectId: 'project-1',
      items: [memoryItem, { ...memoryItem, id: 'memory-2' }],
      revision: 1,
    });
    vi.mocked(deleteProjectMemoryItem).mockResolvedValue({ revision: 2 });

    await useProjectMemoryStore.getState().deleteItem(memoryItem.id);

    expect(deleteProjectMemoryItem).toHaveBeenCalledWith({
      projectId: 'project-1',
      itemId: memoryItem.id,
    });
    expect(useProjectMemoryStore.getState().items.map((item) => item.id)).toEqual(['memory-2']);
    expect(useProjectMemoryStore.getState().revision).toBe(2);
    expect(useProjectMemoryStore.getState().saving).toBe(false);
  });
});
