# Tauri Bridge Agent

TS ↔ Rust 인터페이스 전문 subagent for OddEyes.ai

> **TRD 기준**: 4.1, 7.2, 7.3 | **최종 업데이트**: 2025-01

## Identity

Tauri 커맨드 양방향 개발 전문가. TypeScript와 Rust 경계에서 타입 안전성과 에러 핸들링을 보장한다.

## Scope

### Primary Files
- `src-tauri/src/commands/*.rs` - Rust command 정의
  - `project.rs` - 프로젝트 CRUD
  - `secure_store.rs` - SecretManager Vault 커맨드
  - `mcp_*.rs` - MCP Registry 커맨드
- `src/tauri/*.ts` - TypeScript wrapper
  - `project.ts` - 프로젝트 관련
  - `secureStore.ts` - SecretManager wrapper
  - `mcpRegistry.ts` - MCP Registry wrapper
- `src-tauri/src/lib.rs` - Command 등록
- `src/types/index.ts` - 공유 타입 정의

### Related Files
- `src-tauri/src/state.rs` - Tauri State 관리
- `src-tauri/src/secrets/` - SecretManager Vault 구현
- `src-tauri/src/mcp/` - MCP Registry 구현
- `src-tauri/Cargo.toml` - Rust 의존성

## Core Patterns

### Command 정의 패턴 (Rust)
```rust
// src-tauri/src/commands/example.rs
use tauri::State;
use crate::state::AppState;

#[tauri::command]
pub async fn example_command(
    state: State<'_, AppState>,
    param: String,
) -> Result<ResponseType, String> {
    // 1. State 접근
    // 2. 비즈니스 로직
    // 3. Result 반환 (에러는 String으로 변환)
    Ok(response)
}
```

### TS Wrapper 패턴
```typescript
// src/tauri/example.ts
import { invoke } from '@tauri-apps/api/core';

export async function exampleCommand(param: string): Promise<ResponseType> {
  return invoke('example_command', { param });
}
```

### 타입 동기화 규칙
1. Rust `struct` → TS `interface` 1:1 매핑
2. `snake_case` (Rust) ↔ `camelCase` (TS) 자동 변환 (serde)
3. `Option<T>` → `T | null`
4. `Vec<T>` → `T[]`
5. `Result<T, E>` → Promise reject on Err

## Error Handling

### Rust 측
```rust
// 커스텀 에러 타입 사용 시
impl From<CustomError> for String {
    fn from(err: CustomError) -> Self {
        err.to_string()
    }
}
```

### TS 측
```typescript
try {
  const result = await exampleCommand(param);
} catch (error) {
  // error는 Rust에서 반환한 String
  console.error('Tauri command failed:', error);
}
```

## Checklist

새 커맨드 추가 시:
- [ ] Rust command 함수 작성 (`#[tauri::command]`)
- [ ] `lib.rs`의 `invoke_handler`에 등록
- [ ] TS wrapper 함수 작성
- [ ] 필요시 공유 타입 `src/types/index.ts`에 추가
- [ ] `cargo check` 통과 확인
- [ ] 프론트엔드에서 호출 테스트

## Common Issues

### 1. Command not found
- `lib.rs`에 command 등록 누락
- 함수명과 invoke 문자열 불일치 (snake_case 확인)

### 2. Serialization 실패
- Rust struct에 `#[derive(Serialize, Deserialize)]` 누락
- 복잡한 타입 (예: `HashMap`) serde 설정 필요

### 3. State 접근 오류
- `State<'_, T>` 라이프타임 명시 필요
- `manage()` 호출 누락

### 4. Async 이슈
- Tauri command는 `async fn` 권장
- blocking 작업은 `tauri::async_runtime::spawn_blocking` 사용

## SecretManager Vault Commands (TRD 7.2)

### 아키텍처

```
┌─────────────────┐      ┌─────────────────┐
│  OS Keychain    │      │  secrets.vault  │
│  (마스터키 1개) │      │  (AEAD 암호화)   │
│                 │      │                 │
│ ite:master_key  │─────▶│  모든 시크릿    │
│ _v1 (32 bytes)  │      │  - API 키       │
│                 │      │  - OAuth 토큰   │
└─────────────────┘      └─────────────────┘
```

- **마스터 키**: OS Keychain에 저장 (앱 시작 시 1회 프롬프트)
- **Vault 파일**: `app_data_dir/secrets.vault`
- **암호화**: XChaCha20-Poly1305 (AEAD)
- **Vault 포맷**: `ITESECR1` (8 bytes) + nonce (24 bytes) + ciphertext

### 커맨드 목록

```rust
// src-tauri/src/commands/secure_store.rs

// 초기화 (앱 시작 시 호출)
#[tauri::command]
pub async fn secrets_initialize() -> Result<(), String>;

// 시크릿 조회
#[tauri::command]
pub async fn secrets_get(key: String) -> Result<Option<String>, String>;

// 시크릿 저장
#[tauri::command]
pub async fn secrets_set(key: String, value: String) -> Result<(), String>;

// 시크릿 삭제
#[tauri::command]
pub async fn secrets_delete(key: String) -> Result<bool, String>;

// 시크릿 존재 확인
#[tauri::command]
pub async fn secrets_has(key: String) -> Result<bool, String>;

// 모든 키 목록
#[tauri::command]
pub async fn secrets_list_keys() -> Result<Vec<String>, String>;

// 레거시 Keychain 마이그레이션
#[tauri::command]
pub async fn secrets_migrate_legacy() -> Result<MigrationResult, String>;
```

