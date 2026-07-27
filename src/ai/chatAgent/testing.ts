/**
 * 에이전트 테스트용 스크립트 모델.
 *
 * 스텝별 응답 청크를 미리 정의하고, 각 호출이 실제로 받은 메시지와 bind 옵션을
 * 기록한다. Anthropic prompt cache breakpoint 검증에 두 기록이 모두 필요하다.
 */
import { AIMessageChunk } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type {
  BaseChatModelParams,
  BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';

export type ScriptedStep = AIMessageChunk[];

export class ScriptedChatModel extends BaseChatModel {
  readonly steps: ScriptedStep[];
  /** 앞의 N회 호출은 청크를 모두 흘린 뒤 재시도 가능한 에러로 실패한다 */
  readonly failAttempts: number;
  /** 각 모델 호출이 받은 메시지 목록 (호출 시점 스냅샷) */
  readonly seenMessages: BaseMessage[][] = [];
  /** 각 bindTools 호출이 받은 kwargs (= ModelRequest.modelSettings) */
  readonly seenKwargs: Array<Record<string, unknown> | undefined> = [];
  /** 각 bindTools 호출이 받은 도구 목록 */
  readonly seenTools: BindToolsInput[][] = [];
  /** 모델 호출(시도) 횟수 */
  callCount = 0;
  /** 성공한 스텝 수 — 실패한 시도는 스크립트를 진행시키지 않는다 */
  #stepIndex = 0;

  constructor(
    fields: BaseChatModelParams & { steps: ScriptedStep[]; failAttempts?: number },
  ) {
    super(fields);
    this.steps = fields.steps;
    this.failAttempts = fields.failAttempts ?? 0;
  }

  _llmType(): string {
    return 'scripted';
  }

  _combineLLMOutput(): never[] {
    return [];
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Record<string, unknown>,
  ): this {
    this.seenTools.push(tools);
    this.seenKwargs.push(kwargs);
    return this;
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    this.seenMessages.push([...messages]);
    const attempt = this.callCount;
    this.callCount += 1;
    const idx = Math.min(this.#stepIndex, this.steps.length - 1);

    for (const chunk of this.steps[idx] ?? []) {
      const text = typeof chunk.content === 'string' ? chunk.content : '';
      const gen = new ChatGenerationChunk({ message: chunk, text });
      // 실제 provider와 동일하게 chunk를 함께 전달해야 streamMode 'messages'로
      // usage_metadata / tool_call_chunks가 전파된다.
      await runManager?.handleLLMNewToken(
        text,
        undefined,
        undefined,
        undefined,
        undefined,
        { chunk: gen },
      );
      yield gen;
    }

    if (attempt < this.failAttempts) {
      // 재시도 대상으로 분류되는 오류 (retry.ts의 isRetryableError 기준)
      throw new Error('429 rate limit exceeded');
    }
    this.#stepIndex += 1;
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    let final: AIMessageChunk | null = null;
    for await (const gen of this._streamResponseChunks(messages, options, runManager)) {
      const msg = gen.message as AIMessageChunk;
      final = final === null ? msg : final.concat(msg);
    }
    return { generations: [{ text: '', message: final ?? new AIMessageChunk({ content: '' }) }] };
  }
}

export function textChunk(text: string): AIMessageChunk {
  return new AIMessageChunk({ content: text });
}

export function toolCallChunk(
  name: string,
  id: string,
  args = '{}',
): AIMessageChunk {
  return new AIMessageChunk({
    content: '',
    tool_call_chunks: [{ name, args, id, index: 0, type: 'tool_call_chunk' }],
  });
}

/** Anthropic의 message_start / message_delta가 보고하는 누적 스냅샷 usage */
export function usageChunk(u: {
  input: number;
  output: number;
  cacheRead?: number;
  cacheCreation?: number;
}): AIMessageChunk {
  const chunk = new AIMessageChunk({ content: '' });
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
