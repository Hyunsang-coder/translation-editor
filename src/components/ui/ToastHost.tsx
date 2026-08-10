import { Toaster } from 'sonner';

export function ToastHost(): JSX.Element {
  return (
    <Toaster
      // bottom-right는 우측에 도킹된 채팅 패널의 입력창을 가린다.
      position="bottom-center"
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
