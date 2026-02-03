/**
 * 검수 전용 API 호출 함수
 * - Tool calling 없이 단순 1회 호출
 * - 채팅 인프라 우회로 빠른 응답
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { AIMessageChunk } from '@langchain/core/messages';
import { createChatModel } from '@/ai/client';
import { buildReviewPrompt, type AlignedSegment } from '@/ai/tools/reviewTool';
import type { ReviewIntensity } from '@/stores/reviewStore';

export interface RunReviewParams {
  segments: AlignedSegment[];
  intensity: ReviewIntensity;
  translationRules?: string;
  glossary?: string;
  /** Source 언어 (예: "Korean", "한국어") */
  sourceLanguage?: string | undefined;
  /** Target 언어 (예: "English", "영어") */
  targetLanguage?: string | undefined;
  abortSignal?: AbortSignal;
  onToken?: (accumulated: string) => void;
}

/**
 * AIMessageChunk에서 텍스트 콘텐츠 추출
 */
function extractChunkContent(chunk: AIMessageChunk): string {
  const content = chunk.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (typeof c === 'object' && c && 'text' in c) return String((c as any).text ?? '');
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * 검수 실행 (도구 없이 단순 API 호출)
 *
 * @returns AI 응답 텍스트 (JSON 형식)
 */
export async function runReview(params: RunReviewParams): Promise<string> {
  // useFor: 'translation'으로 설정하여 Responses API 비활성화 (성능 향상)
  // 검수는 도구 호출 없이 단순 텍스트 생성이므로 Responses API 불필요
  const model = createChatModel(undefined, { useFor: 'translation', maxTokens: 4096 });

  // 시스템 프롬프트: 검수 지침만
  const systemPrompt = buildReviewPrompt(params.intensity);

  // 사용자 메시지: 컨텍스트 + 세그먼트
  const userContentParts: string[] = [];

  // 언어 정보 추가 (Source/Target 방향 명시)
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

  // 검수 대상 세그먼트 (대조 검수: 원문+번역문)
  const segmentsText = params.segments
    .map((s) => `[#${s.order}]\nSource (${srcLang}): ${s.sourceText}\nTarget (${tgtLang}): ${s.targetText}`)
    .join('\n\n');
  userContentParts.push(`## 검수 대상\n${segmentsText}`);

  // 출력 지시 (시스템 프롬프트의 Markdown 형식을 따르도록)
  userContentParts.push('위 출력 형식(---REVIEW_START/END--- 마커와 Markdown)을 정확히 따라 출력하세요.');

  const userContent = userContentParts.join('\n\n');

  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userContent),
  ];

  // 도구 없이 직접 스트리밍 (1회 호출)
  const stream = await (model as any).stream(messages, {
    signal: params.abortSignal,
  });

  let result = '';
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

  return result;
}
