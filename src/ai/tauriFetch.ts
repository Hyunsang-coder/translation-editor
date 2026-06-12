import { httpProxyStream, httpProxyCancel, type HttpProxyEvent } from '@/tauri/httpProxy';
import { isTauriRuntime } from '@/tauri/invoke';

/**
 * Tauri 런타임에서 LangChain provider 요청을 Rust 백엔드(reqwest)로 보내는 fetch.
 *
 * - Tauri 환경: 백엔드 프록시를 1차 경로로 사용해 WebView fetch의 CORS/네트워크
 *   "Type error"를 피한다.
 * - 비 Tauri 환경: 네이티브 fetch를 그대로 사용한다.
 * - 응답은 ReadableStream으로 재구성해 LangChain의 SSE 파싱/도구 호출 루프를 유지한다.
 *
 * 도구 호출 루프·SSE 파싱은 호출 측(LangChain)이 그대로 담당한다.
 */

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function generateRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `http-proxy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** RequestInit/Request에서 헤더를 [name, value][] 로 평탄화 */
function flattenHeaders(source: HeadersInit | Headers | undefined): [string, string][] {
  if (!source) return [];
  const headers = source instanceof Headers ? source : new Headers(source);
  const pairs: [string, string][] = [];
  headers.forEach((value, key) => {
    pairs.push([key, value]);
  });
  return pairs;
}

async function readBodyAsString(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
  if (body instanceof Blob) return await body.text();
  // URLSearchParams 등
  try {
    return String(body);
  } catch {
    return undefined;
  }
}

// Fetch 명세상 본문이 없어야 하는 상태 코드
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

async function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // 요청 정보 정규화
  let url: string;
  let method: string;
  let headerInit: HeadersInit | undefined;
  let bodyInit: BodyInit | null | undefined;
  let requestSignal: AbortSignal | undefined;
  let requestBodyText: string | undefined;

  if (input instanceof Request) {
    url = input.url;
    method = init?.method ?? input.method;
    headerInit = init?.headers ?? input.headers;
    bodyInit = init?.body ?? undefined;
    requestSignal = init?.signal ?? input.signal;
    if (bodyInit == null && input.body) {
      requestBodyText = await input.clone().text();
    }
  } else {
    url = typeof input === 'string' ? input : input.toString();
    method = init?.method ?? 'GET';
    headerInit = init?.headers;
    bodyInit = init?.body ?? null;
    requestSignal = init?.signal ?? undefined;
  }

  const headers = flattenHeaders(headerInit);
  const body = requestBodyText ?? await readBodyAsString(bodyInit);
  const requestId = generateRequestId();

  if (requestSignal?.aborted) {
    throw createAbortError();
  }

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let streamClosed = false;
  const closeStream = () => {
    if (streamClosed) return;
    streamClosed = true;
    try {
      controller?.close();
    } catch {
      // already closed
    }
  };
  const errorStream = (err: unknown) => {
    if (streamClosed) return;
    streamClosed = true;
    try {
      controller?.error(err);
    } catch {
      // ignore
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      void httpProxyCancel(requestId).catch(() => undefined);
    },
  });

  let resolveHead!: (meta: { status: number; statusText: string; headers: [string, string][] }) => void;
  let rejectHead!: (err: unknown) => void;
  let headSettled = false;
  const headPromise = new Promise<{ status: number; statusText: string; headers: [string, string][] }>(
    (resolve, reject) => {
      resolveHead = (meta) => {
        headSettled = true;
        resolve(meta);
      };
      rejectHead = (err) => {
        headSettled = true;
        reject(err);
      };
    },
  );

  const onEvent = (event: HttpProxyEvent) => {
    if (streamClosed) return;
    if (event.type === 'head') {
      resolveHead({ status: event.status, statusText: event.statusText, headers: event.headers });
    } else if (event.type === 'chunk') {
      controller?.enqueue(base64ToBytes(event.base64));
    } else if (event.type === 'end') {
      closeStream();
    }
  };

  let cleanupAbortListener: (() => void) | undefined;
  if (requestSignal) {
    const signal = requestSignal;
    const onAbort = () => {
      void httpProxyCancel(requestId).catch(() => undefined);
      const err = createAbortError();
      if (!headSettled) rejectHead(err);
      errorStream(err);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    cleanupAbortListener = () => signal.removeEventListener('abort', onAbort);
  }

  // 명령 완료/오류 시 스트림 정리
  httpProxyStream({ requestId, method, url, headers, body }, onEvent)
    .then(() => {
      cleanupAbortListener?.();
      closeStream();
    })
    .catch((err: unknown) => {
      cleanupAbortListener?.();
      if (!headSettled) rejectHead(err);
      errorStream(err);
    });

  let head: { status: number; statusText: string; headers: [string, string][] };
  try {
    head = await headPromise;
  } catch (error) {
    cleanupAbortListener?.();
    throw error;
  }
  const responseHeaders = new Headers(head.headers);
  const responseBody = NULL_BODY_STATUSES.has(head.status) ? null : stream;
  return new Response(responseBody, {
    status: head.status,
    statusText: head.statusText,
    headers: responseHeaders,
  });
}

let cachedFetch: typeof fetch | null = null;

/**
 * Tauri 런타임에서 사용할 회복탄력적 fetch.
 * Tauri에서는 백엔드 프록시를 1차 경로로 사용해 WebView fetch 의존을 제거한다.
 * 비 Tauri 환경에서는 네이티브 fetch를 그대로 반환한다.
 */
export function getTauriResilientFetch(): typeof fetch {
  if (!isTauriRuntime()) {
    return globalThis.fetch.bind(globalThis);
  }
  if (cachedFetch) return cachedFetch;

  cachedFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    return await proxyFetch(input, init);
  }) as typeof fetch;

  return cachedFetch;
}
