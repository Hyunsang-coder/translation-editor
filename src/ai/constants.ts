/**
 * AI 관련 상수 (토큰 제한, 컨텍스트 윈도우)
 */

// Provider별 컨텍스트 윈도우 크기
export const ANTHROPIC_CONTEXT_WINDOW = 200_000;
export const OPENAI_CONTEXT_WINDOW = 400_000;

// Provider/모델별 최대 출력 토큰
export const CLAUDE_MAX_OUTPUT_TOKENS = 64_000;
export const GPT5_MAX_OUTPUT_TOKENS = 65_536;
export const GPT4O_MAX_OUTPUT_TOKENS = 16_384;

// 용도별 기본 출력 토큰
export const DEFAULT_TRANSLATION_MAX_TOKENS = 8_192;
export const DEFAULT_CHAT_MAX_TOKENS = 4_096;

// 컨텍스트 안전 마진 (입력 + 출력이 컨텍스트를 넘지 않도록)
export const CONTEXT_SAFETY_MARGIN = 0.9;
