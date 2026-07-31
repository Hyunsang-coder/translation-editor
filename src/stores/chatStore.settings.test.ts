import { describe, expect, it, vi } from 'vitest';
import { createSettingsActions } from './chatStore.settings';
import type { ChatGet, ChatSet, ChatStore } from './chatStore.types';

function createSettingsHarness(translationRules = '') {
  let state = { translationRules, projectContext: '' } as ChatStore;

  const set: ChatSet = (partial) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...next };
  };
  const get: ChatGet = () => state;
  const actions = createSettingsActions(set, get, { schedulePersist: vi.fn() });

  return { actions, get };
}

describe('appendToTranslationRules 중복 방지', () => {
  it('세미콜론 구분 규칙을 불릿으로 붙인다', () => {
    const { actions, get } = createSettingsHarness();

    expect(actions.appendToTranslationRules('합니다체 통일; 고유명사 원문 유지')).toBe(true);
    expect(get().translationRules).toBe('- 합니다체 통일\n- 고유명사 원문 유지');
  });

  it('이미 있는 규칙은 붙이지 않고 새 규칙만 남긴다', () => {
    const { actions, get } = createSettingsHarness('- 합니다체 통일');

    expect(actions.appendToTranslationRules('합니다체 통일; 숫자는 아라비아 숫자로')).toBe(true);
    expect(get().translationRules).toBe('- 합니다체 통일\n\n- 숫자는 아라비아 숫자로');
  });

  it('공백·대소문자·불릿 차이는 같은 규칙으로 본다', () => {
    const { actions, get } = createSettingsHarness('- Keep  Proper Nouns');

    expect(actions.appendToTranslationRules('keep proper nouns')).toBe(false);
    expect(get().translationRules).toBe('- Keep  Proper Nouns');
  });

  it('한 스니펫 안의 중복도 한 번만 붙인다', () => {
    const { actions, get } = createSettingsHarness();

    expect(actions.appendToTranslationRules('해요체; 해요체')).toBe(true);
    expect(get().translationRules).toBe('- 해요체');
  });

  it('전부 중복이면 false를 돌려주고 저장하지 않는다', () => {
    const { actions, get } = createSettingsHarness('- 합니다체 통일');

    expect(actions.appendToTranslationRules('합니다체 통일')).toBe(false);
    expect(get().translationRules).toBe('- 합니다체 통일');
  });
});
