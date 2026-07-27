/**
 * 브라우저/WebView용 `node:async_hooks` 최소 폴리필.
 *
 * WebView에는 AsyncLocalStorage가 없다. `@langchain/langgraph`는 import 시점에
 * 이 클래스의 인스턴스를 전역 tracing 저장소로 설치하므로(setup/async_local_storage.js),
 * 여기 동작이 LangGraph 실행 전체에 영향을 준다.
 *
 * ## 반드시 지켜야 할 계약
 *
 * **저장소가 비어 있으면 `undefined`를 반환한다. `null`을 돌려주면 안 된다.**
 * `@langchain/core`의 `runWithConfig`는 이렇게 가드한다:
 *
 * ```js
 * if (previousValue !== undefined && previousValue[_CONTEXT_VARIABLES_KEY] !== undefined)
 * ```
 *
 * `null !== undefined`는 true라서 가드를 통과하고, 곧바로
 * `null is not an object (evaluating 'previousValue[_CONTEXT_VARIABLES_KEY]')`로 터진다.
 * LangGraph는 노드를 실행할 때마다 `runWithConfig`를 타므로 채팅이 한 번도 안 된다.
 *
 * ## 한계 (의도된 degraded 동작)
 *
 * 진짜 async context 추적은 폴리필로 불가능하다. store는 **동기 구간에서만** 유효하고
 * await 이후에는 비어 있는 것으로 보인다. 이는 LangChain이 ALS를 못 찾았을 때 쓰는
 * `MockAsyncLocalStorage`와 같은 수준이며 공식적으로 지원되는 경로다.
 * 이 앱은 async context에 의존하는 기능(`interrupt()`, custom stream writer)을 쓰지 않는다.
 */
export class AsyncLocalStorage {
  constructor() {
    // 비어 있음은 undefined로 표현한다 (위 계약 참고).
    this._store = undefined;
  }

  run(store, callback, ...args) {
    // 중첩 run에서 바깥 store를 되살린다.
    // 이전 구현처럼 finally에서 무조건 비우면 바깥 run의 store가 사라진다.
    const previous = this._store;
    this._store = store;
    try {
      return callback(...args);
    } finally {
      this._store = previous;
    }
  }

  getStore() {
    return this._store;
  }

  /** `setContextVariable()`이 호출한다. 없으면 TypeError가 난다. */
  enterWith(store) {
    this._store = store;
  }

  exit(callback, ...args) {
    const previous = this._store;
    this._store = undefined;
    try {
      return callback(...args);
    } finally {
      this._store = previous;
    }
  }

  disable() {
    this._store = undefined;
  }
}

export default {
  AsyncLocalStorage,
};
