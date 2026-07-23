import { beforeEach, describe, expect, it } from 'vitest';
import { chatPanelId } from '@/types';
import { useUIStore } from '@/stores/uiStore';

describe('uiStore syncChatPanels', () => {
  beforeEach(() => {
    useUIStore.setState({
      leftSidebar: { hidden: false, panels: ['settings', 'review'], activePanel: 'settings', width: 250 },
      rightSidebar: { hidden: false, panels: [], activePanel: null, width: 250 },
    });
  });

  it('stale 우측 chat 정리 후 missing 세션을 우측에 복구한다', () => {
    useUIStore.setState({
      leftSidebar: { hidden: false, panels: ['settings'], activePanel: 'settings', width: 250 },
      rightSidebar: {
        hidden: false,
        panels: [chatPanelId('stale-session')],
        activePanel: chatPanelId('stale-session'),
        width: 250,
      },
    });

    useUIStore.getState().syncChatPanels(['fresh-session']);

    const state = useUIStore.getState();
    expect(state.rightSidebar.panels).toContain(chatPanelId('fresh-session'));
    expect(state.rightSidebar.panels).not.toContain(chatPanelId('stale-session'));
    expect(state.leftSidebar.panels).not.toContain(chatPanelId('fresh-session'));
  });

  it('missing 세션은 항상 우측에 복구한다', () => {
    useUIStore.getState().syncChatPanels(['session-a']);

    const state = useUIStore.getState();
    expect(state.rightSidebar.panels).toContain(chatPanelId('session-a'));
    expect(state.leftSidebar.panels).not.toContain(chatPanelId('session-a'));
  });

  it('좌측에 잘못 도킹된 chat은 우측으로 정규화된다', () => {
    // 역할 위반 상태(좌측 chat) — 마이그레이션 이전 데이터가 hydrate된 상황 모사
    useUIStore.setState({
      leftSidebar: {
        hidden: false,
        panels: ['settings', chatPanelId('session-a')],
        activePanel: chatPanelId('session-a'),
        width: 250,
      },
      rightSidebar: { hidden: false, panels: [], activePanel: null, width: 250 },
    });

    useUIStore.getState().syncChatPanels(['session-a', 'session-b']);

    const state = useUIStore.getState();
    expect(state.leftSidebar.panels).not.toContain(chatPanelId('session-a'));
    expect(state.rightSidebar.panels).toContain(chatPanelId('session-a'));
    expect(state.rightSidebar.panels).toContain(chatPanelId('session-b'));
  });
});

describe('uiStore toggleChatVisibility', () => {
  const rightChat = chatPanelId('right-chat');

  beforeEach(() => {
    // 역할 규칙: 채팅은 우측 전용. 우측 바에는 고정 패널이 없으므로
    // chat을 끄면 fallback 없이 우측 바가 hidden 처리된다.
    useUIStore.setState({
      leftSidebar: {
        hidden: false,
        panels: ['settings', 'review', 'comments'],
        activePanel: 'settings',
        width: 250,
      },
      rightSidebar: {
        hidden: false,
        panels: [rightChat],
        activePanel: rightChat,
        width: 250,
      },
    });
  });

  it('보이는 우측 chat을 끄면 우측 바가 숨겨진다', () => {
    useUIStore.getState().toggleChatVisibility();

    const state = useUIStore.getState();
    expect(state.rightSidebar.hidden).toBe(true);
    expect(state.rightSidebar.activePanel).toBe(rightChat);
  });

  it('꺼진 상태에서 다시 켜면 우측 chat 패널을 연다', () => {
    useUIStore.getState().toggleChatVisibility();
    useUIStore.getState().toggleChatVisibility();

    const state = useUIStore.getState();
    expect(state.rightSidebar.hidden).toBe(false);
    expect(state.rightSidebar.activePanel).toBe(rightChat);
  });
});

