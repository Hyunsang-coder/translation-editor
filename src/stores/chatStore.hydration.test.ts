import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatProjectSettings } from '@/tauri/chat';
import type { ChatStore, ChatSet } from './chatStore.types';

const mocks = vi.hoisted(() => ({
  loadChatSessions: vi.fn(),
  loadChatProjectSettings: vi.fn(),
  listAttachments: vi.fn(),
  saveChatSessions: vi.fn(),
  saveChatProjectSettings: vi.fn(),
  syncChatPanels: vi.fn(),
  activeProjectId: 'project-a' as string | null,
}));

vi.mock('@/tauri/invoke', () => ({
  isTauriRuntime: () => true,
}));

vi.mock('@/tauri/chat', () => ({
  loadChatSessions: mocks.loadChatSessions,
  loadChatProjectSettings: mocks.loadChatProjectSettings,
  saveChatSessions: mocks.saveChatSessions,
  saveChatProjectSettings: mocks.saveChatProjectSettings,
}));

vi.mock('@/tauri/attachments', () => ({
  listAttachments: mocks.listAttachments,
}));

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({ project: mocks.activeProjectId ? { id: mocks.activeProjectId } : null }),
  },
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: {
    getState: () => ({ syncChatPanels: mocks.syncChatPanels }),
  },
}));

import { createSessionActions } from './chatStore.session';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createStateHarness(
  initial: Partial<ChatStore>,
  options?: { persistNow?: ReturnType<typeof vi.fn> },
) {
  let state = {
    sessions: [],
    currentSessionId: null,
    currentSession: null,
    isHydrating: false,
    isFinalizingStreaming: false,
    abortController: null,
    translationRules: '',
    projectContext: '',
    composerText: '',
    webSearchEnabled: true,
    translationContextSessionId: null,
    loadedProjectId: null,
    attachments: [],
    composerAttachments: [],
    ...initial,
  } as ChatStore;

  const set: ChatSet = (partial) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...next };
  };
  const get = () => state;
  const persistNow = options?.persistNow ?? vi.fn(async () => {});
  const schedulePersist = vi.fn();
  const actions = createSessionActions(set, get, { persistNow, schedulePersist });

  return { get, actions, persistNow, schedulePersist };
}

describe('chatStore project settings hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeProjectId = 'project-a';
    mocks.loadChatSessions.mockResolvedValue([]);
    mocks.listAttachments.mockResolvedValue([]);
  });

  it('동일 프로젝트의 중복 하이드레이션은 기존 컨텍스트를 지우지 않고 즉시 무시한다', async () => {
    const harness = createStateHarness({
      loadedProjectId: 'project-a',
      isHydrating: true,
      translationRules: 'Keep terminology consistent.',
      projectContext: 'Existing project context must survive.',
      composerText: 'pending draft',
      webSearchEnabled: false,
    });

    await harness.actions.hydrateForProject('project-a');

    expect(mocks.loadChatProjectSettings).not.toHaveBeenCalled();
    expect(harness.get()).toMatchObject({
      loadedProjectId: 'project-a',
      isHydrating: true,
      translationRules: 'Keep terminology consistent.',
      projectContext: 'Existing project context must survive.',
      composerText: 'pending draft',
      webSearchEnabled: false,
    });
  });

  it('다른 프로젝트로 전환할 때는 이전 컨텍스트를 노출하지 않고 새 설정을 완료 시점에 반영한다', async () => {
    mocks.activeProjectId = 'project-b';
    const settings = deferred<ChatProjectSettings | null>();
    mocks.loadChatProjectSettings.mockReturnValue(settings.promise);
    const harness = createStateHarness({
      loadedProjectId: 'project-a',
      translationRules: 'Project A rules',
      projectContext: 'Project A private context',
    });

    const hydrate = harness.actions.hydrateForProject('project-b');
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.get()).toMatchObject({
      loadedProjectId: null,
      isHydrating: true,
      translationRules: '',
      projectContext: '',
    });

    settings.resolve({
      translatorPersona: '',
      translationRules: 'Project B rules',
      projectContext: 'Project B context',
      composerText: '',
      webSearchEnabled: true,
      translationContextSessionId: null,
    });
    await hydrate;

    expect(harness.get()).toMatchObject({
      loadedProjectId: 'project-b',
      isHydrating: false,
      translationRules: 'Project B rules',
      projectContext: 'Project B context',
    });
  });

  it('이전 프로젝트 저장을 기다리는 동안에도 새 프로젝트에 이전 컨텍스트를 노출하지 않는다', async () => {
    mocks.activeProjectId = 'project-b';
    mocks.loadChatProjectSettings.mockResolvedValue(null);
    const persist = deferred<void>();
    const persistNow = vi.fn(() => persist.promise);
    const harness = createStateHarness({
      loadedProjectId: 'project-a',
      translationRules: 'Project A rules',
      projectContext: 'Project A private context',
    }, { persistNow });

    const hydrate = harness.actions.hydrateForProject('project-b');

    expect(persistNow).toHaveBeenCalledTimes(1);
    expect(harness.get()).toMatchObject({
      loadedProjectId: null,
      isHydrating: true,
      translationRules: '',
      projectContext: '',
    });

    persist.resolve();
    await hydrate;
  });
});
