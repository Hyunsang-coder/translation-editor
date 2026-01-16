# 11. AI Provider 및 API Key 관리

## 11.1 Provider 지원 현황

### Why
- 구조 단순화 및 OpenAI 내장 도구(web_search_preview 등) 활용을 위해 단일 Provider로 통일합니다.
- Anthropic/Google 등 멀티 Provider 지원은 코드 복잡도를 높이고, 각 Provider별 도구 호환성 문제를 야기합니다.

### What
- **OpenAI**: 유일한 활성 Provider (Responses API 사용)
- **Anthropic/Google**: 코드에서 제거 (향후 필요 시 재도입 가능)
- **Mock**: 번역 모드에서 제거됨. mock 설정 시 에러 발생하며 OpenAI API 키 설정 안내

---

## 11.2 API Key 관리 (SecretManager/Vault 아키텍처)

### Why
- 사용자가 App Settings에서 직접 API Key를 입력할 수 있어야 합니다.
- macOS 등에서 앱 실행 시마다 키체인 접근 권한을 묻는 횟수를 최소화(1회)해야 합니다.
- `.ite` export 파일에 시크릿이 절대 포함되지 않도록 보장해야 합니다.

### How (Master Key + Encrypted Vault 아키텍처)
- **Keychain에는 마스터키 1개만 저장**: `ite:master_key_v1` (32 bytes, Base64)
- 모든 시크릿(API 키, OAuth 토큰, 커넥터 토큰 등)은 `app_data_dir/secrets.vault` 파일에 **AEAD(XChaCha20-Poly1305)로 암호화**하여 저장
- 앱 시작 시 SecretManager가:
  1. Keychain에서 마스터키를 1회 로드 (프롬프트 1회)
  2. `secrets.vault`를 복호화하여 메모리 캐시로 보관
  3. 이후 모든 시크릿 읽기/쓰기는 **메모리 + 로컬 파일 업데이트**만 수행 (Keychain 추가 접근 없음)
- 프론트는 secrets 명령(`secrets_get`, `secrets_set` 등)을 통해 저장/조회, localStorage에는 저장하지 않음

### 초기화 동시성 처리
- 동시 초기화 호출 시 첫 번째 초기화 완료까지 대기 (최대 60초)
- 타임아웃 시 상태를 `NotInitialized`로 리셋하여 재시도 가능
- Vault 복호화 실패 시 에러 반환 (기존 토큰 보호)

### What

#### 저장 위치
- **마스터키**: OS 키체인/키링 (서비스: `com.ite.app`, 키: `ite:master_key_v1`)
- **시크릿**: `app_data_dir/secrets.vault` (AEAD 암호화)

#### Vault 파일 포맷 (v1)
- `ITESECR1` (8 bytes magic) + nonce (24 bytes) + ciphertext

#### 시크릿 키 네이밍
- namespace/key 형식 (예: `ai/openai_api_key`, `ai/brave_api_key`)

#### 우선순위
- vault 저장값만 사용 (환경 변수 또는 localStorage 폴백 없음)

#### 보안
- localStorage/DB(`ite.db`)에 저장하지 않음
- `.ite` export는 DB 파일만 포함하므로 시크릿이 절대 포함되지 않음
- 마스터키 메모리에서 `zeroize`로 drop 시 안전하게 삭제
- 토큰/시크릿은 로그에 출력하지 않음 (`[REDACTED]`로 마스킹)
- Vault 복호화 실패 시 에러 반환하여 기존 토큰 보호 (덮어쓰기 방지)

#### UI
- App Settings에서 API Key 입력 필드 제공, Clear 버튼으로 삭제 가능

#### Rust 모듈
- `src-tauri/src/secrets/` (mod.rs, vault.rs, manager.rs)

#### Tauri 명령
- `secrets_initialize`, `secrets_get`, `secrets_set`, `secrets_delete`, `secrets_has`, `secrets_list_keys`, `secrets_migrate_legacy`

#### 에러 처리
- 초기화 실패 시 `PreviousInitFailed` 전용 에러 타입 사용
- Vault 복호화 실패 시 `VaultDecryptFailed` 에러 반환
- 키체인 저장 실패 시 `Failed` 상태로 전환하여 무한 대기 방지

### API Key 필드 목록

| 필드 | 필수 여부 | 용도 |
|------|-----------|------|
| OpenAI API Key | **필수** | 모든 AI 기능 (번역, 채팅, 웹검색) |
| Brave Search API Key | 선택 (Optional) | 웹검색 폴백용 (OpenAI web_search_preview 실패 시) |

- Brave API Key가 없어도 기본 웹검색(OpenAI 내장)은 정상 동작합니다.
- Brave API Key가 입력된 경우, OpenAI 웹검색 실패 시 Brave Search로 폴백합니다.

---

## 11.3 External Connectors (MCP/OAuth)

### Why
- 번역 작업 시 외부 참조 문서(Confluence, Google Docs 등)에 접근해야 하는 경우가 많습니다.
- 각 커넥터는 OAuth 기반 인증을 사용하며, App Settings에서 통합 관리합니다.

