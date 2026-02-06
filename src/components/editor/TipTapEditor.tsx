import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { ImageOriginal, ImagePlaceholder } from '@/editor/extensions/ImagePlaceholder';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useReviewStore } from '@/stores/reviewStore';
import { ReviewHighlight, refreshEditorHighlight } from '@/editor/extensions/ReviewHighlight';
import { SearchHighlight } from '@/editor/extensions/SearchHighlight';
import { normalizePastedHtml } from '@/utils/htmlNormalizer';

/**
 * Source 패널용 편집 가능 에디터
 * ReviewHighlight Extension이 포함되어 검수 이슈 하이라이트 지원 (sourceExcerpt 기반)
 */
export interface SourceTargetEditorProps {
  content: string;
  onChange?: (content: string) => void;
  onJsonChange?: (json: Record<string, unknown>) => void;
  className?: string;
  onEditorReady?: (editor: Editor) => void;
  onSearchOpen?: () => void;
  onSearchOpenWithReplace?: () => void;
}

export function SourceTipTapEditor({
  content,
  onChange,
  onJsonChange,
  className = '',
  onEditorReady,
  onSearchOpen,
}: SourceTargetEditorProps): JSX.Element {
  const { t } = useTranslation();
  const highlightNonce = useReviewStore((s) => s.highlightNonce);
  const pasteImageMode = useUIStore((s) => s.pasteImageMode);
  const pasteLinkPreserve = useUIStore((s) => s.pasteLinkPreserve);

  // pasteImageMode에 따라 Image extension 선택
  // original: 기본 Image (실제 <img> 렌더링), placeholder/ignore: ImagePlaceholder
  const imageExtension = useMemo(() => {
    if (pasteImageMode === 'original') {
      return ImageOriginal.configure({ inline: true, allowBase64: true });
    }
    return ImagePlaceholder.configure({ inline: true, allowBase64: true });
  }, [pasteImageMode]);

  // pasteLinkPreserve에 따라 Link extension 포함/제외
  // false면 에디터에 링크 mark 자체가 존재하지 않음
  const extensions = useMemo(() => {
    const base = [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        history: { depth: 100, newGroupDelay: 500 },
      }),
      Placeholder.configure({
        placeholder: t('editor.sourcePlaceholder'),
        emptyEditorClass: 'tiptap-empty',
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      imageExtension,
      Underline,
      Highlight.configure({ multicolor: false }),
      Subscript,
      Superscript,
      ReviewHighlight.configure({
        highlightClass: 'review-highlight',
        excerptField: 'sourceExcerpt',
      }),
      SearchHighlight.configure({
        searchClass: 'search-match',
        currentClass: 'search-current',
      }),
    ];
    if (pasteLinkPreserve) {
      base.splice(1, 0, Link.configure({
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        HTMLAttributes: { class: 'tiptap-link' },
      }));
    }
    return base;
  }, [imageExtension, pasteLinkPreserve, t]);

  const editor = useEditor({
    extensions,
    content,
    editable: true,
    editorProps: {
      attributes: {
        class: 'tiptap-editor focus:outline-none',
      },
      transformPastedHTML: (html) => {
        // 항상 최신 설정값을 읽어서 stale closure 문제 방지
        const { pasteImageMode: imgMode } = useUIStore.getState();
        const removeImages = imgMode === 'ignore';
        if (removeImages) {
          return normalizePastedHtml(html, { removeImages });
        }
        return normalizePastedHtml(html);
      },
      handleKeyDown: (_view, event) => {
        // Cmd+F: 검색 열기
        const isSearchShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f';
        if (isSearchShortcut) {
          event.preventDefault();
          onSearchOpen?.();
          return true;
        }

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
    onCreate: ({ editor: ed }) => {
      // 에디터 초기화 시 JSON 상태 동기화 (AI 도구용)
      if (onJsonChange) {
        onJsonChange(ed.getJSON() as Record<string, unknown>);
      }
    },
    onUpdate: ({ editor: ed }) => {
      if (onChange) {
        onChange(ed.getHTML());
      }
      if (onJsonChange) {
        onJsonChange(ed.getJSON() as Record<string, unknown>);
      }
    },
  }, [extensions]);

  // 외부 content 변경 시 에디터 업데이트
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
      // Issue #4 수정: setContent는 onUpdate를 트리거하지 않을 수 있으므로 명시적 동기화
      if (onJsonChange) {
        onJsonChange(editor.getJSON() as Record<string, unknown>);
      }
    }
  }, [editor, content, onJsonChange]);

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

  // 에디터 cleanup (메모리 누수 방지)
  useEffect(() => {
    return () => {
      if (editor) {
        editor.destroy();
      }
    };
  }, [editor]);

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
  onSearchOpen,
  onSearchOpenWithReplace,
}: SourceTargetEditorProps): JSX.Element {
  const { t } = useTranslation();
  const highlightNonce = useReviewStore((s) => s.highlightNonce);
  const pasteImageMode = useUIStore((s) => s.pasteImageMode);
  const pasteLinkPreserve = useUIStore((s) => s.pasteLinkPreserve);

  const imageExtension = useMemo(() => {
    if (pasteImageMode === 'original') {
      return ImageOriginal.configure({ inline: true, allowBase64: true });
    }
    return ImagePlaceholder.configure({ inline: true, allowBase64: true });
  }, [pasteImageMode]);

  const extensions = useMemo(() => {
    const base = [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        history: { depth: 100, newGroupDelay: 500 },
      }),
      Placeholder.configure({
        placeholder: t('editor.targetPlaceholder'),
        emptyEditorClass: 'tiptap-empty',
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      imageExtension,
      Underline,
      Highlight.configure({ multicolor: false }),
      Subscript,
      Superscript,
      ReviewHighlight.configure({
        highlightClass: 'review-highlight',
        excerptField: 'targetExcerpt',
      }),
      SearchHighlight.configure({
        searchClass: 'search-match',
        currentClass: 'search-current',
      }),
    ];
    if (pasteLinkPreserve) {
      base.splice(1, 0, Link.configure({
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        HTMLAttributes: { class: 'tiptap-link' },
      }));
    }
    return base;
  }, [imageExtension, pasteLinkPreserve, t]);

  const editor = useEditor({
    extensions,
    content,
    editable: true,
    editorProps: {
      attributes: {
        class: 'tiptap-editor focus:outline-none',
      },
      transformPastedHTML: (html) => {
        // 항상 최신 설정값을 읽어서 stale closure 문제 방지
        const { pasteImageMode: imgMode } = useUIStore.getState();
        const removeImages = imgMode === 'ignore';
        if (removeImages) {
          return normalizePastedHtml(html, { removeImages });
        }
        return normalizePastedHtml(html);
      },
      handleKeyDown: (_view, event) => {
        // Cmd+F: 검색 열기
        const isSearchShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f';
        if (isSearchShortcut) {
          event.preventDefault();
          onSearchOpen?.();
          return true;
        }

        // Cmd+H: 검색+치환 열기 (target 패널 전용)
        const isReplaceShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'h';
        if (isReplaceShortcut) {
          event.preventDefault();
          onSearchOpenWithReplace?.();
          return true;
        }

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
    onCreate: ({ editor: ed }) => {
      // 에디터 초기화 시 JSON 상태 동기화 (AI 도구용)
      if (onJsonChange) {
        onJsonChange(ed.getJSON() as Record<string, unknown>);
      }
    },
    onUpdate: ({ editor: ed }) => {
      if (onChange) {
        onChange(ed.getHTML());
      }
      if (onJsonChange) {
        onJsonChange(ed.getJSON() as Record<string, unknown>);
      }
    },
  }, [extensions]);

  // 외부 content 변경 시 에디터 업데이트
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
      // Issue #4 수정: setContent는 onUpdate를 트리거하지 않을 수 있으므로 명시적 동기화
      if (onJsonChange) {
        onJsonChange(editor.getJSON() as Record<string, unknown>);
      }
    }
  }, [editor, content, onJsonChange]);

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

  // 에디터 cleanup (메모리 누수 방지)
  useEffect(() => {
    return () => {
      if (editor) {
        editor.destroy();
      }
    };
  }, [editor]);

  if (!editor) {
    return <div className="h-full animate-pulse bg-editor-surface rounded-md" />;
  }

  return (
    <div className={`tiptap-wrapper target-editor ${className}`}>
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
}

