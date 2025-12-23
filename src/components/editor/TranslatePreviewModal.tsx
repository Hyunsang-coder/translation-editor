import { useEffect, useMemo } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import type { TipTapDocJson } from '@/ai/translateDocument';

export function TranslatePreviewModal(props: {
  open: boolean;
  title?: string;
  docJson: TipTapDocJson | null;
  isLoading?: boolean;
  error?: string | null;
  onClose: () => void;
  onApply: () => void;
}): JSX.Element | null {
  const { open, title, docJson, isLoading, error, onClose, onApply } = props;

  const content = useMemo(() => docJson ?? null, [docJson]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'tiptap-link' },
      }),
    ],
    content: content ?? undefined,
    editable: false,
    editorProps: {
      attributes: {
        class: 'tiptap-editor focus:outline-none',
      },
    },
  });

  // docJson이 비동기로 들어오므로, 에디터가 이미 생성된 뒤에도 content를 갱신해줘야 합니다.
  useEffect(() => {
    if (!editor) return;
    if (!open) return;
    if (!docJson) return;
    // setContent는 내부적으로 selection을 바꾸므로, focus는 건드리지 않습니다.
    editor.commands.setContent(docJson);
  }, [editor, open, docJson]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-6">
      <div className="w-full max-w-5xl h-[82vh] bg-editor-bg border border-editor-border rounded-lg overflow-hidden flex flex-col">
        <div className="h-12 px-4 border-b border-editor-border flex items-center justify-between bg-editor-surface">
          <div className="text-sm font-medium text-editor-text">
            {title ?? '번역 미리보기'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60 transition-colors"
              onClick={onApply}
              disabled={isLoading || !docJson}
              title="Apply (전체 덮어쓰기)"
            >
              Apply
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-editor-bg text-editor-text hover:bg-editor-border transition-colors"
              onClick={onClose}
              title="Close (ESC)"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-editor-muted">
              <div className="w-full max-w-md px-6">
                <div className="flex items-center justify-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary-500 animate-pulse" />
                  <div className="text-sm">번역 생성 중…</div>
                </div>
                <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-editor-border/60">
                  <div className="h-full w-1/2 rounded-full bg-primary-500 animate-pulse" />
                </div>
                <div className="mt-2 text-center text-[11px] text-editor-muted">
                  응답을 기다리는 중입니다. 잠시만요.
                </div>
              </div>
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center p-6">
              <div className="max-w-xl w-full bg-editor-surface border border-editor-border rounded-lg p-4">
                <div className="text-sm font-medium text-red-600 dark:text-red-400">
                  번역 미리보기를 생성할 수 없습니다
                </div>
                <div className="mt-2 text-sm text-editor-muted whitespace-pre-wrap">
                  {error}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full p-4 overflow-hidden">
              <div className="tiptap-wrapper h-full">
                {editor ? (
                  <EditorContent editor={editor} className="h-full" />
                ) : (
                  <div className="h-full animate-pulse bg-editor-surface rounded-md" />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


