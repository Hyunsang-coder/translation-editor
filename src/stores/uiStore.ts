import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast as sonnerToast } from 'sonner';
import type { EditorUIState, Toast, DockingSidebarState, PanelType, SidebarSide, ChatPanelType } from '@/types';
import { isChatPanel, chatPanelId } from '@/types';
import { useReviewStore } from '@/stores/reviewStore';
import { useChatStore } from '@/stores/chatStore';

// ============================================
// Store State Interface
// ============================================

interface UIState extends EditorUIState {
  theme: 'light' | 'dark' | 'system';
  language: 'ko' | 'en';
  toasts: Toast[];
  reviewPanelOpen: boolean; // Review 탭 활성화 요청
  devTestPanelOpen: boolean; // 개발자 테스트 패널 (검수 디버그용)

  // === Dual Sidebar State (Docking Model) ===
  leftSidebar: DockingSidebarState;
  rightSidebar: DockingSidebarState;

  // === Legacy (deprecated - kept for backward compat during migration) ===
  sidebarActiveTab: 'settings' | 'review';
  chatPanelOpen: boolean;
  chatPanelPinned: boolean;

  // Legacy sidebar widths
  settingsSidebarWidth: number;
  chatPanelWidth: number;

  // Editor typography settings (Source/Target 패널별 독립 설정)
  sourceFontSize: number; // px
  sourceLineHeight: number; // ratio
  targetFontSize: number; // px
  targetLineHeight: number; // ratio

  // Responsive layout state
  windowWidth: number; // 현재 윈도우 너비 (세션마다 새로 측정, persist 안함)
  autoLayoutEnabled: boolean; // 자동 레이아웃 활성화 (기본: true)
  projectSidebarHidden: boolean; // ProjectSidebar 완전 숨김 상태

  // Paste settings
  pasteImageMode: 'placeholder' | 'original' | 'ignore';
  pasteLinkPreserve: boolean;
}

interface UIActions {
  // Focus Mode
  toggleFocusMode: () => void;
  setFocusMode: (focusMode: boolean) => void;

  // Panel
  setActivePanel: (panel: 'source' | 'target' | 'chat') => void;
  setSelectedBlockId: (blockId: string | null) => void;

  // Sidebar (legacy)
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
  closeReviewPanel: () => void;

  // Dev Test Panel
  toggleDevTestPanel: () => void;
  setDevTestPanelOpen: (open: boolean) => void;

  // Legacy Chat Panel
  setSidebarActiveTab: (tab: 'settings' | 'review') => void;
  setChatPanelOpen: (open: boolean) => void;
  toggleChatPanel: () => void;
  setChatPanelPinned: (pinned: boolean) => void;
  toggleChatPanelPinned: () => void;

  // Legacy sidebar widths
  setSettingsSidebarWidth: (width: number) => void;
  setChatPanelWidth: (width: number) => void;

  // === Docking Sidebar Actions ===
  setActivePanel_side: (side: SidebarSide, panel: PanelType) => void;
  toggleSidebarCollapse: (side: SidebarSide) => void;
  setSidebarCollapsedSide: (side: SidebarSide, collapsed: boolean) => void;
  setSidebarWidthSide: (side: SidebarSide, width: number) => void;
  openPanel: (panel: PanelType) => void;
  openPanelOnSide: (side: SidebarSide, panel: PanelType) => void;
  openReviewPanel: () => void;
  toggleSettingsPanel: () => void;
  toggleReviewPanel: () => void;
  toggleChatVisibility: () => void;
  movePanel: (panel: PanelType, from: SidebarSide, to: SidebarSide) => void;
  reorderPanel: (side: SidebarSide, panel: PanelType, toIndex: number) => void;
  findPanelSide: (panel: PanelType) => SidebarSide | null;

  // === Chat Session Panel Actions ===
  addChatPanel: (sessionId: string, preferSide?: SidebarSide) => void;
  removeChatPanel: (sessionId: string) => void;
  syncChatPanels: (sessionIds: string[]) => void;
  openActiveChat: () => void;

