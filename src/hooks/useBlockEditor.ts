import { useState, useEffect, useMemo } from 'react';
import { useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';

interface UseBlockEditorOptions {
  content: string;
  readOnly?: boolean;
  onChange?: (content: string) => void;
  blockId: string;
}

interface UseBlockEditorReturn {
  editor: Editor | null;
  isFocused: boolean;
}

/**
 * TipTap 에디터를 위한 커스텀 훅
 */
export function useBlockEditor({
  content,
  readOnly = false,
  onChange,
  blockId,
}: UseBlockEditorOptions): UseBlockEditorReturn {
  const [isFocused, setIsFocused] = useState(false);
  const splitBlock = useProjectStore((s) => s.splitBlock);
  const mergeWithPreviousTargetBlock = useProjectStore((s) => s.mergeWithPreviousTargetBlock);
  const hasPendingDiff = useProjectStore((s) => s.hasPendingDiff(blockId));
  const acceptDiff = useProjectStore((s) => s.acceptDiff);
  const rejectDiff = useProjectStore((s) => s.rejectDiff);
  const setSelectedBlockId = useUIStore((s) => s.setSelectedBlockId);

  const stableContent = useMemo(() => content, [content]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // 기본 설정
        heading: false,
        bulletList: false,
        orderedList: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
    ],
    content: stableContent,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'outline-none',
        'data-block-id': blockId,
      },
      handleKeyDown: (_view, event) => {
        // Cmd+L or Cmd+K: Selection to Chat (모델 호출 없음)
        // readOnly(source)에서도 동작해야 하므로 readOnly 체크보다 먼저 처리합니다.
        const isSelectionShortcut = (event.metaKey || event.ctrlKey) &&
          (event.key.toLowerCase() === 'l' || event.key.toLowerCase() === 'k');

        if (isSelectionShortcut) {
          event.preventDefault();
          void (async () => {
            if (!editor) return;
            const { from, to } = editor.state.selection;
            const selected = editor.state.doc.textBetween(from, to, ' ').trim();

            // getState()를 사용하여 stale closure 문제 방지
            const { addContextBlock } = useChatStore.getState();
            const { sidebarCollapsed, toggleSidebar, setActivePanel } = useUIStore.getState();
            const { appendComposerText, requestComposerFocus } = useChatStore.getState();

            // 현재 블록을 컨텍스트로 등록 (Context Injection)
            addContextBlock(blockId);
            if (sidebarCollapsed) toggleSidebar();
            setActivePanel('chat');
            if (selected.length > 0) {
              appendComposerText(selected);
            }
            requestComposerFocus();
          })();
          return true;
        }

        if (readOnly) return false;

        // Enter: 블록 분할 (N:M)
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (!editor) return true;
          const { from } = editor.state.selection;
          const before = editor.state.doc.textBetween(0, from, '\n', '\n');
          const offset = before.length;
          splitBlock(blockId, offset);
          return true;
        }

        // Backspace: 블록 시작이면 이전 블록과 병합
        if (event.key === 'Backspace') {
          if (!editor) return false;
          const { from, to, empty } = editor.state.selection;
          if (empty && from === to && from <= 1) {
            event.preventDefault();
            mergeWithPreviousTargetBlock(blockId);
            return true;
          }
        }

        // Cmd+Y / Cmd+N: Diff Accept/Reject
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
          if (hasPendingDiff) {
            event.preventDefault();
            acceptDiff(blockId);
            return true;
          }
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
          if (hasPendingDiff) {
            event.preventDefault();
            rejectDiff(blockId);
            return true;
          }
        }

        return false;
      },
    },
    onFocus: () => {
      setIsFocused(true);
      setSelectedBlockId(blockId);
    },
    onBlur: () => {
      setIsFocused(false);
    },
    onUpdate: ({ editor: ed }) => {
      if (onChange) {
        onChange(ed.getHTML());
      }
    },
  });

  // 외부 content 변경 시 에디터 업데이트
  useEffect(() => {
    if (editor && editor.getHTML() !== content) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  return {
    editor,
    isFocused,
  };
}

