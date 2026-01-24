/**
 * Ollama/Local LLM 유틸리티 함수
 * 연결 테스트, 모델 목록 조회, 모델 능력 확인 등
 */

export interface OllamaConnectionResult {
  success: boolean;
  models?: string[];
  error?: string;
}

export interface ModelCapabilities {
  supportsTools: boolean;
  contextLength?: number | undefined;
}

/**
 * Ollama 서버 연결 테스트
 * Settings UI에서 "Test Connection" 버튼용
 *
 * @param baseUrl - OpenAI 호환 엔드포인트 (예: http://localhost:11434/v1)
 * @returns 연결 결과 (성공 시 모델 목록 포함)
 */
export async function testOllamaConnection(baseUrl: string): Promise<OllamaConnectionResult> {
  try {
    // /v1을 제거하여 Ollama 네이티브 API 엔드포인트 구성
    const apiBase = baseUrl.replace(/\/v1\/?$/, '');

    // Ollama는 /api/tags로 모델 목록 조회 가능
    const res = await fetch(`${apiBase}/api/tags`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      // LM Studio 등 다른 OpenAI 호환 서버는 /v1/models 사용
      const modelsRes = await fetch(`${baseUrl.replace(/\/?$/, '')}/models`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!modelsRes.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const modelsData = await modelsRes.json();
      const models = modelsData.data?.map((m: { id: string }) => m.id) ?? [];
      return { success: true, models };
    }

    const data = await res.json();
    const models = data.models?.map((m: { name: string }) => m.name) ?? [];

    return { success: true, models };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Connection failed',
    };
  }
}

/**
 * 특정 모델의 Tool Calling 지원 여부 확인
 * (Ollama API로 모델 정보 조회)
 *
 * @param baseUrl - OpenAI 호환 엔드포인트
 * @param modelName - 확인할 모델명
 * @returns 모델 능력 정보
 */
export async function checkModelCapabilities(
  baseUrl: string,
  modelName: string
): Promise<ModelCapabilities> {
  try {
    // /v1을 제거하여 Ollama 네이티브 API 엔드포인트 구성
    const apiBase = baseUrl.replace(/\/v1\/?$/, '');

    const res = await fetch(`${apiBase}/api/show`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: modelName }),
    });

    if (!res.ok) {
      // LM Studio 등 다른 서버는 이 API를 지원하지 않을 수 있음
      return { supportsTools: false };
    }

    const data = await res.json();

    // Ollama 응답에서 template에 "tools" 포함 여부로 판단 (휴리스틱)
    const template = data.template ?? '';
    const supportsTools = template.includes('tool') || template.includes('function');

    // 컨텍스트 길이는 parameters에서 추출
    const parameters = data.parameters ?? '';
    const contextMatch = parameters.match(/num_ctx\s+(\d+)/);
    const contextLength = contextMatch ? parseInt(contextMatch[1], 10) : undefined;

    return { supportsTools, contextLength };
  } catch {
    return { supportsTools: false };
  }
}

/**
 * Tool Calling 미지원 에러인지 판단
 *
 * @param error - 에러 객체
 * @returns Tool Calling 미지원 에러 여부
 */
export function isToolCallingNotSupported(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    (msg.includes('tool') || msg.includes('function')) &&
    (msg.includes('not supported') ||
      msg.includes('unsupported') ||
      msg.includes('invalid') ||
      msg.includes('unknown'))
  );
}

/**
 * Tool Calling 지원 모델 목록 (알려진 모델)
 * Ollama Library에서 "tools" 태그가 있는 모델들
 */
export const KNOWN_TOOL_CAPABLE_MODELS = [
  'llama3.1',
  'llama3.2',
  'llama3.3',
  'qwen2.5',
  'qwen3',
  'mistral',
  'mistral-nemo',
  'mixtral',
  'command-r',
  'command-r-plus',
  'hermes3',
  'firefunction-v2',
];

/**
 * 모델명이 Tool Calling을 지원하는지 휴리스틱으로 판단
 *
 * @param modelName - 모델명
 * @returns 지원 가능성 여부
 */
export function mightSupportToolCalling(modelName: string): boolean {
  const normalized = modelName.toLowerCase();
  return KNOWN_TOOL_CAPABLE_MODELS.some((m) => normalized.startsWith(m));
}