  // Editor typography (Source/Target 패널별 독립 설정)
  setSourceFontSize: (size: number) => void;
  adjustSourceFontSize: (delta: number) => void;
  setSourceLineHeight: (height: number) => void;
  adjustSourceLineHeight: (delta: number) => void;
  setTargetFontSize: (size: number) => void;
  adjustTargetFontSize: (delta: number) => void;
  setTargetLineHeight: (height: number) => void;
  adjustTargetLineHeight: (delta: number) => void;

  // Responsive layout
  setWindowWidth: (width: number) => void;
  setAutoLayoutEnabled: (enabled: boolean) => void;
  setProjectSidebarHidden: (hidden: boolean) => void;

  // Paste settings
  setPasteImageMode: (mode: 'placeholder' | 'original' | 'ignore') => void;
  setPasteLinkPreserve: (preserve: boolean) => void;
}

type UIStore = UIState & UIActions;

// ============================================
// Helpers
// ============================================

const sidebarKey = (side: SidebarSide): 'leftSidebar' | 'rightSidebar' =>
  side === 'left' ? 'leftSidebar' : 'rightSidebar';

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
      devTestPanelOpen: false,

      // === Docking Sidebar - 기본값 ===
      leftSidebar: { collapsed: false, panels: ['settings', 'review'], activePanel: 'settings', width: 250 },
      rightSidebar: { collapsed: false, panels: [], activePanel: null, width: 250 },

      // Legacy (deprecated - backward compat)
      sidebarActiveTab: 'settings',
      chatPanelOpen: true,
      chatPanelPinned: true,

      // Legacy sidebar widths
      settingsSidebarWidth: 250,
      chatPanelWidth: 250,

      // Editor typography defaults (Source/Target 패널별 독립 설정)
      sourceFontSize: 14,
      sourceLineHeight: 1.4,
      targetFontSize: 14,
      targetLineHeight: 1.4,

      // Responsive layout defaults
      windowWidth: typeof window !== 'undefined' ? window.innerWidth : 1400,
      autoLayoutEnabled: true,
      projectSidebarHidden: false,

      // Paste settings defaults
      pasteImageMode: 'original',
      pasteLinkPreserve: true,

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

      // Sidebar (legacy)
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

      // Toasts (using sonner)
      addToast: (toast: Omit<Toast, 'id'>): void => {
        const options = {
          duration: toast.duration ?? 3000,
        };

        switch (toast.type) {
          case 'success':
            sonnerToast.success(toast.message, options);
            break;
          case 'error':
            sonnerToast.error(toast.message, options);
            break;
          case 'warning':
            sonnerToast.warning(toast.message, options);
            break;
          case 'info':
          default:
            sonnerToast.info(toast.message, options);
            break;
        }
      },

      removeToast: (_id: string): void => {
        // sonner handles dismissal automatically
        sonnerToast.dismiss();
      },

      clearToasts: (): void => {
        sonnerToast.dismiss();
      },

      // Review Panel (delegates to docking model)
      openReviewPanel: (): void => {
        const state = get();
        // review 패널이 어느 사이드에 있는지 찾기
        const side: SidebarSide | null =
          state.leftSidebar.panels.includes('review') ? 'left'
            : state.rightSidebar.panels.includes('review') ? 'right'
              : null;

        if (side) {
          const key = sidebarKey(side);
          const sb = state[key];
          // 이미 열려있으면 triggerReview
          if (!sb.collapsed && sb.activePanel === 'review') {
            useReviewStore.getState().triggerReview();
            return;
          }
          set({ [key]: { ...sb, collapsed: false, activePanel: 'review' as PanelType } });
        } else {
          // 어디에도 없으면 left에 추가
          const sb = state.leftSidebar;
          set({ leftSidebar: { ...sb, collapsed: false, panels: [...sb.panels, 'review'], activePanel: 'review' } });
        }
      },

      closeReviewPanel: (): void => {
        // review → settings로 전환 (review가 있는 사이드에서)
        const state = get();
        const side: SidebarSide | null =
          state.leftSidebar.panels.includes('review') ? 'left'
            : state.rightSidebar.panels.includes('review') ? 'right'
              : null;
        if (side) {
          const key = sidebarKey(side);
          const sb = state[key];
          if (sb.activePanel === 'review' && sb.panels.length > 0) {
            const next = sb.panels.find((p) => p !== 'review') ?? sb.panels[0] ?? null;
            set({ [key]: { ...sb, activePanel: next } });
          }
        }
      },

      toggleSettingsPanel: (): void => {
        const state = get();
        const side = state.findPanelSide('settings');
        if (side) {
          const key = sidebarKey(side);
          const sb = state[key];
          if (sb.collapsed) {
            set({ [key]: { ...sb, collapsed: false, activePanel: 'settings' as PanelType } });
          } else if (sb.activePanel === 'settings') {
            set({ [key]: { ...sb, collapsed: true } });
          } else {
            set({ [key]: { ...sb, activePanel: 'settings' as PanelType } });
          }
        } else {
          get().openPanelOnSide('left', 'settings');
        }
      },

      toggleReviewPanel: (): void => {
        const state = get();
        const side = state.findPanelSide('review');
        if (side) {
          const key = sidebarKey(side);
          const sb = state[key];
          if (sb.collapsed) {
            set({ [key]: { ...sb, collapsed: false, activePanel: 'review' as PanelType } });
          } else if (sb.activePanel === 'review') {
            set({ [key]: { ...sb, collapsed: true } });
          } else {
            set({ [key]: { ...sb, activePanel: 'review' as PanelType } });
          }
        } else {
          get().openReviewPanel();
        }
      },

      toggleChatVisibility: (): void => {
        const state = get();
        const chatSides = (['left', 'right'] as const).filter((side) => {
          const sb = side === 'left' ? state.leftSidebar : state.rightSidebar;
          return sb.panels.some(isChatPanel);
        });

        if (chatSides.length === 0) {
          get().openActiveChat();
          return;
        }

        const isChatVisibleOn = (side: SidebarSide): boolean => {
          const sb = side === 'left' ? state.leftSidebar : state.rightSidebar;
          return !sb.collapsed && sb.activePanel !== null && isChatPanel(sb.activePanel);
        };

        const anyVisibleChat = chatSides.some(isChatVisibleOn);
        const updates: Partial<Record<'leftSidebar' | 'rightSidebar', DockingSidebarState>> = {};

        if (anyVisibleChat) {
          // Off: 보이는 chat 패널을 모두 숨김 (고정 패널이 있으면 전환, 없으면 collapse)
          for (const side of chatSides) {
            if (!isChatVisibleOn(side)) continue;
            const key = sidebarKey(side);
            const sb = state[key];
            const fallbackPanel = sb.panels.find((panel) => !isChatPanel(panel)) ?? null;
            updates[key] = fallbackPanel
              ? { ...sb, activePanel: fallbackPanel, collapsed: false }
              : { ...sb, collapsed: true };
          }
        } else {
          // On: chat 패널이 있는 모든 사이드를 펼치고 chat 탭 활성화
          for (const side of chatSides) {
            const key = sidebarKey(side);
            const sb = state[key];
            const chatPanel =
              (sb.activePanel !== null && isChatPanel(sb.activePanel) ? sb.activePanel : null)
              ?? sb.panels.find(isChatPanel)
              ?? null;
            if (!chatPanel) continue;
            updates[key] = { ...sb, collapsed: false, activePanel: chatPanel };
          }
        }

        if (Object.keys(updates).length > 0) {
          set(updates);
        }
      },

      // Dev Test Panel
      toggleDevTestPanel: (): void => {
        set((state) => ({ devTestPanelOpen: !state.devTestPanelOpen }));
      },

      setDevTestPanelOpen: (open: boolean): void => {
        set({ devTestPanelOpen: open });
      },

      // Legacy Chat Panel
      setSidebarActiveTab: (tab: 'settings' | 'review'): void => {
        set({ sidebarActiveTab: tab });
      },

      setChatPanelOpen: (open: boolean): void => {
        set({ chatPanelOpen: open });
      },

      toggleChatPanel: (): void => {
        set((state) => ({ chatPanelOpen: !state.chatPanelOpen }));
      },

      setChatPanelPinned: (pinned: boolean): void => {
        set({ chatPanelPinned: pinned });
      },

      toggleChatPanelPinned: (): void => {
        set((state) => ({ chatPanelPinned: !state.chatPanelPinned }));
      },

      // Legacy sidebar widths
      setSettingsSidebarWidth: (width: number): void => {
        set({ settingsSidebarWidth: Math.max(200, Math.min(600, width)) });
      },

      setChatPanelWidth: (width: number): void => {
        set({ chatPanelWidth: Math.max(200, Math.min(600, width)) });
      },

      // === Docking Sidebar Actions ===
      setActivePanel_side: (side: SidebarSide, panel: PanelType): void => {
        const key = sidebarKey(side);
        set((state) => ({ [key]: { ...state[key], activePanel: panel } }));
      },

      toggleSidebarCollapse: (side: SidebarSide): void => {
        const key = sidebarKey(side);
        set((state) => ({ [key]: { ...state[key], collapsed: !state[key].collapsed } }));
      },

      setSidebarCollapsedSide: (side: SidebarSide, collapsed: boolean): void => {
        const key = sidebarKey(side);
        set((state) => ({ [key]: { ...state[key], collapsed } }));
      },

      setSidebarWidthSide: (side: SidebarSide, width: number): void => {
        const key = sidebarKey(side);
        const clamped = Math.max(200, Math.min(600, width));
        set((state) => ({ [key]: { ...state[key], width: clamped } }));
      },

      openPanel: (panel: PanelType): void => {
        const state = get();
        // 패널이 도킹된 사이드를 찾아서 열기
        const side: SidebarSide | null =
          state.leftSidebar.panels.includes(panel) ? 'left'
            : state.rightSidebar.panels.includes(panel) ? 'right'
              : null;
        if (side) {
          const key = sidebarKey(side);
          set({ [key]: { ...state[key], collapsed: false, activePanel: panel } });
        }
      },

      openPanelOnSide: (side: SidebarSide, panel: PanelType): void => {
        const key = sidebarKey(side);
        const sb = get()[key];
        if (sb.panels.includes(panel)) {
          set({ [key]: { ...sb, collapsed: false, activePanel: panel } });
        } else {
          // 패널이 없으면 추가
          set({ [key]: { ...sb, collapsed: false, panels: [...sb.panels, panel], activePanel: panel } });
        }
      },

      movePanel: (panel: PanelType, from: SidebarSide, to: SidebarSide): void => {
        if (from === to) return;
        const state = get();
        const fromKey = sidebarKey(from);
        const toKey = sidebarKey(to);
        const fromSb = state[fromKey];
        const toSb = state[toKey];

        // 모든 패널 동일 처리: from에서 제거
        const newFromPanels = fromSb.panels.filter((p) => p !== panel);

        // to에 추가 (이미 있으면 추가하지 않음)
        const newToPanels = toSb.panels.includes(panel) ? toSb.panels : [...toSb.panels, panel];

        // from의 activePanel 조정
        const fromActive = fromSb.activePanel === panel
          ? (newFromPanels[0] ?? null)
          : fromSb.activePanel;

        // from이 비면 자동 collapse
        const fromCollapsed = newFromPanels.length === 0 ? true : fromSb.collapsed;

        set({
          [fromKey]: { ...fromSb, panels: newFromPanels, activePanel: fromActive, collapsed: fromCollapsed },
          [toKey]: { ...toSb, panels: newToPanels, activePanel: panel, collapsed: false },
        });
      },

      reorderPanel: (side: SidebarSide, panel: PanelType, toIndex: number): void => {
        const key = sidebarKey(side);
        const sb = get()[key];
        const fromIndex = sb.panels.indexOf(panel);
        if (fromIndex === -1 || fromIndex === toIndex) return;
        const newPanels = sb.panels.filter((p) => p !== panel);
        const clampedIndex = Math.max(0, Math.min(newPanels.length, toIndex));
        newPanels.splice(clampedIndex, 0, panel);
        set({ [key]: { ...sb, panels: newPanels } });
      },

      findPanelSide: (panel: PanelType): SidebarSide | null => {
        const state = get();
        if (state.leftSidebar.panels.includes(panel)) return 'left';
        if (state.rightSidebar.panels.includes(panel)) return 'right';
        return null;
      },

      // === Chat Session Panel Actions ===
      addChatPanel: (sessionId: string, preferSide?: SidebarSide): void => {
        const panel: ChatPanelType = chatPanelId(sessionId);
        const state = get();
        // 이미 어느 쪽에든 있으면 무시
        if (state.leftSidebar.panels.includes(panel) || state.rightSidebar.panels.includes(panel)) return;
        const key = sidebarKey(preferSide ?? 'right');
        const sb = state[key];
        set({ [key]: { ...sb, panels: [...sb.panels, panel], activePanel: panel, collapsed: false } });
      },

      removeChatPanel: (sessionId: string): void => {
        const panel: ChatPanelType = chatPanelId(sessionId);
        const state = get();
        const updates: Partial<Record<'leftSidebar' | 'rightSidebar', DockingSidebarState>> = {};
        for (const side of ['leftSidebar', 'rightSidebar'] as const) {
          const sb = state[side];
          if (sb.panels.includes(panel)) {
            const newPanels = sb.panels.filter((p) => p !== panel);
            const newActive = sb.activePanel === panel ? (newPanels[0] ?? null) : sb.activePanel;
            updates[side] = { ...sb, panels: newPanels, activePanel: newActive, collapsed: newPanels.length === 0 ? true : sb.collapsed };
          }
        }
        if (Object.keys(updates).length > 0) set(updates);
      },

      syncChatPanels: (sessionIds: string[]): void => {
        const state = get();
        const validPanels = new Set<PanelType>(sessionIds.map(chatPanelId));
        const updates: Partial<Record<'leftSidebar' | 'rightSidebar', DockingSidebarState>> = {};
        const preLeftChatCount = state.leftSidebar.panels.filter(isChatPanel).length;
        const preRightChatCount = state.rightSidebar.panels.filter(isChatPanel).length;
        const preActiveChatSide: SidebarSide | null =
          state.leftSidebar.activePanel && isChatPanel(state.leftSidebar.activePanel)
            ? 'left'
            : state.rightSidebar.activePanel && isChatPanel(state.rightSidebar.activePanel)
              ? 'right'
              : null;
        const preferredRestoreSide: SidebarSide =
          preActiveChatSide
          ?? (preLeftChatCount > preRightChatCount ? 'left'
            : preRightChatCount > preLeftChatCount ? 'right'
              : 'right');

        for (const side of ['leftSidebar', 'rightSidebar'] as const) {
          const sb = state[side];
          // stale chat 패널 제거
          const cleaned = sb.panels.filter((p) => !isChatPanel(p) || validPanels.has(p));
          if (cleaned.length !== sb.panels.length) {
            const newActive = sb.activePanel && !cleaned.includes(sb.activePanel)
              ? (cleaned[0] ?? null)
              : sb.activePanel;
            updates[side] = { ...sb, panels: cleaned, activePanel: newActive };
          }
        }

        // 세션이 있지만 어디에도 패널이 없으면, right에 첫 번째 세션 추가
        const leftPanels = updates.leftSidebar?.panels ?? state.leftSidebar.panels;
        const rightPanels = updates.rightSidebar?.panels ?? state.rightSidebar.panels;
        const allPanels = [...leftPanels, ...rightPanels];
        const existingChatPanels = new Set(allPanels.filter(isChatPanel));

        // 누락된 세션 패널 복구:
        // 1) 기존 chat이 한쪽에 있으면 그쪽에 복구
        // 2) 양쪽 모두 없으면, 정리 전(chat stale 포함) 선호 사이드로 복구
        const missingPanels = sessionIds
          .map(chatPanelId)
          .filter((panel) => !existingChatPanels.has(panel));

        if (missingPanels.length > 0) {
          const leftHasChat = leftPanels.some(isChatPanel);
          const rightHasChat = rightPanels.some(isChatPanel);
          const restoreSide: SidebarSide =
            leftHasChat && !rightHasChat ? 'left'
              : rightHasChat && !leftHasChat ? 'right'
                : preferredRestoreSide;
          const restoreKey = sidebarKey(restoreSide);
          const restoreSidebar = updates[restoreKey] ?? state[restoreKey];
          const nextPanels = [...restoreSidebar.panels, ...missingPanels];
          updates[restoreKey] = {
            ...restoreSidebar,
            panels: nextPanels,
            activePanel: restoreSidebar.activePanel ?? missingPanels[0] ?? null,
            collapsed: false,
          };
        }

        if (Object.keys(updates).length > 0) set(updates);
      },

      openActiveChat: (): void => {
        const state = get();
        // 이미 열려있는 chat 패널 찾기 (어느 사이드든)
        for (const side of ['rightSidebar', 'leftSidebar'] as const) {
          const sb = state[side];
          // 현재 activePanel이 chat이면 열기
          if (sb.activePanel && isChatPanel(sb.activePanel)) {
            set({ [side]: { ...sb, collapsed: false } });
            return;
          }
        }
        // activePanel은 chat이 아니지만 panels에 chat이 있으면 전환
        for (const side of ['rightSidebar', 'leftSidebar'] as const) {
          const sb = state[side];
          const chatPanel = sb.panels.find(isChatPanel);
          if (chatPanel) {
            set({ [side]: { ...sb, collapsed: false, activePanel: chatPanel } });
            return;
          }
        }
        // 어디에도 chat 패널이 없으면 — chatStore에서 세션을 생성/복구
        const chatState = useChatStore.getState();
        if (chatState.sessions.length > 0) {
          // 세션은 있지만 패널이 없는 경우 → syncChatPanels로 복구 후 열기
          get().syncChatPanels(chatState.sessions.map((s) => s.id));
          const refreshed = get();
          for (const s of ['rightSidebar', 'leftSidebar'] as const) {
            const chatPanel = refreshed[s].panels.find(isChatPanel);
            if (chatPanel) {
              set({ [s]: { ...refreshed[s], collapsed: false, activePanel: chatPanel } });
              return;
            }
          }
        } else {
          // 세션 자체가 없으면 새로 생성 (createSession → addChatPanel 자동 호출)
          chatState.createSession();
        }
      },

      // Editor typography (Source/Target 패널별 독립 설정)
      setSourceFontSize: (size: number): void => {
        set({ sourceFontSize: Math.max(10, Math.min(24, size)) });
      },

      adjustSourceFontSize: (delta: number): void => {
        set((state) => ({
          sourceFontSize: Math.max(10, Math.min(24, state.sourceFontSize + delta)),
        }));
      },

      setSourceLineHeight: (height: number): void => {
        set({ sourceLineHeight: Math.max(1.0, Math.min(2.5, height)) });
      },

      adjustSourceLineHeight: (delta: number): void => {
        set((state) => ({
          sourceLineHeight: Math.max(1.0, Math.min(2.5, Math.round((state.sourceLineHeight + delta) * 10) / 10)),
        }));
      },

      setTargetFontSize: (size: number): void => {
        set({ targetFontSize: Math.max(10, Math.min(24, size)) });
      },

      adjustTargetFontSize: (delta: number): void => {
        set((state) => ({
          targetFontSize: Math.max(10, Math.min(24, state.targetFontSize + delta)),
        }));
      },

      setTargetLineHeight: (height: number): void => {
        set({ targetLineHeight: Math.max(1.0, Math.min(2.5, height)) });
      },

      adjustTargetLineHeight: (delta: number): void => {
        set((state) => ({
          targetLineHeight: Math.max(1.0, Math.min(2.5, Math.round((state.targetLineHeight + delta) * 10) / 10)),
        }));
      },

      // Responsive layout
      setWindowWidth: (width: number): void => {
        set({ windowWidth: width });
      },

      setAutoLayoutEnabled: (enabled: boolean): void => {
        set({ autoLayoutEnabled: enabled });
      },

      setProjectSidebarHidden: (hidden: boolean): void => {
        set({ projectSidebarHidden: hidden });
      },

      // Paste settings
      setPasteImageMode: (mode: 'placeholder' | 'original' | 'ignore'): void => {
        set({ pasteImageMode: mode });
      },

      setPasteLinkPreserve: (preserve: boolean): void => {
        set({ pasteLinkPreserve: preserve });
      },
    }),
    {
      name: 'ite-ui-storage',
      version: 4,
      migrate: (persisted, version) => {
        const data = persisted as Record<string, unknown>;

        if (version === 0 || version === 1) {
          // v0/v1 → v4: 기존 sidebar/chat 상태를 docking 모델로 마이그레이션
          const settingsWidth = (data.settingsSidebarWidth as number) || 250;
          const chatWidth = (data.chatPanelWidth as number) || 250;
          const collapsed = (data.sidebarCollapsed as boolean) ?? false;

          data.leftSidebar = {
            collapsed,
            panels: ['settings', 'review'],
            activePanel: 'settings',
            width: settingsWidth,
          };
          // chat 패널은 hydration 시 syncChatPanels로 채워짐
          data.rightSidebar = {
            collapsed: false,
            panels: [],
            activePanel: null,
            width: chatWidth,
          };
        } else if (version === 2) {
          // v2 → v4: activeTab → activePanel + panels 배열 추가
          const left = data.leftSidebar as Record<string, unknown> | undefined;
          const right = data.rightSidebar as Record<string, unknown> | undefined;

          data.leftSidebar = {
            collapsed: left?.collapsed ?? false,
            panels: ['settings', 'review'],
            activePanel: (left?.activeTab as string) || 'settings',
            width: (left?.width as number) || 250,
          };
          data.rightSidebar = {
            collapsed: right?.collapsed ?? false,
            panels: [],
            activePanel: null,
            width: (right?.width as number) || 250,
          };
        } else if (version === 3) {
          // v3 → v4: 'chat' 리터럴 제거 — hydration 시 실제 세션 ID로 대체
          for (const side of ['leftSidebar', 'rightSidebar'] as const) {
            const sb = data[side] as Record<string, unknown> | undefined;
            if (sb) {
              const panels = (sb.panels as string[]) ?? [];
              sb.panels = panels.filter((p) => p !== 'chat');
              if (sb.activePanel === 'chat') {
                sb.activePanel = (sb.panels as string[])[0] ?? null;
              }
            }
          }
        }

        return data;
      },
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        focusMode: state.focusMode,
        sidebarCollapsed: state.sidebarCollapsed,
        projectSidebarCollapsed: state.projectSidebarCollapsed,
        isPanelsSwapped: state.isPanelsSwapped,
        // Dual sidebar persist
        leftSidebar: state.leftSidebar,
        rightSidebar: state.rightSidebar,
        // Legacy (kept for potential rollback)
        sidebarActiveTab: state.sidebarActiveTab,
        chatPanelOpen: state.chatPanelOpen,
        chatPanelPinned: state.chatPanelPinned,
        settingsSidebarWidth: state.settingsSidebarWidth,
        chatPanelWidth: state.chatPanelWidth,
        // Editor typography
        sourceFontSize: state.sourceFontSize,
        sourceLineHeight: state.sourceLineHeight,
        targetFontSize: state.targetFontSize,
        targetLineHeight: state.targetLineHeight,
        // Responsive layout (windowWidth는 persist 안함)
        autoLayoutEnabled: state.autoLayoutEnabled,
        // Paste settings
        pasteImageMode: state.pasteImageMode,
        pasteLinkPreserve: state.pasteLinkPreserve,
      }),
    }
  )
);