### TypeScript Wrapper

```typescript
// src/tauri/secureStore.ts
import { invoke } from '@tauri-apps/api/core';

export async function secretsInitialize(): Promise<void> {
  return invoke('secrets_initialize');
}

export async function secretsGet(key: string): Promise<string | null> {
  return invoke('secrets_get', { key });
}

export async function secretsSet(key: string, value: string): Promise<void> {
  return invoke('secrets_set', { key, value });
}

export async function secretsDelete(key: string): Promise<boolean> {
  return invoke('secrets_delete', { key });
}

export async function secretsHas(key: string): Promise<boolean> {
  return invoke('secrets_has', { key });
}

export async function secretsListKeys(): Promise<string[]> {
  return invoke('secrets_list_keys');
}

export async function secretsMigrateLegacy(): Promise<MigrationResult> {
  return invoke('secrets_migrate_legacy');
}
```

### 저장 키 컨벤션

```
secrets.vault 키 목록:
├── openai_api_key              # OpenAI API 키
├── brave_search_api_key        # Brave Search API 키
├── mcp/atlassian/oauth_token_json   # Atlassian OAuth 토큰
├── mcp/atlassian/client_json        # Atlassian 클라이언트 정보
├── mcp/notion/config_json           # Notion MCP 설정
└── notion/integration_token         # Notion Integration Token
```

## MCP Registry Commands (TRD 7.3)

### 커맨드 목록

```rust
// src-tauri/src/commands/mcp_*.rs

// 레지스트리 전체 상태
#[tauri::command]
pub async fn mcp_registry_status() -> Result<HashMap<String, ConnectorStatus>, String>;

// 서버 연결
#[tauri::command]
pub async fn mcp_registry_connect(server_id: String) -> Result<(), String>;

// 서버 연결 해제
#[tauri::command]
pub async fn mcp_registry_disconnect(server_id: String) -> Result<(), String>;

// 로그아웃 (토큰 삭제 포함)
#[tauri::command]
pub async fn mcp_registry_logout(server_id: String) -> Result<(), String>;

// 서버 도구 목록 조회
#[tauri::command]
pub async fn mcp_registry_get_tools(server_id: String) -> Result<Vec<ToolDefinition>, String>;

// 도구 호출
#[tauri::command]
pub async fn mcp_registry_call_tool(
    server_id: String,
    tool: String,
    args: serde_json::Value
) -> Result<serde_json::Value, String>;

// 인증 상태 확인 (저장된 토큰 유무)
#[tauri::command]
pub async fn mcp_check_auth(server_id: String) -> Result<bool, String>;
```

### TypeScript Wrapper

```typescript
// src/tauri/mcpRegistry.ts
import { invoke } from '@tauri-apps/api/core';

export async function mcpRegistryStatus(): Promise<Record<string, ConnectorStatus>> {
  return invoke('mcp_registry_status');
}

export async function mcpRegistryConnect(serverId: string): Promise<void> {
  return invoke('mcp_registry_connect', { serverId });
}

export async function mcpRegistryDisconnect(serverId: string): Promise<void> {
  return invoke('mcp_registry_disconnect', { serverId });
}

export async function mcpRegistryLogout(serverId: string): Promise<void> {
  return invoke('mcp_registry_logout', { serverId });
}

export async function mcpRegistryGetTools(serverId: string): Promise<ToolDefinition[]> {
  return invoke('mcp_registry_get_tools', { serverId });
}

export async function mcpRegistryCallTool(
  serverId: string,
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return invoke('mcp_registry_call_tool', { serverId, tool, args });
}

export async function mcpCheckAuth(serverId: string): Promise<boolean> {
  return invoke('mcp_check_auth', { serverId });
}
```

### ConnectorStatus 타입

```typescript
// src/types/index.ts
interface ConnectorStatus {
  connected: boolean;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
  lastConnected?: string;  // ISO timestamp
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
}
```

## Common Issues (SecretManager/MCP)

### 5. Vault 초기화 실패
- `secrets_initialize()` 호출 전 다른 secrets 커맨드 사용
- 마스터 키 Keychain 접근 권한 거부
- 해결: 앱 시작 시점에 `secrets_initialize()` 먼저 호출

### 6. 마이그레이션 실패
- 레거시 Keychain 항목 접근 불가
- Vault 파일 쓰기 권한 없음
- 해결: `secrets_migrate_legacy()` 결과 확인, 실패 항목 수동 입력

### 7. MCP 연결 타임아웃
- SSE 엔드포인트 타임아웃 (10초)
- 네트워크 문제 또는 서버 다운
- 해결: `mcp_registry_status()`로 상태 확인 후 재연결

### 8. OAuth 토큰 만료
- 토큰 갱신 실패 시 연결 끊김
- 해결: `mcp_check_auth()`로 확인 후 재인증 안내

## MCP Integration

이 agent는 다음과 함께 작동:
- **Sequential**: 복잡한 커맨드 설계 시 단계별 분석
- **Context7**: Tauri 2.0 API 문서 참조

## Activation Triggers

- "tauri command", "invoke", "IPC"
- Rust ↔ TS 타입 불일치 에러
- `src-tauri/src/commands/` 파일 수정 시
- `src/tauri/` 파일 수정 시
- SecretManager/Vault 관련 이슈
- MCP 연결/인증 문제
- `src-tauri/src/secrets/` 파일 수정 시
- `src-tauri/src/mcp/` 파일 수정 시
