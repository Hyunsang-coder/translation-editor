import { create } from 'zustand';
import {
  createGlossary as createGlossaryApi,
  createGlossaryEntry,
  deleteGlossary as deleteGlossaryApi,
  deleteGlossaryEntry,
  importGlossaryCsv,
  importGlossaryExcel,
  listGlossaries,
  listGlossaryEntries,
  listProjectGlossaries,
  setProjectGlossaries,
  updateGlossary as updateGlossaryApi,
  updateGlossaryEntry,
  type GlossaryEntryInput,
  type ImportGlossaryCsvResult,
} from '@/tauri/glossary';
import type { GlossaryEntry, GlossarySummary, ProjectGlossary } from '@/types';

interface GlossaryState {
  activeProjectId: string | null;
  glossaries: GlossarySummary[];
  projectGlossaries: ProjectGlossary[];
  entriesByGlossary: Record<string, GlossaryEntry[]>;
  selectedGlossaryId: string | null;
  loading: boolean;
  entriesLoading: boolean;
  saving: boolean;
  error: string | null;
}

interface GlossaryActions {
  reset: () => void;
  selectGlossary: (glossaryId: string | null) => void;
  loadLibrary: (projectId: string) => Promise<void>;
  loadEntries: (glossaryId: string, query?: string) => Promise<void>;
  createGlossary: (name: string, description?: string | null) => Promise<GlossarySummary>;
  renameGlossary: (
    glossaryId: string,
    name: string,
    description?: string | null,
  ) => Promise<GlossarySummary>;
  removeGlossary: (glossaryId: string) => Promise<void>;
  saveProjectSelection: (projectId: string, glossaryIds: string[]) => Promise<void>;
  createEntry: (input: GlossaryEntryInput) => Promise<GlossaryEntry>;
  importFile: (params: {
    glossaryId: string;
    path: string;
    format: 'csv' | 'excel';
    replaceEntries?: boolean;
  }) => Promise<ImportGlossaryCsvResult>;
  updateEntry: (
    input: Omit<GlossaryEntryInput, 'glossaryId'> & { glossaryId: string; entryId: string },
  ) => Promise<GlossaryEntry>;
  deleteEntry: (glossaryId: string, entryId: string) => Promise<void>;
}

const initialState: GlossaryState = {
  activeProjectId: null,
  glossaries: [],
  projectGlossaries: [],
  entriesByGlossary: {},
  selectedGlossaryId: null,
  loading: false,
  entriesLoading: false,
  saving: false,
  error: null,
};

let libraryRequestSequence = 0;
let entriesRequestSequence = 0;
let selectionRequestSequence = 0;
let activeSelectionSaveRequestId: number | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function changeEntryCount<T extends GlossarySummary>(
  items: T[],
  glossaryId: string,
  delta: number,
): T[] {
  return items.map((item) => (
    item.id === glossaryId
      ? { ...item, entryCount: Math.max(0, item.entryCount + delta), updatedAt: Date.now() }
      : item
  ));
}

