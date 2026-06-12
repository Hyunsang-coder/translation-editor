import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(),
  httpProxyStream: vi.fn(),
  httpProxyCancel: vi.fn(),
}));

vi.mock('@/tauri/invoke', () => ({
  isTauriRuntime: mocks.isTauriRuntime,
}));

vi.mock('@/tauri/httpProxy', () => ({
  httpProxyStream: mocks.httpProxyStream,
  httpProxyCancel: mocks.httpProxyCancel,
}));

describe('getTauriResilientFetch', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.isTauriRuntime.mockReturnValue(false);
    mocks.httpProxyCancel.mockResolvedValue(undefined);
    mocks.httpProxyStream.mockImplementation(async (_args, onEvent) => {
      onEvent({ type: 'head', status: 200, statusText: 'OK', headers: [['content-type', 'text/plain']] });
      onEvent({ type: 'chunk', base64: btoa('proxied') });
      onEvent({ type: 'end' });
    });
    globalThis.fetch = vi.fn(async () => new Response('native')) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('비 Tauri 환경에서는 네이티브 fetch를 그대로 사용', async () => {
    const { getTauriResilientFetch } = await import('./tauriFetch');

    const fetchImpl = getTauriResilientFetch();
    const response = await fetchImpl('https://example.com');

    expect(await response.text()).toBe('native');
    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com');
    expect(mocks.httpProxyStream).not.toHaveBeenCalled();
  });

  it('Tauri 환경에서는 WebView fetch 대신 HTTP 프록시를 1차 경로로 사용', async () => {
    mocks.isTauriRuntime.mockReturnValue(true);
    const { getTauriResilientFetch } = await import('./tauriFetch');

    const fetchImpl = getTauriResilientFetch();
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      body: '{"input":"hello"}',
    });

    expect(await response.text()).toBe('proxied');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.httpProxyStream).toHaveBeenCalledTimes(1);

    const [args] = mocks.httpProxyStream.mock.calls[0] as [
      {
        method: string;
        url: string;
        headers: [string, string][];
        body?: string;
      },
      unknown,
    ];
    expect(args.method).toBe('POST');
    expect(args.url).toBe('https://api.openai.com/v1/responses');
    expect(args.headers).toContainEqual(['authorization', 'Bearer test']);
    expect(args.body).toBe('{"input":"hello"}');
  });

  it('Request 객체 입력에서도 body/header/signal을 프록시에 전달', async () => {
    mocks.isTauriRuntime.mockReturnValue(true);
    const { getTauriResilientFetch } = await import('./tauriFetch');
    const controller = new AbortController();

    const request = new Request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant-test' },
      body: '{"messages":[]}',
      signal: controller.signal,
    });
    const removeListenerSpy = vi.spyOn(request.signal, 'removeEventListener');

    const response = await getTauriResilientFetch()(request);

    expect(await response.text()).toBe('proxied');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const [args] = mocks.httpProxyStream.mock.calls[0] as [
      {
        method: string;
        url: string;
        headers: [string, string][];
        body?: string;
      },
      unknown,
    ];
    expect(args.method).toBe('POST');
    expect(args.url).toBe('https://api.anthropic.com/v1/messages');
    expect(args.headers).toContainEqual(['x-api-key', 'sk-ant-test']);
    expect(args.body).toBe('{"messages":[]}');
    expect(removeListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('Request signal이 abort되면 백엔드 프록시를 취소', async () => {
    mocks.isTauriRuntime.mockReturnValue(true);
    let markProxyStarted!: () => void;
    const proxyStarted = new Promise<void>((resolve) => {
      markProxyStarted = resolve;
    });
    mocks.httpProxyStream.mockImplementation(async () => {
      markProxyStarted();
      return new Promise(() => undefined);
    });
    const { getTauriResilientFetch } = await import('./tauriFetch');
    const controller = new AbortController();
    const request = new Request('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: '{"input":"hello"}',
      signal: controller.signal,
    });

    const responsePromise = getTauriResilientFetch()(request);
    await proxyStarted;
    controller.abort();

    await expect(responsePromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.httpProxyCancel).toHaveBeenCalledTimes(1);
  });

  it('스트림 종료 후 늦게 도착한 chunk 이벤트는 무시', async () => {
    mocks.isTauriRuntime.mockReturnValue(true);
    mocks.httpProxyStream.mockImplementation(async (_args, onEvent) => {
      onEvent({ type: 'head', status: 200, statusText: 'OK', headers: [['content-type', 'text/plain']] });
      onEvent({ type: 'end' });
      expect(() => onEvent({ type: 'chunk', base64: btoa('late') })).not.toThrow();
    });
    const { getTauriResilientFetch } = await import('./tauriFetch');

    const response = await getTauriResilientFetch()('https://api.openai.com/v1/responses');

    expect(await response.text()).toBe('');
  });
});
