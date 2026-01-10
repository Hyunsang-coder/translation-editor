import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EditorUIState, Toast } from '@/types';

// ============================================
// Store State Interface
// ============================================

interface UIState extends EditorUIState {
  theme: 'light' | 'dark' | 'system';
  language: 'ko' | 'en';
  toasts: Toast[];
  reviewPanelOpen: boolean; // Review 탭 활성화 요청
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

  // Language
  setLanguage: (language: 'ko' | 'en') => void;

  // Panel Layout
  isPanelsSwapped: boolean;
  togglePanelSwap: () => void;
  setPanelsSwapped: (swapped: boolean) => void;

  // Toasts
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;

  // Review Panel
  openReviewPanel: () => void;
  closeReviewPanel: () => void;
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
      language: 'ko',
      isPanelsSwapped: false,
      toasts: [],
      reviewPanelOpen: false,

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

      // Language
      setLanguage: (language: 'ko' | 'en'): void => {
        set({ language });
      },

      // Panel Layout
      togglePanelSwap: (): void => {
        set((state) => ({ isPanelsSwapped: !state.isPanelsSwapped }));
      },

      setPanelsSwapped: (swapped: boolean): void => {
        set({ isPanelsSwapped: swapped });
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

      // Review Panel
      openReviewPanel: (): void => {
        // 사이드바가 닫혀있으면 열기
        const { sidebarCollapsed } = get();
        if (sidebarCollapsed) {
          set({ sidebarCollapsed: false });
        }
        set({ reviewPanelOpen: true });
      },

      closeReviewPanel: (): void => {
        set({ reviewPanelOpen: false });
      },
    }),
    {
      name: 'ite-ui-storage',
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        focusMode: state.focusMode,
        sidebarCollapsed: state.sidebarCollapsed,
        projectSidebarCollapsed: state.projectSidebarCollapsed,
        isPanelsSwapped: state.isPanelsSwapped,
      }),
    }
  )
);

