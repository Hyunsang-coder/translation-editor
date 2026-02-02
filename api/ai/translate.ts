/**
 * AI Translation Proxy for Vercel Edge Functions
 *
 * 웹 버전에서 문서 번역 기능을 제공하는 서버리스 프록시입니다.
 * 긴 문서도 스트리밍으로 처리하여 타임아웃을 방지합니다.
 *
 * Features:
 * - Server-Sent Events (SSE) 스트리밍
 * - OpenAI / Anthropic 프로바이더 지원
 * - 번역 마커 (---TRANSLATION_START/END---) 포맷
 */

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

// Rate limiting (chat과 동일한 설정)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10; // 번역은 더 무거우므로 제한 강화

const ALLOWED_ORIGINS = [
  'https://oddeyes.ai',
  'https://www.oddeyes.ai',
  'https://app.oddeyes.ai',
  'http://localhost:3000', // Development
];

interface TranslateRequestBody {
  sourceMarkdown: string;
  sourceLanguage?: string;
  targetLanguage: string;
  translationRules?: string;
  projectContext?: string;
  translatorPersona?: string;
  glossary?: string;
  model?: string;
  provider?: 'openai' | 'anthropic';
}

function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetIn: RATE_LIMIT_WINDOW_MS };
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetIn: record.resetTime - now };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - record.count, resetIn: record.resetTime - now };
}

function getCORSHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function buildTranslationPrompt(params: TranslateRequestBody): string {
  const srcLang = params.sourceLanguage || 'Source';
  const tgtLang = params.targetLanguage;

  const persona = params.translatorPersona?.trim()
    ? params.translatorPersona
    : '당신은 경험많은 전문 번역가입니다.';

  const systemLines: string[] = [
    persona,
    `아래에 제공되는 Markdown 문서의 텍스트를 ${srcLang}에서 ${tgtLang}로 자연스럽게 번역하세요.`,
    '',
    '=== 중요: 출력 형식 ===',
    '반드시 아래 형태로만 출력하세요:',
    '',
    '---TRANSLATION_START---',
    '[번역된 Markdown]',
    '---TRANSLATION_END---',
    '',
    '절대 금지 사항:',
    '- "번역 결과입니다", "다음과 같이 번역했습니다" 등의 설명문 금지',
    '- 인사말, 부연 설명 금지',
    '- 구분자 외부에 텍스트 금지',
    '- 오직 구분자 내부에 번역된 Markdown만 출력',
    '',
    '=== 번역 규칙 ===',
    '- 문서 구조/서식(heading, list, bold, italic, link, table 등)은 그대로 유지하고, 텍스트 내용만 번역하세요.',
    '- HTML 테이블(<table>...</table>)이 있으면 테이블 구조와 속성은 그대로 유지하고, 셀 안의 텍스트만 번역하세요.',
    '- 링크 URL(href), 숫자, 코드/태그/변수(예: {var}, <tag>, %s)는 그대로 유지하세요.',
    '- 불확실하면 임의로 꾸미지 말고 원문 표현을 최대한 보존하세요.',
    '',
  ];

  if (params.translationRules?.trim()) {
    systemLines.push('[번역 규칙]', params.translationRules, '');
  }

  if (params.projectContext?.trim()) {
    systemLines.push('[Project Context]', params.projectContext, '');
  }

  if (params.glossary?.trim()) {
    systemLines.push('[용어집]', '아래 용어집의 번역을 준수하세요:', params.glossary, '');
  }

  return systemLines.join('\n').trim();
}

// Vercel Edge Function 설정
export const config = {
  runtime: 'edge',
  maxDuration: 60,
};

export default async function handler(request: Request): Promise<Response> {
  const corsHeaders = getCORSHeaders(request);

  // OPTIONS 요청 처리 (CORS preflight)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // POST 요청만 허용
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Rate limiting
  const clientIP = getClientIP(request);
  const rateLimit = checkRateLimit(clientIP);

  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil(rateLimit.resetIn / 1000),
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(rateLimit.resetIn / 1000)),
        },
      }
    );
  }

  try {
    const body = (await request.json()) as TranslateRequestBody;
    const { sourceMarkdown, provider = 'openai', model } = body;

    if (!sourceMarkdown || typeof sourceMarkdown !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid request: sourceMarkdown required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!body.targetLanguage) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: targetLanguage required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 환경변수에서 API 키 가져오기
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

    // 시스템 프롬프트 생성
    const systemPrompt = buildTranslationPrompt(body);

    // 토큰 추정 (간단한 휴리스틱: 문자 4개 = 1토큰)
    const estimatedInputTokens = Math.ceil((sourceMarkdown.length + systemPrompt.length) / 4);

    // 모델 생성
    let chatModel;
    if (provider === 'anthropic') {
      if (!anthropicApiKey) {
        return new Response(
          JSON.stringify({ error: 'Anthropic API key not configured' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Claude: 출력 토큰 동적 계산
      const maxContextTokens = 200_000;
      const availableOutput = Math.floor(maxContextTokens * 0.9 - estimatedInputTokens);
      const maxTokens = Math.min(Math.max(availableOutput, 8192), 64000);

      chatModel = new ChatAnthropic({
        apiKey: anthropicApiKey,
        model: model || 'claude-sonnet-4-5-20250514',
        maxTokens,
      });
    } else {
      if (!openaiApiKey) {
        return new Response(
          JSON.stringify({ error: 'OpenAI API key not configured' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const isGpt5 = model?.startsWith('gpt-5');
      const maxContextTokens = 400_000;
      const availableOutput = Math.floor(maxContextTokens * 0.9 - estimatedInputTokens);
      const maxTokens = Math.min(Math.max(availableOutput, 8192), isGpt5 ? 65536 : 16384);

      chatModel = new ChatOpenAI({
        apiKey: openaiApiKey,
        model: model || 'gpt-4o',
        maxTokens,
      });
    }

    // SSE 스트리밍 응답 생성
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const messages = [
            new SystemMessage(systemPrompt),
            new HumanMessage(`[원문 문서]\n${sourceMarkdown}`),
          ];

          const langchainStream = await chatModel.stream(messages);
          let fullResponse = '';

          for await (const chunk of langchainStream) {
            const content = typeof chunk.content === 'string' ? chunk.content : '';
            if (content) {
              fullResponse += content;
              const data = JSON.stringify({ type: 'token', content });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }

          // 완료 이벤트 (전체 응답 포함)
          const doneData = JSON.stringify({
            type: 'done',
            fullResponse,
          });
          controller.enqueue(encoder.encode(`data: ${doneData}\n\n`));
          controller.close();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorData = JSON.stringify({ type: 'error', error: errorMessage });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-RateLimit-Remaining': String(rateLimit.remaining),
      },
    });
  } catch (error) {
    console.error('[API/translate] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}
