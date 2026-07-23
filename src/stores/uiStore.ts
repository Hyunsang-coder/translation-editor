import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast as sonnerToast } from 'sonner';
import type { EditorUIState, Toast, DockingSidebarState, PanelType, SidebarSide, ChatPanelType, FloatingChatRect } from '@/types';
import { isChatPanel, chatPanelId } from '@/types';
import { LAYOUT } from '@/constants/layout';
import { useReviewStore } from '@/stores/reviewStore';
import { useChatStore } from '@/stores/chatStore';

// ============================================
// Store State Interface
// ============================================

interface UIState extends EditorUIState {
  theme: 'light' | 'dark' | 'system';
  language: 'ko' | 'en';
  reviewPanelOpen: boolean; // Review 탭 활성화 요청
  devTestPanelOpen: boolean; // 개발자 테스트 패널 (검수 디버그용)

  // === Dual Sidebar State (Docking Model) ===
  leftSidebar: DockingSidebarState;
  rightSidebar: DockingSidebarState;
  floatingChatSessionId: string | null;
  floatingChatRect: FloatingChatRect;

  // Editor typography settings (Source/Target 패널별 독립 설정)
  sourceFontSize: number; // px
  sourceLineHeight: number; // ratio
  targetFontSize: number; // px
  targetLineHeight: number; // ratio

  // Responsive layout state
  windowWidth: number; // 현재 윈도우 너비 (세션마다 새로 측정, persist 안함)
  autoLayoutEnabled: boolean; // 자동 레이아웃 활성화 (기본: true)
  projectSidebarHidden: boolean; // ProjectSidebar 완전 숨김 상태
  projectSidebarWidth: number; // ProjectSidebar 너비 (리사이즈 가능)

  // Paste settings
  pasteImageMode: 'placeholder' | 'original' | 'ignore';
  pasteLinkPreserve: boolean;

  // Editor zoom (CSS zoom, 0.5~2.0)
  editorZoom: number;

  // Focus Mode (원문/번역 단일 패널 보기)
  focusMode: boolean;
  sourceOnlyMode: boolean;
}

interface UIActions {
  // Focus Mode
  toggleFocusMode: () => void;
  setFocusMode: (focusMode: boolean) => void;
  toggleSourceOnlyMode: () => void;
  setSourceOnlyMode: (sourceOnlyMode: boolean) => void;

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
  // Review Panel
  closeReviewPanel: () => void;

  // Dev Test Panel
  toggleDevTestPanel: () => void;
  setDevTestPanelOpen: (open: boolean) => void;

  // === Docking Sidebar Actions ===
  setActivePanel_side: (side: SidebarSide, panel: PanelType) => void;
  toggleSidebarHidden: (side: SidebarSide) => void;
  setSidebarHiddenSide: (side: SidebarSide, hidden: boolean) => void;
  setSidebarWidthSide: (side: SidebarSide, width: number) => void;
  openPanel: (panel: PanelType) => void;
  openPanelOnSide: (side: SidebarSide, panel: PanelType) => void;
  openReviewPanel: () => void;
  openCommentsPanel: () => void;
  toggleSettingsPanel: () => void;
  toggleReviewPanel: () => void;
  toggleChatVisibility: () => void;
  movePanel: (panel: PanelType, from: SidebarSide, to: SidebarSide) => void;
  reorderPanel: (side: SidebarSide, panel: PanelType, toIndex: number) => void;
  findPanelSide: (panel: PanelType) => SidebarSide | null;

  // === Chat Session Panel Actions ===
  addChatPanel: (sessionId: string) => void;
  removeChatPanel: (sessionId: string) => void;
  syncChatPanels: (sessionIds: string[]) => void;
  openActiveChat: () => void;
  floatChatPanel: (sessionId: string) => void;
  dockFloatingChat: () => void;
  closeFloatingChat: () => void;
  setFloatingChatRect: (rect: FloatingChatRect) => void;

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
  setProjectSidebarWidth: (width: number) => void;

