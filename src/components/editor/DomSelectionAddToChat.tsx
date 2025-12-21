import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';

interface BubbleState {
  visible: boolean;
  top: number;
  left: number;
  text: string;
}

/**
 * DOM 텍스트 선택 기반(Cursor 스타일) Add to chat 플로팅 버튼
 * - Source 영역(일반 DOM selection)에서 사용
 * - Target(Monaco) selection은 Monaco 내부 이벤트로 별도 처리
 */
export function DomSelectionAddToChat(): JSX.Element | null {
  const [bubble, setBubble] = useState<BubbleState>({
    visible: false,
    top: 0,
    left: 0,
    text: '',
  });

  const portalEl = useMemo(() => document.body, []);

  useEffect(() => {
    const onSelectionChange = (): void => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        setBubble((b) => (b.visible ? { ...b, visible: false, text: '' } : b));
        return;
      }

      const range = sel.getRangeAt(0);
      if (!range || range.collapsed) {
        setBubble((b) => (b.visible ? { ...b, visible: false, text: '' } : b));
        return;
      }

      const text = sel.toString().trim();
      if (!text) {
        setBubble((b) => (b.visible ? { ...b, visible: false, text: '' } : b));
        return;
      }

      // Chat composer 안에서의 selection은 무시
      const anchorEl =
        (sel.anchorNode instanceof Element
          ? sel.anchorNode
          : sel.anchorNode?.parentElement) ?? null;
      if (anchorEl?.closest('[data-ite-chat-composer]')) {
        setBubble((b) => (b.visible ? { ...b, visible: false, text: '' } : b));
        return;
      }

      // Source 영역에서만 동작
      if (!anchorEl?.closest('[data-ite-source]')) {
        setBubble((b) => (b.visible ? { ...b, visible: false, text: '' } : b));
        return;
      }

      const rect = range.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;

      // Cursor 스타일: 선택 영역 오른쪽 위 근처
      const top = Math.max(8, rect.top - 36);
      const left = Math.min(window.innerWidth - 140, Math.max(8, rect.right - 20));

      setBubble({
        visible: true,
        top,
        left,
        text,
      });
    };

    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('scroll', onSelectionChange, { passive: true });
    window.addEventListener('resize', onSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('scroll', onSelectionChange);
      window.removeEventListener('resize', onSelectionChange);
    };
  }, []);

  if (!bubble.visible) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: bubble.top,
        left: bubble.left,
        zIndex: 50,
      }}
    >
      <button
        type="button"
        className="px-3 py-1.5 rounded-md text-sm font-medium bg-editor-surface border border-editor-border hover:bg-editor-bg transition-colors shadow-sm"
        onMouseDown={(e) => {
          // 클릭 시 selection이 바로 풀리는 걸 방지
          e.preventDefault();
        }}
        onClick={() => {
          const ui = useUIStore.getState();
          if (ui.sidebarCollapsed) ui.toggleSidebar();
          ui.setActivePanel('chat');

          const chat = useChatStore.getState();
          chat.appendComposerText(bubble.text);
          chat.requestComposerFocus();

          // bubble을 닫기 위해 selection 해제
          window.getSelection()?.removeAllRanges();
          setBubble((b) => ({ ...b, visible: false, text: '' }));
        }}
        title="선택한 텍스트를 채팅 입력창에 추가"
      >
        Add to chat
      </button>
    </div>,
    portalEl,
  );
}


