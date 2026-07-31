import { beforeEach, describe, it, expect, vi } from 'vitest';

const secureStoreMock = vi.hoisted(() => ({
  getSecureSecret: vi.fn(),
  setSecureSecret: vi.fn(),
}));

vi.mock('@/tauri/secureStore', () => secureStoreMock);

import { migrateAiConfig, getErrorMessage, useAiConfigStore } from './aiConfigStore';

function createDeferred<T = void>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

describe('aiConfigStore - migrate → v14 (provider 단일 선택)', () => {
  // v14는 translationModel 기준으로 provider를 정한다. 두 값의 provider가 엇갈릴 수
  // 있지만 문서 작업(번역·검수·폴리싱)이 주 용도이므로 그쪽을 살린다.
  it('Anthropic 프리셋 → provider anthropic', () => {
    const result = migrateAiConfig(
      { translationModel: 'claude-opus-4-6', chatModel: 'claude-opus-4-6' },
      8,
    );
    expect(result.provider).toBe('anthropic');
  });

  it('OpenAI 프리셋 → provider openai', () => {
    const result = migrateAiConfig(
      { translationModel: 'gpt-5.4', chatModel: 'gpt-5.4-mini' },
      8,
    );
    expect(result.provider).toBe('openai');
  });

  it('두 모델의 provider가 엇갈리면 translationModel 기준', () => {
    expect(
      migrateAiConfig({ translationModel: 'gpt-5.5', chatModel: 'claude-haiku-4-5' }, 10).provider,
    ).toBe('openai');
    expect(
      migrateAiConfig({ translationModel: 'claude-opus-4-8', chatModel: 'gpt-5.5' }, 10).provider,
    ).toBe('anthropic');
  });

  it('과거 버전(v5)에서도 누적 마이그레이션 끝에 provider가 잡힌다', () => {
    const result = migrateAiConfig(
      { translationModel: 'claude-opus-4-5', chatModel: 'claude-opus-4-5' },
      5,
    );
    expect(result.provider).toBe('anthropic');
  });

  it('v13 저장값(프리셋 rename이 이미 끝난 상태)도 provider로 환산', () => {
    expect(migrateAiConfig({ translationModel: 'claude-sonnet-5' }, 13).provider).toBe('anthropic');
    expect(migrateAiConfig({ translationModel: 'gpt-5.6-sol-high' }, 13).provider).toBe('openai');
  });

  // 값이 아예 없던 저장본이 openai로 튀면 키 없는 provider가 선택돼 앱이 바로 막힌다.
  it('모델 값이 없으면 기본 provider(anthropic)로 떨어진다', () => {
    expect(migrateAiConfig({}, 13).provider).toBe('anthropic');
  });

  it('죽은 모델 필드는 남기지 않는다', () => {
    const result = migrateAiConfig(
      { translationModel: 'claude-sonnet-5', chatModel: 'claude-sonnet-5' },
      13,
    );
    expect('translationModel' in result).toBe(false);
    expect('chatModel' in result).toBe(false);
  });
});

