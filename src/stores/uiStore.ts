import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EditorUIState, Toast } from '@/types';

// ============================================
// Store State Interface
// ============================================

interface UIState extends EditorUIState {
  theme: 'light' | 'dark' | 'system';
  toasts: Toast[];
}

interface UIActions {
  // Focus Mode
  toggleFocusMode: () => void;
  setFocusMode: (focusMode: boolean) => void;

  // Panel
  setActivePanel: (panel: 'source' | 'target' | 'chat') => void;
  setSelectedBlockId: (blockId: string | null) => void;

  // Sidebar
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Project Sidebar
  toggleProjectSidebar: () => void;
  setProjectSidebarCollapsed: (collapsed: boolean) => void;

  // Diff
  setShowDiff: (showDiff: boolean) => void;

  // Theme
  setTheme: (theme: 'light' | 'dark' | 'system') => void;

  // Toasts
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

type UIStore = UIState & UIActions;

// ============================================
// Store Implementation
// ============================================

export const useUIStore = create<UIStore>()(
  persist(
    (set, get) => ({
      // Initial State
      focusMode: false,
      activePanel: 'target',
      selectedBlockId: null,
      showDiff: false,
      sidebarCollapsed: false,
      projectSidebarCollapsed: false,
      theme: 'system',
      toasts: [],

      // Focus Mode
      toggleFocusMode: (): void => {
        set((state) => ({ focusMode: !state.focusMode }));
      },

      setFocusMode: (focusMode: boolean): void => {
        set({ focusMode });
      },

      // Panel
      setActivePanel: (panel: 'source' | 'target' | 'chat'): void => {
        set({ activePanel: panel });
      },

      setSelectedBlockId: (blockId: string | null): void => {
        set({ selectedBlockId: blockId });
      },

      // Sidebar
      toggleSidebar: (): void => {
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
      },

      setSidebarCollapsed: (collapsed: boolean): void => {
        set({ sidebarCollapsed: collapsed });
      },

      // Project Sidebar
      toggleProjectSidebar: (): void => {
        set((state) => ({ projectSidebarCollapsed: !state.projectSidebarCollapsed }));
      },

      setProjectSidebarCollapsed: (collapsed: boolean): void => {
        set({ projectSidebarCollapsed: collapsed });
      },

      // Diff
      setShowDiff: (showDiff: boolean): void => {
        set({ showDiff });
      },

      // Theme
      setTheme: (theme: 'light' | 'dark' | 'system'): void => {
        set({ theme });
      },

      // Toasts
      addToast: (toast: Omit<Toast, 'id'>): void => {
        const id = crypto.randomUUID();
        const newToast: Toast = { ...toast, id };

        set((state) => ({
          toasts: [...state.toasts, newToast],
        }));

        // 자동 제거
        if (toast.duration !== 0) {
          setTimeout(() => {
            get().removeToast(id);
          }, toast.duration ?? 3000);
        }
      },

      removeToast: (id: string): void => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      },

      clearToasts: (): void => {
        set({ toasts: [] });
      },
    }),
    {
      name: 'ite-ui-storage',
      partialize: (state) => ({
        theme: state.theme,
        focusMode: state.focusMode,
        sidebarCollapsed: state.sidebarCollapsed,
        projectSidebarCollapsed: state.projectSidebarCollapsed,
      }),
    }
  )
);

