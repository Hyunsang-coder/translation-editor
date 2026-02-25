import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslatePreviewModal } from './TranslatePreviewModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'ko' },
  }),
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));

vi.mock('@/components/ui/VisualDiffViewer', () => ({
  VisualDiffViewer: () => <div data-testid="visual-diff-viewer" />,
}));

vi.mock('@/components/ui/Skeleton', () => ({
  SkeletonParagraph: () => <div data-testid="skeleton-paragraph" />,
}));

vi.mock('@tiptap/react', () => ({
  useEditor: () => ({
    commands: { setContent: vi.fn() },
  }),
  EditorContent: () => <div data-testid="editor-content" />,
}));

vi.mock('@tiptap/core', () => ({
  generateText: () => 'translated text',
}));

describe('TranslatePreviewModal', () => {
  const docJson = { type: 'doc', content: [] } as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('적용 클릭 시 onApply를 호출한다', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockResolvedValue(undefined);

    render(
      <TranslatePreviewModal
        open
        title="preview"
        docJson={docJson}
        sourceHtml="<p>source</p>"
        originalHtml="<p>original</p>"
        onClose={vi.fn()}
        onApply={onApply}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'common.apply' }));

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledTimes(1);
    });
  });

  it('적용 중에는 중복 클릭이 방지된다', async () => {
    const user = userEvent.setup();
    let resolve: () => void;
    const onApply = vi.fn(
      () => new Promise<void>((r) => { resolve = r; }),
    );

    render(
      <TranslatePreviewModal
        open
        title="preview"
        docJson={docJson}
        sourceHtml="<p>source</p>"
        originalHtml="<p>original</p>"
        onClose={vi.fn()}
        onApply={onApply}
      />,
    );

    const applyButton = screen.getByRole('button', { name: 'common.apply' });
    await user.click(applyButton);
    await user.click(applyButton);

    resolve!();
    await waitFor(() => {
      expect(onApply).toHaveBeenCalledTimes(1);
    });
  });
});
