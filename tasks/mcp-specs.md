# MCP 연동 스펙 (Confluence)

**상태**: ✅ 구현 완료

## 개요

Atlassian Rovo MCP Server를 통해 Confluence 문서 검색/가져오기

## 핵심 원칙

- **OAuth 2.1 전제**: API Token 입력 방식 미지원
- **Lazy OAuth**: 토글 ON ≠ 즉시 인증, 실제 사용 시점에 Connect CTA
- **게이트**: `Confluence_search` 토글 OFF → 도구 미바인딩

## 구현 방식

- **Rust 네이티브 SSE 클라이언트**: Node.js 의존성 제거
- **SSE URL**: `https://mcp.atlassian.com/v1/sse`
- **토큰 영속화**: SecretManager Vault에 OAuth 토큰 저장

## 도구

| 도구 | 용도 |
|------|------|
| `search()` | Confluence 문서 검색 |
| `fetch()` | 문서 본문/메타 가져오기 |

## 주요 파일

- `src-tauri/src/mcp/` - Rust MCP 클라이언트
- `src/ai/mcp/McpClientManager.ts` - 프론트엔드 래퍼
- `src/stores/connectorStore.ts` - 연결 상태 관리
