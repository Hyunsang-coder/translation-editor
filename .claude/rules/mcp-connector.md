---
paths: ["src-tauri/src/mcp/**/*", "src/stores/connectorStore.ts", "src/tauri/mcpRegistry.ts"]
alwaysApply: false
---

# MCP Connector Rules

MCP 서버 및 외부 연동 작업 시 적용되는 규칙.

## Critical Checklist

- [ ] OAuth 토큰은 SecretManager Vault에만 저장 (localStorage 금지)
- [ ] 동시 OAuth 플로우 방지 (`oauth_in_progress` 플래그)
- [ ] SSE 연결 시 shutdown signal로 graceful 종료
- [ ] 토큰 갱신 실패 시 토큰 삭제 후 재인증 CTA 표시

## Architecture

- **Rust 네이티브 SSE** (Node.js Sidecar 아님)
- **McpRegistry**: 다중 MCP 서버 통합 관리
- **OAuth Callback**: 고정 포트 23456

## Vault Storage Keys

```
mcp/atlassian/oauth_token_json
mcp/atlassian/client_json
mcp/notion/config_json
notion/integration_token
```

## Gate Pattern

```
토글 ON ≠ 즉시 연결
토글 ON = 도구 사용 허용
→ 실제 호출 시점에 연결 없으면 "Connect" CTA
→ 사용자 클릭으로만 OAuth 시작 (Lazy)
```

## Tool Binding

```typescript
if (webSearchEnabled) tools.push(webSearchTool);
if (confluenceEnabled && confluence.connected) {
  tools.push(confluenceSearchTool);
}
```

## Common Pitfalls

1. **SSE 연결 끊김**: shutdown signal 및 타임아웃 설정 확인
2. **OAuth 콜백 미수신**: 포트 23456 사용 중 확인 (`lsof -i:23456`)
3. **토큰 만료**: refresh_token 갱신 로직 및 Vault 저장 확인
4. **동시 OAuth**: single-flight guard 확인