  // Paste settings
  setPasteImageMode: (mode: 'placeholder' | 'original' | 'ignore') => void;
  setPasteLinkPreserve: (preserve: boolean) => void;

  // Editor zoom
  setEditorZoom: (zoom: number) => void;
  adjustEditorZoom: (delta: number) => void;
  resetEditorZoom: () => void;
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
      sourceOnlyMode: false,
      activePanel: 'target',
      selectedBlockId: null,
      showDiff: false,
      sidebarCollapsed: false,
      projectSidebarCollapsed: false,
      theme: 'system',
      language: 'ko',
      isPanelsSwapped: false,
      reviewPanelOpen: false,
      devTestPanelOpen: false,

      // === Docking Sidebar - 기본값 ===
      leftSidebar: { hidden: false, panels: ['settings', 'review', 'comments'], activePanel: 'settings', width: 250 },
      rightSidebar: { hidden: false, panels: [], activePanel: null, width: 250 },
      floatingChatSessionId: null,
      floatingChatRect: { x: 24, y: 24, width: 400, height: 560 },

      // Editor typography defaults (Source/Target 패널별 독립 설정)
      sourceFontSize: 14,
      sourceLineHeight: 1.4,
      targetFontSize: 14,
      targetLineHeight: 1.4,

      // Responsive layout defaults
      windowWidth: typeof window !== 'undefined' ? window.innerWidth : 1400,
      autoLayoutEnabled: true,
      projectSidebarHidden: false,
      projectSidebarWidth: LAYOUT.PROJECT_EXPANDED,

      // Paste settings defaults
      pasteImageMode: 'original',
      pasteLinkPreserve: true,

      // Editor zoom default
      editorZoom: 1.0,

      // Focus Mode
      toggleFocusMode: (): void => {
        set((state) => ({
          focusMode: !state.focusMode,
          sourceOnlyMode: false,
        }));
      },

      setFocusMode: (focusMode: boolean): void => {
        set({ focusMode, ...(focusMode ? { sourceOnlyMode: false } : {}) });
      },

      toggleSourceOnlyMode: (): void => {
        set((state) => ({
          sourceOnlyMode: !state.sourceOnlyMode,
          focusMode: false,
        }));
      },

