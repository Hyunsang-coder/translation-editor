import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { resolveModelRunConfig } from '@/ai/config';

const anthropicCtorSpy = vi.fn();
const openaiCtorSpy = vi.fn();

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: vi.fn().mockImplementation((args: unknown) => {
    anthropicCtorSpy(args);
    return { __mock: 'anthropic', args };
  }),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn().mockImplementation((args: unknown) => {
    openaiCtorSpy(args);
    return { __mock: 'openai', args };
  }),
}));

describe('resolveModelRunConfig', () => {
  beforeEach(() => {
    anthropicCtorSpy.mockClear();
    openaiCtorSpy.mockClear();
    useAiConfigStore.setState({
      translationModel: 'claude-sonnet-5',
      chatModel: 'claude-sonnet-5',
      anthropicApiKey: 'sk-ant-test',
      openaiApiKey: 'sk-openai-test',
      anthropicEnabled: true,
      openaiEnabled: true,
    });
  });

  it('전역 chat 프리셋을 스냅샷으로 캡처한다', () => {
    const rc = resolveModelRunConfig();
    expect(rc.requestedPreset).toBe('claude-sonnet-5');
    expect(rc.resolvedModel).toBe('claude-sonnet-5');
    expect(rc.provider).toBe('anthropic');
  });

  it('명시적 preset이 전역 값보다 우선한다', () => {
    const rc = resolveModelRunConfig({ preset: 'gpt-5.6-luna-medium' });
    expect(rc.requestedPreset).toBe('gpt-5.6-luna-medium');
    expect(rc.resolvedModel).toBe('gpt-5.6-luna');
    expect(rc.provider).toBe('openai');
    expect(rc.reasoningEffort).toBe('medium');
  });

  it('resolve 이후 전역 store가 바뀌어도 캡처된 config는 변하지 않는다', () => {
    const rc = resolveModelRunConfig();
    // 요청 준비 중 사용자가 모델을 바꾸는 상황 시뮬레이션
    useAiConfigStore.setState({ chatModel: 'gpt-5.6-sol-high' });
    expect(rc.requestedPreset).toBe('claude-sonnet-5');
    expect(rc.resolvedModel).toBe('claude-sonnet-5');
    expect(rc.provider).toBe('anthropic');
  });

  it('반환된 config는 불변(frozen)이다', () => {
    const rc = resolveModelRunConfig();
    expect(Object.isFrozen(rc)).toBe(true);
  });
});

describe('createChatModel with runConfig — 모델 결정 경쟁 조건 제거', () => {
  beforeEach(() => {
    anthropicCtorSpy.mockClear();
    openaiCtorSpy.mockClear();
    useAiConfigStore.setState({
      translationModel: 'claude-sonnet-5',
      chatModel: 'claude-sonnet-5',
      anthropicApiKey: 'sk-ant-test',
      openaiApiKey: 'sk-openai-test',
      anthropicEnabled: true,
      openaiEnabled: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runConfig로 캡처한 모델을, 이후 전역 변경과 무관하게 사용한다', async () => {
    const { createChatModel } = await import('@/ai/client');
    const rc = resolveModelRunConfig(); // claude-sonnet-5 캡처

    // 준비 단계 이후 사용자가 전역 모델을 OpenAI로 변경
    useAiConfigStore.setState({ chatModel: 'gpt-5.6-sol-high' });

    createChatModel(undefined, { useFor: 'chat', runConfig: rc });

    // 캡처된 anthropic 모델이 사용되어야 함 (전역 변경 무시)
    expect(anthropicCtorSpy).toHaveBeenCalledTimes(1);
    expect(openaiCtorSpy).not.toHaveBeenCalled();
    const callArgs = anthropicCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.model).toBe('claude-sonnet-5');
  });

  it('runConfig의 provider/effort가 생성자에 반영된다', async () => {
    const { createChatModel } = await import('@/ai/client');
    const rc = resolveModelRunConfig({ preset: 'gpt-5.6-luna-medium' });

    createChatModel(undefined, { useFor: 'chat', runConfig: rc });

    expect(openaiCtorSpy).toHaveBeenCalledTimes(1);
    const callArgs = openaiCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.model).toBe('gpt-5.6-luna');
    expect(callArgs.reasoning).toEqual({ effort: 'medium' });
  });
});
