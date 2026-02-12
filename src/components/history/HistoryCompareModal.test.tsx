import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorBlock, ITEProject } from '@/types';
import { HistoryCompareModal } from './HistoryCompareModal';

const mocks = vi.hoisted(() => {
  const now = Date.now();
  const currentBlocks: Record<string, EditorBlock> = {
    'target-1': {
      id: 'target-1',
      type: 'target',
      content: '<p>current text</p>',
      hash: 'hash-current',
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
    blocks: currentBlocks,
  };

  const baseTarget = currentBlocks['target-1']!;
  const snapshotOneBlocks: Record<string, EditorBlock> = {
    'target-1': {
      id: baseTarget.id,
      type: baseTarget.type,
      content: '<p>snapshot one</p>',
      hash: 'hash-snapshot-one',
      metadata: baseTarget.metadata,
    },
  };

  const snapshotTwoBlocks: Record<string, EditorBlock> = {
    'target-1': {
      id: baseTarget.id,
      type: baseTarget.type,
      content: '<p>snapshot two</p>',
      hash: 'hash-snapshot-two',
      metadata: baseTarget.metadata,
    },
  };

  return {
    project,
    snapshots: [
      { id: 's1', timestamp: now - 1000, description: 'Snapshot 1' },
      { id: 's2', timestamp: now - 500, description: 'Snapshot 2' },
    ],
    getSnapshot: vi.fn(),
    snapshotJsonById: {
      s1: JSON.stringify(snapshotOneBlocks),
      s2: JSON.stringify(snapshotTwoBlocks),
    } as Record<string, string>,
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
  VisualDiffViewer: ({ original, suggested }: { original: string; suggested: string }) => (
    <div data-testid="diff" data-original={original} data-suggested={suggested} />
  ),
}));

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: <T,>(selector: (state: { project: ITEProject }) => T): T =>
    selector({ project: mocks.project }),
}));

vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: <T,>(selector: (state: { getSnapshot: typeof mocks.getSnapshot }) => T): T =>
    selector({ getSnapshot: mocks.getSnapshot }),
}));

vi.mock('@/editor/targetDocument', () => ({
  buildTargetDocument: (project: ITEProject) => ({
    text: Object.values(project.blocks)
      .map((block) => block.content)
      .join('\n'),
    blockRanges: {},
  }),
}));

vi.mock('@/utils/hash', () => ({
  stripHtml: (value: string) => value.replace(/<[^>]+>/g, ''),
}));

describe('HistoryCompareModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSnapshot.mockImplementation(
      async ({ snapshotId }: { snapshotId: string }) => ({
        id: snapshotId,
        timestamp: Date.now(),
        description: snapshotId,
        blockChanges: [],
        snapshotJson: mocks.snapshotJsonById[snapshotId],
      }),
    );
  });

  it('기본은 현재와 비교하고, 대상 스냅샷 선택 시 스냅샷끼리 비교한다', async () => {
    const user = userEvent.setup();

    render(
      <HistoryCompareModal
        open
        projectId="project-1"
        snapshotId="s1"
        snapshots={mocks.snapshots}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      const diff = screen.getByTestId('diff');
      expect(diff).toHaveAttribute('data-original', 'snapshot one');
      expect(diff).toHaveAttribute('data-suggested', 'current text');
    });

    const targetSelect = screen.getByLabelText('history.compareTarget');
    const optionValues = Array.from((targetSelect as HTMLSelectElement).options).map((opt) => opt.value);
    expect(optionValues).toEqual(['', 's2']);

    await user.selectOptions(targetSelect, 's2');

    await waitFor(() => {
      const diff = screen.getByTestId('diff');
      expect(diff).toHaveAttribute('data-original', 'snapshot one');
      expect(diff).toHaveAttribute('data-suggested', 'snapshot two');
    });

    expect(mocks.getSnapshot).toHaveBeenCalledWith({ projectId: 'project-1', snapshotId: 's1' });
    expect(mocks.getSnapshot).toHaveBeenCalledWith({ projectId: 'project-1', snapshotId: 's2' });
  });
});
