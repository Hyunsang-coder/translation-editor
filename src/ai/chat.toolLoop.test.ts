import { describe, it, expect, vi } from 'vitest';
import { AIMessageChunk, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import i18n from '@/i18n/config';
import { runToolCallingLoop, FINAL_STEP_NUDGE } from './chat';

type LoopParams = Parameters<typeof runToolCallingLoop>[0];

function textChunk(text: string): AIMessageChunk {
  return new AIMessageChunk({ content: text });
}

function toolCallChunk(name: string, id: string): AIMessageChunk {
  return new AIMessageChunk({
    content: '',
    tool_call_chunks: [{ name, args: '{}', id, index: 0, type: 'tool_call_chunk' }],
  });
}

async function* chunkStream(chunks: AIMessageChunk[]): AsyncGenerator<AIMessageChunk> {
  for (const c of chunks) yield c;
}

/**
 * 스텝별 응답을 미리 정의한 가짜 모델.
 * loopMessages는 in-place로 변하므로, 각 호출 시점의 메시지 목록을 복사해 기록한다.
 */
function makeModel(steps: AIMessageChunk[][]) {
  const seenMessages: BaseMessage[][] = [];
  const seenOptions: Array<Record<string, unknown> | undefined> = [];
  let call = 0;
  const streamMock = vi.fn(async (messages: BaseMessage[], options?: Record<string, unknown>) => {
    seenMessages.push([...messages]);
    seenOptions.push(options);
    const idx = Math.min(call, steps.length - 1);
    call += 1;
    return chunkStream(steps[idx]!);
  });
  return {
    model: { stream: streamMock } as unknown as LoopParams['model'],
    streamMock,
    seenMessages,
    seenOptions,
  };
}

function fakeTool() {
  return { name: 'fake_tool', invoke: vi.fn(async () => 'tool output') };
}

/** Anthropic message_start/message_delta가 보고하는 누적 스냅샷 usage를 실은 청크 */
function usageChunk(u: {
  input: number;
  output: number;
  cacheRead?: number;
  cacheCreation?: number;
}): AIMessageChunk {
  const chunk = new AIMessageChunk({ content: '' });
  // 이 버전의 AIMessageChunk 생성자 타입은 usage_metadata를 받지 않으므로 직접 주입
  (chunk as { usage_metadata?: unknown }).usage_metadata = {
    input_tokens: u.input,
    output_tokens: u.output,
    total_tokens: u.input + u.output,
    input_token_details: {
      ...(u.cacheRead !== undefined ? { cache_read: u.cacheRead } : {}),
      ...(u.cacheCreation !== undefined ? { cache_creation: u.cacheCreation } : {}),
    },
  };
  return chunk;
}

function baseMessages(): BaseMessage[] {
  return [new SystemMessage('sys'), new HumanMessage('질문')];
}

describe('runToolCallingLoop 스텝 소진 처리', () => {
  it('도구 호출 없는 응답은 그대로 최종 답변이 된다', async () => {
    const { model, streamMock } = makeModel([[textChunk('바로 답변')]]);
    const res = await runToolCallingLoop({
      model,
      tools: [fakeTool()],
      messages: baseMessages(),
      maxSteps: 6,
    });
    expect(res.finalText).toBe('바로 답변');
    expect(res.usedTools).toBe(false);
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it('마지막 스텝에서 텍스트와 도구 호출이 함께 오면 텍스트를 폐기하지 않는다', async () => {
    const tool = fakeTool();
    const { model } = makeModel([
      [textChunk('확보한 근거로 작성한 답변입니다.'), toolCallChunk('fake_tool', 'c1')],
    ]);
    const res = await runToolCallingLoop({
      model,
      tools: [tool],
      messages: baseMessages(),
      maxSteps: 1,
    });
    expect(res.finalText).toBe('확보한 근거로 작성한 답변입니다.');
    expect(res.usedTools).toBe(true);
  });

  it('이전 스텝의 텍스트도 스텝 소진 시 복구된다', async () => {
    const { model } = makeModel([
      [textChunk('중간 스텝의 답변'), toolCallChunk('fake_tool', 'c1')],
      [toolCallChunk('fake_tool', 'c2')],
    ]);
    const res = await runToolCallingLoop({
      model,
      tools: [fakeTool()],
      messages: baseMessages(),
      maxSteps: 2,
    });
    expect(res.finalText).toBe('중간 스텝의 답변');
  });

  it('텍스트가 전혀 없이 스텝이 소진되면 정직한 스텝 한도 안내를 반환한다', async () => {
    const { model } = makeModel([[toolCallChunk('fake_tool', 'c1')]]);
    const res = await runToolCallingLoop({
      model,
      tools: [fakeTool()],
      messages: baseMessages(),
      maxSteps: 1,
    });
    expect(res.finalText).toBe(i18n.t('errors.toolLoopStepLimit'));
    // 과거의 오도성 메시지("컨텍스트를 충분히 확보하지 못했습니다")가 아니어야 한다.
    expect(res.finalText).not.toContain('컨텍스트');
  });

  it('마지막 스텝 진입 시 도구 없이 답하라는 안내를 주입한다', async () => {
    const { model, streamMock, seenMessages } = makeModel([
      [toolCallChunk('fake_tool', 'c1')],
      [textChunk('최종 답변')],
    ]);
    const res = await runToolCallingLoop({
      model,
      tools: [fakeTool()],
      messages: baseMessages(),
      maxSteps: 2,
    });
    expect(res.finalText).toBe('최종 답변');
    expect(streamMock).toHaveBeenCalledTimes(2);

    const hasNudge = (msgs: BaseMessage[]) =>
      msgs.some(
        (m) => typeof m.content === 'string' && m.content.includes(FINAL_STEP_NUDGE),
      );
    // 첫 스텝(도구 사용 가능)에는 주입하지 않고, 마지막 스텝에만 주입한다.
    expect(hasNudge(seenMessages[0]!)).toBe(false);
    expect(hasNudge(seenMessages[1]!)).toBe(true);
  });

  it('첫 스텝이 곧 마지막 스텝이면(maxSteps=1) 안내를 주입하지 않는다', async () => {
    const { model, seenMessages } = makeModel([[textChunk('답변')]]);
    await runToolCallingLoop({
      model,
      tools: [fakeTool()],
      messages: baseMessages(),
      maxSteps: 1,
    });
    const hasNudge = seenMessages[0]!.some(
      (m) => typeof m.content === 'string' && m.content.includes(FINAL_STEP_NUDGE),
    );
    expect(hasNudge).toBe(false);
  });
});

describe('runToolCallingLoop Anthropic prompt caching', () => {
  function cacheMarkerCount(msgs: BaseMessage[]): number {
    let count = 0;
    for (const m of msgs) {
      if (!Array.isArray(m.content)) continue;
      for (const block of m.content as Array<Record<string, unknown>>) {
        if (block && typeof block === 'object' && 'cache_control' in block) count++;
      }
    }
    return count;
  }

  it('provider=anthropic이면 매 스텝 요청에 cache_control breakpoint를 적용한다', async () => {
    const { model, seenMessages } = makeModel([
      [toolCallChunk('fake_tool', 'c1')],
      [textChunk('최종 답변')],
    ]);
    const original = baseMessages();
    await runToolCallingLoop({
      model,
      tools: [fakeTool()],
      messages: original,
      maxSteps: 3,
      provider: 'anthropic',
    });

    // 두 스텝 모두: 시스템 + 마지막 HumanMessage에 정확히 2개
    for (const wire of seenMessages) {
      expect(cacheMarkerCount(wire)).toBe(2);
      const system = wire[0]!.content as Array<{ cache_control?: unknown }>;
      expect(system[system.length - 1]!.cache_control).toEqual({ type: 'ephemeral' });
    }
    // 원본 메시지는 plain 유지 (누적 방지)
    expect(original[0]!.content).toBe('sys');
    expect(original[1]!.content).toBe('질문');
  });

  it('provider 미지정/openai면 메시지를 변형하지 않는다', async () => {
    const { model, seenMessages, seenOptions } = makeModel([[textChunk('답변')]]);
    await runToolCallingLoop({
      model,
      tools: [fakeTool()],
      messages: baseMessages(),
      maxSteps: 2,
      provider: 'openai',
    });
    expect(cacheMarkerCount(seenMessages[0]!)).toBe(0);
    expect(seenMessages[0]![0]!.content).toBe('sys');
    // 호출 옵션에도 cache_control을 넣지 않는다 (Anthropic 전용 옵션)
    for (const opts of seenOptions) {
      expect(opts ?? {}).not.toHaveProperty('cache_control');
    }
  });

  it('message_start/message_delta 중복 보고를 이중 계상하지 않고 lastInputTokens를 추적한다', async () => {
    // Anthropic 실스트림 재현: 두 이벤트 모두 누적 스냅샷 usage를 보고한다.
    // 종전 concat 합산 방식은 캐시 필드를 정확히 2배로 계상했다 (write > input 로그).
    const { model } = makeModel([
      [
        usageChunk({ input: 4325, output: 1, cacheRead: 0, cacheCreation: 4323 }), // message_start
        toolCallChunk('fake_tool', 'c1'),
        usageChunk({ input: 0, output: 50, cacheRead: 0, cacheCreation: 4323 }), // message_delta
      ],
      [
        usageChunk({ input: 6000, output: 1, cacheRead: 5625, cacheCreation: 300 }),
        textChunk('최종 답변'),
        usageChunk({ input: 0, output: 80, cacheRead: 5625, cacheCreation: 300 }),
      ],
    ]);
    const res = await runToolCallingLoop({
      model,
      tools: [fakeTool()],
      messages: baseMessages(),
      maxSteps: 3,
      provider: 'anthropic',
    });

    expect(res.usage.modelCalls).toBe(2);
    expect(res.usage.inputTokens).toBe(4325 + 6000);
    expect(res.usage.outputTokens).toBe(50 + 80);
    expect(res.usage.totalTokens).toBe(4325 + 50 + 6000 + 80);
    // 캐시 필드: 스텝별 최댓값의 합 (2배 아님)
    expect(res.usage.cacheReadInputTokens).toBe(0 + 5625);
    expect(res.usage.cacheCreationInputTokens).toBe(4323 + 300);
    // 마지막 모델 호출의 입력 (컨텍스트 점유율용, 누적 아님)
    expect(res.usage.lastInputTokens).toBe(6000);
  });

  it('provider=anthropic이면 호출 옵션 cache_control로 도구 결과 꼬리 breakpoint를 요청한다', async () => {
    const { model, seenOptions } = makeModel([
      [toolCallChunk('fake_tool', 'c1')],
      [textChunk('최종 답변')],
    ]);
    await runToolCallingLoop({
      model,
      tools: [fakeTool()],
      messages: baseMessages(),
      maxSteps: 3,
      provider: 'anthropic',
    });

    // 매 스텝: 어댑터가 변환된 페이로드의 마지막 블록(스텝 2+는 마지막 tool_result)에
    // marker를 추가하도록 옵션을 전달한다
    expect(seenOptions.length).toBe(2);
    for (const opts of seenOptions) {
      expect(opts).toMatchObject({ cache_control: { type: 'ephemeral' } });
    }
  });
});