export const useGlossaryStore = create<GlossaryState & GlossaryActions>((set, get) => ({
  ...initialState,

  reset: () => {
    libraryRequestSequence += 1;
    entriesRequestSequence += 1;
    selectionRequestSequence += 1;
    activeSelectionSaveRequestId = null;
    set({ ...initialState });
  },

  selectGlossary: (glossaryId) => {
    set({ selectedGlossaryId: glossaryId });
  },

  loadLibrary: async (projectId) => {
    const requestId = ++libraryRequestSequence;
    selectionRequestSequence += 1;
    set((state) => ({
      activeProjectId: projectId,
      projectGlossaries:
        state.activeProjectId === projectId ? state.projectGlossaries : [],
      loading: true,
      error: null,
    }));
    try {
      const [glossaries, projectGlossaries] = await Promise.all([
        listGlossaries(),
        listProjectGlossaries(projectId),
      ]);
      if (requestId !== libraryRequestSequence || get().activeProjectId !== projectId) return;
      const currentSelection = get().selectedGlossaryId;
      const selectedGlossaryId =
        (currentSelection && glossaries.some((item) => item.id === currentSelection)
          ? currentSelection
          : projectGlossaries[0]?.id ?? glossaries[0]?.id) ?? null;
      set({
        glossaries,
        projectGlossaries,
        selectedGlossaryId,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (requestId !== libraryRequestSequence || get().activeProjectId !== projectId) return;
      set({ loading: false, error: errorMessage(error) });
      throw error;
    }
  },

  loadEntries: async (glossaryId, query) => {
    const requestId = ++entriesRequestSequence;
    set({ entriesLoading: true, error: null });
    try {
      const entries = await listGlossaryEntries(
        query === undefined ? { glossaryId } : { glossaryId, query },
      );
      if (requestId !== entriesRequestSequence) return;
      set((state) => ({
        entriesByGlossary: {
          ...state.entriesByGlossary,
          [glossaryId]: entries,
        },
        entriesLoading: false,
      }));
    } catch (error) {
      if (requestId !== entriesRequestSequence) return;
      set({ entriesLoading: false, error: errorMessage(error) });
      throw error;
    }
  },

  createGlossary: async (name, description = null) => {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Glossary name is required.');
    set({ saving: true, error: null });
    try {
      const created = await createGlossaryApi({
        name: trimmedName,
        description: description?.trim() || null,
      });
      set((state) => ({
        glossaries: [...state.glossaries, created],
        selectedGlossaryId: created.id,
        entriesByGlossary: { ...state.entriesByGlossary, [created.id]: [] },
        saving: false,
      }));
      return created;
    } catch (error) {
      set({ saving: false, error: errorMessage(error) });
      throw error;
    }
  },

  renameGlossary: async (glossaryId, name, description = null) => {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Glossary name is required.');
    set({ saving: true, error: null });
    try {
      const updated = await updateGlossaryApi({
        glossaryId,
        name: trimmedName,
        description: description?.trim() || null,
      });
      set((state) => ({
        glossaries: state.glossaries.map((item) => item.id === glossaryId ? updated : item),
        projectGlossaries: state.projectGlossaries.map((item) => (
          item.id === glossaryId ? { ...updated, priority: item.priority } : item
        )),
        saving: false,
      }));
      return updated;
    } catch (error) {
      set({ saving: false, error: errorMessage(error) });
      throw error;
    }
  },

  removeGlossary: async (glossaryId) => {
    set({ saving: true, error: null });
    try {
      await deleteGlossaryApi(glossaryId);
      set((state) => {
        const glossaries = state.glossaries.filter((item) => item.id !== glossaryId);
        const entriesByGlossary = { ...state.entriesByGlossary };
        delete entriesByGlossary[glossaryId];
        return {
          glossaries,
          projectGlossaries: state.projectGlossaries.filter((item) => item.id !== glossaryId),
          entriesByGlossary,
          selectedGlossaryId:
            state.selectedGlossaryId === glossaryId
              ? glossaries[0]?.id ?? null
              : state.selectedGlossaryId,
          saving: false,
        };
      });
    } catch (error) {
      set({ saving: false, error: errorMessage(error) });
      throw error;
    }
  },

  saveProjectSelection: async (projectId, glossaryIds) => {
    const requestId = ++selectionRequestSequence;
    activeSelectionSaveRequestId = requestId;
    set({ saving: true, error: null });
    try {
      const projectGlossaries = await setProjectGlossaries({ projectId, glossaryIds });
      if (
        requestId !== selectionRequestSequence
        || get().activeProjectId !== projectId
      ) {
        if (activeSelectionSaveRequestId === requestId) {
          activeSelectionSaveRequestId = null;
          set({ saving: false });
        }
        return;
      }
      activeSelectionSaveRequestId = null;
      set({ projectGlossaries, saving: false });
    } catch (error) {
      if (
        requestId !== selectionRequestSequence
        || get().activeProjectId !== projectId
      ) {
        if (activeSelectionSaveRequestId === requestId) {
          activeSelectionSaveRequestId = null;
          set({ saving: false });
        }
        return;
      }
      activeSelectionSaveRequestId = null;
      set({ saving: false, error: errorMessage(error) });
      throw error;
    }
  },

  createEntry: async (input) => {
    entriesRequestSequence += 1;
    set({ entriesLoading: false, saving: true, error: null });
    try {
      const created = await createGlossaryEntry({
        ...input,
        source: input.source.trim(),
        target: input.target.trim(),
        notes: input.notes?.trim() || null,
      });
      const state = get();
      const wasLinked = state.projectGlossaries.some((item) => item.id === input.glossaryId);
      let projectGlossaries = state.projectGlossaries;
      // 미연결 용어집에 용어를 추가하면 현재 프로젝트에 자동 연결 (검색에 안 잡히는 orphan 방지)
      if (state.activeProjectId && !wasLinked) {
        projectGlossaries = await setProjectGlossaries({
          projectId: state.activeProjectId,
          glossaryIds: [...projectGlossaries.map((item) => item.id), input.glossaryId],
        });
        // setProjectGlossaries COUNT는 create 이후라 새 엔트리가 이미 포함됨
      } else {
        projectGlossaries = changeEntryCount(projectGlossaries, input.glossaryId, 1);
      }
      set({
        entriesByGlossary: {
          ...state.entriesByGlossary,
          [input.glossaryId]: [
            ...(state.entriesByGlossary[input.glossaryId] ?? []),
            created,
          ],
        },
        glossaries: changeEntryCount(state.glossaries, input.glossaryId, 1),
        projectGlossaries,
        saving: false,
      });
      return created;
    } catch (error) {
      set({ saving: false, error: errorMessage(error) });
      throw error;
    }
  },

  importFile: async ({ glossaryId, path, format, replaceEntries = false }) => {
    set({ saving: true, error: null });
    try {
      const result = format === 'excel'
        ? await importGlossaryExcel({ glossaryId, path, replaceEntries })
        : await importGlossaryCsv({ glossaryId, path, replaceEntries });
      const [glossaries, entries] = await Promise.all([
        listGlossaries(),
        listGlossaryEntries({ glossaryId }),
      ]);
      set((state) => ({
        glossaries,
        projectGlossaries: state.projectGlossaries.map((item) => {
          const updated = glossaries.find((glossary) => glossary.id === item.id);
          return updated ? { ...updated, priority: item.priority } : item;
        }),
        entriesByGlossary: {
          ...state.entriesByGlossary,
          [glossaryId]: entries,
        },
        saving: false,
      }));
      return result;
    } catch (error) {
      set({ saving: false, error: errorMessage(error) });
      throw error;
    }
  },

  updateEntry: async ({ glossaryId, ...input }) => {
    entriesRequestSequence += 1;
    set({ entriesLoading: false, saving: true, error: null });
    try {
      const updated = await updateGlossaryEntry({
        ...input,
        source: input.source.trim(),
        target: input.target.trim(),
        notes: input.notes?.trim() || null,
      });
      set((state) => ({
        entriesByGlossary: {
          ...state.entriesByGlossary,
          [glossaryId]: (state.entriesByGlossary[glossaryId] ?? []).map((item) => (
            item.id === updated.id ? updated : item
          )),
        },
        saving: false,
      }));
      return updated;
    } catch (error) {
      set({ saving: false, error: errorMessage(error) });
      throw error;
    }
  },

  deleteEntry: async (glossaryId, entryId) => {
    entriesRequestSequence += 1;
    set({ entriesLoading: false, saving: true, error: null });
    try {
      await deleteGlossaryEntry(entryId);
      set((state) => ({
        entriesByGlossary: {
          ...state.entriesByGlossary,
          [glossaryId]: (state.entriesByGlossary[glossaryId] ?? []).filter(
            (item) => item.id !== entryId,
          ),
        },
        glossaries: changeEntryCount(state.glossaries, glossaryId, -1),
        projectGlossaries: changeEntryCount(state.projectGlossaries, glossaryId, -1),
        saving: false,
      }));
    } catch (error) {
      set({ saving: false, error: errorMessage(error) });
      throw error;
    }
  },
}));
