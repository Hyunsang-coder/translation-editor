import { Toaster } from 'sonner';

export function ToastHost(): JSX.Element {
  return (
    <Toaster
      position="top-center"
      toastOptions={{
        className: 'bg-editor-surface border border-editor-border text-editor-text',
        style: {
          background: 'var(--color-editor-surface)',
          border: '1px solid var(--color-editor-border)',
          color: 'var(--color-editor-text)',
        },
      }}
      gap={8}
    />
  );
}
