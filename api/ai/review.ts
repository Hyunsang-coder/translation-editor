/**
 * AI Review Proxy for Vercel Edge Functions
 *
 * 웹 버전에서 번역 검수 기능을 제공하는 서버리스 프록시입니다.
 * 검수 결과를 스트리밍으로 처리하여 타임아웃을 방지합니다.
 *
 * Features:
 * - Server-Sent Events (SSE) 스트리밍
 * - OpenAI / Anthropic 프로바이더 지원
 * - 검수 마커 (---REVIEW_START/END---) 포맷
 */

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

// Rate limiting (translate와 동일한 설정)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

const ALLOWED_ORIGINS = [
  'https://oddeyes.ai',
  'https://www.oddeyes.ai',
  'https://app.oddeyes.ai',
  'http://localhost:3000', // Development
];

interface ReviewSegment {
  id: string;
  order: number;
  source: string;
  target: string;
}

interface ReviewRequestBody {
  segments: ReviewSegment[];
  systemPrompt: string;
  translationRules?: string;
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

function buildUserContent(params: ReviewRequestBody): string {
  const userContentParts: string[] = [];

  if (params.translationRules?.trim()) {
    userContentParts.push(`## 번역 규칙\n${params.translationRules.trim()}`);
  }
  if (params.glossary?.trim()) {
    userContentParts.push(`## 용어집\n${params.glossary.trim()}`);
  }

  // 폴리싱 모드 체크 (systemPrompt에 "교정" 또는 "에디터" 포함 시)
  const isPolishing = params.systemPrompt.includes('교정자') || params.systemPrompt.includes('에디터');

  // 검수 대상 세그먼트
  const segmentsText = params.segments
    .map((s) => isPolishing
      ? `[#${s.order}]\nText: ${s.target}`
      : `[#${s.order}]\nSource: ${s.source}\nTarget: ${s.target}`
    )
    .join('\n\n');
  userContentParts.push(`## ${isPolishing ? '검사 대상' : '검수 대상'}\n${segmentsText}`);

  // 출력 지시
  userContentParts.push('반드시 위 출력 형식의 JSON만 출력하세요. 설명이나 마크다운 없이 JSON만 출력합니다.\n문제가 없으면: { "issues": [] }');

  return userContentParts.join('\n\n');
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
    const body = (await request.json()) as ReviewRequestBody;
    const { segments, systemPrompt, provider = 'openai', model } = body;

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: segments array required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!systemPrompt || typeof systemPrompt !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid request: systemPrompt required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 환경변수에서 API 키 가져오기
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

    // 사용자 메시지 생성
    const userContent = buildUserContent(body);

    // 토큰 추정 (간단한 휴리스틱: 문자 4개 = 1토큰)
    const estimatedInputTokens = Math.ceil((userContent.length + systemPrompt.length) / 4);

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
      const maxTokens = Math.min(Math.max(availableOutput, 4096), 16000);

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
      const maxContextTokens = 128_000;
      const availableOutput = Math.floor(maxContextTokens * 0.9 - estimatedInputTokens);
      const maxTokens = Math.min(Math.max(availableOutput, 4096), isGpt5 ? 16384 : 8192);

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
            new HumanMessage(userContent),
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
    console.error('[API/review] Error:', error);
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
