/**
 * 장기 대화 working context 플래너 (Phase 3)
 *
 * 전체 transcript(messages)를 파괴하지 않고, "누적 요약 + 최근 원문 대화"로 나누는
 * 순수 함수다. 실제 요약 LLM 호출과 영속화는 store가 담당하며(소유권/abort/persist),
 * 이 모듈은 무엇을 요약하고 무엇을 원문으로 남길지 "계획"만 세운다.
 */
import type { ChatMessage, ChatSessionMemory } from '@/types';
import {
  approxTokens,
  IMAGE_TOKEN_COST,
  MAX_SUMMARY_INPUT_TOKENS,
  MIN_RECENT_TURNS,
  MAX_RECENT_TURNS,
  type InputBudget,
} from './tokenBudget';

const PER_MESSAGE_OVERHEAD_TOKENS = 4;

/** ChatMessage 1개의 입력 토큰 근사치 (본문 + 이미지 첨부 비용). */
function chatMessageTokens(m: ChatMessage): number {
  const imageCount = m.metadata?.imageAttachments?.length ?? 0;
  return PER_MESSAGE_OVERHEAD_TOKENS + approxTokens(m.content) + imageCount * IMAGE_TOKEN_COST;
}

function sumTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) total += chatMessageTokens(m);
  return total;
}

/**
 * 채팅 transcript 구간의 입력 토큰 근사치 (planner와 동일 기준).
 * selection 스코프 등 planner를 타지 않는 경로의 예산 trim용으로 export한다.
 * tokenBudget.ts의 estimateMessagesTokens(BaseMessage 기준)와 혼동하지 말 것.
 */
export function estimateChatMessagesTokens(messages: ChatMessage[]): number {
  return sumTokens(messages);
}

export interface ConversationContextPlan {
  /** 요약이 필요한지 여부 (오래된 원문 구간을 요약으로 접어야 하는지). */
  needsSummary: boolean;
  /** 이번 증분 요약 대상 (기존 요약 이후 ~ 최근 원문 윈도우 이전). */
  messagesToSummarize: ChatMessage[];
  /** 모델에 원문으로 전달할 최근 대화 (항상 user부터 시작). */
  recentRawMessages: ChatMessage[];
  /**
   * 이번 계획 반영 후 memory.summarizedThroughMessageId로 저장할 값.
   * needsSummary=false면 기존 값을 그대로 유지한다.
   */
  summarizedThroughMessageId: string | null;
  /** 관측용: 최근 원문 윈도우의 추정 토큰. */
  estimatedRecentTokens: number;
}

/**
 * 대화 컨텍스트 계획을 세운다.
 *
 * @param input.messages 현재 전송 메시지를 제외한 전체 prior transcript
 * @param input.memory 기존 누적 요약 상태(있으면 증분)
 * @param input.budget 대상 모델 입력 예산
 * @param input.reservedContextTokens 시스템/규칙/글로서리/현재 입력 등 고정 컨텍스트 추정 토큰
 */
