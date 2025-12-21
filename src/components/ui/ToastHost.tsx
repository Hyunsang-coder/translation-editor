import { useUIStore } from '@/stores/uiStore';

export function ToastHost(): JSX.Element | null {
  const toasts = useUIStore((s) => s.toasts);
  const removeToast = useUIStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 max-w-[420px]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="rounded-md border border-editor-border bg-editor-surface shadow-sm px-3 py-2 flex items-start gap-3"
          role="status"
        >
          <div className="text-xs font-semibold uppercase tracking-wider text-editor-muted mt-0.5">
            {t.type}
          </div>
          <div className="flex-1 text-sm text-editor-text whitespace-pre-wrap">
            {t.message}
          </div>
          <button
            type="button"
            className="text-editor-muted hover:text-editor-text transition-colors"
            onClick={() => removeToast(t.id)}
            title="닫기"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}


