import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useReviewStore } from '@/stores/reviewStore';
import { ReviewHighlight, refreshEditorHighlight } from '@/editor/extensions/ReviewHighlight';

export interface TipTapEditorProps {
  content: string;
  onChange?: (content: string) => void;
  onJsonChange?: (json: Record<string, unknown>) => void;
  editable?: boolean;
  placeholder?: string;
  className?: string;
  onEditorReady?: (editor: Editor) => void;
}

/**
 * TipTap 기반 Notion 스타일 에디터
 * - Source 패널: editable=true (편집 가능)
 * - Target 패널: editable=true (편집 가능)
 */
export function TipTapEditor({
  content,
  onChange,
  onJsonChange,
  editable = true,
  placeholder = '내용을 입력하세요...',
  className = '',
  onEditorReady,
}: TipTapEditorProps): JSX.Element {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Heading은 StarterKit에 포함됨 (H1-H6)
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        // BulletList, OrderedList, Bold, Italic, Strike, Blockquote 모두 포함
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'tiptap-link',
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'tiptap-empty',
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content,
    editable,
    editorProps: {
      attributes: {
        class: 'tiptap-editor focus:outline-none',
      },
      handleKeyDown: (_view, event) => {
        // Cmd+L or Cmd+K: Selection to Chat (모델 호출 없음)
        const isSelectionShortcut = (event.metaKey || event.ctrlKey) &&
          (event.key.toLowerCase() === 'l' || event.key.toLowerCase() === 'k');

        if (isSelectionShortcut) {
          if (!editor) return false;
          const { from, to } = editor.state.selection;
          if (from === to) return false;

          event.preventDefault();
          const selected = editor.state.doc.textBetween(from, to, ' ').trim();

          const { setChatPanelOpen } = useUIStore.getState();
          const { appendComposerText, requestComposerFocus } = useChatStore.getState();

          // 플로팅 Chat 패널 열기
          setChatPanelOpen(true);
          if (selected.length > 0) {
            appendComposerText(selected);
          }
          requestComposerFocus();
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (onChange) {
        onChange(editor.getHTML());
      }
      if (onJsonChange) {
        onJsonChange(editor.getJSON() as Record<string, unknown>);
      }
    },
  });

  // 외부 content 변경 시 에디터 업데이트
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [editor, content]);

  // editable 상태 변경 시 업데이트
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  // 에디터 준비 완료 콜백
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  if (!editor) {
    return <div className="h-full animate-pulse bg-editor-surface rounded-md" />;
  }

  return (
    <div className={`tiptap-wrapper ${className}`}>
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
}

/**
 * Source 패널용 편집 가능 에디터
 * ReviewHighlight Extension이 포함되어 검수 이슈 하이라이트 지원 (sourceExcerpt 기반)
 */
export function SourceTipTapEditor({
  content,
  onChange,
  onJsonChange,
  className = '',
  onEditorReady,
}: {
  content: string;
  onChange?: (content: string) => void;
  onJsonChange?: (json: Record<string, unknown>) => void;
  className?: string;
  onEditorReady?: (editor: Editor) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const highlightNonce = useReviewStore((s) => s.highlightNonce);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'tiptap-link',
        },
      }),
      Placeholder.configure({
        placeholder: t('editor.sourcePlaceholder'),
        emptyEditorClass: 'tiptap-empty',
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      ReviewHighlight.configure({
        highlightClass: 'review-highlight',
        excerptField: 'sourceExcerpt',
      }),
    ],
    content,
    editable: true,
    editorProps: {
      attributes: {
        class: 'tiptap-editor focus:outline-none',
      },
      handleKeyDown: (_view, event) => {
        const isSelectionShortcut = (event.metaKey || event.ctrlKey) &&
          (event.key.toLowerCase() === 'l' || event.key.toLowerCase() === 'k');

        if (isSelectionShortcut && editor) {
          const { from, to } = editor.state.selection;
          if (from === to) return false;

          event.preventDefault();
          const selected = editor.state.doc.textBetween(from, to, ' ').trim();

          const { setChatPanelOpen } = useUIStore.getState();
          const { appendComposerText, requestComposerFocus } = useChatStore.getState();

          // 플로팅 Chat 패널 열기
          setChatPanelOpen(true);
          if (selected.length > 0) {
            appendComposerText(selected);
          }
          requestComposerFocus();
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (onChange) {
        onChange(ed.getHTML());
      }
      if (onJsonChange) {
        onJsonChange(ed.getJSON() as Record<string, unknown>);
      }
    },
  });

  // 외부 content 변경 시 에디터 업데이트
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [editor, content]);

  // 에디터 준비 완료 콜백
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // highlightNonce 변경 시 decoration 새로고침
  useEffect(() => {
    if (editor && highlightNonce > 0) {
      refreshEditorHighlight(editor);
    }
  }, [editor, highlightNonce]);

  if (!editor) {
    return <div className="h-full animate-pulse bg-editor-surface rounded-md" />;
  }

  return (
    <div className={`tiptap-wrapper source-editor ${className}`}>
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
}

/**
 * Target 패널용 편집 가능 에디터
 * ReviewHighlight Extension이 포함되어 검수 이슈 하이라이트 지원
 */
export function TargetTipTapEditor({
  content,
  onChange,
  onJsonChange,
  className = '',
  onEditorReady,
}: {
  content: string;
  onChange?: (content: string) => void;
  onJsonChange?: (json: Record<string, unknown>) => void;
  className?: string;
  onEditorReady?: (editor: Editor) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const highlightNonce = useReviewStore((s) => s.highlightNonce);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'tiptap-link',
        },
      }),
      Placeholder.configure({
        placeholder: t('editor.targetPlaceholder'),
        emptyEditorClass: 'tiptap-empty',
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      ReviewHighlight.configure({
        highlightClass: 'review-highlight',
        excerptField: 'targetExcerpt',
      }),
    ],
    content,
    editable: true,
    editorProps: {
      attributes: {
        class: 'tiptap-editor focus:outline-none',
      },
      handleKeyDown: (_view, event) => {
        const isSelectionShortcut = (event.metaKey || event.ctrlKey) &&
          (event.key.toLowerCase() === 'l' || event.key.toLowerCase() === 'k');

        if (isSelectionShortcut && editor) {
          const { from, to } = editor.state.selection;
          if (from === to) return false;

          event.preventDefault();
          const selected = editor.state.doc.textBetween(from, to, ' ').trim();

          const { setChatPanelOpen } = useUIStore.getState();
          const { appendComposerText, requestComposerFocus } = useChatStore.getState();

          // 플로팅 Chat 패널 열기
          setChatPanelOpen(true);
          if (selected.length > 0) {
            appendComposerText(selected);
          }
          requestComposerFocus();
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (onChange) {
        onChange(ed.getHTML());
      }
      if (onJsonChange) {
        onJsonChange(ed.getJSON() as Record<string, unknown>);
      }
    },
  });

  // 외부 content 변경 시 에디터 업데이트
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [editor, content]);

  // 에디터 준비 완료 콜백
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // highlightNonce 변경 시 decoration 새로고침
  useEffect(() => {
    if (editor && highlightNonce > 0) {
      refreshEditorHighlight(editor);
    }
  }, [editor, highlightNonce]);

  if (!editor) {
    return <div className="h-full animate-pulse bg-editor-surface rounded-md" />;
  }

  return (
    <div className={`tiptap-wrapper target-editor ${className}`}>
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
}

