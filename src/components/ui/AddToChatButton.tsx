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
 * - 헤더와 동일한 테마 색상 사용 (editor-surface)
 * - 라이트 모드: 밝은 배경 + 검정 글씨
 * - 다크 모드: 어두운 배경 + 흰색 글씨
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
        font-medium
        text-editor-text
        backdrop-blur-sm
        border border-editor-border
        shadow-lg shadow-black/10 dark:shadow-black/30
        hover:brightness-95 dark:hover:brightness-110
        active:scale-95
        transition-all duration-150
        ${className}
      `.trim()}
      style={{
        ...style,
        backgroundColor: 'color-mix(in srgb, var(--editor-surface) 90%, transparent)',
        fontFamily: "'Noto Sans KR', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        fontSize: 'var(--editor-font-size, 14px)',
      }}
      onMouseDown={onMouseDown}
      onClick={onClick}
      title="선택한 텍스트를 채팅 입력창에 추가"
    >
      <MessageSquarePlus className="w-4 h-4 text-primary-500" />
      Add to chat
    </button>
  );
}
