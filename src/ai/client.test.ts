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
      provider: 'anthropic',
      anthropicApiKey: 'sk-ant-test',
      openaiApiKey: undefined,
      anthropicEnabled: true,
      openaiEnabled: false,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('검수(claude-opus-5) 호출 시 ChatAnthropic 생성자에 temperature가 전달되지 않음', async () => {
    vi.stubEnv('VITE_AI_TEMPERATURE', '0.7');
    const { createChatModel } = await import('@/ai/client');

    createChatModel(undefined, { useFor: 'review' });

    expect(anthropicCtorSpy).toHaveBeenCalledTimes(1);
    const callArgs = anthropicCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.model).toBe('claude-opus-5');
    expect('temperature' in callArgs).toBe(false);
  });

  // Haiku는 매핑에서 제거됐지만 sampling 가드 자체는 구형 모델용으로 남아 있어야 한다.
  it('modelOverride로 claude-haiku-4-5를 지정하면 temperature가 정상 전달됨 (회귀 방지)', async () => {
    vi.stubEnv('VITE_AI_TEMPERATURE', '0.7');
    const { createChatModel } = await import('@/ai/client');

    createChatModel('claude-haiku-4-5', { useFor: 'chat' });

    const callArgs = anthropicCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.model).toBe('claude-haiku-4-5');
    expect(callArgs.temperature).toBe(0.7);
  });

  it('채팅(claude-sonnet-5) 호출 시 temperature가 전달되지 않음', async () => {
    vi.stubEnv('VITE_AI_TEMPERATURE', '0.7');
    const { createChatModel } = await import('@/ai/client');

    createChatModel(undefined, { useFor: 'chat' });

    const callArgs = anthropicCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.model).toBe('claude-sonnet-5');
    expect('temperature' in callArgs).toBe(false);
  });

  it('modelOverride로 claude-opus-5를 직접 지정해도 temperature 차단', async () => {
    vi.stubEnv('VITE_AI_TEMPERATURE', '0.5');
    const { createChatModel } = await import('@/ai/client');

    createChatModel('claude-opus-5', { useFor: 'chat' });

    const callArgs = anthropicCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.model).toBe('claude-opus-5');
    expect('temperature' in callArgs).toBe(false);
  });

  // 폴리싱이 문서 한 벌을 통째로 뱉는데 채팅 상한(8192)이 걸리면 조용히 잘린다.
  it('폴리싱은 번역과 같은 긴 출력 상한을 받는다', async () => {
    const { createChatModel } = await import('@/ai/client');
    const { DEFAULT_TRANSLATION_MAX_TOKENS, DEFAULT_CHAT_MAX_TOKENS } = await import('@/ai/constants');

    createChatModel(undefined, { useFor: 'polish' });
    const polishArgs = anthropicCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(polishArgs.maxTokens).toBe(DEFAULT_TRANSLATION_MAX_TOKENS);

    anthropicCtorSpy.mockClear();
    createChatModel(undefined, { useFor: 'chat' });
    const chatArgs = anthropicCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(chatArgs.maxTokens).toBe(DEFAULT_CHAT_MAX_TOKENS);
  });
});
