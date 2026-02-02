/**
 * AI Chat Streaming Proxy for Vercel Edge Functions
 *
 * 웹 버전에서 AI 채팅 기능을 제공하는 서버리스 프록시입니다.
 * API 키를 서버에서 관리하여 클라이언트에 노출되지 않도록 합니다.
 *
 * Features:
 * - Server-Sent Events (SSE) 스트리밍
 * - OpenAI / Anthropic 프로바이더 지원
 * - Rate limiting (IP 기반)
 */

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

// Rate limiting: in-memory store (Vercel Edge에서는 요청 간 공유되지 않음)
// 프로덕션에서는 Vercel KV 또는 Upstash Redis 사용 권장
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1분
const RATE_LIMIT_MAX_REQUESTS = 20; // 분당 최대 요청

// CORS 허용 도메인
const ALLOWED_ORIGINS = [
  'https://oddeyes.ai',
  'https://www.oddeyes.ai',
  'https://app.oddeyes.ai',
  process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '',
].filter(Boolean);

interface ChatRequestBody {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  model?: string;
  provider?: 'openai' | 'anthropic';
  temperature?: number;
  maxTokens?: number;
}

function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }
  return 'unknown';
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

function getCORSHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export async function OPTIONS(request: Request): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: getCORSHeaders(request),
  });
}

export async function POST(request: Request): Promise<Response> {
  const corsHeaders = getCORSHeaders(request);

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
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetIn / 1000)),
        },
      }
    );
  }

  try {
    const body: ChatRequestBody = await request.json();
    const { messages, model, provider = 'openai', temperature, maxTokens } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: messages array required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 환경변수에서 API 키 가져오기
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

    // LangChain 메시지 변환
    const langchainMessages: BaseMessage[] = messages.map((msg) => {
      switch (msg.role) {
        case 'system':
          return new SystemMessage(msg.content);
        case 'user':
          return new HumanMessage(msg.content);
        case 'assistant':
          return new AIMessage(msg.content);
        default:
          return new HumanMessage(msg.content);
      }
    });

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
      chatModel = new ChatAnthropic({
        apiKey: anthropicApiKey,
        model: model || 'claude-sonnet-4-5-20250514',
        ...(temperature !== undefined && { temperature }),
        maxTokens: maxTokens || 4096,
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
      chatModel = new ChatOpenAI({
        apiKey: openaiApiKey,
        model: model || 'gpt-4o',
        ...(isGpt5 ? {} : temperature !== undefined ? { temperature } : {}),
        ...(maxTokens && { maxTokens }),
      });
    }

    // SSE 스트리밍 응답 생성
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const langchainStream = await chatModel.stream(langchainMessages);

          for await (const chunk of langchainStream) {
            const content = typeof chunk.content === 'string' ? chunk.content : '';
            if (content) {
              const data = JSON.stringify({ type: 'token', content });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }

          // 완료 이벤트
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
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
        'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetIn / 1000)),
      },
    });
  } catch (error) {
    console.error('[API/chat] Error:', error);
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

// Vercel Edge Function 설정
export const config = {
  runtime: 'edge',
  // 스트리밍을 위해 maxDuration 설정 (Pro plan: 60s, Enterprise: 300s)
  maxDuration: 60,
};
