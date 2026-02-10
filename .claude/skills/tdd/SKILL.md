---
name: tdd
description: TDD 워크플로우 실행. 테스트 먼저 작성 → 실패 확인 → 구현 → 통과 확인 순서를 자동화합니다. 새 기능 구현 또는 버그 수정 시 사용.
argument-hint: "[run|watch|coverage|new <name>|<file>]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
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

## Mocking & Tips

모킹 패턴, 커버리지 목표, TDD 팁은 `.claude/testing.md` 참조.

## Related Skills

- `/typecheck` - 타입 체크와 함께 사용
- `/sync-types` - Rust ↔ TS 타입 동기화 확인
