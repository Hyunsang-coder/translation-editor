import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatMessageItem } from './ChatMessageItem';
import type { ChatMessage } from '@/types';

vi.mock('./MemoizedMarkdown', () => ({
  MemoizedMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn() }));

const noop = () => undefined;

function renderMessage(message: ChatMessage) {
  return render(
    <ChatMessageItem
      message={message}
      isStreaming={false}
      streamingContent={null}
      streamingMetadata={null}
      showStreamingSkeleton={false}
      statusMessage={null}
      onEdit={noop}
      onReplay={noop}
      onDelete={noop}
      onAppendToRules={noop}
      onAppendToContext={noop}
      onUpdateMessageMetadata={noop}
    />,
  );
}

describe('ChatMessageItem width', () => {
  it('AI 응답은 채팅 본문 가로폭 전체를 사용한다', () => {
    renderMessage({ id: 'assistant-1', role: 'assistant', content: 'Full width', timestamp: 0 });

    expect(screen.getByTestId('chat-message-assistant')).toHaveClass('w-full', 'max-w-none');
  });

  it('사용자 메시지는 전체폭 스타일을 사용하지 않는다', () => {
    renderMessage({ id: 'user-1', role: 'user', content: 'Compact bubble', timestamp: 0 });

    expect(screen.getByTestId('chat-message-user')).not.toHaveClass('w-full', 'max-w-none');
  });
});
