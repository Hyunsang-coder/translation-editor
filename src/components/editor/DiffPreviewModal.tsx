import { useEffect } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';

/**
 * Pending Edit Diff 미리보기 (Keep/Discard)
 * - Keep: Cmd+Y
 * - Discard: Cmd+N / ESC
 */
export function DiffPreviewModal(): JSX.Element | null {
  const pending = useProjectStore((s) => s.pendingDocDiff);
  const accept = useProjectStore((s) => s.acceptDocDiff);
  const reject = useProjectStore((s) => s.rejectDocDiff);
  const theme = useUIStore((s) => s.theme);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase();
      const cmd = e.metaKey || e.ctrlKey;

      if (cmd && key === 'y') {
        e.preventDefault();
        accept();
        return;
      }
      if (cmd && key === 'n') {
        e.preventDefault();
        reject();
        return;
      }
      if (key === 'escape') {
        e.preventDefault();
        reject();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pending, accept, reject]);

  if (!pending) return null;

  const monacoTheme = (() => {
    if (theme === 'dark') return 'vs-dark';
    if (theme === 'light') return 'light';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'vs-dark' : 'light';
  })();

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-6">
      <div className="w-full max-w-5xl h-[80vh] bg-editor-bg border border-editor-border rounded-lg overflow-hidden flex flex-col">
        <div className="h-12 px-4 border-b border-editor-border flex items-center justify-between bg-editor-surface">
          <div className="text-sm font-medium text-editor-text">Diff Preview</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary-500 text-white hover:bg-primary-600 transition-colors"
              onClick={accept}
              title="Keep (Cmd+Y)"
            >
              Keep
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-editor-bg text-editor-text hover:bg-editor-border transition-colors"
              onClick={reject}
              title="Discard (Cmd+N)"
            >
              Discard
            </button>
          </div>
        </div>

        <div className="flex-1">
          <DiffEditor
            height="100%"
            language="plaintext"
            theme={monacoTheme}
            original={pending.originalText}
            modified={pending.suggestedText}
            options={{
              renderSideBySide: true,
              readOnly: true,
              minimap: { enabled: false },
              lineNumbers: 'off',
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              renderOverviewRuler: false,
            }}
          />
        </div>
      </div>
    </div>
  );
}


