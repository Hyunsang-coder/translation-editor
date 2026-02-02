/**
 * 검수 전용 API 호출 함수
 * - Tool calling 없이 단순 1회 호출
 * - 채팅 인프라 우회로 빠른 응답
 * - 웹 환경에서는 프록시 사용
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { AIMessageChunk } from '@langchain/core/messages';
import { createChatModel } from '@/ai/client';
import { getAiConfig } from '@/ai/config';
import { buildReviewPrompt, type AlignedSegment } from '@/ai/tools/reviewTool';
import { type ReviewIntensity, isPolishingMode } from '@/stores/reviewStore';
import { shouldUseWebProxy, webProxyReview } from '@/ai/webProxy';

export interface RunReviewParams {
  segments: AlignedSegment[];
  intensity: ReviewIntensity;
  translationRules?: string;
  glossary?: string;
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
  const useWebProxy = shouldUseWebProxy();
  const systemPrompt = buildReviewPrompt(params.intensity);

  // ============================================
  // 웹 환경: 프록시 사용
  // ============================================
  if (useWebProxy) {
    const cfg = getAiConfig();

    // 세그먼트를 프록시 형식으로 변환
    const segments = params.segments.map((s) => ({
      id: s.groupId,
      order: s.order,
      source: s.sourceText,
      target: s.targetText,
    }));

    const result = await webProxyReview({
      segments,
      systemPrompt,
      translationRules: params.translationRules,
      glossary: params.glossary,
      model: cfg.model,
      provider: cfg.provider === 'anthropic' ? 'anthropic' : 'openai',
      onToken: params.onToken,
      abortSignal: params.abortSignal,
    });

    return result;
  }

  // ============================================
  // Tauri 환경: 직접 API 호출
  // ============================================

  // useFor: 'translation'으로 설정하여 Responses API 비활성화 (성능 향상)
  // 검수는 도구 호출 없이 단순 텍스트 생성이므로 Responses API 불필요
  const model = createChatModel(undefined, { useFor: 'translation', maxTokens: 4096 });

  // 사용자 메시지: 컨텍스트 + 세그먼트
  const userContentParts: string[] = [];

  if (params.translationRules?.trim()) {
    userContentParts.push(`## 번역 규칙\n${params.translationRules.trim()}`);
  }
  if (params.glossary?.trim()) {
    userContentParts.push(`## 용어집\n${params.glossary.trim()}`);
  }

  // 검수 대상 세그먼트
  // 폴리싱 모드는 번역문(Target)만, 대조 검수는 원문+번역문
  const isPolishing = isPolishingMode(params.intensity);
  const segmentsText = params.segments
    .map((s) => isPolishing
      ? `[#${s.order}]\nText: ${s.targetText}`
      : `[#${s.order}]\nSource: ${s.sourceText}\nTarget: ${s.targetText}`
    )
    .join('\n\n');
  userContentParts.push(`## ${isPolishing ? '검사 대상' : '검수 대상'}\n${segmentsText}`);

  // 출력 지시
  userContentParts.push('반드시 위 출력 형식의 JSON만 출력하세요. 설명이나 마크다운 없이 JSON만 출력합니다.\n문제가 없으면: { "issues": [] }');

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
