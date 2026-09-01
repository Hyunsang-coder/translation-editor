import { Toaster } from 'sonner';

export function ToastHost(): JSX.Element {
  return (
    <Toaster
      // bottom-right는 우측에 도킹된 채팅 패널의 입력창을 가린다.
      position="bottom-center"
      toastOptions={{
        className: 'bg-editor-surface border border-editor-border text-editor-text',
        style: {
          // index.css가 정의하는 이름은 --editor-* 다. --color-* 는 어디에도 없어
          // 인라인 스타일이 통째로 무효가 되고, className의 bg-editor-surface까지
          // 덮어써 토스트가 배경 없이 떴다.
          background: 'var(--editor-surface)',
          border: '1px solid var(--editor-border)',
          color: 'var(--editor-text)',
        },
      }}
      gap={8}
    />
  );
}
