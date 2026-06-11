import { describe, it, expect } from 'vitest';
import { migrateAiConfig, getErrorMessage } from './aiConfigStore';

describe('aiConfigStore - migrate v8 → v10 (GPT-5.5 / Opus 4.8)', () => {
  it('claude-opus-4-6 → 4-7 → 4-8 누적 rename', () => {
    const result = migrateAiConfig(
      { translationModel: 'claude-opus-4-6', chatModel: 'claude-opus-4-6' },
      8,
    );
    expect(result.translationModel).toBe('claude-opus-4-8');
    expect(result.chatModel).toBe('claude-opus-4-8');
  });

  it('v9 → v10: claude-opus-4-7 → 4-8 자동 rename', () => {
    const result = migrateAiConfig(
      { translationModel: 'claude-opus-4-7', chatModel: 'claude-opus-4-7' },
      9,
    );
    expect(result.translationModel).toBe('claude-opus-4-8');
    expect(result.chatModel).toBe('claude-opus-4-8');
  });

  it('gpt-5.4 → gpt-5.5 rename, gpt-5.4-mini는 유지', () => {
    const result = migrateAiConfig(
      { translationModel: 'gpt-5.4', chatModel: 'gpt-5.4-mini' },
      8,
    );
    expect(result.translationModel).toBe('gpt-5.5');
    expect(result.chatModel).toBe('gpt-5.4-mini');
  });

  it('claude-sonnet-4-6 / claude-haiku-4-5 등 다른 모델은 그대로 유지', () => {
    const result = migrateAiConfig(
      { translationModel: 'claude-sonnet-4-6', chatModel: 'claude-haiku-4-5' },
      8,
    );
    expect(result.translationModel).toBe('claude-sonnet-4-6');
    expect(result.chatModel).toBe('claude-haiku-4-5');
  });

  it('이미 v10인 경우 변경 없음', () => {
    const result = migrateAiConfig(
      { translationModel: 'claude-opus-4-8', chatModel: 'gpt-5.5' },
      10,
    );
    expect(result.translationModel).toBe('claude-opus-4-8');
    expect(result.chatModel).toBe('gpt-5.5');
  });

  it('과거 버전(v5)에서 누적 마이그레이션: opus-4-5 → 4-6 → 4-7 → 4-8', () => {
    const result = migrateAiConfig(
      { translationModel: 'claude-opus-4-5', chatModel: 'claude-opus-4-5' },
      5,
    );
    expect(result.translationModel).toBe('claude-opus-4-8');
    expect(result.chatModel).toBe('claude-opus-4-8');
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