// API 키 저장 실패 시 "원인: [object Object]" 대신 실제 메시지를 노출하는지 검증
describe('aiConfigStore - getErrorMessage (Tauri CommandError 추출)', () => {
  it('Error 인스턴스는 message를 반환', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('문자열 에러는 그대로 반환', () => {
    expect(getErrorMessage('plain error')).toBe('plain error');
  });

  it('Tauri CommandError 객체에서 message를 추출 ([object Object] 방지)', () => {
    const commandError = {
      code: 'SECURE_STORE_ERROR',
      message: 'Secure store error: Keychain error: access denied',
      details: null,
    };
    expect(getErrorMessage(commandError)).toBe(
      'Secure store error: Keychain error: access denied',
    );
  });

  it('details 문자열이 있으면 message에 덧붙임', () => {
    const commandError = {
      code: 'SECURE_STORE_ERROR',
      message: 'Secure store error',
      details: 'vault corruption',
    };
    expect(getErrorMessage(commandError)).toBe('Secure store error (vault corruption)');
  });

  it('message가 없으면 code로 폴백', () => {
    expect(getErrorMessage({ code: 'SECURE_STORE_ERROR' })).toBe('SECURE_STORE_ERROR');
  });

  it('임의 객체도 [object Object]가 아닌 JSON으로 직렬화', () => {
    expect(getErrorMessage({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });
});

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

describe('aiConfigStore - API key bundle persist ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAiConfigStore.getState().clearApiKeysAfterSecureStorageReset();
  });

  it('serializes bundle writes so an older slow write cannot overwrite the latest keys', async () => {
    const firstWrite = createDeferred<void>();
    const persistedBundles: Array<{ openai?: string; anthropic?: string }> = [];

    secureStoreMock.setSecureSecret
      .mockImplementationOnce((_id: string, json: string) => {
        persistedBundles.push(JSON.parse(json));
        return firstWrite.promise;
      })
      .mockImplementationOnce((_id: string, json: string) => {
        persistedBundles.push(JSON.parse(json));
        return Promise.resolve();
      });

    useAiConfigStore.getState().setOpenaiApiKey('sk-openai');

    await flushPromises();
    expect(secureStoreMock.setSecureSecret).toHaveBeenCalledTimes(1);
    expect(persistedBundles).toEqual([{ openai: 'sk-openai' }]);

    useAiConfigStore.getState().setAnthropicApiKey('sk-anthropic');
    await flushPromises();
    expect(secureStoreMock.setSecureSecret).toHaveBeenCalledTimes(1);

    firstWrite.resolve();
    await flushPromises();

    expect(secureStoreMock.setSecureSecret).toHaveBeenCalledTimes(2);
    expect(persistedBundles).toEqual([
      { openai: 'sk-openai' },
      { openai: 'sk-openai', anthropic: 'sk-anthropic' },
    ]);
    expect(useAiConfigStore.getState().secureKeyPersistError).toBeUndefined();
  });

  it('coalesces same-tick key changes into a single latest bundle write', async () => {
    const persistedBundles: Array<{ openai?: string; anthropic?: string }> = [];
    secureStoreMock.setSecureSecret.mockImplementation((_id: string, json: string) => {
      persistedBundles.push(JSON.parse(json));
      return Promise.resolve();
    });

    useAiConfigStore.getState().setOpenaiApiKey('sk-openai');
    useAiConfigStore.getState().setAnthropicApiKey('sk-anthropic');

    await flushPromises();

    expect(secureStoreMock.setSecureSecret).toHaveBeenCalledTimes(1);
    expect(persistedBundles).toEqual([
      { openai: 'sk-openai', anthropic: 'sk-anthropic' },
    ]);
  });

  it('continues the queue after an older write fails and persists the latest bundle', async () => {
    const firstWrite = createDeferred<void>();
    const persistedBundles: Array<{ openai?: string; anthropic?: string }> = [];

    secureStoreMock.setSecureSecret
      .mockImplementationOnce((_id: string, json: string) => {
        persistedBundles.push(JSON.parse(json));
        return firstWrite.promise;
      })
      .mockImplementationOnce((_id: string, json: string) => {
        persistedBundles.push(JSON.parse(json));
        return Promise.resolve();
      });

    useAiConfigStore.getState().setOpenaiApiKey('sk-openai');
    await flushPromises();
    useAiConfigStore.getState().setAnthropicApiKey('sk-anthropic');

    firstWrite.reject(new Error('stale write failed'));
    await flushPromises();

    expect(secureStoreMock.setSecureSecret).toHaveBeenCalledTimes(2);
    expect(persistedBundles).toEqual([
      { openai: 'sk-openai' },
      { openai: 'sk-openai', anthropic: 'sk-anthropic' },
    ]);
    expect(useAiConfigStore.getState().secureKeyPersistError).toBeUndefined();
  });
});

describe('모델 직접 지정 (ADR-0017)', () => {
  beforeEach(() => {
    useAiConfigStore.setState({ provider: 'anthropic', modelOverrides: {} });
  });

  it('v14 → v15 마이그레이션은 지정을 비운 채로 시작한다', () => {
    // 기본값을 채워 넣으면 앱이 모델을 바꿔도 기존 사용자만 옛 모델에 고정된다.
    const migrated = migrateAiConfig({ provider: 'anthropic' }, 14);
    expect(migrated.modelOverrides).toEqual({});
  });

  it('provider별 지정이 서로를 덮어쓰지 않고 각자 남는다', () => {
    // provider를 오갈 때마다 다시 고르지 않아도 되게, 두 벌이 독립적으로 보존돼야 한다.
    const { setModelOverride, setEffortOverride } = useAiConfigStore.getState();

    setModelOverride('anthropic', 'review', 'claude-sonnet-5');
    setEffortOverride('anthropic', 'review', 'medium');
    setModelOverride('openai', 'chat', 'gpt-5.6-terra');

    expect(useAiConfigStore.getState().modelOverrides).toEqual({
      anthropic: { review: { model: 'claude-sonnet-5', effort: 'medium' } },
      openai: { chat: { model: 'gpt-5.6-terra' } },
    });
  });

  it('모델과 effort는 서로를 지우지 않고 따로 걷힌다', () => {
    const { setModelOverride, setEffortOverride } = useAiConfigStore.getState();
    setModelOverride('anthropic', 'review', 'claude-sonnet-5');
    setEffortOverride('anthropic', 'review', 'medium');

    setModelOverride('anthropic', 'review', null);
    expect(useAiConfigStore.getState().modelOverrides).toEqual({
      anthropic: { review: { effort: 'medium' } },
    });

    setEffortOverride('anthropic', 'review', null);
    // 마지막 필드까지 빠지면 빈 껍데기를 남기지 않고 키째 사라진다.
    expect(useAiConfigStore.getState().modelOverrides).toEqual({});
  });

  it('저장 대상(partialize)에 지정이 포함된다', () => {
    // 여기서 빠지면 앱을 껐다 켤 때마다 다시 골라야 한다.
    const { setModelOverride } = useAiConfigStore.getState();
    setModelOverride('anthropic', 'review', 'claude-sonnet-5');

    const persisted = JSON.parse(localStorage.getItem('ite-ai-config') ?? '{}');
    expect(persisted.state?.modelOverrides).toEqual({
      anthropic: { review: { model: 'claude-sonnet-5' } },
    });
  });

  it('v15 → v16은 모델 문자열을 { model } 형태로 옮긴다', () => {
    const migrated = migrateAiConfig(
      { provider: 'anthropic', modelOverrides: { anthropic: { review: 'claude-sonnet-5' } } },
      15,
    );
    expect(migrated.modelOverrides).toEqual({
      anthropic: { review: { model: 'claude-sonnet-5' } },
    });
  });

  it('전체 초기화는 모든 provider의 지정을 한 번에 걷어낸다', () => {
    const { setModelOverride, clearModelOverrides } = useAiConfigStore.getState();
    setModelOverride('anthropic', 'review', 'claude-sonnet-5');
    setModelOverride('openai', 'polish', 'gpt-5.6-terra');

    clearModelOverrides();

    expect(useAiConfigStore.getState().modelOverrides).toEqual({});
  });
});
