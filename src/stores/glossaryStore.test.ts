import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGlossary,
  createGlossaryEntry,
  deleteGlossaryEntry,
  importGlossaryCsv,
  listGlossaries,
  listGlossaryEntries,
  listProjectGlossaries,
  setProjectGlossaries,
} from '@/tauri/glossary';
import { useGlossaryStore } from './glossaryStore';

vi.mock('@/tauri/glossary', () => ({
  createGlossary: vi.fn(),
  updateGlossary: vi.fn(),
  deleteGlossary: vi.fn(),
  listGlossaries: vi.fn(),
  listGlossaryEntries: vi.fn(),
  createGlossaryEntry: vi.fn(),
  updateGlossaryEntry: vi.fn(),
  deleteGlossaryEntry: vi.fn(),
  listProjectGlossaries: vi.fn(),
  setProjectGlossaries: vi.fn(),
  importGlossaryCsv: vi.fn(),
  importGlossaryExcel: vi.fn(),
}));

const glossary = {
  id: 'g-1',
  name: 'PUBG 공통',
  description: null,
  entryCount: 1,
  createdAt: 1,
  updatedAt: 1,
};

const entry = {
  id: 'e-1',
  glossaryId: 'g-1',
  source: 'Care Package',
  target: '보급 상자',
  notes: null,
  domain: null,
  caseSensitive: false,
  createdAt: 1,
  updatedAt: 1,
};

function resetStore(): void {
  useGlossaryStore.getState().reset();
  vi.clearAllMocks();
}

