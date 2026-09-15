/**
 * Live AI 하네스(`*.live.test.ts`)용 fetch 패치 — jsdom에서만 쓴다.
 *
 * LangChain/OpenAI/Anthropic SDK가 내부에서 만드는 AbortSignal은 jsdom 클래스의
 * 인스턴스라 undici fetch가 거부한다(RequestInit: Expected signal ... to be an
 * instance of AbortSignal). 하네스에서는 취소/클라이언트 타임아웃을 쓰지 않으므로
 * 비-네이티브 signal만 떼고 보낸다. vitest 테스트 타임아웃이 행잉 가드를 대신한다.
 *
 * SDK가 fetch를 호출 시점에 조회하므로 import 뒤 모듈 최상단에서 한 번이면 된다.
 */
export function patchFetchForLiveTests(): void {
  const g = globalThis as {
    fetch: typeof fetch;
    __liveFetchPatched?: boolean;
  };
  if (g.__liveFetchPatched) return;
  const nativeFetch = g.fetch.bind(g);
  const patched = (
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1] & { signal?: unknown },
  ): ReturnType<typeof fetch> => {
    if (init?.signal == null) return nativeFetch(url, init);
    try {
      new Request('http://localhost', { signal: init.signal as AbortSignal });
      return nativeFetch(url, init);
    } catch {
      const { signal: _dropped, ...rest } = init as Record<string, unknown>;
      return nativeFetch(url, rest as RequestInit);
    }
  };
  g.fetch = patched as typeof fetch;
  g.__liveFetchPatched = true;
}
