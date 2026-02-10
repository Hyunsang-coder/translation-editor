import { beforeEach, describe, expect, it } from 'vitest';
import { chatPanelId } from '@/types';
import { useUIStore } from '@/stores/uiStore';

describe('uiStore syncChatPanels', () => {
  beforeEach(() => {
    useUIStore.setState({
      leftSidebar: { collapsed: false, panels: ['settings', 'review'], activePanel: 'settings', width: 250 },
      rightSidebar: { collapsed: false, panels: [], activePanel: null, width: 250 },
    });
  });

  it('stale left chat 패널 정리 후에도 missing 세션을 left에 복구한다', () => {
    useUIStore.setState({
      leftSidebar: {
        collapsed: false,
        panels: ['settings', chatPanelId('stale-session')],
        activePanel: chatPanelId('stale-session'),
        width: 250,
      },
      rightSidebar: { collapsed: false, panels: [], activePanel: null, width: 250 },
    });

    useUIStore.getState().syncChatPanels(['fresh-session']);

    const state = useUIStore.getState();
    expect(state.leftSidebar.panels).toContain(chatPanelId('fresh-session'));
    expect(state.rightSidebar.panels).not.toContain(chatPanelId('fresh-session'));
  });

  it('chat 위치 힌트가 없으면 missing 세션을 right에 복구한다', () => {
    useUIStore.getState().syncChatPanels(['session-a']);

    const state = useUIStore.getState();
    expect(state.rightSidebar.panels).toContain(chatPanelId('session-a'));
    expect(state.leftSidebar.panels).not.toContain(chatPanelId('session-a'));
  });

  it('유효한 left chat이 있으면 추가 missing 세션도 left에 붙인다', () => {
    useUIStore.setState({
      leftSidebar: {
        collapsed: false,
        panels: ['settings', chatPanelId('session-a')],
        activePanel: chatPanelId('session-a'),
        width: 250,
      },
      rightSidebar: { collapsed: false, panels: [], activePanel: null, width: 250 },
    });

    useUIStore.getState().syncChatPanels(['session-a', 'session-b']);

    const state = useUIStore.getState();
    expect(state.leftSidebar.panels).toContain(chatPanelId('session-b'));
    expect(state.rightSidebar.panels).not.toContain(chatPanelId('session-b'));
  });
});
