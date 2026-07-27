/**
 * 모델 capability 프로필 (Phase 3)
 *
 * LangChain `model.profile`은 아직 beta라 값이 누락/부정확할 수 있으므로, 앱이 사용하는
 * 프리셋 기준의 보수적 fallback registry를 진실 공급원으로 둔다(§6.1). profile을 참조하게
 * 되더라도 fallback과 충돌하면 더 보수적인 값을 선택한다.
 */
import type { AiProvider } from '@/ai/config';
import {
  ANTHROPIC_CONTEXT_WINDOW,
  OPENAI_CONTEXT_WINDOW,
  CONTEXT_SAFETY_MARGIN,
} from '@/ai/constants';

export interface ModelCapabilities {
  /** 입력에 쓸 수 있는 최대 토큰(컨텍스트 윈도우에 안전 마진 적용). */
  maxInputTokens: number;
  /** vision(이미지) 입력 지원 여부. */
  imageInputs: boolean;
  /** function/tool calling 지원 여부. */
  toolCalling: boolean;
  /** reasoning(생각) 출력 지원 여부. */
  reasoningOutput: boolean;
  /** provider 내장 웹 검색 지원 여부. */
  builtInWebSearch: boolean;
}

/** provider별 보수적 기본 capability. */
function providerDefaults(provider: AiProvider): ModelCapabilities {
  if (provider === 'anthropic') {
    return {
      maxInputTokens: Math.floor(ANTHROPIC_CONTEXT_WINDOW * CONTEXT_SAFETY_MARGIN),
      imageInputs: true,
      toolCalling: true,
      reasoningOutput: true,
      builtInWebSearch: true,
    };
  }
  if (provider === 'openai') {
    return {
      maxInputTokens: Math.floor(OPENAI_CONTEXT_WINDOW * CONTEXT_SAFETY_MARGIN),
      imageInputs: true,
      toolCalling: true,
      reasoningOutput: true,
      builtInWebSearch: true,
    };
  }
  // mock / 미지원: 안전한 소형 컨텍스트 (실경로에서는 도달하지 않음)
  return {
    maxInputTokens: 32_000,
    imageInputs: false,
    toolCalling: true,
    reasoningOutput: false,
    builtInWebSearch: false,
  };
}

/**
 * 모델별 보수적 override registry.
 * 실제 API 모델 ID(resolvedModel)의 prefix로 매칭한다. provider 기본값과 병합되며,
 * 특정 모델이 provider 일반값과 다른 capability를 가질 때만 항목을 추가한다.
 */
const MODEL_OVERRIDES: { prefix: string; caps: Partial<ModelCapabilities> }[] = [
  // 현재 프리셋(Opus 5 / Sonnet 5 / Haiku 4.5 / gpt-5.6-*)은 모두 provider 기본값과 동일하다.
  // 향후 컨텍스트/비전 특성이 다른 모델이 추가되면 여기에 보수적 값을 등록한다.
];

/**
 * 실행 모델의 capability를 해석한다. resolvedModel(API 모델 ID) + provider 기준.
 */
export function resolveModelCapabilities(input: {
  resolvedModel: string;
  provider: AiProvider;
}): ModelCapabilities {
  const base = providerDefaults(input.provider);
  const override = MODEL_OVERRIDES.find((o) => input.resolvedModel.startsWith(o.prefix));
  if (!override) return base;
  return { ...base, ...override.caps };
}
