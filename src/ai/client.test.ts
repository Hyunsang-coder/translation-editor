import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiConfigStore } from '@/stores/aiConfigStore';

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

describe('createChatModel - Opus 5 sampling parameter guard', () => {
  beforeEach(() => {
    anthropicCtorSpy.mockClear();
    openaiCtorSpy.mockClear();
    useAiConfigStore.setState({
      translationModel: 'claude-opus-5',
      chatModel: 'claude-opus-5',
      anthropicApiKey: 'sk-ant-test',
      openaiApiKey: undefined,
      anthropicEnabled: true,
      openaiEnabled: false,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('claude-opus-5 호출 시 ChatAnthropic 생성자에 temperature가 전달되지 않음', async () => {
    vi.stubEnv('VITE_AI_TEMPERATURE', '0.7');
    const { createChatModel } = await import('@/ai/client');

    createChatModel(undefined, { useFor: 'chat' });

    expect(anthropicCtorSpy).toHaveBeenCalledTimes(1);
    const callArgs = anthropicCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.model).toBe('claude-opus-5');
    expect('temperature' in callArgs).toBe(false);
  });

  it('claude-haiku-4-5 호출 시에는 temperature가 정상 전달됨 (회귀 방지)', async () => {
    vi.stubEnv('VITE_AI_TEMPERATURE', '0.7');
    useAiConfigStore.setState({
      translationModel: 'claude-haiku-4-5',
      chatModel: 'claude-haiku-4-5',
    });
    const { createChatModel } = await import('@/ai/client');

    createChatModel(undefined, { useFor: 'chat' });

    const callArgs = anthropicCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.model).toBe('claude-haiku-4-5');
    expect(callArgs.temperature).toBe(0.7);
  });

  it('claude-sonnet-5 호출 시 temperature가 전달되지 않음', async () => {
    vi.stubEnv('VITE_AI_TEMPERATURE', '0.7');
    useAiConfigStore.setState({
      translationModel: 'claude-sonnet-5',
      chatModel: 'claude-sonnet-5',
    });
    const { createChatModel } = await import('@/ai/client');

    createChatModel(undefined, { useFor: 'chat' });

    const callArgs = anthropicCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.model).toBe('claude-sonnet-5');
    expect('temperature' in callArgs).toBe(false);
  });

  it('modelOverride로 claude-opus-5를 직접 지정해도 temperature 차단', async () => {
    vi.stubEnv('VITE_AI_TEMPERATURE', '0.5');
    useAiConfigStore.setState({
      translationModel: 'claude-sonnet-4-6',
      chatModel: 'claude-sonnet-4-6',
    });
    const { createChatModel } = await import('@/ai/client');

    createChatModel('claude-opus-5', { useFor: 'chat' });

    const callArgs = anthropicCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.model).toBe('claude-opus-5');
    expect('temperature' in callArgs).toBe(false);
  });
});
