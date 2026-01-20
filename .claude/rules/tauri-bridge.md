---
paths: ["src-tauri/src/commands/**/*", "src/tauri/**/*", "src-tauri/src/lib.rs"]
alwaysApply: false
---

# Tauri Bridge Rules

TS ↔ Rust IPC 작업 시 적용되는 규칙.

## Critical Checklist

- [ ] Rust command 작성 후 `lib.rs`의 `invoke_handler`에 등록
- [ ] TS wrapper 함수명과 Rust command 이름 일치 (snake_case)
- [ ] Rust struct에 `#[derive(Serialize, Deserialize)]` 추가
- [ ] `State<'_, T>` 라이프타임 명시

## Type Mapping

| Rust | TypeScript |
|------|------------|
| `String` | `string` |
| `Option<T>` | `T \| null` |
| `Vec<T>` | `T[]` |
| `Result<T, E>` | Promise (reject on Err) |
| `snake_case` | `camelCase` (serde 자동 변환) |

## Command Pattern

```rust
// Rust
#[tauri::command]
pub async fn example_command(
    state: State<'_, AppState>,
    param: String,
) -> Result<ResponseType, String> {
    Ok(response)
}
```

```typescript
// TypeScript
export async function exampleCommand(param: string): Promise<ResponseType> {
  return invoke('example_command', { param });
}
```

## SecretManager Vault

- 마스터 키: OS Keychain (`ite:master_key_v1`)
- Vault 파일: `app_data_dir/secrets.vault`
- 앱 시작 시 `secrets_initialize()` 먼저 호출

## Common Pitfalls

1. **Command not found**: `lib.rs` 등록 누락 또는 함수명 불일치
2. **Serialization 실패**: `#[derive(Serialize, Deserialize)]` 누락
3. **State 접근 오류**: `manage()` 호출 누락
4. **Async 이슈**: blocking 작업은 `spawn_blocking` 사용