export function planConversationContext(input: {
  messages: ChatMessage[];
  memory?: ChatSessionMemory | undefined;
  budget: InputBudget;
  reservedContextTokens?: number;
  /**
   * 1회 증분 요약에 넣을 오래된 대화 구간의 입력 상한(근사 토큰). 오래된 구간이 상한을 넘으면
   * 오래된 쪽부터 상한 안에 드는 만큼만 이번 요약 대상으로 자르고,
   * 나머지는 다음 턴 증분 요약으로 넘긴다(throughId는 자른 끝까지만 전진).
   */
  maxSummaryTokens?: number;
  /**
   * 최근 원문 윈도우의 메시지 수 상한. 기본값은 MAX_RECENT_TURNS * 2.
   * 컨텍스트 오버플로우 긴급 압축 시에만 더 작은 값(최소 보존 턴)을 넘긴다.
   */
  maxRecentMessages?: number;
}): ConversationContextPlan {
  const { messages, memory, budget } = input;
  const reserved = input.reservedContextTokens ?? 0;
  const maxSummaryTokens = input.maxSummaryTokens ?? MAX_SUMMARY_INPUT_TOKENS;
  const maxRecentMessages = input.maxRecentMessages ?? MAX_RECENT_TURNS * 2;

  // 1) 이미 요약된 prefix 제외 → 아직 요약되지 않은 구간만 대상으로 한다(증분).
  const throughId = memory?.summarizedThroughMessageId ?? null;
  let unsummarizedStart = 0;
  if (throughId) {
    const idx = messages.findIndex((m) => m.id === throughId);
    if (idx >= 0) unsummarizedStart = idx + 1;
    // idx<0(경계 메시지가 삭제/트렁케이트됨): 보수적으로 전체를 대상으로 두되,
    // store가 기존 요약을 앞에 붙여 증분 요약하므로 정보 손실은 없다.
  }
  const unsummarized = messages.slice(unsummarizedStart);

  // 짧은 대화: 전부 원문 유지, 요약 없음.
  if (unsummarized.length === 0) {
    return {
      needsSummary: false,
      messagesToSummarize: [],
      recentRawMessages: [],
      summarizedThroughMessageId: throughId,
      estimatedRecentTokens: 0,
    };
  }

  // 2) 최근 원문 윈도우 선정: 토큰 예산 우선, 턴 수 상한은 보조 상한으로만 둔다.
  //    전체 미요약 구간이 예산 안에 들면 개수와 무관하게 전부 원문 유지(요약 없음).
  //    이전에는 개수 캡(24개)을 먼저 박아 토큰 0.1%인 대화도 매 턴 요약 호출하던 문제 수정.
  const minRecentMessages = Math.min(unsummarized.length, MIN_RECENT_TURNS * 2);

  // 요약(existing summary)과 고정 컨텍스트를 뺀 최근 원문용 예산.
  const summaryTokens = memory?.summary ? approxTokens(memory.summary) : 0;
  const recentBudget = Math.max(
    0,
    budget.summaryTriggerTokens - reserved - summaryTokens,
  );

  // 예산 안에 전부 들면 요약 없이 전부 원문으로 전달한다.
  if (sumTokens(unsummarized) <= recentBudget) {
    return {
      needsSummary: false,
      messagesToSummarize: [],
      recentRawMessages: unsummarized,
      summarizedThroughMessageId: throughId,
      estimatedRecentTokens: sumTokens(unsummarized),
    };
  }

  // 예산 초과 시에만: 개수 상한으로 먼저 자르고, 그래도 초과면 최소 보존 턴까지 앞에서 줄인다.
  let start = Math.max(0, unsummarized.length - maxRecentMessages);
  // 토큰 예산 초과 시 앞에서부터 줄이되, 최소 보존 턴 아래로는 내리지 않는다.
  while (start < unsummarized.length) {
    const windowTokens = sumTokens(unsummarized.slice(start));
    if (windowTokens <= recentBudget) break;
    if (unsummarized.length - start <= minRecentMessages) break;
    start++;
  }

  let recentRawMessages = unsummarized.slice(start);
  let messagesToSummarize = unsummarized.slice(0, start);

  // 3) 원문 윈도우는 user부터 시작해야 한다. 앞의 assistant/system은 요약 구간으로 넘긴다.
  while (recentRawMessages.length > 0 && recentRawMessages[0]!.role !== 'user') {
    messagesToSummarize.push(recentRawMessages[0]!);
    recentRawMessages = recentRawMessages.slice(1);
  }

  // 4) 요약 입력 상한: 오래된 쪽부터 상한 안에 드는 청크만 이번 대상으로 한다.
  //    잘린 꼬리는 memory에 미반영(throughId 미전진)되어 다음 턴에 다시 잡힌다.
  //    단, 잘린 꼬리를 이번 턴 컨텍스트에서 통째로 빼면(요약에도 원문에도 없음)
  //    모델이 중간 구간을 모른 채 답하므로, 꼬리는 최근 원문 앞에 붙여 이번 턴 무손실로 둔다.
  //    예산을 넘으면 모델 호출 직전 하드 가드(trimMessages)가 오래된 쪽부터 자르며,
  //    잘린 부분은 미요약 상태로 남아 다음 턴에 다시 잡히므로 영구 손실은 없다.
  if (messagesToSummarize.length > 0) {
    let acc = 0;
    let end = 0;
    for (; end < messagesToSummarize.length; end++) {
      const t = chatMessageTokens(messagesToSummarize[end]!);
      if (acc + t > maxSummaryTokens && end > 0) break;
      acc += t;
    }
    const head = messagesToSummarize.slice(0, Math.max(1, end));
    const tail = messagesToSummarize.slice(head.length);
    // 꼬리 앞쪽의 비-user 메시지(assistant/system)는 원문 윈도우 선두에 둘 수 없어
    // 이번 턴에서만 제외한다. throughId가 head까지만 전진하므로 다음 턴 요약 대상에 남는다.
    let drop = 0;
    while (drop < tail.length && tail[drop]!.role !== 'user') drop++;
    messagesToSummarize = head;
    recentRawMessages = [...tail.slice(drop), ...recentRawMessages];
  }

  const needsSummary = messagesToSummarize.length > 0;
  const summarizedThroughMessageId = needsSummary
    ? messagesToSummarize[messagesToSummarize.length - 1]!.id
    : throughId;

  return {
    needsSummary,
    messagesToSummarize,
    recentRawMessages,
    summarizedThroughMessageId,
    estimatedRecentTokens: sumTokens(recentRawMessages),
  };
}
