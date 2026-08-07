import { Toaster } from 'sonner';

export function ToastHost(): JSX.Element {
  return (
    <Toaster
      // top-center는 상단 버전 스트립·헤더와 겹쳐 토스트가 가려진다.
      position="bottom-right"
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
