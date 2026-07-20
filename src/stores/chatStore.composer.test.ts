import { describe, expect, it, vi } from 'vitest';
import { createComposerActions } from './chatStore.settings';
import type { ChatGet, ChatSet, ChatStore } from './chatStore.types';

function createComposerHarness(currentSessionId = 'session-a') {
  let state = {
    composerText: '',
    composerFocusNonce: 0,
    currentSessionId,
    pendingComposerAppend: null,
    pendingComposerFocus: null,
  } as ChatStore;

  const set: ChatSet = (partial) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...next };
  };
  const get: ChatGet = () => state;
  const actions = createComposerActions(set, get, { schedulePersist: vi.fn() });

  return { actions, get };
}

describe('chat composer pending append', () => {
  it('채팅 입력창이 나중에 마운트돼도 대기 중인 텍스트를 한 번 소비할 수 있다', () => {
    const { actions, get } = createComposerHarness();

    actions.appendComposerText('선택한 텍스트');

    const pending = actions.consumePendingComposerAppend('session-a');
    expect(pending).toMatchObject({
      text: '선택한 텍스트',
      separator: '\n\n',
      targetSessionId: 'session-a',
    });
    expect(get().pendingComposerAppend).toBeNull();
    expect(actions.consumePendingComposerAppend('session-a')).toBeNull();
  });

  it('다른 채팅 세션은 자신을 대상으로 하지 않은 텍스트를 소비하지 않는다', () => {
    const { actions, get } = createComposerHarness();

    actions.appendComposerText('session-a 전용 텍스트');

    expect(actions.consumePendingComposerAppend('session-b')).toBeNull();
    expect(get().pendingComposerAppend?.text).toBe('session-a 전용 텍스트');
  });
});
