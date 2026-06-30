/**
 * 검수 전용 API 호출 함수
 * - Tool calling 없이 단순 1회 호출
 * - 채팅 인프라 우회로 빠른 응답
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { AIMessageChunk } from '@langchain/core/messages';
import { createChatModel } from '@/ai/client';
import { getAiConfig } from '@/ai/config';
import {
  shouldRetryWithTauriAiBackend,
  streamWithTauriAiBackend,
  type AiPromptMessage,
} from '@/ai/backendCompletion';
import { buildReviewPrompt, type AlignedSegment } from '@/ai/tools/reviewTool';
import { extractChunkContent } from '@/ai/extractChunkContent';
import { useUIStore } from '@/stores/uiStore';
import { isTauriRuntime } from '@/tauri/invoke';

export interface RunReviewParams {
  segments: AlignedSegment[];
  translationRules?: string;
  glossary?: string;
  /** Source 언어 (예: "Korean", "한국어") */
  sourceLanguage?: string | undefined;
  /** Target 언어 (예: "English", "영어") */
  targetLanguage?: string | undefined;
  /** 직렬화된 사용자 인라인 코멘트(serializeUserComments 결과). 청크 범위로 한정 가능. */
  userComments?: string | undefined;
  abortSignal?: AbortSignal;
  onToken?: (accumulated: string) => void;
}

const REVIEW_MAX_TOKENS = 4096;

function buildReviewMessages(params: RunReviewParams): AiPromptMessage[] {
  const systemPrompt = buildReviewPrompt();

  const userContentParts: string[] = [];

  const srcLang = params.sourceLanguage || '원문';
  const tgtLang = params.targetLanguage || '번역문';
  userContentParts.push(`## 번역 방향
- **Source** (원문): ${srcLang}
- **Target** (번역문): ${tgtLang}

**⚠️ 필수**: excerpt 작성 시 Source/Target을 절대 혼동하지 마세요!
- sourceExcerpt → Source 열(${srcLang})에서 복사
- targetExcerpt → Target 열(${tgtLang})에서 복사
- 잘못 복사하면 시스템이 텍스트를 찾지 못합니다!`);

  if (params.translationRules?.trim()) {
    userContentParts.push(`## 번역 규칙\n${params.translationRules.trim()}`);
  }
  if (params.glossary?.trim()) {
    userContentParts.push(`## 용어집\n${params.glossary.trim()}`);
  }
  if (params.userComments?.trim()) {
    userContentParts.push(params.userComments.trim());
  }

  const segmentsText = params.segments
    .map((s) => `[#${s.order}]\nSegmentGroupId: ${s.groupId}\nSource (${srcLang}): ${s.sourceText}\nTarget (${tgtLang}): ${s.targetText}`)
    .join('\n\n');
  userContentParts.push(`## 검수 대상\n${segmentsText}`);

  // 출력 지시 (시스템 프롬프트의 Markdown 형식을 따르도록)
  const appLang = useUIStore.getState().language === 'ko' ? '한국어' : 'English';
  userContentParts.push(`위 출력 형식(---REVIEW_START/END--- 마커와 Markdown)을 정확히 따라 출력하세요.
- Explanation: ${appLang}로 작성
- Suggestion: 반드시 Target 언어(${tgtLang})로 작성`);

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContentParts.join('\n\n') },
  ];
}

/**
 * 검수 실행 (도구 없이 단순 API 호출)
 *
 * @returns AI 응답 텍스트 (JSON 형식)
 */
export async function runReview(params: RunReviewParams): Promise<string> {
  const cfg = getAiConfig({ useFor: 'translation' });
  const promptMessages = buildReviewMessages(params);

  if (params.abortSignal?.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }

  // 검수는 도구 호출 없는 단순 스트리밍이므로 Tauri에서는 WebView fetch를 거치지 않는다.
  if (isTauriRuntime() && cfg.provider !== 'mock') {
    return await streamWithTauriAiBackend({
      cfg,
      messages: promptMessages,
      maxTokens: REVIEW_MAX_TOKENS,
      onAccumulated: params.onToken,
      cancelMessage: '검수가 취소되었습니다.',
      abortSignal: params.abortSignal,
    });
  }

  // 도구 없이 직접 스트리밍 (1회 호출)
  let result = '';
  try {
    // useFor: 'translation'으로 설정하여 Responses API 비활성화 (성능 향상)
    const model = createChatModel(undefined, { useFor: 'translation', maxTokens: REVIEW_MAX_TOKENS });
    const messages = [
      new SystemMessage(promptMessages[0]!.content),
      new HumanMessage(promptMessages[1]!.content),
    ];
    const stream = await model.stream(messages, {
      ...(params.abortSignal && { signal: params.abortSignal }),
    });

    for await (const chunk of stream) {
      // AbortSignal 체크
      if (params.abortSignal?.aborted) {
        throw new DOMException('Request aborted', 'AbortError');
      }

      const text = extractChunkContent(chunk as AIMessageChunk);
      if (text) {
        result += text;
        params.onToken?.(result);
      }
    }
  } catch (error) {
    if (!shouldRetryWithTauriAiBackend(error)) {
      throw error;
    }
    return await streamWithTauriAiBackend({
      cfg,
      messages: promptMessages,
      maxTokens: REVIEW_MAX_TOKENS,
      onAccumulated: params.onToken,
      cancelMessage: '검수가 취소되었습니다.',
      abortSignal: params.abortSignal,
    });
  }

  return result;
}
