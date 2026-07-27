import { describe, it, expect, vi } from 'vitest';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import i18n from '@/i18n/config';
import { runChatAgentStream, FINAL_STEP_NUDGE } from './runAgentStream';
import {
  ScriptedChatModel,
  textChunk,
  toolCallChunk,
  usageChunk,
  type ScriptedStep,
} from './testing';

function makeModel(steps: ScriptedStep[]) {
  return new ScriptedChatModel({ steps });
}

/** registry 미등록 → 외부 신뢰도로 간주되어 출력이 래핑된다 */
const fakeTool = tool(async () => 'tool output', {
  name: 'fake_tool',
  description: 'fake',
  schema: z.object({}),
});

/** registry 등록(trust: internal, maxOutputChars: 256) → 래핑 없음, 절단 있음 */
const longOutputTool = tool(async () => 'X'.repeat(1000), {
  name: 'suggest_translation_rule',
  description: 'long',
  schema: z.object({}),
});

const failingTool = tool(
  async () => {
    throw new Error('always fails');
  },
  { name: 'fake_tool', description: 'fails', schema: z.object({}) },
);

function baseMessages(): BaseMessage[] {
  return [new HumanMessage('질문')];
}

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

const SYSTEM_PROMPT = 'sys';

function run(params: Partial<Parameters<typeof runChatAgentStream>[0]> & { model: ScriptedChatModel }) {
  return runChatAgentStream({
    tools: [fakeTool],
    systemPrompt: SYSTEM_PROMPT,
    messages: baseMessages(),
    maxSteps: 6,
    ...params,
  });
}

// ── 스텝 소진 / 최종 답변 ───────────────────────────────────────────────

describe('runChatAgentStream 스텝 소진 처리', () => {
  it('도구 호출 없는 응답은 그대로 최종 답변이 된다', async () => {
    const model = makeModel([[textChunk('바로 답변')]]);
    const res = await run({ model });

    expect(res.finalText).toBe('바로 답변');
    expect(res.usedTools).toBe(false);
    expect(model.callCount).toBe(1);
  });

  it('마지막 스텝에서 텍스트와 도구 호출이 함께 오면 텍스트를 폐기하지 않는다', async () => {
    const model = makeModel([
      [textChunk('확보한 근거로 작성한 답변입니다.'), toolCallChunk('fake_tool', 'c1')],
    ]);
    const res = await run({ model, maxSteps: 1 });

    expect(res.finalText).toBe('확보한 근거로 작성한 답변입니다.');
    expect(res.usedTools).toBe(true);
  });

  it('이전 스텝의 텍스트도 스텝 소진 시 복구된다', async () => {
    const model = makeModel([
      [textChunk('중간 스텝의 답변'), toolCallChunk('fake_tool', 'c1')],
      [toolCallChunk('fake_tool', 'c2')],
    ]);
    const res = await run({ model, maxSteps: 2 });

    expect(res.finalText).toBe('중간 스텝의 답변');
  });

  it('텍스트가 전혀 없이 스텝이 소진되면 정직한 스텝 한도 안내를 반환한다', async () => {
    const model = makeModel([[toolCallChunk('fake_tool', 'c1')]]);
    const res = await run({ model, maxSteps: 1 });

    expect(res.finalText).toBe(i18n.t('errors.toolLoopStepLimit'));
    expect(res.finalText).not.toContain('컨텍스트');
    // 빌트인 modelCallLimit의 영문 안내가 사용자에게 새어나가면 안 된다.
    expect(res.finalText).not.toContain('Model call limits exceeded');
  });

  it('마지막 스텝 진입 시 도구 없이 답하라는 안내를 주입한다', async () => {
    const model = makeModel([
      [toolCallChunk('fake_tool', 'c1')],
      [textChunk('최종 답변')],
    ]);
    const res = await run({ model, maxSteps: 2 });

    expect(res.finalText).toBe('최종 답변');
    expect(model.callCount).toBe(2);

    const hasNudge = (msgs: BaseMessage[]) =>
      msgs.some((m) => typeof m.content === 'string' && m.content.includes(FINAL_STEP_NUDGE));
    expect(hasNudge(model.seenMessages[0]!)).toBe(false);
    expect(hasNudge(model.seenMessages[1]!)).toBe(true);
  });

  it('첫 스텝이 곧 마지막 스텝이면(maxSteps=1) 안내를 주입하지 않는다', async () => {
    const model = makeModel([[textChunk('답변')]]);
    await run({ model, maxSteps: 1 });

    const hasNudge = model.seenMessages[0]!.some(
      (m) => typeof m.content === 'string' && m.content.includes(FINAL_STEP_NUDGE),
    );
    expect(hasNudge).toBe(false);
  });
});

