---
name: tdd
description: TDD 워크플로우 실행. 테스트 먼저 작성 → 실패 확인 → 구현 → 통과 확인 순서를 자동화합니다.
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - TodoWrite
---

# /tdd

Test-Driven Development 워크플로우를 지원합니다.

## Usage

```
/tdd                    # TDD 모드 시작 (대화형)
/tdd run                # 전체 테스트 실행
/tdd watch              # 테스트 감시 모드
/tdd coverage           # 커버리지 리포트
/tdd <file>             # 특정 파일 테스트
/tdd new <name>         # 새 테스트 파일 생성
```

## TDD Workflow

### Red-Green-Refactor 사이클

1. **🔴 Red**: 실패하는 테스트 먼저 작성
2. **🟢 Green**: 테스트를 통과하는 최소한의 코드 구현
3. **🔵 Refactor**: 코드 개선 (테스트는 계속 통과해야 함)

## Execution Commands

### 전체 테스트 실행
```bash
npm run test:run
```

### 감시 모드 (개발 중 권장)
```bash
npm run test:watch
```

### 특정 파일만 테스트
```bash
npx vitest run <pattern>
```

### UI 모드
```bash
npm run test:ui
```

### 커버리지
```bash
npm run test:coverage
```

## Test File Convention

- 파일명: `*.test.ts` 또는 `*.spec.ts`
- 위치: 테스트 대상과 같은 디렉토리 (co-location)
- 예: `src/utils/hash.ts` → `src/utils/hash.test.ts`

## Test Structure Template

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ModuleName', () => {
  // 셋업
  beforeEach(() => {
    // 각 테스트 전 초기화
  });

  afterEach(() => {
    // 각 테스트 후 정리
  });

  describe('functionName', () => {
    it('정상 케이스를 처리한다', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = functionName(input);

      // Assert
      expect(result).toBe('expected');
    });

    it('에러 케이스를 처리한다', () => {
      expect(() => functionName(null)).toThrow();
    });
  });
});
```

## Output Format

```
═══════════════════════════════════════════════════════════
                      TDD TEST RESULTS
═══════════════════════════════════════════════════════════

📊 SUMMARY
───────────────────────────────────────────────────────────
Tests:  ✅ 10 passed | ❌ 2 failed | ⏭️ 1 skipped
Files:  5 test files
Time:   1.23s

🔴 FAILED TESTS
───────────────────────────────────────────────────────────
❌ src/utils/hash.test.ts > hashContent > 빈 문자열 처리
   Expected: ""
   Received: null

💡 NEXT STEPS
───────────────────────────────────────────────────────────
1. 실패한 테스트 수정
2. `npm run test:watch`로 자동 재실행

═══════════════════════════════════════════════════════════
```

## Mocking Guide

### Tauri API 모킹
```typescript
import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue('mocked result'),
}));
```

### Zustand Store 모킹
```typescript
import { useProjectStore } from '@stores/projectStore';

vi.mock('@stores/projectStore', () => ({
  useProjectStore: vi.fn(() => ({
    project: mockProject,
    setProject: vi.fn(),
  })),
}));
```

### 타이머 모킹
```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});
```

## Coverage Targets

| 영역 | 목표 |
|------|------|
| Utilities (`src/utils/`) | 80%+ |
| AI Logic (`src/ai/`) | 70%+ |
| Stores (`src/stores/`) | 60%+ |
| Components | 선택적 |

## TDD Tips

1. **작은 단위로 시작**: 하나의 함수/동작에 집중
2. **명확한 테스트명**: 한글로 "무엇을 한다" 형식
3. **AAA 패턴**: Arrange-Act-Assert 구조 유지
4. **경계값 테스트**: 빈 값, null, 최대값 등
5. **독립적 테스트**: 테스트 간 의존성 없이

## Related Skills

- `/typecheck` - 타입 체크와 함께 사용
- `/sync-types` - Rust ↔ TS 타입 동기화 확인
