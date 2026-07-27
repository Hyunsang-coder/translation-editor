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
  let call = 0;
  const streamMock = vi.fn(async (messages: BaseMessage[]) => {
    seenMessages.push([...messages]);
    const idx = Math.min(call, steps.length - 1);
    call += 1;
    return chunkStream(steps[idx]!);
  });
  return {
    model: { stream: streamMock } as unknown as LoopParams['model'],
    streamMock,
    seenMessages,
  };
}

function fakeTool() {
  return { name: 'fake_tool', invoke: vi.fn(async () => 'tool output') };
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
    const { model, seenMessages } = makeModel([[textChunk('답변')]]);
    await runToolCallingLoop({
      model,
      tools: [fakeTool()],
      messages: baseMessages(),
      maxSteps: 2,
      provider: 'openai',
    });
    expect(cacheMarkerCount(seenMessages[0]!)).toBe(0);
    expect(seenMessages[0]![0]!.content).toBe('sys');
  });
});
