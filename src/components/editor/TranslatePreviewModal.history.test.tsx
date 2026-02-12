import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITEProject } from '@/types';
import { TranslatePreviewModal } from './TranslatePreviewModal';

const stores = vi.hoisted(() => {
  const now = Date.now();
  const blocks = {
    'target-1': {
      id: 'target-1',
      type: 'target',
      content: '<p>current target</p>',
      hash: 'hash-target-1',
      metadata: {
        createdAt: now,
        updatedAt: now,
        tags: [],
      },
    },
  };

  const project: ITEProject = {
    id: 'project-1',
    version: '1.0.0',
    metadata: {
      title: 'Test Project',
      domain: 'general',
      createdAt: now,
      updatedAt: now,
      settings: {
        strictnessLevel: 0.5,
        autoSave: true,
        autoSaveInterval: 30000,
        theme: 'system',
      },
    },
    segments: [],
    blocks,
  };

  return {
    blocks,
    project,
    projectStoreState: {
      project,
      materializeBlocksForSnapshot: vi.fn<() => typeof blocks | null>(),
    },
    historyStoreState: {
      createSnapshot: vi.fn(),
    },
  };
});

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
    commands: {
      setContent: vi.fn(),
    },
  }),
  EditorContent: () => <div data-testid="editor-content" />,
}));

vi.mock('@tiptap/core', () => ({
  generateText: () => 'translated text',
}));

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: <T,>(selector: (state: typeof stores.projectStoreState) => T): T =>
    selector(stores.projectStoreState),
}));

vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: <T,>(selector: (state: typeof stores.historyStoreState) => T): T =>
    selector(stores.historyStoreState),
}));

describe('TranslatePreviewModal auto snapshot integration', () => {
  const docJson = { type: 'doc', content: [] } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    stores.projectStoreState.project = stores.project;
    stores.projectStoreState.materializeBlocksForSnapshot.mockReturnValue(stores.blocks);
    stores.historyStoreState.createSnapshot.mockResolvedValue('snapshot-1');
  });

  it('적용 클릭 시 자동 스냅샷을 먼저 생성한 뒤 onApply를 호출한다', async () => {
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
        autoSnapshotDescription="custom auto snapshot"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'common.apply' }));

    await waitFor(() => {
      expect(stores.historyStoreState.createSnapshot).toHaveBeenCalledWith({
        projectId: 'project-1',
        description: 'custom auto snapshot',
        blocks: stores.blocks,
      });
      expect(onApply).toHaveBeenCalledTimes(1);
    });

    expect(
      stores.historyStoreState.createSnapshot.mock.invocationCallOrder[0],
    ).toBeLessThan(onApply.mock.invocationCallOrder[0]);
  });

  it('자동 스냅샷이 실패해도 적용(onApply)은 계속 진행한다', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockResolvedValue(undefined);
    stores.projectStoreState.materializeBlocksForSnapshot.mockReturnValue(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

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
    expect(stores.historyStoreState.createSnapshot).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
