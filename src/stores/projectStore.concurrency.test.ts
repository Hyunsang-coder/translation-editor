import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorBlock, ITEProject } from '@/types';
import { hashContent } from '@/utils/hash';

const tauriProjectMock = vi.hoisted(() => ({
  loadProject: vi.fn(),
  saveProject: vi.fn(),
}));

const tauriStorageMock = vi.hoisted(() => ({
  listProjectIds: vi.fn(),
}));

const tauriCommentsMock = vi.hoisted(() => ({
  loadComments: vi.fn(),
  saveComments: vi.fn(),
}));

const chatStoreMock = vi.hoisted(() => ({
  hydrateForProject: vi.fn(),
}));

vi.mock('@/tauri/project', () => tauriProjectMock);
vi.mock('@/tauri/storage', () => tauriStorageMock);
vi.mock('@/tauri/comments', () => tauriCommentsMock);
vi.mock('@/stores/chatStore', () => ({
  useChatStore: {
    getState: () => chatStoreMock,
  },
}));

import { useProjectStore } from './projectStore';
import { useCommentStore } from './commentStore';
import { useTranslationPreviewStore } from './translationPreviewStore';

function createDeferred<T = void>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

function block(id: string, type: EditorBlock['type'], content: string): EditorBlock {
  return {
    id,
    type,
    content,
    hash: hashContent(content),
    metadata: {
      createdAt: 1,
      updatedAt: 1,
      tags: [],
    },
  };
}

function makeProject(targetContent = '<p>first</p>', id = 'project-1'): ITEProject {
  return {
    id,
    version: '1.0.0',
    metadata: {
      title: 'Project',
      domain: 'general',
      createdAt: 1,
      updatedAt: 1,
      settings: {
        strictnessLevel: 0.5,
        autoSave: true,
        autoSaveInterval: 30000,
        theme: 'system',
      },
    },
    segments: [
      {
        groupId: 'segment-1',
        sourceIds: ['source-1'],
        targetIds: ['target-1'],
        isAligned: true,
        order: 0,
      },
    ],
    blocks: {
      'source-1': block('source-1', 'source', '<p>source</p>'),
      'target-1': block('target-1', 'target', targetContent),
    },
  };
}

describe('projectStore save concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriStorageMock.listProjectIds.mockResolvedValue([]);
    tauriCommentsMock.loadComments.mockResolvedValue([]);
    tauriCommentsMock.saveComments.mockResolvedValue(undefined);
    chatStoreMock.hydrateForProject.mockResolvedValue(undefined);
    useProjectStore.getState().stopAutoSave();

    const project = makeProject();
    useProjectStore.setState({
      project,
      isDirty: true,
      isLoading: false,
      error: null,
      lastProjectId: project.id,
      lastChangeAt: 1,
      lastSavedAt: 0,
      saveStatus: 'idle',
      lastSaveError: null,
      targetDocument: '<p>first</p>',
      sourceDocument: '<p>source</p>',
      sourceDocJson: null,
      targetDocJson: null,
      pendingDiffs: {},
      editSessions: [],
      applyAnchor: null,
      targetDocHandle: null,
    });
    useCommentStore.getState().clear();
  });

  it('queues a second save when the document changes while a save is in flight', async () => {
    const firstSave = createDeferred<void>();
    tauriProjectMock.saveProject
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce(undefined);

    const savePromise = useProjectStore.getState().saveProject();
    await Promise.resolve();

    expect(tauriProjectMock.saveProject).toHaveBeenCalledTimes(1);
    expect((tauriProjectMock.saveProject.mock.calls[0]?.[0] as ITEProject).blocks['target-1']?.content)
      .toBe('<p>first</p>');

    useProjectStore.getState().setTargetDocument('<p>second</p>');

    firstSave.resolve();
    await savePromise;

    expect(tauriProjectMock.saveProject).toHaveBeenCalledTimes(2);
    const secondProject = tauriProjectMock.saveProject.mock.calls[1]?.[0] as ITEProject;
    expect(secondProject.blocks['target-1']?.content).toBe('<p>second</p>');
    expect(useProjectStore.getState().project?.blocks['target-1']?.content).toBe('<p>second</p>');
    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it('queues another save when only comments change while comment persistence is in flight', async () => {
    const firstCommentSave = createDeferred<void>();
    tauriProjectMock.saveProject.mockResolvedValue(undefined);
    tauriCommentsMock.saveComments
      .mockReturnValueOnce(firstCommentSave.promise)
      .mockResolvedValueOnce(undefined);

    const comment = useCommentStore.getState().addComment({
      field: 'target',
      excerpt: 'first',
      comment: 'before',
      createdAt: 1,
    });

    const savePromise = useProjectStore.getState().saveProject();
    await flushPromises();

    expect(tauriCommentsMock.saveComments).toHaveBeenCalledTimes(1);
    expect(tauriCommentsMock.saveComments.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ id: comment.id, comment: 'before' }),
    ]);

    useCommentStore.getState().updateComment(comment.id, { comment: 'after' });
    void useProjectStore.getState().saveProject();

    firstCommentSave.resolve();
    await savePromise;

    expect(tauriProjectMock.saveProject).toHaveBeenCalledTimes(2);
    expect(tauriCommentsMock.saveComments).toHaveBeenCalledTimes(2);
    expect(tauriCommentsMock.saveComments.mock.calls[1]?.[1]).toEqual([
      expect.objectContaining({ id: comment.id, comment: 'after' }),
    ]);
  });
});

