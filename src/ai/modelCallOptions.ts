/**
 * 모델별 호출 옵션(temperature / thinking / effort) 결정을 한 곳으로 모은다.
 *
 * LangChain 경로(client.ts)와 Tauri 백엔드 경로(backendCompletion.ts)가 같은 가드를
 * 중복 유지하다 어긋난 것이 F7(데스크톱 앱에서 thinking/effort 미전달)과
 * F8(Sonnet 5 temperature 400)의 공통 원인이었다. 두 경로 모두 이 함수를 사용한다.
 */

import type { AiConfig } from '@/ai/config';

export type { ModelUseFor } from '@/ai/config';

export interface ModelCallOptions {
  /** 모델이 non-default sampling을 거부하면 undefined */
  temperature?: number;
  /** Anthropic adaptive thinking (Opus 4.7+/Sonnet 5) */
  adaptiveThinking?: boolean;
  /** Anthropic output_config.effort / OpenAI reasoning_effort */
  effort?: 'medium' | 'high';
}

/** Opus 4.7 이상(4.7/4.8/4.9 및 2자리 이상 버전) 및 Opus 5+ */
function isOpus47Plus(model: string): boolean {
  return /^claude-opus-(4-(7|[89]|\d{2,})|[5-9]|\d{2,})/.test(model);
}

function isSonnet5(model: string): boolean {
  return /^claude-sonnet-5/.test(model);
}

/**
 * 이 모델이 effort(`output_config.effort` / `reasoning_effort`)를 받는가.
 *
 * Haiku 4.5처럼 받지 않는 모델에 보내면 400이 난다. UI가 effort 선택을 열지 말지도
 * 이 판정을 쓴다 — 판정이 두 벌이 되면 "고를 수는 있는데 안 먹는" 칸이 생긴다.
 */
export function modelSupportsEffort(model: string): boolean {
  return isOpus47Plus(model) || isSonnet5(model) || model.startsWith('gpt-5');
}

/**
 * cfg에 대한 모델 호출 옵션을 결정한다.
 *
 * 용도(useFor)별 차이는 `MODEL_BY_USE`가 이미 모델·`cfg.reasoningEffort`로 해석해 넘겨준다.
 * 여기서 판정하는 것은 **그 모델이 각 파라미터를 받아들이는가** 하나뿐이다.
 *
 * 규칙:
 * - temperature: Anthropic Opus 4.7+/Sonnet 5, OpenAI gpt-5* 는 non-default를
 *   400으로 거부하므로 전달하지 않는다. 그 외에는 cfg.temperature(있으면).
 * - adaptiveThinking(Anthropic): Opus 4.7+는 기본 꺼짐이라 항상 명시,
 *   Sonnet 5는 생략 시 기본 adaptive지만 명시성/일관성을 위해 함께 설정.
 * - effort: cfg.reasoningEffort를 그대로 전달하되, 지원 모델에만 붙인다.
 *   구형 Claude나 gpt-4o 등에 보내면 400이 나므로 여기서(모델 판정 지점) 가드한다.
 *   Rust 경로(commands/ai.rs)의 starts_with("gpt-5") 판정과 동일 기준. (A3)
 */
export function resolveModelCallOptions(cfg: AiConfig): ModelCallOptions {
  const opts: ModelCallOptions = {};

  if (cfg.provider === 'anthropic') {
    const opus47Plus = isOpus47Plus(cfg.model);
    const sonnet5 = isSonnet5(cfg.model);
    const rejectsSamplingParams = opus47Plus || sonnet5;

    if (!rejectsSamplingParams && cfg.temperature !== undefined) {
      opts.temperature = cfg.temperature;
    }

    if (opus47Plus || sonnet5) {
      opts.adaptiveThinking = true;
      if (cfg.reasoningEffort) opts.effort = cfg.reasoningEffort;
    }

    return opts;
  }

  // OpenAI (또는 mock → OpenAI fallback)
  const isGpt5 = cfg.model.startsWith('gpt-5');
  if (!isGpt5 && cfg.temperature !== undefined) {
    opts.temperature = cfg.temperature;
  }
  // effort는 reasoning_effort를 지원하는 gpt-5 계열에만 포함한다.
  // 호출 경로(client.ts / backendCompletion.ts)는 이 결과를 신뢰해 그대로 전달한다. (A3)
  if (isGpt5 && cfg.reasoningEffort) {
    opts.effort = cfg.reasoningEffort;
  }

  return opts;
}
