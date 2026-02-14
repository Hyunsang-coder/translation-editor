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
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useReviewStore } from '@/stores/reviewStore';
import { ReviewHighlight, refreshEditorHighlight } from '@/editor/extensions/ReviewHighlight';
import { SearchHighlight } from '@/editor/extensions/SearchHighlight';
import { normalizePastedHtml } from '@/utils/htmlNormalizer';
import { replaceDocContent } from '@/editor/utils/replaceDocContent';

export interface TipTapEditorProps {
  panelType: 'source' | 'target';
  content: string;
  onChange?: (content: string) => void;
  onJsonChange?: (json: Record<string, unknown>) => void;
  className?: string;
  onEditorReady?: (editor: Editor) => void;
  onSearchOpen?: () => void;
  onSearchOpenWithReplace?: () => void;
}

function TipTapEditor({
  panelType,
  content,
  onChange,
  onJsonChange,
  className = '',
  onEditorReady,
  onSearchOpen,
  onSearchOpenWithReplace,
}: TipTapEditorProps): JSX.Element {
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
        placeholder: t(panelType === 'source' ? 'editor.sourcePlaceholder' : 'editor.targetPlaceholder'),
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
        excerptField: panelType === 'source' ? 'sourceExcerpt' : 'targetExcerpt',
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
  }, [imageExtension, pasteLinkPreserve, t, panelType]);

  const lastContentRef = useRef<string>(content);

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
        if (panelType === 'target') {
          const isReplaceShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'h';
          if (isReplaceShortcut) {
            event.preventDefault();
            onSearchOpenWithReplace?.();
            return true;
          }
        }

        const isSelectionShortcut = (event.metaKey || event.ctrlKey) &&
          (event.key.toLowerCase() === 'l' || event.key.toLowerCase() === 'k');

        if (isSelectionShortcut && editor) {
          const { from, to } = editor.state.selection;
          if (from === to) return false;

          event.preventDefault();
          const selected = editor.state.doc.textBetween(from, to, ' ').trim();

          const { openActiveChat } = useUIStore.getState();
          const { appendComposerText, requestComposerFocus } = useChatStore.getState();

          // Chat 패널 열기
          openActiveChat();
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
      lastContentRef.current = ed.getHTML();
      if (onJsonChange) {
        onJsonChange(ed.getJSON() as Record<string, unknown>);
      }
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      lastContentRef.current = html;
      if (onChange) {
        onChange(html);
      }
      if (onJsonChange) {
        onJsonChange(ed.getJSON() as Record<string, unknown>);
      }
    },
  }, [extensions]);

  // 외부 content 변경 시 에디터 업데이트 (lastContentRef로 비교하여 false positive 방지)
  useEffect(() => {
    if (!editor) return;
    if (content === lastContentRef.current) return;
    replaceDocContent(editor, content, { addToHistory: false });
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
    <div className={`tiptap-wrapper ${panelType}-editor ${className}`} data-testid={`${panelType}-editor`}>
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
}

// 하위 호환 래퍼
type PanellessProps = Omit<TipTapEditorProps, 'panelType'>;

export function SourceTipTapEditor(props: PanellessProps): JSX.Element {
  return TipTapEditor({ ...props, panelType: 'source' });
}

export function TargetTipTapEditor(props: PanellessProps): JSX.Element {
  return TipTapEditor({ ...props, panelType: 'target' });
}
