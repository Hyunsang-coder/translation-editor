import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessage } from '@/types';
import type { ModelRunConfig } from '@/ai/config';

const createChatModel = vi.fn();
vi.mock('@/ai/client', () => ({ createChatModel: (...a: unknown[]) => createChatModel(...a) }));

import { summarizeConversation, resolveSummaryModelRunConfig } from './summarizeConversation';

function baseRc(overrides?: Partial<ModelRunConfig>): ModelRunConfig {
  return {
    requestedPreset: 'claude-opus-4-8',
    resolvedModel: 'claude-opus-4-8',
    provider: 'anthropic',
    openaiApiKey: 'sk-openai',
    anthropicApiKey: 'sk-ant',
    maxRecentMessages: 20,
    ...overrides,
  } as ModelRunConfig;
}

const msgs: ChatMessage[] = [
  { id: 'm0', role: 'user', content: '이 문장 번역해줘: Hello', timestamp: 1 },
  { id: 'm1', role: 'assistant', content: '안녕하세요', timestamp: 2 },
];

beforeEach(() => {
  createChatModel.mockReset();
});

describe('resolveSummaryModelRunConfig', () => {
  it('anthropic 실행은 저비용 Haiku 프리셋으로 요약', () => {
    const rc = resolveSummaryModelRunConfig(baseRc({ provider: 'anthropic', resolvedModel: 'claude-opus-4-8' }));
    expect(rc.provider).toBe('anthropic');
    expect(rc.resolvedModel).toContain('haiku');
    expect(rc.anthropicApiKey).toBe('sk-ant');
  });

  it('openai 실행은 저비용 Luna 프리셋으로 요약', () => {
    const rc = resolveSummaryModelRunConfig(
      baseRc({ provider: 'openai', resolvedModel: 'gpt-5.6-sol', requestedPreset: 'gpt-5.6-sol-high' }),
    );
    expect(rc.provider).toBe('openai');
    expect(rc.resolvedModel).toBe('gpt-5.6-luna');
    expect(rc.openaiApiKey).toBe('sk-openai');
  });

  it('채팅 모델을 바꿔도(같은 provider) 요약 모델은 고정 저비용 모델', () => {
    const a = resolveSummaryModelRunConfig(baseRc({ provider: 'anthropic', resolvedModel: 'claude-opus-4-8' }));
    const b = resolveSummaryModelRunConfig(baseRc({ provider: 'anthropic', resolvedModel: 'claude-sonnet-5' }));
    expect(a.resolvedModel).toBe(b.resolvedModel);
  });
});

describe('summarizeConversation', () => {
  it('요약 대상이 없으면 모델을 호출하지 않고 기존 요약을 반환', async () => {
    const out = await summarizeConversation({
      priorSummary: '기존 요약',
      messagesToSummarize: [],
      runConfig: baseRc(),
    });
    expect(out).toBe('기존 요약');
    expect(createChatModel).not.toHaveBeenCalled();
  });

  it('기존 요약 + 새 메시지를 입력으로 저비용 모델을 호출하고 새 요약을 반환', async () => {
    const invoke = vi.fn().mockResolvedValue({ content: '새 누적 요약' });
    createChatModel.mockReturnValue({ invoke });

    const out = await summarizeConversation({
      priorSummary: '기존 요약',
      messagesToSummarize: msgs,
      runConfig: baseRc(),
    });

    expect(out).toBe('새 누적 요약');
    expect(createChatModel).toHaveBeenCalledTimes(1);
    // 저비용 요약 runConfig가 전달됐는지
    const opts = createChatModel.mock.calls[0]![1] as { runConfig: ModelRunConfig };
    expect(opts.runConfig.resolvedModel).toContain('haiku');
    // 입력 메시지에 기존 요약과 새 대화 원문이 포함
    const passedMessages = invoke.mock.calls[0]![0] as { content: string }[];
    const joined = passedMessages.map((m) => String(m.content)).join('\n');
    expect(joined).toContain('기존 요약');
    expect(joined).toContain('Hello');
  });

  it('모델이 빈 응답을 주면 기존 요약을 유지(무손실 fallback)', async () => {
    const invoke = vi.fn().mockResolvedValue({ content: '   ' });
    createChatModel.mockReturnValue({ invoke });
    const out = await summarizeConversation({
      priorSummary: '기존 요약',
      messagesToSummarize: msgs,
      runConfig: baseRc(),
    });
    expect(out).toBe('기존 요약');
  });

  it('abortSignal을 모델 invoke 옵션으로 전달', async () => {
    const invoke = vi.fn().mockResolvedValue({ content: '요약' });
    createChatModel.mockReturnValue({ invoke });
    const ac = new AbortController();
    await summarizeConversation({
      priorSummary: '',
      messagesToSummarize: msgs,
      runConfig: baseRc(),
      abortSignal: ac.signal,
    });
    const invokeOpts = invoke.mock.calls[0]![1] as { signal?: AbortSignal };
    expect(invokeOpts.signal).toBe(ac.signal);
  });
});
