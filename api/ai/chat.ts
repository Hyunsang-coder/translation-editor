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
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage, AIMessageChunk } from '@langchain/core/messages';
import type { ToolCallChunk } from '@langchain/core/messages/tool';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

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
  'http://localhost:3000', // Development
];

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface ToolCallResult {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface ChatRequestBody {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
  }>;
  tools?: ToolDefinition[];
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
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetIn / 1000)),
        },
      }
    );
  }

  try {
    const body = (await request.json()) as ChatRequestBody;
    const { messages, tools, model, provider = 'openai', temperature, maxTokens } = body;

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
        case 'tool':
          return new ToolMessage({
            tool_call_id: msg.tool_call_id || '',
            content: msg.content,
          });
        default:
          return new HumanMessage(msg.content);
      }
    });

    // 모델 생성
    let chatModel: ChatOpenAI | ChatAnthropic;
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

    // 도구 정의가 있으면 LangChain 도구로 변환하여 바인딩
    let modelToUse: ChatOpenAI | ChatAnthropic | ReturnType<ChatOpenAI['bindTools']> = chatModel;
    if (tools && tools.length > 0) {
      // 클라이언트에서 전달받은 도구 정의를 LangChain 도구로 변환
      const langchainTools = tools.map((t) => {
        // 동적으로 zod 스키마 생성
        const schemaObj: Record<string, z.ZodTypeAny> = {};
        const props = (t.parameters as any)?.properties || {};
        const required = (t.parameters as any)?.required || [];

        for (const [key, value] of Object.entries(props)) {
          const prop = value as any;
          let zodType: z.ZodTypeAny;

          switch (prop.type) {
            case 'string':
              zodType = z.string();
              break;
            case 'number':
              zodType = z.number();
              break;
            case 'boolean':
              zodType = z.boolean();
              break;
            case 'array':
              zodType = z.array(z.any());
              break;
            default:
              zodType = z.any();
          }

          if (prop.description) {
            zodType = zodType.describe(prop.description);
          }

          if (!required.includes(key)) {
            zodType = zodType.optional();
          }

          schemaObj[key] = zodType;
        }

        return tool(
          async () => {
            // 서버에서는 도구를 실행하지 않음 - 클라이언트에서 실행
            return 'Tool execution delegated to client';
          },
          {
            name: t.name,
            description: t.description,
            schema: z.object(schemaObj),
          }
        );
      });

      modelToUse = (chatModel as ChatOpenAI).bindTools(langchainTools);
    }

    // SSE 스트리밍 응답 생성
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const langchainStream = await (modelToUse as any).stream(langchainMessages);

          let _accumulatedText = '';
          const accumulatedToolCallChunks: ToolCallChunk[] = [];
          let finalAiMessage: AIMessageChunk | null = null;

          for await (const chunk of langchainStream) {
            // 텍스트 토큰 처리
            const content = typeof chunk.content === 'string' ? chunk.content : '';
            if (content) {
              _accumulatedText += content;
              const data = JSON.stringify({ type: 'token', content });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }

            // 도구 호출 청크 수집
            if (chunk.tool_call_chunks && Array.isArray(chunk.tool_call_chunks)) {
              accumulatedToolCallChunks.push(...chunk.tool_call_chunks);
            }

            // 최종 메시지 누적
            if (finalAiMessage === null) {
              finalAiMessage = chunk;
            } else {
              finalAiMessage = finalAiMessage.concat(chunk);
            }
          }

          // 도구 호출 청크 병합
          const toolCalls = mergeToolCallChunks(accumulatedToolCallChunks);

          // 최종 메시지에서도 tool_calls 추출 시도
          if (toolCalls.length === 0 && finalAiMessage) {
            const extracted = extractToolCalls(finalAiMessage);
            toolCalls.push(...extracted);
          }

          // 완료 이벤트 (도구 호출 포함)
          const doneData: { type: string; toolCalls?: ToolCallResult[] } = { type: 'done' };
          if (toolCalls.length > 0) {
            doneData.toolCalls = toolCalls;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneData)}\n\n`));
          controller.close();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorData = JSON.stringify({ type: 'error', error: errorMessage });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      },
    });

    // 도구 호출 청크 병합 헬퍼
    function mergeToolCallChunks(chunks: ToolCallChunk[]): ToolCallResult[] {
      const byIndex = new Map<number, ToolCallChunk[]>();
      for (const chunk of chunks) {
        const idx = chunk.index ?? 0;
        if (!byIndex.has(idx)) byIndex.set(idx, []);
        byIndex.get(idx)!.push(chunk);
      }

      const result: ToolCallResult[] = [];
      for (const [, groupChunks] of byIndex) {
        let id = '';
        let name = '';
        let argsStr = '';
        for (const c of groupChunks) {
          if (c.id) id = c.id;
          if (c.name) name = c.name;
          if (c.args) argsStr += c.args;
        }
        if (name) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(argsStr) || {};
          } catch {
            args = {};
          }
          result.push({ id: id || crypto.randomUUID(), name, args });
        }
      }
      return result;
    }

    // 최종 메시지에서 tool_calls 추출
    function extractToolCalls(ai: unknown): ToolCallResult[] {
      const a = ai as any;
      const rawCalls = a?.tool_calls || a?.additional_kwargs?.tool_calls || [];
      if (!Array.isArray(rawCalls)) return [];

      return rawCalls
        .filter((call: any) => call && (call.name || call.function?.name))
        .map((call: any) => {
          const name = call.name || call.function?.name;
          const id = call.id || call.tool_call_id || crypto.randomUUID();
          let args: Record<string, unknown> = {};

          const rawArgs = call.args || call.input || call.function?.arguments;
          if (typeof rawArgs === 'string') {
            try {
              args = JSON.parse(rawArgs) || {};
            } catch {
              args = {};
            }
          } else if (rawArgs && typeof rawArgs === 'object') {
            args = rawArgs;
          }

          return { id, name, args };
        });
    }

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
