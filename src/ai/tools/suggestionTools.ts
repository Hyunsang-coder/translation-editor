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
      'Create a "save suggestion" for Translation Rules (번역 규칙). ' +
      'CRITICAL: Translation Rules는 번역 스타일/포맷/문체 규칙입니다 (예: "해요체 사용", "따옴표 유지", "고유명사는 음차"). ' +
      'Project Context와 다릅니다: Project Context는 프로젝트 배경 지식/맥락 정보입니다 (예: "이 프로젝트는 게임 UI 번역", "배경 설정: 미래 SF 세계관"). ' +
      '이 도구는 번역 방법/스타일 규칙만 제안하며, 배경 지식은 제안하지 않습니다. ' +
      'IMPORTANT: This does not save anything automatically; the user must click [Add to Rules] button to apply.',
    schema: z.object({
      rule: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          '번역 규칙 (간결하게 작성). ' +
            'FORMAT: 한 규칙당 한 줄, 핵심만 간결하게. 여러 규칙이면 줄바꿈(\\n)으로 구분. ' +
            'GOOD: "합니다체로 통일한다." / BAD: "문서 전체 문체는 기본적으로 합니다체로 통일한다." ' +
            'GOOD: "합니다체로 통일.\\n공식 명령형은 하십시오 사용." ' +
            'BAD: 부연 설명, 예외 조건, 이유 등 장황한 내용 금지.'
        ),
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
      'Create a "save suggestion" for Project Context (프로젝트 맥락 정보). ' +
      'CRITICAL: Project Context는 프로젝트 배경 지식/맥락 정보입니다 (예: "이 프로젝트는 게임 UI 번역", "캐릭터 이름은 음차", "배경 설정: 미래 SF 세계관"). ' +
      'Translation Rules와 다릅니다: Translation Rules는 번역 스타일/포맷/문체 규칙입니다 (예: "해요체 사용", "따옴표 유지"). ' +
      '이 도구는 배경 지식/맥락 정보만 제안하며, 번역 스타일 규칙은 제안하지 않습니다. ' +
      'IMPORTANT: This does not save anything automatically; the user must click [Add to Context] button to apply.',
    schema: z.object({
      context: z
        .string()
        .min(1)
        .max(4000)
        .describe('프로젝트 맥락 정보 내용 (배경 지식/맥락 정보, 번역 스타일 규칙이 아님)'),
    }),
  }
);

