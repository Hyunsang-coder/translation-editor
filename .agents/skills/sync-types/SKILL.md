---
name: sync-types
description: Rust struct와 TypeScript interface 간 타입 동기화 검증. 불일치 감지 및 자동 생성 지원. Tauri command 수정 후 또는 타입 오류 발생 시 사용.
argument-hint: "[--check|--generate|--diff]"
allowed-tools:
  - Bash
  - Read
  - Grep
  - Write
---

# /sync-types

Rust struct와 TypeScript interface 간 타입 동기화를 검증합니다.

## Usage

```
/sync-types              # 전체 타입 동기화 검증
/sync-types --check      # 검증만 (수정 없음)
/sync-types --generate   # 누락된 TS 타입 자동 생성
/sync-types --diff       # Rust ↔ TS 차이점만 표시
```

## Scope

### Source (Rust)
```
src-tauri/src/
├── commands/*.rs      # Tauri command 파라미터/반환 타입
├── state.rs           # AppState 구조체
└── mcp/*.rs           # MCP 관련 타입
```

### Target (TypeScript)
```
src/
├── types/index.ts     # 공유 타입 정의
└── tauri/*.ts         # Tauri wrapper 함수
```

## Type Mapping Rules

- `snake_case` (Rust) → `camelCase` (TS) - serde rename 고려
- `Option<T>` → `T | null`
- `Vec<T>` → `T[]`
- `HashMap<K, V>` → `Record<K, V>`
- `Result<T, E>` → `Promise<T>` (에러는 reject)

## Output Format

```
═══════════════════════════════════════════════════════════
                    TYPE SYNC ANALYSIS
═══════════════════════════════════════════════════════════

✅ SYNCHRONIZED (N)
❌ MISMATCHED (N) - 상세 정보 포함
⚠️  RUST ONLY (N) - TypeScript 정의 없음

═══════════════════════════════════════════════════════════
```

## Serde Attribute Handling

```rust
#[serde(rename_all = "camelCase")]  // → TS에서 camelCase 사용
#[serde(rename = "customName")]     // → customName으로 매핑
#[serde(skip_serializing_if = "Option::is_none")]  // → optional?
```
