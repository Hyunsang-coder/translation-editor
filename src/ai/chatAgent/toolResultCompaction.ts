/**
 * 도구 결과 축약 (context editing 전략)
 *
 * 최근 N개 도구 결과는 원문을 유지하고, 그보다 오래되고 큰 결과만 digest로 바꾼다.
 * 메시지를 제거하지 않고 content만 교체하므로 AI tool_call ↔ ToolMessage 쌍은 보존된다.
 *
 * 빌트인 ClearToolUsesEdit는 "전체 토큰이 임계(기본 100k)를 넘을 때"만 동작하는 반면
 * 이 전략은 기존 구현대로 "오래되고 4k자를 넘는 결과"를 항상 축약한다. 도구 결과가
 * 프롬프트 프리픽스를 계속 밀어내는 것을 막는 것이 목적이므로 임계 도달 전에 줄인다.
 */
import { ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { ContextEdit, TokenCounter } from 'langchain';

const TOOL_RESULT_KEEP_RECENT = 3;
const TOOL_RESULT_MAX_CHARS = 4_000;

function digestToolContent(name: string | undefined, content: string): string {
  const head = content.slice(0, 200).replace(/\s+/g, ' ').trim();
  return `[cleared: ${name ?? 'tool'} | ${content.length} chars | "${head}…"]`;
}

export interface ToolResultCompactionConfig {
  /** 원문을 유지할 최근 도구 결과 개수 */
  keepRecent?: number;
  /** 이 길이 이하의 결과는 축약하지 않는다 */
  maxChars?: number;
}

export class ToolResultCompactionEdit implements ContextEdit {
  readonly #keepRecent: number;
  readonly #maxChars: number;

  constructor(config?: ToolResultCompactionConfig) {
    this.#keepRecent = Math.max(0, config?.keepRecent ?? TOOL_RESULT_KEEP_RECENT);
    this.#maxChars = config?.maxChars ?? TOOL_RESULT_MAX_CHARS;
  }

  apply(params: { messages: BaseMessage[]; countTokens: TokenCounter }): void {
    const { messages } = params;

    const toolIdx: number[] = [];
    messages.forEach((m, i) => {
      if (m instanceof ToolMessage) toolIdx.push(i);
    });

    const compressUntil = toolIdx.length - this.#keepRecent;
    for (let k = 0; k < compressUntil; k++) {
      const idx = toolIdx[k]!;
      const msg = messages[idx] as ToolMessage;
      const content =
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (content.length <= this.#maxChars) continue;
      if (content.startsWith('[cleared:')) continue;

      messages[idx] = new ToolMessage({
        tool_call_id: msg.tool_call_id,
        ...(msg.name ? { name: msg.name } : {}),
        ...(msg.status ? { status: msg.status } : {}),
        content: digestToolContent(msg.name, content),
      });
    }
  }
}
