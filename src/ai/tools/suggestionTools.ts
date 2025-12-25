import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 번역 규칙 제안 도구
 * AI가 대화 중 새로운 번역 규칙(포맷, 서식, 문체 등)을 발견했을 때 호출합니다.
 */
export const suggestTranslationRule = tool(
  async (_args) => {
    // 실제 저장은 하지 않고, UI에 "저장 제안"을 표시하기 위한 시그널 역할만 함
    // Tool 결과는 모델 컨텍스트에 다시 들어가므로, 토큰 절약을 위해 최소한으로 반환합니다.
    return { ok: true };
  },
  {
    name: 'suggest_translation_rule',
    description:
      'Create a "save suggestion" for Translation Rules. IMPORTANT: This does not save anything automatically; the user must click a button to apply.',
    schema: z.object({
      rule: z
        .string()
        .min(1)
        .max(2000)
        .describe('The translation rule content to suggest (a short, actionable rule)'),
    }),
  }
);

/**
 * Project Context 제안 도구
 * AI가 대화 중 Project Context에 추가할 중요한 맥락 정보(배경 지식, 프로젝트 컨텍스트 등)를 발견했을 때 호출합니다.
 */
export const suggestProjectContext = tool(
  async (_args) => {
    // 실제 저장은 하지 않고, UI에 "저장 제안"을 표시하기 위한 시그널 역할만 함
    return { ok: true };
  },
  {
    name: 'suggest_project_context',
    description:
      'Create a "save suggestion" for Project Context. IMPORTANT: This does not save anything automatically; the user must click a button to apply.',
    schema: z.object({
      context: z
        .string()
        .min(1)
        .max(4000)
        .describe('The project context content to suggest (facts/constraints, not style rules)'),
    }),
  }
);

