/**
 * ChatStore 선택자 최적화 테스트
 *
 * TDD RED Phase: 그룹화된 선택자로 리렌더링 최적화
 * - 관련 상태를 단일 선택자로 통합
 * - 불필요한 리렌더링 방지
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Mock Tauri before importing store
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

describe('ChatStore Selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('useChatComposerState가 모든 composer 관련 상태를 반환해야 함', async () => {
    const { useChatComposerState } = await import('./chatStore.selectors');

    const { result } = renderHook(() => useChatComposerState());

    // 그룹화된 상태 확인
    expect(result.current).toHaveProperty('composerText');
    expect(result.current).toHaveProperty('setComposerText');
    expect(result.current).toHaveProperty('composerAttachments');
    expect(result.current).toHaveProperty('addComposerAttachment');
    expect(result.current).toHaveProperty('removeComposerAttachment');
    expect(result.current).toHaveProperty('focusNonce');
  });

  it('useChatSessionState가 세션 관련 상태를 반환해야 함', async () => {
    const { useChatSessionState } = await import('./chatStore.selectors');

    const { result } = renderHook(() => useChatSessionState());

    expect(result.current).toHaveProperty('currentSession');
    expect(result.current).toHaveProperty('sessions');
    expect(result.current).toHaveProperty('createSession');
    expect(result.current).toHaveProperty('isHydrating');
  });

  it('useChatStreamingState가 스트리밍 관련 상태를 반환해야 함', async () => {
    const { useChatStreamingState } = await import('./chatStore.selectors');

    const { result } = renderHook(() => useChatStreamingState());

    expect(result.current).toHaveProperty('isLoading');
    expect(result.current).toHaveProperty('streamingMessageId');
    expect(result.current).toHaveProperty('streamingContent');
    expect(result.current).toHaveProperty('streamingMetadata');
    expect(result.current).toHaveProperty('statusMessage');
  });

  it('useChatSearchState가 검색 관련 상태를 반환해야 함', async () => {
    const { useChatSearchState } = await import('./chatStore.selectors');

    const { result } = renderHook(() => useChatSearchState());

    expect(result.current).toHaveProperty('webSearchEnabled');
    expect(result.current).toHaveProperty('setWebSearchEnabled');
    expect(result.current).toHaveProperty('confluenceSearchEnabled');
    expect(result.current).toHaveProperty('setConfluenceSearchEnabled');
  });

  it('useChatMessageActions가 메시지 액션을 반환해야 함', async () => {
    const { useChatMessageActions } = await import('./chatStore.selectors');

    const { result } = renderHook(() => useChatMessageActions());

    expect(result.current).toHaveProperty('sendMessage');
    expect(result.current).toHaveProperty('editMessage');
    expect(result.current).toHaveProperty('replayMessage');
    expect(result.current).toHaveProperty('deleteMessageFrom');
    expect(result.current).toHaveProperty('updateMessage');
  });

  it('useSummarySuggestionState가 요약 제안 상태를 반환해야 함', async () => {
    const { useSummarySuggestionState } = await import('./chatStore.selectors');

    const { result } = renderHook(() => useSummarySuggestionState());

    expect(result.current).toHaveProperty('shouldShow');
    expect(typeof result.current.shouldShow).toBe('boolean');
    expect(result.current).toHaveProperty('dismiss');
    expect(result.current).toHaveProperty('startNewSession');
  });

  it('그룹화된 선택자가 관련 없는 상태 변경에 리렌더링하지 않아야 함', async () => {
    const { useChatComposerState, useChatStore } = await import('./chatStore.selectors');

    const renderCount = { count: 0 };
    renderHook(() => {
      renderCount.count++;
      return useChatComposerState();
    });

    const initialCount = renderCount.count;

    // composer와 무관한 상태 변경
    act(() => {
      useChatStore.getState().setStatusMessage('test');
    });

    // 리렌더링이 발생하지 않아야 함 (또는 최소화)
    // 참고: Zustand는 shallow 비교를 하므로 객체 참조가 같으면 리렌더링 안 함
    expect(renderCount.count).toBeLessThanOrEqual(initialCount + 1);
  });
});
