import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '@/ai/config';
import {
  completeWithTauriAiBackend,
  streamWithTauriAiBackend,
  type AiPromptMessage,
} from './backendCompletion';

const mocks = vi.hoisted(() => ({
  aiComplete: vi.fn(),
  aiStream: vi.fn(),
  aiStreamCancel: vi.fn(),
  isTauriRuntime: vi.fn(),
}));

vi.mock('@/tauri/ai', () => ({
  aiComplete: mocks.aiComplete,
  aiStream: mocks.aiStream,
  aiStreamCancel: mocks.aiStreamCancel,
}));

vi.mock('@/tauri/invoke', () => ({
  isTauriRuntime: mocks.isTauriRuntime,
}));

describe('backendCompletion', () => {
  const messages: AiPromptMessage[] = [{ role: 'user', content: 'Hello' }];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauriRuntime.mockReturnValue(true);
    mocks.aiComplete.mockResolvedValue({ text: 'ok' });
    mocks.aiStreamCancel.mockResolvedValue(undefined);
    mocks.aiStream.mockImplementation(async (_args, onEvent) => {
      onEvent({ type: 'delta', text: 'ok' });
      return { text: 'ok' };
    });
  });

  it('Opus 4.7+ 백엔드 completion 호출에는 temperature를 전달하지 않음', async () => {
    const cfg: AiConfig = {
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      anthropicApiKey: 'sk-ant-test',
      temperature: 0.7,
      maxRecentMessages: 20,
    };

    await completeWithTauriAiBackend({ cfg, messages, maxTokens: 4096 });

    const args = mocks.aiComplete.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.model).toBe('claude-opus-4-8');
    expect('temperature' in args).toBe(false);
  });

  it('일반 Claude 백엔드 completion 호출에는 temperature를 유지', async () => {
    const cfg: AiConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      anthropicApiKey: 'sk-ant-test',
      temperature: 0.7,
      maxRecentMessages: 20,
    };

    await completeWithTauriAiBackend({ cfg, messages, maxTokens: 4096 });

    const args = mocks.aiComplete.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.model).toBe('claude-sonnet-4-6');
    expect(args.temperature).toBe(0.7);
  });

  it('GPT-5 백엔드 스트리밍 호출에는 temperature를 전달하지 않음', async () => {
    const cfg: AiConfig = {
      provider: 'openai',
      model: 'gpt-5.5',
      openaiApiKey: 'sk-test',
      temperature: 0.7,
      maxRecentMessages: 20,
    };

    await streamWithTauriAiBackend({ cfg, messages, maxTokens: 4096 });

    const args = mocks.aiStream.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.model).toBe('gpt-5.5');
    expect('temperature' in args).toBe(false);
  });

  it('Opus 4.7+ 백엔드 completion 호출에는 adaptiveThinking·effort를 전달 (F7)', async () => {
    const cfg: AiConfig = {
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      anthropicApiKey: 'sk-ant-test',
      maxRecentMessages: 20,
    };

    await completeWithTauriAiBackend({ cfg, messages, maxTokens: 4096 });

    const args = mocks.aiComplete.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.adaptiveThinking).toBe(true);
    expect(args.effort).toBe('high');
  });

  it('GPT-5 review 스트리밍에는 effort=high, 기본(translation)에는 미전달 (F8)', async () => {
    const cfg: AiConfig = {
      provider: 'openai',
      model: 'gpt-5.5',
      openaiApiKey: 'sk-test',
      maxRecentMessages: 20,
    };

    await streamWithTauriAiBackend({ cfg, messages, maxTokens: 4096, useFor: 'review' });
    const reviewArgs = mocks.aiStream.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(reviewArgs.effort).toBe('high');

    await streamWithTauriAiBackend({ cfg, messages, maxTokens: 4096 });
    const translateArgs = mocks.aiStream.mock.calls[1]?.[0] as Record<string, unknown>;
    expect('effort' in translateArgs).toBe(false);
  });

  it('GPT-5.6 Luna medium 백엔드 호출에 실제 모델 ID와 effort=medium을 전달', async () => {
    const cfg: AiConfig = {
      provider: 'openai',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'medium',
      openaiApiKey: 'sk-test',
      maxRecentMessages: 20,
    };

    await streamWithTauriAiBackend({ cfg, messages, maxTokens: 4096 });

    const args = mocks.aiStream.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.model).toBe('gpt-5.6-luna');
    expect(args.effort).toBe('medium');
  });

  it('abortSignal 있는 completion은 cancellable streaming backend를 사용', async () => {
    const cfg: AiConfig = {
      provider: 'openai',
      model: 'gpt-5.5',
      openaiApiKey: 'sk-test',
      maxRecentMessages: 20,
    };
    const abortController = new AbortController();

    const result = await completeWithTauriAiBackend({
      cfg,
      messages,
      maxTokens: 4096,
      cancelMessage: '검수가 취소되었습니다.',
      abortSignal: abortController.signal,
    });

    expect(result).toBe('ok');
    expect(mocks.aiComplete).not.toHaveBeenCalled();
    expect(mocks.aiStream).toHaveBeenCalledTimes(1);
  });

  it('abortSignal 있는 completion 중 취소되면 백엔드 스트림 취소를 호출', async () => {
    const cfg: AiConfig = {
      provider: 'openai',
      model: 'gpt-5.5',
      openaiApiKey: 'sk-test',
      maxRecentMessages: 20,
    };
    mocks.aiStream.mockImplementation(async () => new Promise(() => undefined));
    const abortController = new AbortController();

    const promise = completeWithTauriAiBackend({
      cfg,
      messages,
      maxTokens: 4096,
      cancelMessage: '검수가 취소되었습니다.',
      abortSignal: abortController.signal,
    });
    abortController.abort();

    await expect(promise).rejects.toThrow('검수가 취소되었습니다.');
    expect(mocks.aiComplete).not.toHaveBeenCalled();
    expect(mocks.aiStreamCancel).toHaveBeenCalledTimes(1);
  });

  it('streaming completion 중 취소되면 백엔드 스트림 취소를 호출', async () => {
    const cfg: AiConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      anthropicApiKey: 'sk-ant-test',
      maxRecentMessages: 20,
    };
    mocks.aiStream.mockImplementation(async () => new Promise(() => undefined));
    const abortController = new AbortController();

    const promise = streamWithTauriAiBackend({
      cfg,
      messages,
      maxTokens: 4096,
      cancelMessage: '검수가 취소되었습니다.',
      abortSignal: abortController.signal,
    });
    abortController.abort();

    await expect(promise).rejects.toThrow('검수가 취소되었습니다.');
    expect(mocks.aiStreamCancel).toHaveBeenCalledTimes(1);
  });
});