describe('glossaryStore', () => {
  beforeEach(resetStore);

  it('loads the library and current project links together', async () => {
    vi.mocked(listGlossaries).mockResolvedValue([glossary]);
    vi.mocked(listProjectGlossaries).mockResolvedValue([{ ...glossary, priority: 0 }]);

    await useGlossaryStore.getState().loadLibrary('project-1');

    const state = useGlossaryStore.getState();
    expect(state.glossaries).toEqual([glossary]);
    expect(state.projectGlossaries).toEqual([{ ...glossary, priority: 0 }]);
    expect(state.selectedGlossaryId).toBe('g-1');
    expect(state.error).toBeNull();
  });

  it('ignores a stale project load that resolves after a newer one', async () => {
    let resolveFirst!: (value: typeof glossary[]) => void;
    vi.mocked(listGlossaries)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce([{ ...glossary, id: 'g-2', name: 'Warfare' }]);
    vi.mocked(listProjectGlossaries)
      .mockResolvedValueOnce([{ ...glossary, priority: 0 }])
      .mockResolvedValueOnce([{ ...glossary, id: 'g-2', name: 'Warfare', priority: 0 }]);

    const first = useGlossaryStore.getState().loadLibrary('project-1');
    await useGlossaryStore.getState().loadLibrary('project-2');
    resolveFirst([glossary]);
    await first;

    expect(useGlossaryStore.getState().glossaries[0]?.id).toBe('g-2');
  });

  it('keeps current project links visible during a same-project refresh', async () => {
    vi.mocked(listGlossaries).mockResolvedValueOnce([glossary]);
    vi.mocked(listProjectGlossaries).mockResolvedValueOnce([{ ...glossary, priority: 0 }]);
    await useGlossaryStore.getState().loadLibrary('project-1');

    let resolveGlossaries!: (value: typeof glossary[]) => void;
    let resolveLinks!: (value: Array<typeof glossary & { priority: number }>) => void;
    vi.mocked(listGlossaries).mockImplementationOnce(
      () => new Promise((resolve) => { resolveGlossaries = resolve; }),
    );
    vi.mocked(listProjectGlossaries).mockImplementationOnce(
      () => new Promise((resolve) => { resolveLinks = resolve; }),
    );

    const refresh = useGlossaryStore.getState().loadLibrary('project-1');
    expect(useGlossaryStore.getState().projectGlossaries[0]?.id).toBe('g-1');
    expect(useGlossaryStore.getState().loading).toBe(true);

    resolveGlossaries([glossary]);
    resolveLinks([{ ...glossary, priority: 0 }]);
    await refresh;
  });

  it('creates a glossary and selects it', async () => {
    vi.mocked(createGlossary).mockResolvedValue(glossary);

    const created = await useGlossaryStore.getState().createGlossary('  PUBG 공통  ');

    expect(createGlossary).toHaveBeenCalledWith({ name: 'PUBG 공통', description: null });
    expect(created).toEqual(glossary);
    expect(useGlossaryStore.getState().selectedGlossaryId).toBe('g-1');
  });

  it('updates ordered project links after saving selection', async () => {
    useGlossaryStore.setState({ activeProjectId: 'project-1' });
    vi.mocked(setProjectGlossaries).mockResolvedValue([
      { ...glossary, id: 'g-2', name: 'Warfare', priority: 0 },
      { ...glossary, priority: 1 },
    ]);

    await useGlossaryStore.getState().saveProjectSelection('project-1', ['g-2', 'g-1']);

    expect(setProjectGlossaries).toHaveBeenCalledWith({
      projectId: 'project-1',
      glossaryIds: ['g-2', 'g-1'],
    });
    expect(useGlossaryStore.getState().projectGlossaries.map((item) => item.id)).toEqual(['g-2', 'g-1']);
  });

  it('does not apply a project link save after switching projects', async () => {
    let resolveSave!: (value: Array<typeof glossary & { priority: number }>) => void;
    useGlossaryStore.setState({ activeProjectId: 'project-1' });
    vi.mocked(setProjectGlossaries).mockImplementationOnce(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );
    const pendingSave = useGlossaryStore.getState().saveProjectSelection('project-1', ['g-1']);

    vi.mocked(listGlossaries).mockResolvedValue([{ ...glossary, id: 'g-2', name: 'Warfare' }]);
    vi.mocked(listProjectGlossaries).mockResolvedValue([
      { ...glossary, id: 'g-2', name: 'Warfare', priority: 0 },
    ]);
    await useGlossaryStore.getState().loadLibrary('project-2');
    resolveSave([{ ...glossary, priority: 0 }]);
    await pendingSave;

    expect(useGlossaryStore.getState().projectGlossaries[0]?.id).toBe('g-2');
  });

  it('keeps the saving guard while a newer project-link save is pending', async () => {
    let resolveFirst!: (value: Array<typeof glossary & { priority: number }>) => void;
    let resolveSecond!: (value: Array<typeof glossary & { priority: number }>) => void;
    useGlossaryStore.setState({ activeProjectId: 'project-1' });
    vi.mocked(setProjectGlossaries)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const first = useGlossaryStore.getState().saveProjectSelection('project-1', ['g-1']);
    const second = useGlossaryStore.getState().saveProjectSelection('project-1', ['g-2']);
    resolveFirst([{ ...glossary, priority: 0 }]);
    await first;
    expect(useGlossaryStore.getState().saving).toBe(true);

    resolveSecond([{ ...glossary, id: 'g-2', name: 'Warfare', priority: 0 }]);
    await second;
    expect(useGlossaryStore.getState().saving).toBe(false);
    expect(useGlossaryStore.getState().projectGlossaries[0]?.id).toBe('g-2');
  });

  it('loads and mutates entries without a full library reload', async () => {
    useGlossaryStore.setState({ glossaries: [glossary] });
    vi.mocked(listGlossaryEntries).mockResolvedValue([entry]);
    vi.mocked(createGlossaryEntry).mockResolvedValue({ ...entry, id: 'e-2', source: 'Blue Zone' });
    vi.mocked(deleteGlossaryEntry).mockResolvedValue(undefined);

    await useGlossaryStore.getState().loadEntries('g-1');
    await useGlossaryStore.getState().createEntry({
      glossaryId: 'g-1',
      source: 'Blue Zone',
      target: '블루존',
      notes: null,
      domain: null,
      caseSensitive: false,
    });
    await useGlossaryStore.getState().deleteEntry('g-1', 'e-1');

    expect(useGlossaryStore.getState().entriesByGlossary['g-1']?.map((item) => item.id)).toEqual(['e-2']);
    expect(useGlossaryStore.getState().glossaries[0]?.entryCount).toBe(1);
  });

  it('auto-links the glossary to the active project when adding a term to an unlinked glossary', async () => {
    useGlossaryStore.setState({
      activeProjectId: 'project-1',
      glossaries: [{ ...glossary, entryCount: 0 }],
      projectGlossaries: [],
    });
    vi.mocked(createGlossaryEntry).mockResolvedValue(entry);
    vi.mocked(setProjectGlossaries).mockResolvedValue([{ ...glossary, priority: 0 }]);

    await useGlossaryStore.getState().createEntry({
      glossaryId: 'g-1',
      source: 'Care Package',
      target: '보급 상자',
      notes: null,
      domain: null,
      caseSensitive: false,
    });

    expect(setProjectGlossaries).toHaveBeenCalledWith({
      projectId: 'project-1',
      glossaryIds: ['g-1'],
    });
    expect(useGlossaryStore.getState().projectGlossaries[0]?.id).toBe('g-1');
    expect(useGlossaryStore.getState().glossaries[0]?.entryCount).toBe(1);
  });

  it('does not re-link when adding a term to an already linked glossary', async () => {
    useGlossaryStore.setState({
      activeProjectId: 'project-1',
      glossaries: [glossary],
      projectGlossaries: [{ ...glossary, priority: 0 }],
    });
    vi.mocked(createGlossaryEntry).mockResolvedValue({ ...entry, id: 'e-2', source: 'Blue Zone' });

    await useGlossaryStore.getState().createEntry({
      glossaryId: 'g-1',
      source: 'Blue Zone',
      target: '블루존',
      notes: null,
      domain: null,
      caseSensitive: false,
    });

    expect(setProjectGlossaries).not.toHaveBeenCalled();
    expect(useGlossaryStore.getState().projectGlossaries[0]?.entryCount).toBe(2);
  });

  it('imports a CSV file into the selected glossary and refreshes entries', async () => {
    useGlossaryStore.setState({
      glossaries: [glossary],
      projectGlossaries: [{ ...glossary, priority: 0 }],
      selectedGlossaryId: 'g-1',
    });
    vi.mocked(importGlossaryCsv).mockResolvedValue({
      inserted: 3,
      updated: 0,
      skipped: 1,
      warnings: ['row 4 skipped'],
    });
    vi.mocked(listGlossaries).mockResolvedValue([{ ...glossary, entryCount: 4 }]);
    vi.mocked(listGlossaryEntries).mockResolvedValue([entry]);

    const result = await useGlossaryStore.getState().importFile({
      glossaryId: 'g-1',
      path: '/tmp/terms.csv',
      format: 'csv',
    });

    expect(importGlossaryCsv).toHaveBeenCalledWith({
      glossaryId: 'g-1',
      path: '/tmp/terms.csv',
      replaceEntries: false,
    });
    expect(result.inserted).toBe(3);
    expect(useGlossaryStore.getState().glossaries[0]?.entryCount).toBe(4);
    expect(useGlossaryStore.getState().entriesByGlossary['g-1']).toEqual([entry]);
    expect(useGlossaryStore.getState().saving).toBe(false);
  });

  it('does not let a stale entry load overwrite a newly created term', async () => {
    let resolveEntries!: (value: typeof entry[]) => void;
    useGlossaryStore.setState({
      glossaries: [glossary],
      selectedGlossaryId: 'g-1',
    });
    vi.mocked(listGlossaryEntries).mockImplementationOnce(
      () => new Promise((resolve) => { resolveEntries = resolve; }),
    );
    vi.mocked(createGlossaryEntry).mockResolvedValue({
      ...entry,
      id: 'e-2',
      source: 'Blue Zone',
      target: '블루존',
    });

    const pendingLoad = useGlossaryStore.getState().loadEntries('g-1');
    await useGlossaryStore.getState().createEntry({
      glossaryId: 'g-1',
      source: 'Blue Zone',
      target: '블루존',
      notes: null,
      domain: null,
      caseSensitive: false,
    });
    resolveEntries([entry]);
    await pendingLoad;

    expect(useGlossaryStore.getState().entriesByGlossary['g-1']?.map((item) => item.id)).toEqual(['e-2']);
    expect(useGlossaryStore.getState().entriesLoading).toBe(false);
  });
});
