/**
 * 채팅 컴포저용 경량 TipTap 에디터
 *
 * 기존 TipTapEditor.tsx와 별개로 채팅 입력에 최적화된 에디터입니다.
 * - 리치 텍스트 입력 (굵게, 기울임, 링크 등)
 * - Enter로 전송, Shift+Enter로 줄바꿈
 * - IME 입력 중 Enter 무시 (한글 입력 호환)
 * - composerText (Markdown)와 양방향 동기화
 */

import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { useEffect, useRef, useCallback } from 'react';

export interface ChatComposerEditorProps {
  /** Markdown 콘텐츠 (composerText) */
  content: string;
  /** Markdown 변경 시 호출 */
  onChange: (markdown: string) => void;
  /** Enter 키로 전송 (Shift+Enter는 줄바꿈) */
  onSubmit: () => void;
  /** 에디터 비활성화 (로딩 중 등) */
  disabled?: boolean;
  /** placeholder 텍스트 */
  placeholder?: string;
  /** 추가 className */
  className?: string;
  /** 에디터 인스턴스 접근용 콜백 */
  onEditorReady?: (editor: Editor) => void;
}

export function ChatComposerEditor({
  content,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = '메시지를 입력하세요...',
  className = '',
  onEditorReady,
}: ChatComposerEditorProps): JSX.Element {
  // IME 입력 상태 추적 (한글 조합 중 Enter 방지)
  const isComposingRef = useRef(false);

  // 외부에서 content 변경 시 에디터 업데이트 (sync direction: content -> editor)
  const lastSetContentRef = useRef<string>('');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, // 채팅에서는 헤딩 불필요
        codeBlock: false, // 인라인 코드만 사용
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary-500 underline',
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      Underline,
      Highlight.configure({ multicolor: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: '-',
        linkify: false,
        breaks: true, // 채팅에서는 줄바꿈 유지
        transformPastedText: true,
        transformCopiedText: false,
      }),
    ],
    content: '', // 초기 content는 useEffect에서 설정
    editable: !disabled,
    editorProps: {
      attributes: {
        class: 'chat-composer-tiptap focus:outline-none',
      },
      handleKeyDown: (_view, event) => {
        // Enter 키 처리
        if (event.key === 'Enter') {
          // Shift+Enter: 줄바꿈 (기본 동작)
          if (event.shiftKey) {
            return false;
          }

          // IME 조합 중이면 무시
          if (isComposingRef.current || event.isComposing) {
            return false;
          }

          // Enter: 전송
          event.preventDefault();
          onSubmit();
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      // 에디터 -> composerText 동기화
      const markdown = ed.storage.markdown?.getMarkdown() ?? '';
      lastSetContentRef.current = markdown;
      onChange(markdown);
    },
  });

  // IME 이벤트 핸들러
  useEffect(() => {
    if (!editor) return;

    const dom = editor.view.dom;

    const handleCompositionStart = () => {
      isComposingRef.current = true;
    };

    const handleCompositionEnd = () => {
      isComposingRef.current = false;
    };

    dom.addEventListener('compositionstart', handleCompositionStart);
    dom.addEventListener('compositionend', handleCompositionEnd);

    return () => {
      dom.removeEventListener('compositionstart', handleCompositionStart);
      dom.removeEventListener('compositionend', handleCompositionEnd);
    };
  }, [editor]);

  // 외부 content 변경 시 에디터 동기화
  useEffect(() => {
    if (!editor) return;

    // 자체 onChange로 인한 변경은 무시 (무한 루프 방지)
    if (content === lastSetContentRef.current) return;

    // 빈 문자열이면 clearContent
    if (!content || content.trim() === '') {
      if (!editor.isEmpty) {
        editor.commands.clearContent();
        lastSetContentRef.current = '';
      }
      return;
    }

    // Markdown을 에디터에 설정
    lastSetContentRef.current = content;
    editor.commands.setContent(content);
  }, [editor, content]);

  // editable 상태 변경 시 업데이트
  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [editor, disabled]);

  // 에디터 준비 완료 콜백
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // 콘텐츠 초기화 메서드 (전송 후 사용)
  const clearContent = useCallback(() => {
    if (editor) {
      editor.commands.clearContent();
      lastSetContentRef.current = '';
    }
  }, [editor]);

  // 에디터 인스턴스에 clearContent 메서드 노출
  useEffect(() => {
    if (editor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (editor as any).clearComposerContent = clearContent;
    }
  }, [editor, clearContent]);

  if (!editor) {
    return <div className={`h-full animate-pulse bg-editor-surface rounded-md ${className}`} />;
  }

  return (
    <div className={`chat-composer-editor-wrapper ${className}`}>
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
}
