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

  // Floating Chat Panel state
  sidebarActiveTab: 'settings' | 'review';
  chatPanelOpen: boolean;
  chatPanelPosition: { x: number; y: number };
  chatPanelSize: { width: number; height: number };

  // Settings sidebar width (resizable)
  settingsSidebarWidth: number;

  // Floating chat button position
  floatingButtonPosition: { x: number; y: number } | null; // null = 기본 위치 (우측 하단)

  // Editor typography settings (Source/Target 패널별 독립 설정)
  sourceFontSize: number; // px
  sourceLineHeight: number; // ratio
  targetFontSize: number; // px
  targetLineHeight: number; // ratio

  // Chat settings
  maxChatSessions: number; // 1-5, default 3
  chatLengthNotifyThreshold: number; // 10-50, default 20
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

  // Floating Chat Panel
  setSidebarActiveTab: (tab: 'settings' | 'review') => void;
  setChatPanelOpen: (open: boolean) => void;
  toggleChatPanel: () => void;
  setChatPanelPosition: (position: { x: number; y: number }) => void;
  setChatPanelSize: (size: { width: number; height: number }) => void;

  // Settings sidebar width
  setSettingsSidebarWidth: (width: number) => void;

  // Floating button position
  setFloatingButtonPosition: (position: { x: number; y: number } | null) => void;

  // Editor typography (Source/Target 패널별 독립 설정)
  setSourceFontSize: (size: number) => void;
  adjustSourceFontSize: (delta: number) => void;
  setSourceLineHeight: (height: number) => void;
  adjustSourceLineHeight: (delta: number) => void;
  setTargetFontSize: (size: number) => void;
  adjustTargetFontSize: (delta: number) => void;
  setTargetLineHeight: (height: number) => void;
  adjustTargetLineHeight: (delta: number) => void;

  // Chat settings
  setMaxChatSessions: (max: number) => void;
  setChatLengthNotifyThreshold: (threshold: number) => void;
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

      // Floating Chat Panel - 기본값
      sidebarActiveTab: 'settings',
      chatPanelOpen: false,
      chatPanelPosition: { x: 0, y: 100 }, // 실제 위치는 컴포넌트에서 계산
      chatPanelSize: { width: 420, height: 600 },

      // Settings sidebar width
      settingsSidebarWidth: 320,

      // Floating button position (null = 기본 우측 하단)
      floatingButtonPosition: null,

      // Editor typography defaults (Source/Target 패널별 독립 설정)
      sourceFontSize: 14,
      sourceLineHeight: 1.4,
      targetFontSize: 14,
      targetLineHeight: 1.4,

      // Chat settings defaults
      maxChatSessions: 3,
      chatLengthNotifyThreshold: 20,

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
        // 사이드바가 닫혀있으면 열기 + Review 탭으로 전환
        const { sidebarCollapsed } = get();
        if (sidebarCollapsed) {
          set({ sidebarCollapsed: false });
        }
        set({ sidebarActiveTab: 'review' });
      },

      closeReviewPanel: (): void => {
        // 더 이상 reviewPanelOpen 상태를 사용하지 않지만, 하위 호환성을 위해 유지
        set({ sidebarActiveTab: 'settings' });
      },

      // Floating Chat Panel
      setSidebarActiveTab: (tab: 'settings' | 'review'): void => {
        set({ sidebarActiveTab: tab });
      },

      setChatPanelOpen: (open: boolean): void => {
        set({ chatPanelOpen: open });
      },

      toggleChatPanel: (): void => {
        set((state) => ({ chatPanelOpen: !state.chatPanelOpen }));
      },

      setChatPanelPosition: (position: { x: number; y: number }): void => {
        set({ chatPanelPosition: position });
      },

      setChatPanelSize: (size: { width: number; height: number }): void => {
        set({ chatPanelSize: size });
      },

      // Settings sidebar width
      setSettingsSidebarWidth: (width: number): void => {
        set({ settingsSidebarWidth: Math.max(280, Math.min(600, width)) }); // min 280, max 600
      },

      // Floating button position
      setFloatingButtonPosition: (position: { x: number; y: number } | null): void => {
        set({ floatingButtonPosition: position });
      },

      // Editor typography (Source/Target 패널별 독립 설정)
      setSourceFontSize: (size: number): void => {
        set({ sourceFontSize: Math.max(10, Math.min(24, size)) }); // 10-24px
      },

      adjustSourceFontSize: (delta: number): void => {
        set((state) => ({
          sourceFontSize: Math.max(10, Math.min(24, state.sourceFontSize + delta)),
        }));
      },

      setSourceLineHeight: (height: number): void => {
        set({ sourceLineHeight: Math.max(1.0, Math.min(2.5, height)) }); // 1.0-2.5
      },

      adjustSourceLineHeight: (delta: number): void => {
        set((state) => ({
          sourceLineHeight: Math.max(1.0, Math.min(2.5, Math.round((state.sourceLineHeight + delta) * 10) / 10)),
        }));
      },

      setTargetFontSize: (size: number): void => {
        set({ targetFontSize: Math.max(10, Math.min(24, size)) }); // 10-24px
      },

      adjustTargetFontSize: (delta: number): void => {
        set((state) => ({
          targetFontSize: Math.max(10, Math.min(24, state.targetFontSize + delta)),
        }));
      },

      setTargetLineHeight: (height: number): void => {
        set({ targetLineHeight: Math.max(1.0, Math.min(2.5, height)) }); // 1.0-2.5
      },

      adjustTargetLineHeight: (delta: number): void => {
        set((state) => ({
          targetLineHeight: Math.max(1.0, Math.min(2.5, Math.round((state.targetLineHeight + delta) * 10) / 10)),
        }));
      },

      // Chat settings
      setMaxChatSessions: (max: number): void => {
        set({ maxChatSessions: Math.max(1, Math.min(5, max)) }); // 1-5
      },

      setChatLengthNotifyThreshold: (threshold: number): void => {
        set({ chatLengthNotifyThreshold: Math.max(10, Math.min(50, threshold)) }); // 10-50
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
        // Floating Chat Panel persist
        sidebarActiveTab: state.sidebarActiveTab,
        chatPanelOpen: state.chatPanelOpen,
        chatPanelPosition: state.chatPanelPosition,
        chatPanelSize: state.chatPanelSize,
        // Settings sidebar & floating button
        settingsSidebarWidth: state.settingsSidebarWidth,
        floatingButtonPosition: state.floatingButtonPosition,
        // Editor typography (Source/Target 패널별 독립 설정)
        sourceFontSize: state.sourceFontSize,
        sourceLineHeight: state.sourceLineHeight,
        targetFontSize: state.targetFontSize,
        targetLineHeight: state.targetLineHeight,
        // Chat settings
        maxChatSessions: state.maxChatSessions,
        chatLengthNotifyThreshold: state.chatLengthNotifyThreshold,
      }),
    }
  )
);

