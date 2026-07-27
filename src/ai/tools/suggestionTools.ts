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
      '번역 스타일/포맷/문체 규칙을 제안합니다 (예: 해요체, 따옴표 유지, 고유명사 음차). ' +
      '배경 지식/맥락은 propose_project_memory_change를 사용하세요. ' +
      '사용자가 [Add to Rules] 버튼을 눌러야 저장됩니다.',
    schema: z.object({
      rule: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          '번역 규칙 (핵심만 간결하게). ' +
            '최대 3-5개 규칙, 세미콜론(;)으로 구분. ' +
            'GOOD: "합니다체 통일; 고유명사 원문 유지" ' +
            'NO PREAMBLE, NO MARKDOWN.'
        ),
    }),
  }
);
