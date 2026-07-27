import { describe, it, expect } from 'vitest';
// @ts-expect-error - 폴리필은 타입 정의가 없는 .js 모듈이다.
import { AsyncLocalStorage } from './async_hooks.js';

describe('AsyncLocalStorage 폴리필', () => {
  it('저장소가 비어 있으면 null이 아니라 undefined를 반환한다', () => {
    const als = new AsyncLocalStorage();

    // @langchain/core는 `previousValue !== undefined`로만 가드한다.
    // null을 돌려주면 가드를 통과해 null[_CONTEXT_VARIABLES_KEY]에서 터진다.
    expect(als.getStore()).toBeUndefined();
    expect(als.getStore()).not.toBeNull();
  });

  it('run 종료 후에도 undefined로 남는다', () => {
    const als = new AsyncLocalStorage();
    als.run({ a: 1 }, () => undefined);

    expect(als.getStore()).toBeUndefined();
  });

  it('중첩 run은 바깥 store를 복원한다', () => {
    const als = new AsyncLocalStorage();
    const seen: unknown[] = [];

    als.run({ level: 'outer' }, () => {
      seen.push(als.getStore());
      als.run({ level: 'inner' }, () => {
        seen.push(als.getStore());
      });
      // 안쪽 run이 끝나도 바깥 store가 살아 있어야 한다.
      seen.push(als.getStore());
    });

    expect(seen).toEqual([{ level: 'outer' }, { level: 'inner' }, { level: 'outer' }]);
    expect(als.getStore()).toBeUndefined();
  });

  it('enterWith를 제공한다 (setContextVariable이 호출한다)', () => {
    const als = new AsyncLocalStorage();
    als.enterWith({ v: 1 });

    expect(als.getStore()).toEqual({ v: 1 });
  });

  it('callback이 던져도 이전 store를 복원한다', () => {
    const als = new AsyncLocalStorage();

    als.run({ level: 'outer' }, () => {
      expect(() =>
        als.run({ level: 'inner' }, () => {
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(als.getStore()).toEqual({ level: 'outer' });
    });
  });

  it('run은 callback의 반환값을 그대로 돌려준다', () => {
    const als = new AsyncLocalStorage();
    expect(als.run({}, () => 42)).toBe(42);
  });
});
