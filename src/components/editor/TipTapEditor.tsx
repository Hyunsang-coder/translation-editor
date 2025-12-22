import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect } from 'react';

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
 * - Source 패널: editable=false (읽기 전용)
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
    ],
    content,
    editable,
    editorProps: {
      attributes: {
        class: 'tiptap-editor focus:outline-none',
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
 * Source 패널용 읽기 전용 에디터
 */
export function SourceTipTapEditor({
  content,
  className = '',
}: {
  content: string;
  className?: string;
}): JSX.Element {
  return (
    <TipTapEditor
      content={content}
      editable={false}
      placeholder="원문이 여기에 표시됩니다..."
      className={`source-editor ${className}`}
    />
  );
}

/**
 * Target 패널용 편집 가능 에디터
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
  // Props를 명시적으로 구성하여 undefined 값 제외
  const props: TipTapEditorProps = {
    content,
    editable: true,
    placeholder: '번역문을 입력하세요...',
    className: `target-editor ${className}`,
  };
  
  if (onChange) props.onChange = onChange;
  if (onJsonChange) props.onJsonChange = onJsonChange;
  if (onEditorReady) props.onEditorReady = onEditorReady;

  return <TipTapEditor {...props} />;
}

