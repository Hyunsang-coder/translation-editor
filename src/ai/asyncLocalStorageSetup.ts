/**
 * LangChain/LangGraph 전역 AsyncLocalStorage 인스턴스를 안전한 구현으로 고정한다.
 *
 * **반드시 앱 진입점(main.tsx)의 첫 import여야 한다.** langchain 모듈이 먼저 평가되면
 * 그쪽이 먼저 인스턴스를 설치한다(아래 2번 경로로 복구하긴 한다).
 *
 * ## 왜 필요한가
 *
 * `@langchain/langgraph`는 import 시점에 `node:async_hooks`의 AsyncLocalStorage를
 * 전역 슬롯에 설치한다. WebView에는 그 모듈이 없어 `vite.config.ts`가
 * `src/mocks/async_hooks.js`로 alias하는데, 그 폴리필이 빈 저장소를 `null`로 돌려주면
 * `@langchain/core`의 `runWithConfig`가 이렇게 터진다:
 *
 *   null is not an object (evaluating 'previousValue[_CONTEXT_VARIABLES_KEY]')
 *
 * 가드가 `previousValue !== undefined`만 보기 때문이다. LangGraph는 노드를 실행할 때마다
 * 이 경로를 타므로 채팅이 한 번도 동작하지 않는다.
 *
 * ## 왜 폴리필 수정만으로 부족한가
 *
 * Vite는 `@langchain/*`를 pre-bundle하면서 alias된 폴리필을 그 청크 안에 **인라인**한다.
 * `src/mocks/async_hooks.js`를 고쳐도 `node_modules/.vite` 캐시는 무효화되지 않아
 * 낡은 구현이 계속 실행된다. 이 모듈은 그 캐시 상태와 무관하게 결과를 보장한다.
 */

/** langsmith와 @langchain/core가 공유하는 전역 슬롯 키 */
const TRACING_ALS_KEY = Symbol.for('ls:tracing_async_local_storage');

interface AsyncLocalStorageLike {
  getStore(): unknown;
  run<T>(store: unknown, callback: (...args: unknown[]) => T, ...args: unknown[]): T;
  enterWith?(store: unknown): void;
}

/**
 * 동기 구간에서만 유효한 AsyncLocalStorage 대체 구현.
 *
 * 진짜 async context 추적은 브라우저에서 불가능하다. LangChain이 ALS를 못 찾았을 때
 * 쓰는 `MockAsyncLocalStorage`와 같은 수준의 degraded 동작이며, 이 앱은 async context에
 * 의존하는 기능(`interrupt()`, custom stream writer)을 쓰지 않는다.
 *
 * 핵심 계약: **빈 저장소는 `undefined`다. 절대 `null`을 반환하지 않는다.**
 */
class SyncScopedAsyncLocalStorage implements AsyncLocalStorageLike {
  private store: unknown = undefined;

  run<T>(store: unknown, callback: (...args: unknown[]) => T, ...args: unknown[]): T {
    // 중첩 run에서 바깥 store를 복원한다(무조건 비우면 바깥 컨텍스트가 사라진다).
    const previous = this.store;
    this.store = store;
    try {
      return callback(...args);
    } finally {
      this.store = previous;
    }
  }

  getStore(): unknown {
    return this.store;
  }

  /** `setContextVariable()`이 호출한다. 없으면 TypeError. */
  enterWith(store: unknown): void {
    this.store = store;
  }

  exit<T>(callback: (...args: unknown[]) => T, ...args: unknown[]): T {
    const previous = this.store;
    this.store = undefined;
    try {
      return callback(...args);
    } finally {
      this.store = previous;
    }
  }

  disable(): void {
    this.store = undefined;
  }
}

/** 빈 저장소에 `null`을 돌려주는 구현은 위 크래시를 일으키므로 교체 대상이다. */
function isUnsafeInstance(instance: AsyncLocalStorageLike | undefined): boolean {
  if (!instance) return false;
  try {
    return instance.getStore() === null;
  } catch {
    return true;
  }
}

export function installSafeAsyncLocalStorage(): void {
  const globals = globalThis as unknown as Record<symbol, AsyncLocalStorageLike | undefined>;
  const existing = globals[TRACING_ALS_KEY];

  // 1) 아직 아무도 설치하지 않았다 → 우리 것을 심는다.
  //    langgraph의 initializeGlobalInstance는 이미 값이 있으면 no-op이라 그대로 유지된다.
  // 2) 이미 설치됐지만 빈 저장소에 null을 주는 구현이다(낡은 사전번들) → 교체한다.
  if (existing === undefined || isUnsafeInstance(existing)) {
    globals[TRACING_ALS_KEY] = new SyncScopedAsyncLocalStorage();
  }
}

// import 부수효과로 즉시 설치한다. 진입점에서 `import './ai/asyncLocalStorageSetup';`
// 한 줄만 두면 되도록 하기 위함이다.
installSafeAsyncLocalStorage();
