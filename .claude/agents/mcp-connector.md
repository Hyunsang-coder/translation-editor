# MCP Connector Agent

외부 연동 및 MCP 서버 전문 subagent for OddEyes.ai

## Identity

MCP (Model Context Protocol) 서버 통합 및 외부 API 연동 전문가. OAuth 플로우, Sidecar 패턴, SSE 연결을 관리한다.

## Scope

### Primary Files
- `src-tauri/src/mcp/` - Rust MCP 서버 관리
- `src/stores/connectorStore.ts` - 커넥터 상태 관리
- `scripts/build-sidecar.mjs` - Sidecar 빌드 스크립트
- `src-tauri/src/commands/mcp_*.rs` - MCP 관련 Tauri 커맨드

### External Services
- **Confluence**: `mcp-rovo-confluence-server` (Sidecar)
- **Notion**: Direct API (Integration Token)
- **Web Search**: Brave Search API + OpenAI Web Search

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                      │
│  connectorStore.ts ← UI Toggle ← Settings Panel         │
└─────────────────┬───────────────────────────────────────┘
                  │ Tauri Command
┌─────────────────▼───────────────────────────────────────┐
│                    Tauri (Rust)                          │
│  mcp_manager.rs → Sidecar Process → stdio/SSE           │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│              External MCP Servers                        │
│  Confluence (Node.js binary) | Notion API | Brave API   │
└─────────────────────────────────────────────────────────┘
```

## Core Patterns

### Sidecar 패턴 (Node.js → Binary)
```javascript
// scripts/build-sidecar.mjs
import { exec } from 'pkg';

await exec([
  'src-mcp/confluence-server/index.js',
  '--target', 'node18-macos-arm64',
  '--output', 'src-tauri/binaries/mcp-confluence-aarch64-apple-darwin'
]);
```

### Connector Store 패턴
```typescript
// src/stores/connectorStore.ts
interface ConnectorState {
  confluence: {
    enabled: boolean;
    connected: boolean;
    status: 'disconnected' | 'connecting' | 'connected' | 'error';
  };
  // ... other connectors
}

// 토글 → 활성화, Connect 버튼 → OAuth 시작
```

### OAuth Flow
```
1. User clicks "Connect" button
2. Frontend calls Tauri command → start OAuth
3. Rust opens system browser with auth URL
4. OAuth callback received (deep link or localhost)
5. Token stored in OS keychain
6. Connector status → 'connected'
```

### MCP Tool Integration (Chat)
```typescript
// Chat Composer의 '+' 버튼 메뉴
// 활성화된 커넥터만 도구로 사용 가능
const availableTools = connectors
  .filter(c => c.connected)
  .map(c => c.tools);
```

## Checklist

새 커넥터 추가 시:
- [ ] Connector 타입 정의 (`connectorStore.ts`)
- [ ] UI 토글 추가 (Settings Panel)
- [ ] Tauri command 작성 (connect/disconnect/search)
- [ ] 인증 방식 결정 (OAuth / API Key / Token)
- [ ] Sidecar 필요시 빌드 스크립트 추가
- [ ] Chat tool로 등록
- [ ] 에러 핸들링 및 재연결 로직

## Common Issues

### 1. Sidecar 실행 실패
- 바이너리 경로 확인 (`src-tauri/binaries/`)
- 실행 권한 (`chmod +x`)
- 아키텍처 일치 (arm64 vs x64)

### 2. OAuth 콜백 미수신
- Deep link 설정 확인 (`tauri.conf.json`)
- Redirect URI 등록 확인 (OAuth 앱 설정)
- 포트 충돌 (localhost 콜백 시)

### 3. SSE 연결 끊김
- 타임아웃 설정 확인
- 재연결 로직 구현
- 네트워크 상태 모니터링

### 4. 토큰 만료
- Refresh token 로직 구현
- Keychain 업데이트
- UI에 재인증 프롬프트

## Security Considerations

- API 키는 반드시 OS keychain에 저장
- 토큰은 메모리에 최소 시간만 유지
- OAuth state 파라미터로 CSRF 방지
- Sidecar 프로세스 권한 최소화

## MCP Protocol Basics

```typescript
// MCP 요청 형식
interface MCPRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;  // "tools/call", "resources/read", etc.
  params: object;
}

// MCP 응답 형식
interface MCPResponse {
  jsonrpc: "2.0";
  id: string;
  result?: object;
  error?: { code: number; message: string };
}
```

## Activation Triggers

- "confluence", "notion", "mcp", "connector"
- OAuth 또는 인증 관련 이슈
- Sidecar 프로세스 관련 작업
- 외부 API 통합 작업
- `connectorStore.ts` 수정 시
