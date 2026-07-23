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
}): ConversationContextPlan {
  const { messages, memory, budget } = input;
  const reserved = input.reservedContextTokens ?? 0;

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

  // 2) 최근 원문 윈도우 선정: 턴 수 상한(8~12턴) + 토큰 예산을 모두 만족하는 suffix.
  const maxRecentMessages = MAX_RECENT_TURNS * 2;
  const minRecentMessages = Math.min(unsummarized.length, MIN_RECENT_TURNS * 2);

  // 요약(existing summary)과 고정 컨텍스트를 뺀 최근 원문용 예산.
  const summaryTokens = memory?.summary ? approxTokens(memory.summary) : 0;
  const recentBudget = Math.max(
    0,
    budget.summaryTriggerTokens - reserved - summaryTokens,
  );

  // 턴 수 상한 우선 적용
  let start = Math.max(0, unsummarized.length - maxRecentMessages);
  // 토큰 예산 초과 시 앞에서부터 줄이되, 최소 보존 턴 아래로는 내리지 않는다.
  while (start < unsummarized.length) {
    const windowTokens = sumTokens(unsummarized.slice(start));
    if (windowTokens <= recentBudget) break;
    if (unsummarized.length - start <= minRecentMessages) break;
    start++;
  }

  let recentRawMessages = unsummarized.slice(start);
  const messagesToSummarize = unsummarized.slice(0, start);

  // 3) 원문 윈도우는 user부터 시작해야 한다. 앞의 assistant/system은 요약 구간으로 넘긴다.
  while (recentRawMessages.length > 0 && recentRawMessages[0]!.role !== 'user') {
    messagesToSummarize.push(recentRawMessages[0]!);
    recentRawMessages = recentRawMessages.slice(1);
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