      setSourceOnlyMode: (sourceOnlyMode: boolean): void => {
        set({ sourceOnlyMode, ...(sourceOnlyMode ? { focusMode: false } : {}) });
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
          if (!sb.hidden && sb.activePanel === 'review') {
            useReviewStore.getState().triggerReview();
            return;
          }
          set({ [key]: { ...sb, hidden: false, activePanel: 'review' as PanelType } });
        } else {
          // 어디에도 없으면 left에 추가
          const sb = state.leftSidebar;
          set({ leftSidebar: { ...sb, hidden: false, panels: [...sb.panels, 'review'], activePanel: 'review' } });
        }
      },

      // Comments Panel (delegates to docking model) — openReviewPanel과 동일 패턴
      openCommentsPanel: (): void => {
        const state = get();
        const side: SidebarSide | null =
          state.leftSidebar.panels.includes('comments') ? 'left'
            : state.rightSidebar.panels.includes('comments') ? 'right'
              : null;

        if (side) {
          const key = sidebarKey(side);
          const sb = state[key];
          set({ [key]: { ...sb, hidden: false, activePanel: 'comments' as PanelType } });
        } else {
          const sb = state.leftSidebar;
          set({ leftSidebar: { ...sb, hidden: false, panels: [...sb.panels, 'comments'], activePanel: 'comments' } });
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
          if (sb.hidden) {
            set({ [key]: { ...sb, hidden: false, activePanel: 'settings' as PanelType } });
          } else if (sb.activePanel === 'settings') {
            set({ [key]: { ...sb, hidden: true } });
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
          if (sb.hidden) {
            set({ [key]: { ...sb, hidden: false, activePanel: 'review' as PanelType } });
          } else if (sb.activePanel === 'review') {
            set({ [key]: { ...sb, hidden: true } });
          } else {
            set({ [key]: { ...sb, activePanel: 'review' as PanelType } });
          }
        } else {
          get().openReviewPanel();
        }
      },

      toggleChatVisibility: (): void => {
        const state = get();
        if (state.floatingChatSessionId) {
          const sidebarUpdates: Partial<Record<'leftSidebar' | 'rightSidebar', DockingSidebarState>> = {};
          for (const side of ['leftSidebar', 'rightSidebar'] as const) {
            const sidebar = state[side];
            if (sidebar.hidden || !sidebar.activePanel || !isChatPanel(sidebar.activePanel)) continue;
            const fallbackPanel = sidebar.panels.find((panel) => !isChatPanel(panel)) ?? null;
            sidebarUpdates[side] = fallbackPanel
              ? { ...sidebar, activePanel: fallbackPanel, hidden: false }
              : { ...sidebar, hidden: true };
          }
          set({ floatingChatSessionId: null, ...sidebarUpdates });
          return;
        }
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
          return !sb.hidden && sb.activePanel !== null && isChatPanel(sb.activePanel);
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
              ? { ...sb, activePanel: fallbackPanel, hidden: false }
              : { ...sb, hidden: true };
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
            updates[key] = { ...sb, hidden: false, activePanel: chatPanel };
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

      // === Docking Sidebar Actions ===
      setActivePanel_side: (side: SidebarSide, panel: PanelType): void => {
        const key = sidebarKey(side);
        set((state) => ({ [key]: { ...state[key], activePanel: panel } }));
      },

      toggleSidebarHidden: (side: SidebarSide): void => {
        const key = sidebarKey(side);
        set((state) => ({ [key]: { ...state[key], hidden: !state[key].hidden } }));
      },

      setSidebarHiddenSide: (side: SidebarSide, hidden: boolean): void => {
        const key = sidebarKey(side);
        set((state) => ({ [key]: { ...state[key], hidden } }));
      },

      setSidebarWidthSide: (side: SidebarSide, width: number): void => {
        const key = sidebarKey(side);
        const sidebar = get()[key];
        const minWidth = sidebar.panels.some(isChatPanel) ? LAYOUT.CHAT_SIDEBAR_MIN : LAYOUT.SIDEBAR_MIN;
        const clamped = Math.max(minWidth, Math.min(LAYOUT.SIDEBAR_MAX, width));
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
          set({ [key]: { ...state[key], hidden: false, activePanel: panel } });
        }
      },

      openPanelOnSide: (side: SidebarSide, panel: PanelType): void => {
        const key = sidebarKey(side);
        const sb = get()[key];
        if (sb.panels.includes(panel)) {
          set({ [key]: { ...sb, hidden: false, activePanel: panel } });
        } else {
          // 패널이 없으면 추가
          set({ [key]: { ...sb, hidden: false, panels: [...sb.panels, panel], activePanel: panel } });
        }
      },

      movePanel: (panel: PanelType, from: SidebarSide, to: SidebarSide): void => {
        if (from === to) return;

        // 역할 잠금(side lock): 좌=고정패널 전용, 우=채팅 전용.
        // 드래그·우클릭·+버튼 3경로가 모두 이 한 곳을 통과하므로 여기서 차단하면 전부 막힌다.
        if (to === 'left' && isChatPanel(panel)) return;
        if (to === 'right' && !isChatPanel(panel)) return;

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

        // from이 비면 자동 숨김
        const fromHidden = newFromPanels.length === 0 ? true : fromSb.hidden;

        set({
          [fromKey]: { ...fromSb, panels: newFromPanels, activePanel: fromActive, hidden: fromHidden },
          [toKey]: { ...toSb, panels: newToPanels, activePanel: panel, hidden: false },
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
      addChatPanel: (sessionId: string): void => {
        const panel: ChatPanelType = chatPanelId(sessionId);
        const state = get();
        // 이미 어느 쪽에든 있으면 무시
        if (state.leftSidebar.panels.includes(panel) || state.rightSidebar.panels.includes(panel)) return;
        // 채팅은 우측 전용 — preferSide로 좌측이 요청돼도 우측에 도킹
        const key = sidebarKey('right');
        const sb = state[key];
        set({ [key]: { ...sb, panels: [...sb.panels, panel], activePanel: panel, hidden: false } });
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
            updates[side] = { ...sb, panels: newPanels, activePanel: newActive, hidden: newPanels.length === 0 ? true : sb.hidden };
          }
        }
        const floatingChatSessionId = state.floatingChatSessionId === sessionId
          ? null
          : state.floatingChatSessionId;
        if (Object.keys(updates).length > 0 || floatingChatSessionId !== state.floatingChatSessionId) {
          set({ ...updates, floatingChatSessionId });
        }
      },

      syncChatPanels: (sessionIds: string[]): void => {
        const state = get();
        const validPanels = new Set<PanelType>(sessionIds.map(chatPanelId));
        const updates: Partial<Record<'leftSidebar' | 'rightSidebar', DockingSidebarState>> = {};

        // 채팅은 우측 전용. 좌측에 도킹된 유효 chat은 우측으로 옮기고,
        // 좌/우의 stale chat은 제거한다. (역할 정규화 + stale 정리 동시 수행)

        // 좌측: 모든 chat 제거 (유효한 것은 우측 이동 대상으로 수집)
        const leftSb = state.leftSidebar;
        const leftChatToMove = leftSb.panels.filter((p) => isChatPanel(p) && validPanels.has(p));
        const leftCleaned: PanelType[] = leftSb.panels.filter((p) => !isChatPanel(p));
        if (leftCleaned.length !== leftSb.panels.length) {
          const newActive = leftSb.activePanel && !leftCleaned.includes(leftSb.activePanel)
            ? (leftCleaned[0] ?? null)
            : leftSb.activePanel;
          updates.leftSidebar = { ...leftSb, panels: leftCleaned, activePanel: newActive };
        }

        // 우측: stale chat 제거
        const rightSb = state.rightSidebar;
        const rightCleaned: PanelType[] = rightSb.panels.filter((p) => !isChatPanel(p) || validPanels.has(p));
        const rightActive = rightSb.activePanel && !rightCleaned.includes(rightSb.activePanel)
          ? (rightCleaned[0] ?? null)
          : rightSb.activePanel;

        // 우측에 이미 있는 chat + 좌측에서 옮겨온 chat을 합친 뒤, 누락 세션 복구
        const rightExistingChat = new Set<PanelType>(rightCleaned.filter(isChatPanel));
        const movedFromLeft = leftChatToMove.filter((p) => !rightExistingChat.has(p));
        const afterMove = [...rightCleaned, ...movedFromLeft];
        const afterMoveChat = new Set(afterMove.filter(isChatPanel));
        const missingPanels = sessionIds
          .map(chatPanelId)
          .filter((panel) => !afterMoveChat.has(panel));

        const nextRightPanels = [...afterMove, ...missingPanels];
        const restoredCount = movedFromLeft.length + missingPanels.length;
        if (restoredCount > 0 || rightCleaned.length !== rightSb.panels.length) {
          updates.rightSidebar = {
            ...rightSb,
            panels: nextRightPanels,
            activePanel: rightActive ?? movedFromLeft[0] ?? missingPanels[0] ?? null,
            hidden: restoredCount > 0 ? false : rightSb.hidden,
          };
        }

        const floatingChatSessionId = state.floatingChatSessionId
          && sessionIds.includes(state.floatingChatSessionId)
          ? state.floatingChatSessionId
          : null;

        if (floatingChatSessionId) {
          const floatingPanel = chatPanelId(floatingChatSessionId);
          const nextRight = updates.rightSidebar ?? state.rightSidebar;
          if (nextRight.activePanel === floatingPanel) {
            const fallback = nextRight.panels.find((panel) => panel !== floatingPanel && isChatPanel(panel)) ?? null;
            updates.rightSidebar = fallback
              ? { ...nextRight, activePanel: fallback, hidden: false }
              : { ...nextRight, hidden: true };
          }
        }

        if (Object.keys(updates).length > 0 || floatingChatSessionId !== state.floatingChatSessionId) {
          set({ ...updates, floatingChatSessionId });
        }
      },

      openActiveChat: (): void => {
        const state = get();
        if (state.floatingChatSessionId) return;
        // 이미 열려있는 chat 패널 찾기 (어느 사이드든)
        for (const side of ['rightSidebar', 'leftSidebar'] as const) {
          const sb = state[side];
          // 현재 activePanel이 chat이면 열기
          if (sb.activePanel && isChatPanel(sb.activePanel)) {
            set({ [side]: { ...sb, hidden: false } });
            return;
          }
        }
        // activePanel은 chat이 아니지만 panels에 chat이 있으면 전환
        for (const side of ['rightSidebar', 'leftSidebar'] as const) {
          const sb = state[side];
          const chatPanel = sb.panels.find(isChatPanel);
          if (chatPanel) {
            set({ [side]: { ...sb, hidden: false, activePanel: chatPanel } });
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
              set({ [s]: { ...refreshed[s], hidden: false, activePanel: chatPanel } });
              return;
            }
          }
        } else {
          // 세션 자체가 없으면 새로 생성 (createSession → addChatPanel 자동 호출)
          chatState.createSession();
        }
      },

      floatChatPanel: (sessionId: string): void => {
        const state = get();
        const panel = chatPanelId(sessionId);
        const rightSidebar = state.rightSidebar;
        if (!rightSidebar.panels.includes(panel)) return;

        const fallback = rightSidebar.panels.find((candidate) => candidate !== panel && isChatPanel(candidate)) ?? null;
        set({
          floatingChatSessionId: sessionId,
          rightSidebar: fallback
            ? { ...rightSidebar, activePanel: fallback, hidden: false }
            : { ...rightSidebar, hidden: true },
        });
      },

      dockFloatingChat: (): void => {
        const state = get();
        const sessionId = state.floatingChatSessionId;
        if (!sessionId) return;

        const panel = chatPanelId(sessionId);
        const rightSidebar = state.rightSidebar;
        set({
          floatingChatSessionId: null,
          rightSidebar: {
            ...rightSidebar,
            panels: rightSidebar.panels.includes(panel)
              ? rightSidebar.panels
              : [...rightSidebar.panels, panel],
            activePanel: panel,
            hidden: false,
          },
        });
      },

      closeFloatingChat: (): void => {
        set({ floatingChatSessionId: null });
      },

      setFloatingChatRect: (rect: FloatingChatRect): void => {
        set({ floatingChatRect: rect });
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

      setProjectSidebarWidth: (width: number): void => {
        const clamped = Math.max(LAYOUT.PROJECT_MIN, Math.min(LAYOUT.PROJECT_MAX, width));
        set({ projectSidebarWidth: clamped });
      },

      // Paste settings
      setPasteImageMode: (mode: 'placeholder' | 'original' | 'ignore'): void => {
        set({ pasteImageMode: mode });
      },

      setPasteLinkPreserve: (preserve: boolean): void => {
        set({ pasteLinkPreserve: preserve });
      },

      // Editor zoom
      setEditorZoom: (zoom: number): void => {
        set({ editorZoom: Math.max(0.5, Math.min(2.0, Math.round(zoom * 10) / 10)) });
      },

      adjustEditorZoom: (delta: number): void => {
        set((state) => ({
          editorZoom: Math.max(0.5, Math.min(2.0, Math.round((state.editorZoom + delta) * 10) / 10)),
        }));
      },

      resetEditorZoom: (): void => {
        set({ editorZoom: 1.0 });
      },
    }),
    {
      name: 'ite-ui-storage',
      version: 7,
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

        // v4 이하 → v5: 'comments' 고정 패널 추가(idempotent).
        // review 탭이 있는 사이드에 함께 두고, 없으면 left에 추가. 이미 있으면 no-op.
        if (version < 5) {
          const hasComments = (['leftSidebar', 'rightSidebar'] as const).some((side) => {
            const sb = data[side] as Record<string, unknown> | undefined;
            return Array.isArray(sb?.panels) && (sb.panels as string[]).includes('comments');
          });
          if (!hasComments) {
            const reviewSide = (['leftSidebar', 'rightSidebar'] as const).find((side) => {
              const sb = data[side] as Record<string, unknown> | undefined;
              return Array.isArray(sb?.panels) && (sb.panels as string[]).includes('review');
            });
            const targetSide = reviewSide ?? 'leftSidebar';
            const sb = data[targetSide] as Record<string, unknown> | undefined;
            if (sb && Array.isArray(sb.panels)) {
              (sb.panels as string[]).push('comments');
            } else {
              data[targetSide] = { collapsed: false, panels: ['comments'], activePanel: 'comments', width: 250 };
            }
          }
        }

        // v5 이하 → v6: collapsed→hidden 리네임 + 역할 정규화.
        // 좌=고정패널 전용, 우=채팅 전용. 위반 패널(좌측 chat, 우측 fixed)을 재배치한다.
        if (version < 6) {
          const isChat = (p: string): boolean => p.startsWith('chat:');
          const left = data.leftSidebar as Record<string, unknown> | undefined;
          const right = data.rightSidebar as Record<string, unknown> | undefined;
          const leftPanels = Array.isArray(left?.panels) ? (left!.panels as string[]) : [];
          const rightPanels = Array.isArray(right?.panels) ? (right!.panels as string[]) : [];

          // 위반 패널 수집
          const chatFromLeft = leftPanels.filter(isChat);
          const fixedFromRight = rightPanels.filter((p) => !isChat(p));

          // 정규화된 패널 목록 (중복 제거)
          let nextLeft = [
            ...leftPanels.filter((p) => !isChat(p)),
            ...fixedFromRight.filter((p) => !leftPanels.includes(p)),
          ];
          // 좌측은 고정 패널 전용 바이므로 최소 한 개는 보장한다.
          // (구 컨텍스트 메뉴로 고정 패널을 전부 우측으로 옮긴 뒤 삭제된 상태 등에서 좌측이 비어
          //  hidden:false + panels:[] 로 렌더 null이 되면 되살림 진입점이 사라지는 dead-end 방지)
          if (nextLeft.length === 0) {
            nextLeft = ['settings', 'review', 'comments'];
          }
          const nextRight = [
            ...rightPanels.filter(isChat),
            ...chatFromLeft.filter((p) => !rightPanels.includes(p)),
          ];

          const normalizeSide = (
            sb: Record<string, unknown> | undefined,
            nextPanels: string[],
          ): Record<string, unknown> => {
            const base = sb ?? {};
            const prevActive = base.activePanel as string | null | undefined;
            const activePanel = prevActive && nextPanels.includes(prevActive)
              ? prevActive
              : (nextPanels[0] ?? null);
            const hidden = 'hidden' in base ? Boolean(base.hidden) : Boolean(base.collapsed);
            return {
              hidden,
              panels: nextPanels,
              activePanel,
              width: (base.width as number) ?? 250,
            };
          };

          data.leftSidebar = normalizeSide(left, nextLeft);
          data.rightSidebar = normalizeSide(right, nextRight);
        }

        if (version < 7) {
          data.floatingChatSessionId = null;
          data.floatingChatRect = { x: 24, y: 24, width: 400, height: 560 };
        }

        return data;
      },
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        focusMode: state.focusMode,
        sourceOnlyMode: state.sourceOnlyMode,
        projectSidebarCollapsed: state.projectSidebarCollapsed,
        projectSidebarWidth: state.projectSidebarWidth,
        isPanelsSwapped: state.isPanelsSwapped,
        // Dual sidebar persist
        leftSidebar: state.leftSidebar,
        rightSidebar: state.rightSidebar,
        floatingChatSessionId: state.floatingChatSessionId,
        floatingChatRect: state.floatingChatRect,
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
        // Editor zoom
        editorZoom: state.editorZoom,
      }),
    }
  )
);
