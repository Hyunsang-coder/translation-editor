import { create } from 'zustand';
import type {
  ForbiddenTerm,
  ProjectMemoryItem,
} from '@/types';
import {
  addProjectMemoryItem,
  archiveProjectMemoryItem,
  deleteForbiddenTerm,
  loadProjectMemory,
  migrateLegacyProjectMemory,
  replaceProjectMemoryItem,
  upsertForbiddenTerm,
  type ForbiddenTermInput,
  type ProjectMemoryItemInput,
} from '@/tauri/projectMemory';

interface ProjectMemoryState {
  activeProjectId: string | null;
  items: ProjectMemoryItem[];
  forbiddenTerms: ForbiddenTerm[];
  revision: number;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

interface ProjectMemoryActions {
  reset: () => void;
  hydrate: (projectId: string | null, legacyProjectContext?: string) => Promise<void>;
  addItem: (input: ProjectMemoryItemInput) => ReturnType<typeof addProjectMemoryItem>;
  replaceItem: (
    targetItemId: string,
    input: ProjectMemoryItemInput,
  ) => ReturnType<typeof replaceProjectMemoryItem>;
  archiveItem: (itemId: string) => ReturnType<typeof archiveProjectMemoryItem>;
  saveForbiddenTerm: (
    input: ForbiddenTermInput,
  ) => ReturnType<typeof upsertForbiddenTerm>;
  removeForbiddenTerm: (id: string) => Promise<void>;
}

const initialState: ProjectMemoryState = {
  activeProjectId: null,
  items: [],
  forbiddenTerms: [],
  revision: 0,
  loading: false,
  saving: false,
  error: null,
};

let hydrationSequence = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireProjectId(projectId: string | null): string {
  if (!projectId) throw new Error('Project memory requires an active project.');
  return projectId;
}

function replaceById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) return [...items, item];
  return items.map((candidate) => candidate.id === item.id ? item : candidate);
}

export const useProjectMemoryStore = create<ProjectMemoryState & ProjectMemoryActions>((set, get) => ({
  ...initialState,

  reset: () => {
    hydrationSequence += 1;
    set({ ...initialState });
  },

  hydrate: async (projectId, legacyProjectContext = '') => {
    const requestId = ++hydrationSequence;
    if (!projectId) {
      set({ ...initialState });
      return;
    }

    set((state) => ({
      activeProjectId: projectId,
      items: state.activeProjectId === projectId ? state.items : [],
      forbiddenTerms: state.activeProjectId === projectId ? state.forbiddenTerms : [],
      revision: state.activeProjectId === projectId ? state.revision : 0,
      loading: true,
      error: null,
    }));

    try {
      let snapshot = await loadProjectMemory(projectId);
      if (
        snapshot.items.length === 0
        && legacyProjectContext.trim().length > 0
      ) {
        const migrated = await migrateLegacyProjectMemory({
          projectId,
          content: legacyProjectContext.trim(),
        });
        if (migrated) snapshot = await loadProjectMemory(projectId);
      }

      if (
        requestId !== hydrationSequence
        || get().activeProjectId !== projectId
      ) return;

      set({
        items: snapshot.items,
        forbiddenTerms: snapshot.forbiddenTerms,
        revision: snapshot.revision,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (
        requestId !== hydrationSequence
        || get().activeProjectId !== projectId
      ) return;
      set({ loading: false, error: errorMessage(error) });
      throw error;
    }
  },

  addItem: async (input) => {
    const projectId = requireProjectId(get().activeProjectId);
    set({ saving: true, error: null });
    try {
      const result = await addProjectMemoryItem({ projectId, input });
      if (get().activeProjectId === projectId) {
        set((state) => ({
          items: replaceById(state.items, result.item),
          revision: result.revision,
          saving: false,
        }));
      }
      return result;
    } catch (error) {
      if (get().activeProjectId === projectId) {
        set({ saving: false, error: errorMessage(error) });
      }
      throw error;
    }
  },

  replaceItem: async (targetItemId, input) => {
    const projectId = requireProjectId(get().activeProjectId);
    set({ saving: true, error: null });
    try {
      const result = await replaceProjectMemoryItem({
        projectId,
        targetItemId,
        input,
      });
      if (get().activeProjectId === projectId) {
        set((state) => ({
          items: replaceById(
            replaceById(state.items, result.archived),
            result.item,
          ),
          revision: result.revision,
          saving: false,
        }));
      }
      return result;
    } catch (error) {
      if (get().activeProjectId === projectId) {
        set({ saving: false, error: errorMessage(error) });
      }
      throw error;
    }
  },

  archiveItem: async (itemId) => {
    const projectId = requireProjectId(get().activeProjectId);
    set({ saving: true, error: null });
    try {
      const result = await archiveProjectMemoryItem({ projectId, itemId });
      if (get().activeProjectId === projectId) {
        set((state) => ({
          items: replaceById(state.items, result.item),
          revision: result.revision,
          saving: false,
        }));
      }
      return result;
    } catch (error) {
      if (get().activeProjectId === projectId) {
        set({ saving: false, error: errorMessage(error) });
      }
      throw error;
    }
  },

  saveForbiddenTerm: async (input) => {
    const projectId = requireProjectId(get().activeProjectId);
    set({ saving: true, error: null });
    try {
      const result = await upsertForbiddenTerm({ projectId, input });
      if (get().activeProjectId === projectId) {
        set((state) => ({
          forbiddenTerms: replaceById(state.forbiddenTerms, result.term),
          revision: result.revision,
          saving: false,
        }));
      }
      return result;
    } catch (error) {
      if (get().activeProjectId === projectId) {
        set({ saving: false, error: errorMessage(error) });
      }
      throw error;
    }
  },

  removeForbiddenTerm: async (id) => {
    const projectId = requireProjectId(get().activeProjectId);
    set({ saving: true, error: null });
    try {
      const result = await deleteForbiddenTerm({ projectId, id });
      if (get().activeProjectId === projectId) {
        set((state) => ({
          forbiddenTerms: state.forbiddenTerms.filter((term) => term.id !== id),
          revision: result.revision,
          saving: false,
        }));
      }
    } catch (error) {
      if (get().activeProjectId === projectId) {
        set({ saving: false, error: errorMessage(error) });
      }
      throw error;
    }
  },
}));
