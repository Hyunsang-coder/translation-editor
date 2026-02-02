import { MessageSquarePlus } from 'lucide-react';

interface AddToChatButtonProps {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  'data-text'?: string;
}

/**
 * Add to Chat 플로팅 버튼 컴포넌트
 * - 그라데이션 + 글로우 효과
 * - 테마 색상(--primary-*) 활용
 */
export function AddToChatButton({
  onClick,
  onMouseDown,
  style,
  className = '',
  id,
  'data-text': dataText,
}: AddToChatButtonProps): JSX.Element {
  return (
    <button
      id={id}
      type="button"
      data-text={dataText}
      className={`
        inline-flex items-center gap-1.5
        px-3 py-1.5 rounded-lg
        text-sm font-medium text-white
        backdrop-blur-sm
        active:scale-95
        transition-all duration-150
        ${className}
      `.trim()}
      style={{
        ...style,
        backgroundColor: 'color-mix(in srgb, var(--primary-500) 85%, transparent)',
        boxShadow: '0 10px 15px -3px color-mix(in srgb, var(--primary-500) 25%, transparent)',
      }}
      onMouseDown={onMouseDown}
      onClick={onClick}
      title="선택한 텍스트를 채팅 입력창에 추가"
    >
      <MessageSquarePlus className="w-4 h-4" />
      Add to chat
    </button>
  );
}
