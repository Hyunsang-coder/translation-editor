/**
 * AI 토큰 사용량 장부 기록.
 *
 * 모델 호출 1회(도구 루프는 루프 전체)당 1건을 append 한다. 기록은 번역·채팅의 부산물이므로
 * **실패해도 본 작업을 막지 않는다** — 모든 실패를 삼키고 경고만 남긴다.
 *
 * 비용 환산은 여기서 하지 않는다(단가는 `pricing.ts`). 장부에는 토큰만 남기고,
 * 가격이 바뀌어도 과거 기록을 그대로 재계산할 수 있게 한다.
 */
import { v4 as uuidv4 } from 'uuid';
import type { AIMessageChunk } from '@langchain/core/messages';
import { invoke, isTauriRuntime } from '@/tauri/invoke';
import { useProjectStore } from '@/stores/projectStore';

/** 사용량을 발생시킨 기능. UI의 기능별 분해에 그대로 쓰인다. */
export type AiUsageFeature =
  | 'chat'
  | 'translate'
  | 'review'
  | 'polish'
  | 'selection-retranslate'
  | 'summary';

/** 캐시 read/write 내역을 함께 담는 정규화된 사용량. */
export interface AiUsageTokens {
  /**
   * **캐시 read/write를 포함한 총 입력 토큰.**
   *
   * LangChain `usage_metadata.input_tokens`가 그렇게 정의되어 있고 양쪽 provider 모두
   * 그 규약을 따른다 — Anthropic은 `input_tokens + cache_creation + cache_read`를 합쳐 내보내고,
   * OpenAI는 `prompt_tokens` 자체가 `cached_tokens`를 포함한다. 여기서 빼지 않는 이유는
   * 장부를 provider 보고값 그대로 두기 위해서다. 정가 구간 분리는 `pricing.estimateCost`가 한다.
   */
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cacheReadInputTokens?: number | undefined;
  cacheCreationInputTokens?: number | undefined;
  /** 도구 루프에서 실제 모델을 호출한 횟수 (기본 1) */
  modelCalls?: number | undefined;
}

export interface RecordAiUsageInput extends AiUsageTokens {
  feature: AiUsageFeature;
  provider: string;
  /** 실제 호출된 API 모델 ID */
  model: string;
  /** 생략 시 현재 열린 프로젝트에서 채운다 */
  projectId?: string | null | undefined;
}

function hasAnyTokens(usage: AiUsageTokens): boolean {
  return (
    (usage.inputTokens ?? 0) > 0 ||
    (usage.outputTokens ?? 0) > 0 ||
    (usage.cacheReadInputTokens ?? 0) > 0 ||
    (usage.cacheCreationInputTokens ?? 0) > 0
  );
}

/**
 * 사용량 1건을 기록한다 (fire-and-forget).
 *
 * - Tauri 런타임이 아니면(웹 하네스/테스트) 아무것도 하지 않는다.
 * - 토큰이 전부 0이면 기록하지 않는다(provider 미보고와 구분할 실익이 없다).
 */
export function recordAiUsage(input: RecordAiUsageInput): void {
  if (!isTauriRuntime()) return;
  if (!hasAnyTokens(input)) return;

  const projectId =
    input.projectId !== undefined
      ? input.projectId
      : (useProjectStore.getState().project?.id ?? null);

  const record = {
    id: uuidv4(),
    projectId,
    occurredAt: Date.now(),
    feature: input.feature,
    provider: input.provider,
    model: input.model,
    inputTokens: Math.max(0, Math.round(input.inputTokens ?? 0)),
    outputTokens: Math.max(0, Math.round(input.outputTokens ?? 0)),
    cacheReadInputTokens: Math.max(0, Math.round(input.cacheReadInputTokens ?? 0)),
    cacheCreationInputTokens: Math.max(0, Math.round(input.cacheCreationInputTokens ?? 0)),
    modelCalls: Math.max(1, Math.round(input.modelCalls ?? 1)),
  };

  void invoke('log_ai_usage', { args: { record } }).catch((e) => {
    // 장부 기록 실패가 번역/채팅을 막아서는 안 된다.
    console.warn('[usage] 사용량 기록 실패:', e instanceof Error ? e.message : e);
  });
}

function maxField(a: number | undefined, b: number | undefined): number | undefined {
  return b === undefined ? a : a === undefined ? b : Math.max(a, b);
}

/**
 * 스트리밍 청크의 usage_metadata를 누적 버퍼에 병합한다.
 *
 * Anthropic 스트리밍은 message_start와 message_delta가 모두 "누적 스냅샷"을 보고하므로
 * 합산하면 캐시 필드가 2배로 계상된다. 필드별 최댓값이 그 호출의 실제값이다.
 */
export function mergeUsageFromChunk(acc: AiUsageTokens, chunk: AIMessageChunk): void {
  const u = (
    chunk as unknown as {
      usage_metadata?: {
        input_tokens?: number;
        output_tokens?: number;
        input_token_details?: { cache_read?: number; cache_creation?: number };
      };
    }
  ).usage_metadata;
  if (!u) return;

  acc.inputTokens = maxField(acc.inputTokens, u.input_tokens);
  acc.outputTokens = maxField(acc.outputTokens, u.output_tokens);
  acc.cacheReadInputTokens = maxField(
    acc.cacheReadInputTokens,
    u.input_token_details?.cache_read,
  );
  acc.cacheCreationInputTokens = maxField(
    acc.cacheCreationInputTokens,
    u.input_token_details?.cache_creation,
  );
}

/** `.invoke()` 응답 메시지에서 사용량을 뽑는다. 없으면 빈 객체. */
export function usageFromMessage(message: unknown): AiUsageTokens {
  const acc: AiUsageTokens = {};
  mergeUsageFromChunk(acc, message as AIMessageChunk);
  return acc;
}
