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

function makeProject(targetContent = '<p>first</p>'): ITEProject {
  return {
    id: 'project-1',
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
      pendingDocDiff: null,
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
