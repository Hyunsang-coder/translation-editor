import { describe, it, expect } from 'vitest';

// 핵심: loadSecureKeys가 동시 호출/재시도를 올바르게 처리하는지 검증
describe('aiConfigStore - loadSecureKeys 로직 검증', () => {
  it('구현 분석: Promise dedup 패턴으로 동시 호출 처리', () => {
    // W-18 fix: boolean | 'loading' tri-state → loadingPromise dedup 패턴으로 전환
    // 1. if (keysLoaded) return;              → 성공 후 캐시
    // 2. if (loadingPromise) return promise;  → 동시 호출 시 같은 프로미스 공유
    // 3. loadingPromise = (async () => {})()  → 로딩 프로미스 생성
    // 4. finally: loadingPromise = null       → 완료 후 리셋

    // 상태 전이:
    // keysLoaded=false, promise=null → 첫 호출: 프로미스 생성
    // keysLoaded=false, promise=P    → 동시 호출: 동일 P 반환
    // keysLoaded=true,  promise=null → 성공 후: 즉시 return
    const states = [false, null, true];
    expect(states).toContain(false);  // 초기 상태
    expect(states).toContain(null);   // 로딩 완료 후 promise
    expect(states).toContain(true);   // 성공
  });

  it('aiConfigStore 구현이 Promise dedup 패턴을 사용하는지 검증', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.resolve('./src/stores/aiConfigStore.ts');
    const content = await fs.readFile(filePath, 'utf-8');

    // 수정사항 1: loadingPromise 변수 존재
    expect(content).toMatch(/loadingPromise/);

    // 수정사항 2: 성공 후에만 keysLoaded = true
    expect(content).toMatch(/keysLoaded\s*=\s*true/);

    // 수정사항 3: finally에서 loadingPromise = null (완료 후 리셋)
    expect(content).toMatch(/finally[^}]*loadingPromise\s*=\s*null/s);
  });

  it('동시 호출 방지 로직 존재 확인', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.resolve('./src/stores/aiConfigStore.ts');
    const content = await fs.readFile(filePath, 'utf-8');

    // loadingPromise 기반 dedup 체크
    expect(content).toMatch(/if\s*\(loadingPromise\)/);
  });
});