// ── Anthropic prompt caching ────────────────────────────────────────────

describe('runChatAgentStream Anthropic prompt caching', () => {
  it('provider=anthropic이면 매 스텝 요청에 cache_control breakpoint 2개를 적용한다', async () => {
    const model = makeModel([
      [toolCallChunk('fake_tool', 'c1')],
      [textChunk('최종 답변')],
    ]);
    const original = baseMessages();
    await run({ model, messages: original, maxSteps: 3, provider: 'anthropic' });

    expect(model.seenMessages.length).toBe(2);
    for (const wire of model.seenMessages) {
      // 시스템 메시지 + 마지막 HumanMessage 정확히 2개
      expect(cacheMarkerCount(wire)).toBe(2);
      const system = wire[0]!.content as Array<{ cache_control?: unknown }>;
      expect(system[system.length - 1]!.cache_control).toEqual({ type: 'ephemeral' });
    }
    // 호출자가 넘긴 원본 배열은 plain 유지 (마커 누적 방지)
    expect(original[0]!.content).toBe('질문');
  });

  it('provider=anthropic이면 modelSettings.cache_control로 꼬리 breakpoint를 요청한다', async () => {
    const model = makeModel([
      [toolCallChunk('fake_tool', 'c1')],
      [textChunk('최종 답변')],
    ]);
    await run({ model, maxSteps: 3, provider: 'anthropic' });

    expect(model.seenKwargs.length).toBe(2);
    for (const kwargs of model.seenKwargs) {
      expect(kwargs).toMatchObject({ cache_control: { type: 'ephemeral' } });
    }
  });

  it('provider=openai면 메시지도 호출 옵션도 변형하지 않는다', async () => {
    const model = makeModel([[textChunk('답변')]]);
    await run({ model, maxSteps: 2, provider: 'openai' });

    expect(cacheMarkerCount(model.seenMessages[0]!)).toBe(0);
    for (const kwargs of model.seenKwargs) {
      expect(kwargs ?? {}).not.toHaveProperty('cache_control');
    }
  });
});

// ── usage 집계 ──────────────────────────────────────────────────────────

