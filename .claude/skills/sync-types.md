# /sync-types

Rust struct와 TypeScript interface 간 타입 동기화를 검증하고 생성합니다.

## Usage

```
/sync-types              # 전체 타입 동기화 검증
/sync-types --check      # 검증만 (수정 없음)
/sync-types --generate   # 누락된 TS 타입 자동 생성
/sync-types --diff       # Rust ↔ TS 차이점만 표시
```

## Scope

### Source Files (Rust)
```
src-tauri/src/
├── commands/*.rs      # Tauri command 파라미터/반환 타입
├── state.rs           # AppState 구조체
├── models/*.rs        # 데이터 모델 (있는 경우)
└── mcp/*.rs           # MCP 관련 타입
```

### Target Files (TypeScript)
```
src/
├── types/index.ts     # 공유 타입 정의
└── tauri/*.ts         # Tauri wrapper 함수
```

## Execution Steps

### 1. Rust 타입 추출
```rust
// 분석 대상 패턴
#[derive(Serialize, Deserialize)]
pub struct ProjectData {
    pub id: String,
    pub name: String,
    pub created_at: Option<i64>,
}

#[tauri::command]
pub async fn load_project(id: String) -> Result<ProjectData, String>
```

### 2. TypeScript 타입 추출
```typescript
// 분석 대상 패턴
interface ProjectData {
  id: string;
  name: string;
  createdAt: number | null;  // snake_case → camelCase 변환
}

export async function loadProject(id: string): Promise<ProjectData>
```

### 3. 매핑 검증

**자동 변환 규칙**:
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

📊 SCAN RESULTS
───────────────────────────────────────────────────────────
Rust structs found:     12
TypeScript interfaces:  10
Commands analyzed:      8

───────────────────────────────────────────────────────────

✅ SYNCHRONIZED (8)
───────────────────────────────────────────────────────────
• Project          (commands/project.rs ↔ types/index.ts)
• ChatMessage      (commands/chat.rs ↔ types/index.ts)
• GlossaryEntry    (commands/glossary.rs ↔ types/index.ts)
...

───────────────────────────────────────────────────────────

❌ MISMATCHED (2)
───────────────────────────────────────────────────────────
1. ConnectorState
   Rust (src-tauri/src/mcp/types.rs:15):
   │ pub struct ConnectorState {
   │     pub enabled: bool,
   │     pub status: String,
   │     pub last_error: Option<String>,  // ← missing in TS
   │ }

   TypeScript (src/types/index.ts:89):
   │ interface ConnectorState {
   │   enabled: boolean;
   │   status: string;
   │   // last_error 누락!
   │ }

2. Attachment
   Field type mismatch:
   │ Rust:  content: Vec<u8>
   │ TS:    content: string  // should be Uint8Array or number[]

───────────────────────────────────────────────────────────

⚠️  RUST ONLY (2) - TypeScript 정의 없음
───────────────────────────────────────────────────────────
• McpServerConfig   (src-tauri/src/mcp/config.rs:8)
• SecureStoreEntry  (src-tauri/src/commands/secure_store.rs:12)

═══════════════════════════════════════════════════════════
SUMMARY: 8 synced, 2 mismatched, 2 missing
═══════════════════════════════════════════════════════════
```

## Auto-Generation (--generate)

```typescript
// 자동 생성되는 타입 (src/types/generated.ts)

/**
 * Auto-generated from src-tauri/src/mcp/config.rs
 * DO NOT EDIT MANUALLY
 */

export interface McpServerConfig {
  serverId: string;
  command: string;
  args: string[];
  env: Record<string, string> | null;
}

export interface SecureStoreEntry {
  key: string;
  value: string;
  createdAt: number;
}
```

## Serde Attribute Handling

```rust
// Rust serde 속성 인식
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]  // → TS에서 camelCase 사용
pub struct Example {
    #[serde(rename = "customName")]  // → customName으로 매핑
    pub field_name: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub optional_field: Option<i32>,  // → optional?: number
}
```

## Integration

### With /typecheck
```
/typecheck 실행 후 타입 불일치 발견 시 자동으로 /sync-types --diff 제안
```

### With tauri-bridge agent
```
타입 수정 시 @.claude/agents/tauri-bridge.md 참조하여 양쪽 업데이트
```

## Common Issues

### 1. camelCase 변환 누락
- Rust에 `#[serde(rename_all = "camelCase")]` 추가
- 또는 TS에서 snake_case 그대로 사용

### 2. Option vs undefined
- Rust `Option<T>` → TS `T | null` (권장)
- `T | undefined` 사용 시 serde 설정 필요

### 3. 날짜/시간 타입
- Rust `i64` (Unix timestamp) → TS `number`
- Rust `chrono::DateTime` → TS `string` (ISO 8601)
