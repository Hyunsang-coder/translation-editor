/**
 * 장기 대화 토큰 예산 유틸 (Phase 3)
 *
 * provider별 실제 토크나이저를 번들에 싣지 않고, 저비용 heuristic으로 입력 토큰을
 * "사전 추정"한다. 실제 소비량은 provider usage_metadata로 별도 기록하므로(§12.5)
 * 이 추정은 요약 트리거/트리밍 판단용 근사치로만 쓰인다. 예산 안전을 위해 약간
 * 과대 추정하는 편이다.
 */
import type { BaseMessage } from '@langchain/core/messages';

// ── 튜닝 상수 (중앙화) ───────────────────────────────────────────────────

/** usable 예산의 이 비율을 넘으면 사전 요약을 트리거한다 (§7.2: 70~80%). */
export const SUMMARY_TRIGGER_RATIO = 0.75;
/** 요약 후에도 원문으로 유지할 최소 최근 턴 수 (user+assistant 쌍 기준). */
export const MIN_RECENT_TURNS = 8;
/** 원문으로 유지할 최대 최근 턴 수. */
export const MAX_RECENT_TURNS = 12;
/** 이미지 1장당 근사 토큰 비용 (vision 입력). */
export const IMAGE_TOKEN_COST = 800;
/** 추론/도구 왕복을 위한 안전 예약 토큰. */
export const TOOL_SAFETY_RESERVE_TOKENS = 4_000;
/** 메시지 1개당 role/구분자 오버헤드 근사치. */
const PER_MESSAGE_OVERHEAD_TOKENS = 4;

// ── CJK 감지 ─────────────────────────────────────────────────────────────

// 한글(자모·완성형), CJK 통합 한자, 가나, CJK 기호, 전각 등: 문자당 토큰 비중이 높다.
const CJK_REGEX =
  /[ᄀ-ᇿ　-〿぀-ヿ㄰-㆏㐀-䶿一-鿿ꥠ-꥿가-힯豈-﫿＀-￯]/g;

/**
 * 대략적 토큰 추정 (heuristic).
 * - CJK 문자: 문자당 약 1토큰
 * - 그 외 문자: 약 4문자당 1토큰
 */
export function approxTokens(text: string): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;

  const cjkMatches = trimmed.match(CJK_REGEX);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkCount = trimmed.length - cjkCount;

  const tokens = cjkCount + Math.ceil(nonCjkCount / 4);
  return Math.max(1, tokens);
}

// ── 메시지 토큰 추정 ─────────────────────────────────────────────────────

interface ImageBlock {
  type: 'image_url';
  image_url?: { url?: string };
}
interface TextBlock {
  type: 'text';
  text?: string;
}
type ContentBlock = TextBlock | ImageBlock | Record<string, unknown>;

function isImageBlock(block: unknown): boolean {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'image_url'
  );
}

/** 메시지 1개의 입력 토큰 근사치 (텍스트 + 이미지 비용 + 오버헤드). */
export function estimateMessageTokens(message: BaseMessage): number {
  const content = message.content as string | ContentBlock[];
  let tokens = PER_MESSAGE_OVERHEAD_TOKENS;

  if (typeof content === 'string') {
    tokens += approxTokens(content);
    return tokens;
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      if (isImageBlock(block)) {
        tokens += IMAGE_TOKEN_COST;
      } else if (block && typeof block === 'object') {
        const text = (block as TextBlock).text;
        if (typeof text === 'string') tokens += approxTokens(text);
      }
    }
  }

  return tokens;
}

/** 메시지 배열 전체의 입력 토큰 근사치. */
export function estimateMessagesTokens(messages: BaseMessage[]): number {
  let total = 0;
  for (const m of messages) total += estimateMessageTokens(m);
  return total;
}

// ── 입력 예산 ────────────────────────────────────────────────────────────

export interface InputBudget {
  /** 대상 모델의 최대 입력 토큰(컨텍스트 윈도우 근사). */
  maxInputTokens: number;
  /** 요약/최근 원문을 담을 수 있는 실제 가용 입력 토큰. */
  usableInputTokens: number;
  /** 이 값을 초과하면 사전 요약을 트리거한다. */
  summaryTriggerTokens: number;
}

/**
 * usableInputBudget = maxInputTokens - outputTokenBudget - reasoning/tool safety reserve (§7.1)
 */
export function computeInputBudget(opts: {
  maxInputTokens: number;
  outputTokenBudget: number;
}): InputBudget {
  const usable = Math.max(
    0,
    opts.maxInputTokens - opts.outputTokenBudget - TOOL_SAFETY_RESERVE_TOKENS,
  );
  return {
    maxInputTokens: opts.maxInputTokens,
    usableInputTokens: usable,
    summaryTriggerTokens: Math.floor(usable * SUMMARY_TRIGGER_RATIO),
  };
}