describe('runChatAgentStream usage 집계', () => {
  it('message_start/message_delta 중복 보고를 이중 계상하지 않고 lastInputTokens를 추적한다', async () => {
    const model = makeModel([
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
    const res = await run({ model, maxSteps: 3, provider: 'anthropic' });

    expect(res.usage.modelCalls).toBe(2);
    expect(res.usage.inputTokens).toBe(4325 + 6000);
    expect(res.usage.outputTokens).toBe(50 + 80);
    expect(res.usage.totalTokens).toBe(4325 + 50 + 6000 + 80);
    // 캐시 필드는 스텝별 최댓값의 합 (concat 합산이면 2배가 된다)
    expect(res.usage.cacheReadInputTokens).toBe(0 + 5625);
    expect(res.usage.cacheCreationInputTokens).toBe(4323 + 300);
    // 컨텍스트 점유율의 분자 — 누적이 아닌 마지막 호출 1회분
    expect(res.usage.lastInputTokens).toBe(6000);
  });
});

// ── 도구 실행 ───────────────────────────────────────────────────────────

describe('runChatAgentStream 도구 실행', () => {
  it('registry 미등록 도구 출력은 인젝션 방어 태그로 감싼다', async () => {
    const model = makeModel([
      [toolCallChunk('fake_tool', 'c1')],
      [textChunk('답변')],
    ]);
    await run({ model, maxSteps: 3 });

    const toolMsg = model.seenMessages[1]!.find((m) => m.getType() === 'tool');
    expect(String(toolMsg?.content)).toContain('<external_content>');
    expect(String(toolMsg?.content)).toContain('tool output');
  });

  it('registry의 maxOutputChars로 도구 출력을 절단하고 내부 도구는 래핑하지 않는다', async () => {
    const model = makeModel([
      [toolCallChunk('suggest_translation_rule', 'c1')],
      [textChunk('답변')],
    ]);
    await run({ model, tools: [longOutputTool], maxSteps: 3 });

    const content = String(model.seenMessages[1]!.find((m) => m.getType() === 'tool')?.content);
    expect(content).not.toContain('<external_content>');
    expect(content).toContain('[도구 결과가 제한 길이에서 잘렸습니다.]');
    // 256자 상한 + 안내 문구
    expect(content.length).toBeLessThan(1000);
  });

  it('같은 도구 에러가 2회 반복되면 추가 모델 호출 없이 조기 중단한다', async () => {
    const model = makeModel([
      [toolCallChunk('fake_tool', 'e1')],
      [toolCallChunk('fake_tool', 'e2')],
      [textChunk('여기까지 오면 조기 중단 실패')],
    ]);
    const res = await run({ model, tools: [failingTool], maxSteps: 6 });

    expect(res.finalText).toBe(
      i18n.t('errors.toolCallRepeatedFailure', { toolName: 'fake_tool' }),
    );
    // 2번째 실패 직후 중단 → 3번째 모델 호출은 없어야 한다
    expect(model.callCount).toBe(2);
  });

  it('콜백으로 도구 호출 시작/종료와 사용 도구 목록을 보고한다', async () => {
    const model = makeModel([
      [toolCallChunk('fake_tool', 'c1')],
      [textChunk('답변')],
    ]);
    const onToolCall = vi.fn();
    const onToolsUsed = vi.fn();
    const onModelRun = vi.fn();
    const onUsage = vi.fn();

    const res = await run({
      model,
      maxSteps: 3,
      cb: { onToolCall, onToolsUsed, onModelRun, onUsage },
    });

    expect(res.toolsUsed).toEqual(['fake_tool']);
    expect(onToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'start', toolName: 'fake_tool' }),
    );
    expect(onToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'end', toolName: 'fake_tool', status: 'success' }),
    );
    // onModelRun은 0-based 스텝 인덱스 (chatStore가 step > 0으로 분기한다)
    expect(onModelRun.mock.calls.map((c) => c[0])).toEqual([0, 1]);
  });

  it('onToken은 스텝마다 리셋된 누적 텍스트와 델타를 전달한다', async () => {
    const model = makeModel([
      [textChunk('가'), textChunk('나'), toolCallChunk('fake_tool', 'c1')],
      [textChunk('다'), textChunk('라')],
    ]);
    const seen: Array<[string, string]> = [];
    await run({
      model,
      maxSteps: 3,
      cb: { onToken: (full, delta) => void seen.push([full, delta]) },
    });

    expect(seen).toEqual([
      ['가', '가'],
      ['가나', '나'],
      ['다', '다'],
      ['다라', '라'],
    ]);
  });
});

// ── 세션 중 provider 전환 ───────────────────────────────────────────────

