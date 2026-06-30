import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorBlock, ITEProject } from '@/types';
import { HistoryRestoreDialog } from './HistoryRestoreDialog';

const mocks = vi.hoisted(() => {
  const now = Date.now();
  const baseBlocks: Record<string, EditorBlock> = {
    'target-1': {
      id: 'target-1',
      type: 'target',
      content: '<p>before restore</p>',
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
    blocks: baseBlocks,
  };

  const restoredBlocks: Record<string, EditorBlock> = {
    'target-1': {
      id: 'target-1',
      type: 'target',
      content: '<p>after restore</p>',
      hash: 'hash-target-1-restored',
      metadata: {
        createdAt: now,
        updatedAt: now + 1000,
        tags: [],
      },
    },
  };

  return {
    baseBlocks,
    restoredBlocks,
    onClose: vi.fn(),
    tauriHistory: {
      restoreSnapshot: vi.fn(),
    },
    projectStoreState: {
      project,
      materializeBlocksForSnapshot: vi.fn(),
      loadProject: vi.fn(),
      saveProject: vi.fn(),
    },
    historyStoreState: {
      createSnapshotIfChanged: vi.fn(),
      loadHistory: vi.fn(),
    },
    editorStoreState: {
      sourceEditor: null as unknown,
      targetEditor: null as unknown,
    },
    uiStoreState: {
      addToast: vi.fn(),
    },
    docs: {
      buildSourceDocument: vi.fn(),
      buildTargetDocument: vi.fn(),
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

vi.mock('@/tauri/history', () => ({
  restoreSnapshot: (args: unknown) => mocks.tauriHistory.restoreSnapshot(args),
}));

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: <T,>(selector: (state: typeof mocks.projectStoreState) => T): T =>
    selector(mocks.projectStoreState),
}));

vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: <T,>(selector: (state: typeof mocks.historyStoreState) => T): T =>
    selector(mocks.historyStoreState),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: <T,>(selector: (state: typeof mocks.editorStoreState) => T): T =>
    selector(mocks.editorStoreState),
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: <T,>(selector: (state: typeof mocks.uiStoreState) => T): T =>
    selector(mocks.uiStoreState),
}));

vi.mock('@/editor/sourceDocument', () => ({
  buildSourceDocument: (project: unknown) => mocks.docs.buildSourceDocument(project),
}));

vi.mock('@/editor/targetDocument', () => ({
  buildTargetDocument: (project: unknown) => mocks.docs.buildTargetDocument(project),
}));

vi.mock('@/editor/utils/replaceDocContent', () => ({
  replaceDocContent: vi.fn(),
}));

describe('HistoryRestoreDialog auto snapshot integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onClose.mockReset();
    mocks.projectStoreState.materializeBlocksForSnapshot.mockReturnValue(mocks.baseBlocks);
    mocks.projectStoreState.saveProject.mockResolvedValue(undefined);
    mocks.projectStoreState.loadProject.mockImplementation(() => {});
    mocks.historyStoreState.createSnapshotIfChanged.mockResolvedValue('snapshot-auto');
    mocks.historyStoreState.loadHistory.mockResolvedValue(undefined);
    mocks.tauriHistory.restoreSnapshot.mockResolvedValue(mocks.restoredBlocks);
    mocks.uiStoreState.addToast.mockImplementation(() => {});
    mocks.docs.buildSourceDocument.mockReturnValue({ text: 'source text', blockRanges: {} });
    mocks.docs.buildTargetDocument.mockReturnValue({ text: 'target text', blockRanges: {} });
  });

  it('복원 시 현재 상태 자동 스냅샷을 만든 뒤 복원/저장을 수행한다', async () => {
    const user = userEvent.setup();

    render(
      <HistoryRestoreDialog
        open
        projectId="project-1"
        snapshotId="snapshot-1"
        onClose={mocks.onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'history.restore' }));

    await waitFor(() => {
      expect(mocks.historyStoreState.createSnapshotIfChanged).toHaveBeenCalledWith({
        projectId: 'project-1',
        description: expect.stringContaining('history.autoSnapshotBeforeRestore'),
        blocks: mocks.baseBlocks,
      });
      expect(mocks.tauriHistory.restoreSnapshot).toHaveBeenCalledWith({
        projectId: 'project-1',
        snapshotId: 'snapshot-1',
      });
      expect(mocks.projectStoreState.loadProject).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'project-1',
          blocks: mocks.restoredBlocks,
        }),
        { hydrateComments: false },
      );
      expect(mocks.projectStoreState.saveProject).toHaveBeenCalledTimes(1);
      expect(mocks.historyStoreState.loadHistory).toHaveBeenCalledWith('project-1');
      expect(mocks.onClose).toHaveBeenCalledTimes(1);
    });

    expect(mocks.uiStoreState.addToast).toHaveBeenCalledWith({
      type: 'success',
      message: 'history.restoreSuccess',
    });
  });

  it('자동 스냅샷이 실패해도 복원은 계속 진행한다', async () => {
    const user = userEvent.setup();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.historyStoreState.createSnapshotIfChanged.mockRejectedValue(new Error('snapshot failed'));

    render(
      <HistoryRestoreDialog
        open
        projectId="project-1"
        snapshotId="snapshot-1"
        onClose={mocks.onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'history.restore' }));

    await waitFor(() => {
      expect(mocks.tauriHistory.restoreSnapshot).toHaveBeenCalledWith({
        projectId: 'project-1',
        snapshotId: 'snapshot-1',
      });
      expect(mocks.onClose).toHaveBeenCalledTimes(1);
    });

    expect(warnSpy).toHaveBeenCalled();
    expect(mocks.uiStoreState.addToast).toHaveBeenCalledWith({
      type: 'success',
      message: 'history.restoreSuccess',
    });

    warnSpy.mockRestore();
  });
});
