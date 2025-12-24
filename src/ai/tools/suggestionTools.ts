import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 번역 규칙 제안 도구
 * AI가 대화 중 새로운 번역 규칙(포맷, 서식, 문체 등)을 발견했을 때 호출합니다.
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
 * Project Context 제안 도구
 * AI가 대화 중 Project Context에 추가할 중요한 맥락 정보(배경 지식, 프로젝트 컨텍스트 등)를 발견했을 때 호출합니다.
 */
export const suggestProjectContext = tool(
  async ({ context, memory }) => {
    // 실제 저장은 하지 않고, UI에 제안을 표시하기 위한 시그널 역할만 함
    const value = (typeof context === 'string' && context.trim().length > 0 ? context : undefined) ??
      (typeof memory === 'string' && memory.trim().length > 0 ? memory : '');
    return `Project Context 제안이 감지되었습니다: "${value}"\n(사용자가 버튼을 눌러 승인하면 저장됩니다)`;
  },
  {
    name: 'suggest_project_context',
    description: 'Use this tool when you find important project context (background info, project constraints, etc.) that should be persisted for translation.',
    schema: z.object({
      context: z.string().optional().describe('The project context content to suggest (preferred)'),
      memory: z.string().optional().describe('(legacy) Same as context'),
    }),
  }
);

