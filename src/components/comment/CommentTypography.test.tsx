import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { UserComment } from '@/stores/commentStore';
import { useCommentStore } from '@/stores/commentStore';
import { CommentDetailPopover } from './CommentDetailPopover';
import { CommentInputPopover } from './CommentInputPopover';
import { CommentListPanel } from './CommentListPanel';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

const comment: UserComment = {
  id: 'comment-1',
  field: 'source',
  excerpt: '선택한 원문',
  comment: '용어를 통일해 주세요.',
  resolved: false,
  createdAt: 1,
};

afterEach(() => {
  act(() => useCommentStore.getState().clear());
});

describe('코멘트 글자 크기 계층', () => {
  it('목록은 메타 10px, 인용 11px, 본문 12px을 사용한다', () => {
    useCommentStore.getState().setComments([comment]);
    render(<CommentListPanel />);

    expect(screen.getByText('editor.source (1)')).toHaveClass('text-[10px]');
    expect(screen.getByText('“선택한 원문”')).toHaveClass('text-[11px]');
    expect(screen.getByText(comment.comment)).toHaveClass('text-xs');
  });

  it('상세 팝오버도 목록과 같은 인용·본문 크기를 사용한다', () => {
    render(
      <CommentDetailPopover
        top={0}
        left={0}
        comment={comment}
        onSave={vi.fn()}
        onToggleResolve={vi.fn()}
        onDelete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('“선택한 원문”')).toHaveClass('text-[11px]');
    expect(screen.getByText(comment.comment)).toHaveClass('text-xs');
  });

  it('입력 팝오버도 인용 11px, 입력 12px을 사용한다', () => {
    render(
      <CommentInputPopover
        top={0}
        left={0}
        excerpt={comment.excerpt}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('“선택한 원문”')).toHaveClass('text-[11px]');
    expect(screen.getByPlaceholderText('comment.inputPlaceholder')).toHaveClass('text-xs');
  });
});
