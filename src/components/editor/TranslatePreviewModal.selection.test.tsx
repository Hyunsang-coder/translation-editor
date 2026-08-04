import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TipTapDocJson } from '@/ai/translateDocument';
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
  generateText: () => 'polished text',
}));

function paragraph(text: string): Record<string, unknown> {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

const originalDoc: TipTapDocJson = {
  type: 'doc',
  content: [paragraph('First old sentence.'), paragraph('Second old sentence.')],
};

const polishedDoc: TipTapDocJson = {
  type: 'doc',
  content: [paragraph('First new sentence.'), paragraph('Second new sentence.')],
};

function renderPreview(onApplySelective = vi.fn()) {
  return render(
    <TranslatePreviewModal
      open
      title="폴리싱 미리보기"
      docJson={polishedDoc}
      sourceHtml="<p>source</p>"
      originalHtml="<p>original</p>"
      originalDocJson={originalDoc}
      onApplySelective={onApplySelective}
      onClose={vi.fn()}
      onApply={vi.fn()}
    />,
  );
}

describe('TranslatePreviewModal 선택 적용', () => {
  it('전체 선택·전체 해제와 개별 선택을 즉시 반영한다', async () => {
    const user = userEvent.setup();
    renderPreview();

    const selectAll = await screen.findByRole('checkbox', { name: '전체 선택' });
    const changes = screen.getAllByRole('checkbox', { name: '변경 선택' });

    await waitFor(() => {
      expect(selectAll).toBeChecked();
      expect(changes.every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true);
    });

    await user.click(selectAll);
    expect(selectAll).not.toBeChecked();
    expect(changes.every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true);

    await user.click(selectAll);
    expect(selectAll).toBeChecked();
    expect(changes.every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true);

    await user.click(changes[0]!);
    expect(changes[0]).not.toBeChecked();
    expect(changes[1]).toBeChecked();
    expect(selectAll).toBePartiallyChecked();
  });

  it('동일 결과에서 적용 콜백 참조만 바뀌어도 사용자 선택을 초기화하지 않는다', async () => {
    const user = userEvent.setup();
    const firstApply = vi.fn();
    const view = renderPreview(firstApply);
    const firstChange = (await screen.findAllByRole('checkbox', { name: '변경 선택' }))[0]!;

    await waitFor(() => expect(firstChange).toBeChecked());
    await user.click(firstChange);
    expect(firstChange).not.toBeChecked();

    view.rerender(
      <TranslatePreviewModal
        open
        title="폴리싱 미리보기"
        docJson={polishedDoc}
        sourceHtml="<p>source</p>"
        originalHtml="<p>original</p>"
        originalDocJson={originalDoc}
        onApplySelective={vi.fn()}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('checkbox', { name: '변경 선택' })[0]).not.toBeChecked();
  });
});
