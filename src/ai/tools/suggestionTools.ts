import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 번역 규칙 제안 도구
 * AI가 대화 중 새로운 번역 규칙(용어, 스타일 등)을 발견했을 때 호출합니다.
 */
export const suggestTranslationRule = tool(
  async ({ rule }) => {
    // 실제 저장은 하지 않고, UI에 제안을 표시하기 위한 시그널 역할만 함
    return `번역 규칙 제안이 감지되었습니다: "${rule}"\n(사용자가 버튼을 눌러 승인하면 저장됩니다)`;
  },
  {
    name: 'suggest_translation_rule',
    description: 'Use this tool when you find a new translation rule or style guideline that should be persisted (e.g., "always translate X as Y", "use formal tone").',
    schema: z.object({
      rule: z.string().describe('The translation rule content to suggest'),
    }),
  }
);

/**
 * Active Memory 제안 도구
 * AI가 대화 중 기억해야 할 중요한 맥락이나 임시 규칙을 발견했을 때 호출합니다.
 */
export const suggestActiveMemory = tool(
  async ({ memory }) => {
    // 실제 저장은 하지 않고, UI에 제안을 표시하기 위한 시그널 역할만 함
    return `Active Memory 제안이 감지되었습니다: "${memory}"\n(사용자가 버튼을 눌러 승인하면 저장됩니다)`;
  },
  {
    name: 'suggest_active_memory',
    description: 'Use this tool when you find important context or temporary rules that should be remembered for this session.',
    schema: z.object({
      memory: z.string().describe('The memory content to suggest'),
    }),
  }
);

