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

describe('Phase 2: 세션별 모델 프리셋', () => {
  beforeEach(() => {
    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      currentSession: null,
      loadedProjectId: 'p1',
    });
    useAiConfigStore.setState({ chatModel: 'claude-sonnet-5' });
  });

  it('새 세션은 전역 chatModel을 기본 모델로 상속한다', () => {
    const id = useChatStore.getState().createSession('A');
    const s = useChatStore.getState().sessions.find((x) => x.id === id)!;
    expect(s.modelPreset).toBe('claude-sonnet-5');
  });

  it('세션 A 모델 변경이 세션 B에 영향을 주지 않는다', () => {
    const a = useChatStore.getState().createSession('A');
    const b = useChatStore.getState().createSession('B');
    useChatStore.getState().setSessionModelPreset(a, 'gpt-5.6-sol-high');

    const sa = useChatStore.getState().sessions.find((x) => x.id === a)!;
    const sb = useChatStore.getState().sessions.find((x) => x.id === b)!;
    expect(sa.modelPreset).toBe('gpt-5.6-sol-high');
    expect(sb.modelPreset).toBe('claude-sonnet-5');
  });

  it('세션 모델 변경은 전역 chatModel(새 세션 기본값)을 바꾸지 않는다', () => {
    const a = useChatStore.getState().createSession('A');
    useChatStore.getState().setSessionModelPreset(a, 'gpt-5.6-sol-high');
    expect(useAiConfigStore.getState().chatModel).toBe('claude-sonnet-5');
  });

  it('전역 기본 모델을 바꾼 뒤 만든 새 세션만 새 기본값을 상속한다', () => {
    const a = useChatStore.getState().createSession('A');
    useAiConfigStore.setState({ chatModel: 'gpt-5.6-luna-medium' });
    const b = useChatStore.getState().createSession('B');

    expect(useChatStore.getState().sessions.find((x) => x.id === a)!.modelPreset).toBe('claude-sonnet-5');
    expect(useChatStore.getState().sessions.find((x) => x.id === b)!.modelPreset).toBe('gpt-5.6-luna-medium');
  });

  it('currentSession도 동일 세션이면 modelPreset이 갱신된다', () => {
    const a = useChatStore.getState().createSession('A');
    useChatStore.getState().switchSession(a);
    useChatStore.getState().setSessionModelPreset(a, 'claude-opus-4-8');
    expect(useChatStore.getState().currentSession?.modelPreset).toBe('claude-opus-4-8');
  });
});
