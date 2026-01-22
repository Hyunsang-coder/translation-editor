# Phase 6: 외부 도구 연동

**상태**: ✅ 대부분 완료

## 완료 항목

### 6.0 OpenAI 전용 단순화
- Anthropic/Google Provider 제거
- OpenAI 빌트인 커넥터 모듈
- MCP 레지스트리 (다중 MCP 서버 통합)
- App Settings 커넥터 UI

### 6.1 MCP 연동
- Confluence_search 게이트 토글
- OAuth 2.1 인증 (Lazy)
- **Rust 네이티브 SSE 클라이언트** (Node.js 의존성 제거)
- OAuth 토큰 키체인 영속화

### 6.2 웹검색
- Brave Search API 연동
- OpenAI Web Search 연동

### 6.3 Notion 연동
- Notion REST API 직접 호출
- Integration Token 기반

## 미완료

### 6.0.5 OAuth 플로우 구현
- [ ] Google OAuth 2.0 (Drive, Calendar, Gmail)
- [ ] Dropbox OAuth 2.0
- [ ] Microsoft Azure AD OAuth 2.0

### 6.3 외부 사전 API
- [ ] 사전 API 선택 및 연동 방식 결정