### How
- 모든 커넥터는 **OAuth 2.1 PKCE** 기반으로 인증합니다 (Notion은 Integration Token 사용).
- OAuth 토큰은 **SecretManager Vault에 영속화**되어 앱 재시작 후에도 재인증 없이 사용 가능합니다.
- 커넥터 연결/해제는 App Settings에서 관리하며, 각 커넥터별로 연결 상태를 표시합니다.
- **Lazy OAuth**: 토글 ON은 "도구 사용 허용"만 의미하며, 실제 사용 시점에 연결이 없으면 CTA를 표시합니다.
- **토큰 자동 갱신**: OAuth 토큰 만료 5분 전부터 `refresh_token`으로 자동 갱신 시도

### 지원 커넥터

| 커넥터 | 타입 | 상태 | 인증 방식 | 용도 |
|--------|------|------|-----------|------|
| Atlassian Confluence | MCP (Rovo) | 구현됨 | OAuth 2.1 PKCE | Confluence 문서 검색/참조 |
| Notion | REST API | 구현됨 | Integration Token | Notion 문서 검색/참조 |
| Google Drive | OpenAI Builtin | 준비 중 | OAuth 2.0 | Google Drive 파일 검색/접근 |
| Gmail | OpenAI Builtin | 준비 중 | OAuth 2.0 | Gmail 이메일 검색/읽기 |

### 커넥터 토큰 영속화
- **Atlassian**: OAuth 토큰이 vault에 저장되어 앱 재시작 시 자동 재연결
- **Notion**: Integration Token이 vault에 저장되어 앱 재시작 시 자동 재연결
- **연결 해제**: App Settings에서 "연결 해제" 시 토큰은 유지, 연결만 해제 (재연결 시 기존 토큰 재사용 가능)
- **로그아웃**: 명시적 로그아웃 시에만 토큰 삭제

### MCP 레지스트리
- **McpRegistry**: 다중 MCP 서버를 통합 관리하는 Rust 모듈 (`src-tauri/src/mcp/registry.rs`)
- **지원 서버**: Atlassian (구현됨), Notion (구현됨)
- **Tauri 명령**: `mcp_registry_status`, `mcp_registry_connect`, `mcp_registry_disconnect`, `mcp_registry_logout`, `mcp_registry_get_tools`, `mcp_registry_call_tool`
- **TypeScript 래퍼**: `src/tauri/mcpRegistry.ts`

### OAuth 토큰 관리 (SecretManager Vault)

#### 저장 위치
- `app_data_dir/secrets.vault` (마스터키로 암호화)

#### 키 패턴
- `mcp/<provider>/oauth_token_json`, `mcp/<provider>/client_json`, `connector/<id>/token_json`

#### 예시 키
- `mcp/atlassian/oauth_token_json`: Atlassian MCP OAuth 토큰
- `mcp/atlassian/client_json`: Atlassian 등록된 클라이언트 정보
- `mcp/notion/config_json`: Notion MCP 설정
- `notion/integration_token`: Notion Integration Token
- `connector/google/token_json`: Google 커넥터 토큰

#### 토큰 갱신
- 만료 5분 전부터 자동 갱신 시도, 실패 시 재인증 CTA 표시

#### 로그아웃
- App Settings에서 개별 커넥터 연결 해제 가능 (토큰은 유지, 연결만 해제)

#### 마이그레이션
- Settings → Security에서 "기존 Keychain 로그인 정보 가져오기" 버튼으로 레거시 키체인 엔트리를 vault로 이전

### OAuth 콜백 서버 (리소스 관리)

#### 포트
- `localhost:23456` (고정)

#### 자동 종료 조건
- `/callback` 성공 시 즉시 종료
- 브라우저 열기(`open::that`) 실패 시 즉시 종료
- 인증 타임아웃(5분) 시 즉시 종료
- 서버 자체 타임아웃(6분) 시 자동 종료

#### shutdown signal
- `tokio::select!`로 shutdown signal과 accept를 동시 대기하여 즉시 종료 보장

#### 재시도 보호
- 종료되지 않은 서버가 포트를 점유하는 것을 방지하여 즉시 재시도 가능

### UI 구조 (App Settings)

```
App Settings
├── API Keys
│   ├── OpenAI API Key (필수)
│   └── Brave Search API Key (선택)
│
├── Connectors (구현됨: ConnectorsSection.tsx)
│   ├── Atlassian Confluence (MCP)
│   │   ├── 연결 상태: [연결됨 ✓] / [연결 안 됨]
│   │   ├── [연결] / [연결 해제] 버튼
│   │   └── "채팅에서 이 서비스 사용" 토글
│   ├── Notion (MCP)
│   │   ├── 연결 상태: [연결됨 ✓] / [연결 안 됨]
│   │   ├── [연결] / [연결 해제] 버튼
│   │   └── "채팅에서 이 서비스 사용" 토글
│   ├── Google Drive (OpenAI Builtin)
│   │   └── 준비 중 (Coming Soon)
│   └── Gmail (OpenAI Builtin)
│       └── 준비 중 (Coming Soon)
│
└── (기존 설정들...)
```

### 채팅 탭별 토글
- 각 커넥터는 **채팅 입력창의 토글**로 개별 활성화/비활성화할 수 있습니다.
- 토글이 OFF인 경우 해당 커넥터의 도구는 모델에 바인딩되지 않습니다 (게이트 원칙).
- 커넥터가 App Settings에서 "연결 안 됨" 상태이면 토글은 비활성화(disabled)됩니다.