describe('runChatAgentStream 세션 중 provider 전환', () => {
  it('Anthropic 턴의 캐시 마커와 도구 흔적이 다음 OpenAI 턴으로 새지 않는다', async () => {
    // 턴 1: Anthropic — 도구를 1회 호출하고 답한다.
    const turn1Model = makeModel([
      [toolCallChunk('fake_tool', 'c1')],
      [textChunk('첫 답변')],
    ]);
    const turn1Messages: BaseMessage[] = [new HumanMessage('질문1')];
    await run({
      model: turn1Model,
      messages: turn1Messages,
      provider: 'anthropic',
      maxSteps: 3,
    });

    // 호출자가 넘긴 배열은 변형되지 않아야 다음 턴에 안전하게 재사용된다.
    expect(turn1Messages).toHaveLength(1);
    expect(turn1Messages[0]!.content).toBe('질문1');

    // 턴 2: OpenAI — chatStore는 이력을 평문 Human/AI로만 재구성한다
    // (tool_use / tool_result는 턴을 넘어 재생되지 않는다).
    const turn2Model = makeModel([[textChunk('둘째 답변')]]);
    const res = await run({
      model: turn2Model,
      messages: [
        new HumanMessage('질문1'),
        new AIMessage('첫 답변'),
        new HumanMessage('질문2'),
      ],
      provider: 'openai',
      maxSteps: 3,
    });

    expect(res.finalText).toBe('둘째 답변');

    const wire = turn2Model.seenMessages[0]!;
    // Anthropic 전용 cache_control이 OpenAI 요청에 섞이면 400이 난다.
    expect(cacheMarkerCount(wire)).toBe(0);
    for (const kwargs of turn2Model.seenKwargs) {
      expect(kwargs ?? {}).not.toHaveProperty('cache_control');
    }
    // provider마다 형식이 다른 도구 호출 흔적이 남아 있으면 안 된다.
    expect(wire.some((m) => m.getType() === 'tool')).toBe(false);
    expect(
      wire.some((m) => ((m as { tool_calls?: unknown[] }).tool_calls ?? []).length > 0),
    ).toBe(false);
  });
});

// ── provider 빌트인 도구 ────────────────────────────────────────────────

describe('runChatAgentStream provider 빌트인 도구', () => {
  it('실행 함수가 없는 서버 도구(web_search 등)도 모델에 그대로 바인딩된다', async () => {
    const model = makeModel([[textChunk('답변')]]);
    // OpenAI/Anthropic 빌트인 도구 스펙 — 로컬 실행 대상이 아니다.
    const openAiWebSearch = { type: 'web_search_preview' } as never;
    const anthropicWebSearch = {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 5,
    } as never;

    const res = await run({
      model,
      tools: [fakeTool, openAiWebSearch, anthropicWebSearch],
    });

    expect(res.finalText).toBe('답변');
    const bound = model.seenTools[0] ?? [];
    expect(bound).toHaveLength(3);
    expect(bound).toContainEqual({ type: 'web_search_preview' });
    expect(bound).toContainEqual({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 5,
    });
  });
});

// ── 재시도 ──────────────────────────────────────────────────────────────

describe('runChatAgentStream 재시도', () => {
  it('재시도 가능한 오류는 재시도하되 이전 시도의 부분 출력을 누적하지 않는다', async () => {
    // 1회차는 토큰을 흘린 뒤 429로 실패, 2회차에 성공한다.
    const model = new ScriptedChatModel({
      steps: [[textChunk('최종 답변')]],
      failAttempts: 1,
    });
    const onModelRun = vi.fn();
    const tokens: string[] = [];

    const res = await run({
      model,
      cb: { onModelRun, onToken: (full) => void tokens.push(full) },
    });

    expect(model.callCount).toBe(2);
    // 시도마다 누적을 리셋하지 않으면 '최종 답변최종 답변'이 된다.
    expect(res.finalText).toBe('최종 답변');
    expect(tokens.at(-1)).toBe('최종 답변');
    // 재시도는 같은 논리적 스텝이므로 onModelRun은 1회만
    expect(onModelRun).toHaveBeenCalledTimes(1);
  }, 20000);
});

// ── 취소 ────────────────────────────────────────────────────────────────

describe('runChatAgentStream 취소', () => {
  it('abortSignal이 취소되면 name이 AbortError인 에러로 전파한다', async () => {
    const model = makeModel([[textChunk('답변')]]);
    const controller = new AbortController();
    controller.abort();

    // chatStore의 isAbortError()가 name === 'AbortError'로 판별하므로,
    // LangGraph의 일반 Error를 그대로 흘리면 취소가 에러 말풍선이 된다.
    await expect(
      run({ model, abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
