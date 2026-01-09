# /typecheck

Rust + TypeScript 타입 체크를 동시에 실행하여 양쪽 타입 오류를 한번에 확인합니다.

## Usage

```
/typecheck           # 전체 타입 체크 (Rust + TS)
/typecheck --rust    # Rust만
/typecheck --ts      # TypeScript만
/typecheck --fix     # 가능한 오류 자동 수정 제안
```

## Execution Steps

### 1. Rust Type Check
```bash
cd src-tauri && cargo check 2>&1
```

**체크 항목**:
- Compilation errors
- Type mismatches
- Lifetime issues
- Unused imports/variables (warnings)

### 2. TypeScript Type Check
```bash
npx tsc --noEmit 2>&1
```

**체크 항목**:
- Type errors
- Missing imports
- Interface mismatches
- Strict null checks

### 3. Cross-boundary Validation
Tauri command 경계에서 타입 일관성 검증:
- `src-tauri/src/commands/*.rs` 의 반환 타입
- `src/tauri/*.ts` 의 invoke 호출 타입
- `src/types/index.ts` 공유 타입 정의

## Output Format

```
═══════════════════════════════════════════════════════════
                    TYPE CHECK RESULTS
═══════════════════════════════════════════════════════════

🦀 RUST (cargo check)
───────────────────────────────────────────────────────────
✅ No errors

⚠️  Warnings (2):
   src-tauri/src/commands/project.rs:45
   └─ unused variable: `temp`

   src-tauri/src/mcp/manager.rs:123
   └─ unused import: `std::collections::HashMap`

───────────────────────────────────────────────────────────

📘 TYPESCRIPT (tsc --noEmit)
───────────────────────────────────────────────────────────
❌ Errors (1):
   src/tauri/project.ts:28:5
   └─ Type 'string | null' is not assignable to type 'string'

⚠️  Warnings (0)

───────────────────────────────────────────────────────────

🔗 CROSS-BOUNDARY CHECK
───────────────────────────────────────────────────────────
⚠️  Potential mismatch:
   Rust: load_project returns Result<Project, String>
   TS:   loadProject(): Promise<Project>
   └─ Error handling may be inconsistent

═══════════════════════════════════════════════════════════
SUMMARY: 1 error, 3 warnings
═══════════════════════════════════════════════════════════
```

## Error Categories

### Critical (Must Fix)
- Rust compilation errors
- TypeScript type errors
- Cross-boundary type mismatches

### Warnings (Should Review)
- Unused variables/imports
- Deprecated API usage
- Implicit any types

## Integration with Agents

이 스킬은 다음 agent와 연계됩니다:
- **tauri-bridge**: 타입 불일치 발견 시 수정 가이드
- **store-sync**: Store 타입 오류 시 패턴 제안

## Auto-fix Suggestions

`--fix` 플래그 사용 시:
```
💡 Suggested fixes:

1. src/tauri/project.ts:28
   - const result = await invoke<string>('load_project', { id });
   + const result = await invoke<string | null>('load_project', { id });

2. src-tauri/src/commands/project.rs:45
   - let temp = calculate();
   + let _temp = calculate();  // or remove if unused
```

## Common Patterns

### Rust → TS 타입 매핑
| Rust | TypeScript |
|------|------------|
| `String` | `string` |
| `i32`, `i64` | `number` |
| `bool` | `boolean` |
| `Option<T>` | `T \| null` |
| `Vec<T>` | `T[]` |
| `HashMap<K,V>` | `Record<K,V>` |
| `Result<T,E>` | `Promise<T>` (reject on Err) |