describe('uiStore movePanel 역할 가드', () => {
  const chat = chatPanelId('c1');

  beforeEach(() => {
    useUIStore.setState({
      leftSidebar: { hidden: false, panels: ['settings', 'review', 'comments'], activePanel: 'settings', width: 250 },
      rightSidebar: { hidden: false, panels: [chat], activePanel: chat, width: 250 },
    });
  });

  it('채팅을 좌측으로 이동하려 하면 거부한다', () => {
    useUIStore.getState().movePanel(chat, 'right', 'left');

    const state = useUIStore.getState();
    expect(state.leftSidebar.panels).not.toContain(chat);
    expect(state.rightSidebar.panels).toContain(chat);
  });

  it('고정 패널을 우측으로 이동하려 하면 거부한다', () => {
    useUIStore.getState().movePanel('settings', 'left', 'right');

    const state = useUIStore.getState();
    expect(state.rightSidebar.panels).not.toContain('settings');
    expect(state.leftSidebar.panels).toContain('settings');
  });
});

describe('uiStore floating chat', () => {
  const floatingChat = chatPanelId('floating-chat');
  const otherChat = chatPanelId('other-chat');

  beforeEach(() => {
    useUIStore.setState({
      floatingChatSessionId: null,
      floatingChatRect: { x: 24, y: 24, width: 400, height: 560 },
      leftSidebar: {
        hidden: false,
        panels: ['settings', 'review', 'comments'],
        activePanel: 'settings',
        width: 250,
      },
      rightSidebar: {
        hidden: false,
        panels: [floatingChat],
        activePanel: floatingChat,
        width: 320,
      },
    });
  });

  it('유일한 채팅을 플로팅하면 우측 사이드바를 숨긴다', () => {
    useUIStore.getState().floatChatPanel('floating-chat');

    const state = useUIStore.getState();
    expect(state.floatingChatSessionId).toBe('floating-chat');
    expect(state.rightSidebar.hidden).toBe(true);
    expect(state.rightSidebar.activePanel).toBe(floatingChat);
  });

  it('다른 채팅 탭이 있으면 사이드바에 다음 탭을 표시한다', () => {
    useUIStore.setState({
      rightSidebar: {
        hidden: false,
        panels: [floatingChat, otherChat],
        activePanel: floatingChat,
        width: 320,
      },
    });

    useUIStore.getState().floatChatPanel('floating-chat');

    const state = useUIStore.getState();
    expect(state.floatingChatSessionId).toBe('floating-chat');
    expect(state.rightSidebar.hidden).toBe(false);
    expect(state.rightSidebar.activePanel).toBe(otherChat);
  });

  it('다시 도킹하면 해당 채팅을 우측 사이드바에 연다', () => {
    useUIStore.getState().floatChatPanel('floating-chat');
    useUIStore.getState().dockFloatingChat();

    const state = useUIStore.getState();
    expect(state.floatingChatSessionId).toBeNull();
    expect(state.rightSidebar.hidden).toBe(false);
    expect(state.rightSidebar.activePanel).toBe(floatingChat);
  });

  it('플로팅 중인 세션이 삭제되면 플로팅 상태를 정리한다', () => {
    useUIStore.getState().floatChatPanel('floating-chat');
    useUIStore.getState().removeChatPanel('floating-chat');

    expect(useUIStore.getState().floatingChatSessionId).toBeNull();
  });

  it('채팅 토글을 끄면 플로팅 패널과 남은 채팅 사이드바를 함께 숨긴다', () => {
    useUIStore.setState({
      rightSidebar: {
        hidden: false,
        panels: [floatingChat, otherChat],
        activePanel: floatingChat,
        width: 320,
      },
    });
    useUIStore.getState().floatChatPanel('floating-chat');

    useUIStore.getState().toggleChatVisibility();

    const state = useUIStore.getState();
    expect(state.floatingChatSessionId).toBeNull();
    expect(state.rightSidebar.hidden).toBe(true);
  });
});

describe('uiStore 좌측 바 되살림 (empty-left 복구)', () => {
  it('좌측이 비어 있어도 openPanelOnSide로 settings를 복구·표시한다', () => {
    // dead-end 시나리오: 좌측 바가 비고 hidden:false 로 렌더 null 이 된 상태
    useUIStore.setState({
      leftSidebar: { hidden: false, panels: [], activePanel: null, width: 250 },
      rightSidebar: { hidden: false, panels: [], activePanel: null, width: 250 },
    });

    useUIStore.getState().openPanelOnSide('left', 'settings');

    const state = useUIStore.getState();
    expect(state.leftSidebar.panels).toContain('settings');
    expect(state.leftSidebar.activePanel).toBe('settings');
    expect(state.leftSidebar.hidden).toBe(false);
  });
});
