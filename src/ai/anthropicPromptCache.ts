/**
 * Anthropic prompt caching (도구 루프용)
 *
 * 도구 루프는 매 스텝 전체 대화를 재전송하므로, cache_control breakpoint가 없으면
 * 반복 프리픽스(시스템+가이드+규칙+대화 이력)가 스텝마다 정가로 재과금된다.
 * (OpenAI는 서버 자동 캐싱, Anthropic은 명시적 cache_control 필수)
 *
 * breakpoint 배치 (요청당 최대 4개 제한 대비 이 모듈이 2개 + 호출 옵션 1개):
 * 1. 시스템 메시지 — tools 정의는 system보다 앞에 렌더되므로 이 마커가 tools+system을 함께 캐시.
 * 2. 마지막 HumanMessage(현재 사용자 질문) — 대화 이력 전체가 프리픽스로 캐시.
 *    다음 사용자 턴은 도구 흔적 없이 이력을 재구성하므로, 이 마커의 캐시 엔트리가
 *    턴 간 프리픽스 재사용의 매칭 지점이 된다.
 * 3. (이 모듈 밖) 도구 루프가 스트림 호출 옵션 cache_control로 페이로드의 마지막 블록에
 *    marker를 추가한다 — 스텝 2+에서는 마지막 tool_result. ToolMessage는 어댑터가
 *    tool_result 블록을 자체 생성하며 메시지 레벨 cache_control을 통과시키지 않으므로,
 *    스텝별로 자라는 도구 결과 꼬리는 호출 옵션으로만 캐시할 수 있다.
 *
 * 최소 캐시 길이(Opus 4.8/Sonnet 5: 1024, Haiku 4.5: 4096 토큰) 미달 프리픽스는
 * API가 조용히 무시하므로 짧은 대화에서도 무해하다.
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

const EPHEMERAL_CACHE = { type: 'ephemeral' } as const;

type ContentBlock = Record<string, unknown>;

function stripCacheControlBlocks(content: ContentBlock[]): ContentBlock[] {
  return content.map((block) => {
    if (block && typeof block === 'object' && 'cache_control' in block) {
      const { cache_control: _removed, ...rest } = block;
      return rest;
    }
    return block;
  });
}

/**
 * content의 마지막 마킹 가능 블록(text/image_url)에 cache_control을 추가한 사본을 반환.
 * 마킹할 블록이 없으면 null.
 */
function withMarkedLastBlock(
  content: string | ContentBlock[],
): ContentBlock[] | null {
  if (typeof content === 'string') {
    if (!content.trim()) return null;
    return [{ type: 'text', text: content, cache_control: EPHEMERAL_CACHE }];
  }
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    const type = block ? (block as { type?: unknown }).type : undefined;
    if (type === 'text' || type === 'image_url') {
      const next = [...content];
      next[i] = { ...block, cache_control: EPHEMERAL_CACHE };
      return next;
    }
  }
  return null;
}

/**
 * Anthropic 요청 직전에 cache_control breakpoint를 적용한 메시지 사본을 만든다.
 * - 비파괴: 입력 배열/메시지는 변경하지 않는다 (루프의 loopMessages는 plain 유지).
 * - 멱등: 기존 마커를 먼저 제거하므로 스텝마다 재적용해도 breakpoint는 항상 ≤ 2개.
 */
export function withAnthropicPromptCache(messages: BaseMessage[]): BaseMessage[] {
  const lastHumanIdx = messages.reduce(
    (found, m, i) => (m instanceof HumanMessage ? i : found),
    -1,
  );

  return messages.map((message, i) => {
    const isSystemHead = i === 0 && message instanceof SystemMessage;
    const isLastHuman = i === lastHumanIdx;
    if (!isSystemHead && !isLastHuman) return message;

    const content =
      typeof message.content === 'string'
        ? message.content
        : stripCacheControlBlocks(message.content as ContentBlock[]);
    const marked = withMarkedLastBlock(content);
    if (!marked) return message;

    return isSystemHead
      ? new SystemMessage({ content: marked as SystemMessage['content'] })
      : new HumanMessage({ content: marked as HumanMessage['content'] });
  });
}
