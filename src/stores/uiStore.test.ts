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
