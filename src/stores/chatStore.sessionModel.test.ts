import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatStore } from '@/stores/chatStore';
import { useAiConfigStore } from '@/stores/aiConfigStore';

// Tauri 영속 side-effect 차단 (테스트는 순수 store 로직만 검증)
vi.mock('@/tauri/attachments', () => ({
  listAttachments: vi.fn().mockResolvedValue([]),
  attachFile: vi.fn(),
  deleteAttachment: vi.fn(),
  previewAttachment: vi.fn(),
  readImageAsDataUrl: vi.fn(),
}));

describe('Phase 2: 세션별 provider 고정', () => {
  beforeEach(() => {
    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      currentSession: null,
      loadedProjectId: 'p1',
    });
    useAiConfigStore.setState({ provider: 'anthropic' });
  });

  it('새 세션은 전역 provider를 기본값으로 상속한다', () => {
    const id = useChatStore.getState().createSession('A');
    const s = useChatStore.getState().sessions.find((x) => x.id === id)!;
    expect(s.modelPreset).toBe('anthropic');
  });

  it('세션 A provider 변경이 세션 B에 영향을 주지 않는다', () => {
    const a = useChatStore.getState().createSession('A');
    const b = useChatStore.getState().createSession('B');
    useChatStore.getState().setSessionModelPreset(a, 'openai');

    const sa = useChatStore.getState().sessions.find((x) => x.id === a)!;
    const sb = useChatStore.getState().sessions.find((x) => x.id === b)!;
    expect(sa.modelPreset).toBe('openai');
    expect(sb.modelPreset).toBe('anthropic');
  });

  it('세션 provider 변경은 전역 provider(새 세션 기본값)를 바꾸지 않는다', () => {
    const a = useChatStore.getState().createSession('A');
    useChatStore.getState().setSessionModelPreset(a, 'openai');
    expect(useAiConfigStore.getState().provider).toBe('anthropic');
  });

  it('전역 provider를 바꾼 뒤 만든 새 세션만 새 기본값을 상속한다', () => {
    const a = useChatStore.getState().createSession('A');
    useAiConfigStore.setState({ provider: 'openai' });
    const b = useChatStore.getState().createSession('B');

    expect(useChatStore.getState().sessions.find((x) => x.id === a)!.modelPreset).toBe('anthropic');
    expect(useChatStore.getState().sessions.find((x) => x.id === b)!.modelPreset).toBe('openai');
  });

  it('대화가 시작된 세션은 provider를 바꿀 수 없다', () => {
    const a = useChatStore.getState().createSession('A');
    useChatStore.getState().switchSession(a);
    useChatStore.getState().addMessage({ role: 'user', content: '첫 질문' }, a);

    useChatStore.getState().setSessionModelPreset(a, 'openai');

    // provider를 바꾸면 그 세션이 쌓은 prompt cache가 통째로 무효화된다.
    expect(useChatStore.getState().sessions.find((x) => x.id === a)!.modelPreset)
      .toBe('anthropic');
    expect(useChatStore.getState().currentSession?.modelPreset).toBe('anthropic');
  });

  it('첫 메시지 전에는 아직 캐시가 없으므로 provider를 바꿀 수 있다', () => {
    const a = useChatStore.getState().createSession('A');
    useChatStore.getState().setSessionModelPreset(a, 'openai');

    expect(useChatStore.getState().sessions.find((x) => x.id === a)!.modelPreset)
      .toBe('openai');
  });

  it('currentSession도 동일 세션이면 modelPreset이 갱신된다', () => {
    const a = useChatStore.getState().createSession('A');
    useChatStore.getState().switchSession(a);
    useChatStore.getState().setSessionModelPreset(a, 'openai');
    expect(useChatStore.getState().currentSession?.modelPreset).toBe('openai');
  });
});
