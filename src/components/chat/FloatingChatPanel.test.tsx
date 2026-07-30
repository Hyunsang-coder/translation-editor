import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingChatPanel } from './FloatingChatPanel';
import { useUIStore } from '@/stores/uiStore';
import { chatPanelId } from '@/types';

vi.mock('@/components/chat/ChatContent', () => ({
  ChatContent: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="floating-chat-content">{sessionId}</div>
  ),
}));

describe('FloatingChatPanel', () => {
  const panel = chatPanelId('session-a');

  beforeEach(() => {
    useUIStore.setState({
      floatingChatSessionId: 'session-a',
      floatingChatRect: { x: 24, y: 32, width: 400, height: 560 },
      rightSidebar: {
        hidden: true,
        panels: [panel],
        activePanel: panel,
        width: 320,
      },
    });
  });

  function renderPanel() {
    const host = document.createElement('div');
    document.body.append(host);
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    });
    return render(<FloatingChatPanel />, { container: host });
  }

  it('활성 세션의 채팅 콘텐츠를 저장된 위치와 크기로 표시한다', () => {
    renderPanel();

    const floating = screen.getByTestId('floating-chat-panel');
    expect(screen.getByTestId('floating-chat-content')).toHaveTextContent('session-a');
    expect(floating).toHaveStyle({ left: '24px', top: '32px', width: '400px', height: '560px' });
  });

  it('헤더를 드래그하면 패널 위치를 갱신한다', () => {
    renderPanel();

    fireEvent.mouseDown(screen.getByTestId('floating-chat-drag-handle'), { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 180, clientY: 150 });
    fireEvent.mouseUp(document);

    expect(useUIStore.getState().floatingChatRect).toMatchObject({ x: 104, y: 82 });
  });

  it('우측 하단 모서리를 드래그하면 패널 크기를 갱신한다', () => {
    renderPanel();

    fireEvent.mouseDown(screen.getByTestId('floating-chat-resize-se'), { clientX: 424, clientY: 592 });
    fireEvent.mouseMove(document, { clientX: 524, clientY: 672 });
    fireEvent.mouseUp(document);

    expect(useUIStore.getState().floatingChatRect).toMatchObject({ width: 500, height: 640 });
  });

  it('왼쪽 가장자리를 드래그하면 오른쪽 위치를 유지한 채 너비를 바꾼다', () => {
    renderPanel();

    fireEvent.mouseDown(screen.getByTestId('floating-chat-resize-w'), { clientX: 24, clientY: 300 });
    fireEvent.mouseMove(document, { clientX: 74, clientY: 300 });
    fireEvent.mouseUp(document);

    expect(useUIStore.getState().floatingChatRect).toMatchObject({ x: 74, width: 350 });
  });

  it('다시 도킹 버튼으로 채팅을 우측 사이드바에 복귀시킨다', () => {
    vi.useFakeTimers();
    try {
      renderPanel();

      fireEvent.click(screen.getByTestId('floating-chat-dock'));

      // 퇴장 애니메이션이 끝나기 전에는 아직 플로팅 상태를 유지한다
      // (사이드바에 같은 세션이 동시에 마운트되지 않도록).
      expect(useUIStore.getState().floatingChatSessionId).toBe('session-a');
      expect(screen.getByTestId('floating-chat-panel')).toHaveClass('floating-panel-exit');

      act(() => {
        vi.advanceTimersByTime(200);
      });

      const state = useUIStore.getState();
      expect(state.floatingChatSessionId).toBeNull();
      expect(state.rightSidebar.hidden).toBe(false);
      expect(state.rightSidebar.activePanel).toBe(panel);
    } finally {
      vi.useRealTimers();
    }
  });
});