describe('projectStore switchProjectById concurrency (L5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriStorageMock.listProjectIds.mockResolvedValue([]);
    tauriCommentsMock.loadComments.mockResolvedValue([]);
    tauriCommentsMock.saveComments.mockResolvedValue(undefined);
    tauriProjectMock.saveProject.mockResolvedValue(undefined);
    chatStoreMock.hydrateForProject.mockResolvedValue(undefined);
    useProjectStore.getState().stopAutoSave();

    const project = makeProject();
    useProjectStore.setState({
      project,
      isDirty: false,
      isLoading: false,
      error: null,
      lastProjectId: project.id,
      lastChangeAt: 1,
      lastSavedAt: 0,
      saveStatus: 'idle',
      lastSaveError: null,
      targetDocument: '<p>first</p>',
      sourceDocument: '<p>source</p>',
      sourceDocJson: null,
      targetDocJson: null,
      pendingDiffs: {},
      editSessions: [],
      applyAnchor: null,
      targetDocHandle: null,
    });
    useCommentStore.getState().clear();
    useTranslationPreviewStore.getState().clearPreview();
  });

  it('applies only the latest switch when switches overlap (last-click-wins)', async () => {
    const projectB = makeProject('<p>b</p>', 'project-B');
    const projectC = makeProject('<p>c</p>', 'project-C');

    const loadB = createDeferred<ITEProject>();
    const loadC = createDeferred<ITEProject>();
    tauriProjectMock.loadProject.mockImplementation((id: string) =>
      id === 'project-B' ? loadB.promise : loadC.promise,
    );

    const switchB = useProjectStore.getState().switchProjectById('project-B');
    const switchC = useProjectStore.getState().switchProjectById('project-C');

    // C(더 최신 클릭)가 먼저 완료되고 B(이전 클릭)가 나중에 완료되는 최악의 순서.
    // 세대 토큰이 없으면 B가 마지막에 적용되어 last-click-wins가 깨진다.
    loadC.resolve(projectC);
    await flushPromises();
    loadB.resolve(projectB);
    await Promise.all([switchB, switchC]);
    await flushPromises();

    expect(useProjectStore.getState().project?.id).toBe('project-C');
    useProjectStore.getState().stopAutoSave();
  });

  it('clears the desktop translation preview when switching projects (L3)', async () => {
    useTranslationPreviewStore.getState().setPreview({
      docJson: { type: 'doc', content: [] },
      projectId: 'project-1',
      targetRevision: 'rev-1',
    });
    expect(useTranslationPreviewStore.getState().open).toBe(true);

    const projectB = makeProject('<p>b</p>', 'project-B');
    tauriProjectMock.loadProject.mockResolvedValue(projectB);

    await useProjectStore.getState().switchProjectById('project-B');

    const preview = useTranslationPreviewStore.getState();
    expect(preview.open).toBe(false);
    expect(preview.docJson).toBeNull();
    expect(preview.projectId).toBeNull();
    useProjectStore.getState().stopAutoSave();
  });
});
