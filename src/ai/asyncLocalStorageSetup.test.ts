import { describe, it, expect, beforeEach } from 'vitest';
import { installSafeAsyncLocalStorage } from './asyncLocalStorageSetup';

const TRACING_ALS_KEY = Symbol.for('ls:tracing_async_local_storage');

type Slot = Record<symbol, { getStore(): unknown; run<T>(s: unknown, cb: () => T): T } | undefined>;
const globals = globalThis as unknown as Slot;

describe('installSafeAsyncLocalStorage', () => {
  beforeEach(() => {
    delete globals[TRACING_ALS_KEY];
  });

  it('설치된 것이 없으면 안전한 구현을 심는다', () => {
    installSafeAsyncLocalStorage();

    const instance = globals[TRACING_ALS_KEY]!;
    expect(instance).toBeDefined();
    // 크래시의 직접 원인: 빈 저장소가 null이면 안 된다.
    expect(instance.getStore()).toBeUndefined();
  });

  it('빈 저장소에 null을 주는 구현(낡은 사전번들)은 교체한다', () => {
    // vite dep 캐시에 남아 있던 옛 폴리필과 동일한 동작.
    const broken = {
      store: null as unknown,
      getStore() {
        return this.store;
      },
      run<T>(s: unknown, cb: () => T): T {
        this.store = s;
        try {
          return cb();
        } finally {
          this.store = null;
        }
      },
    };
    globals[TRACING_ALS_KEY] = broken;

    installSafeAsyncLocalStorage();

    expect(globals[TRACING_ALS_KEY]).not.toBe(broken);
    expect(globals[TRACING_ALS_KEY]!.getStore()).toBeUndefined();
  });

  it('이미 정상 구현이 있으면 건드리지 않는다', () => {
    const healthy = {
      getStore: () => undefined,
      run: <T,>(_s: unknown, cb: () => T) => cb(),
    };
    globals[TRACING_ALS_KEY] = healthy;

    installSafeAsyncLocalStorage();

    // Node의 진짜 AsyncLocalStorage를 덮어쓰면 async context 추적을 잃는다.
    expect(globals[TRACING_ALS_KEY]).toBe(healthy);
  });

  it('심어진 구현은 중첩 run에서 바깥 store를 복원한다', () => {
    installSafeAsyncLocalStorage();
    const als = globals[TRACING_ALS_KEY]!;
    const seen: unknown[] = [];

    als.run({ level: 'outer' }, () => {
      als.run({ level: 'inner' }, () => undefined);
      seen.push(als.getStore());
    });

    expect(seen).toEqual([{ level: 'outer' }]);
    expect(als.getStore()).toBeUndefined();
  });
});
