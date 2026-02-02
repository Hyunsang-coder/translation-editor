/**
 * AI Providers Status Endpoint
 *
 * 서버에 설정된 AI 프로바이더 상태를 반환합니다.
 * 클라이언트에서 사용 가능한 모델 목록을 결정하는 데 사용됩니다.
 */

// CORS 허용 도메인
const ALLOWED_ORIGINS = [
  'https://oddeyes.ai',
  'https://www.oddeyes.ai',
  'https://app.oddeyes.ai',
  'http://localhost:3000', // Development
];

function getCORSHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

// Vercel Edge Function 설정
export const config = {
  runtime: 'edge',
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

  // GET 요청만 허용
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 환경변수에서 API 키 존재 여부 확인 (키 값 자체는 노출하지 않음)
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  return new Response(
    JSON.stringify({
      providers: {
        openai: hasOpenAI,
        anthropic: hasAnthropic,
      },
    }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60', // 1분 캐시
      },
    }
  );
}
