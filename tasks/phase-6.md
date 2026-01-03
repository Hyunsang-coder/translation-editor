# Phase 6: 외부 도구 연동

**목표**: MCP 프로토콜 연동, 웹검색 등 외부 도구 통합.

## 진행 중 / 계획

### 6.1 MCP 연동

#### 6.1.1 Rovo MCP 연동 (Confluence: `search()` / `fetch()`) — MVP ✅
- [x] **Chat Panel: `Confluence_search` 게이트 토글 추가** ✅
  - 완료 조건:
    - Chat composer 하단 `+` 메뉴에 `Confluence_search` 체크 항목 추가 ✅
    - 토글은 **채팅 탭(thread) 단위**로 on/off (웹검색 체크와 동일한 UX) ✅
  - 정책:
    - 토글 ON은 "도구 사용 허용"만 의미 (즉시 OAuth 강제하지 않음, Lazy) ✅
    - 토글 OFF 시 모델에 Rovo MCP 도구를 바인딩/노출하지 않음 ✅

- [x] **OAuth 2.1 인증 (Lazy) + 연결 UX** ✅
  - 배경:
    - Rovo MCP는 **API Token/API Key 입력 방식 미지원**. OAuth 2.1 기반이 전제.
  - 완료 조건:
    - Confluence 도구 사용이 실제로 필요할 때(모델/사용자 흐름상) 연결이 없으면 "Atlassian 연결(Connect)" CTA 노출 ✅
    - 사용자가 CTA를 눌렀을 때만 브라우저 OAuth를 시작 ✅

- [x] **Rovo MCP 연결 방식(MVP): `mcp-remote` 프록시 사용** ✅
  - 근거(공식 가이드): `https://support.atlassian.com/atlassian-rovo-mcp-server/docs/setting-up-ides/`
  - 완료 조건:
    - 로컬에서 `npx -y mcp-remote https://mcp.atlassian.com/v1/sse` 실행을 통해 OAuth 플로우 완료 ✅
    - 이후 MCP 프로토콜로 연결하여 tool 목록 조회/호출 가능 ✅
  - 제약 사항:
    - 사용자 PC에 Node.js(18+) 필요 (MVP 단계)
    - 토큰 만료 시 재인증 필요 (프록시 재실행/재로그인)

- [x] **도구 연동: `search()` → `fetch()` (Confluence 문서 검색/가져오기)** ✅
  - 완료 조건:
    - 모델이 Confluence 문서를 필요로 할 때 `search()`로 후보를 찾고 `fetch()`로 본문/메타를 가져오는 2단계 사용 ✅
    - 결과는 **채팅 컨텍스트 보조용**으로만 사용 (문서 자동 적용 없음) ✅
  - 안전장치(권장):
    - 가져온 문서의 길이 제한/요약 정책으로 토큰 폭주 방지
    - Tool 사용 여부 표시("도구 사용됨/실행 중")는 보조 UX로 제공 가능

#### 6.1.2 MCP 연동 (Production - 배포 단계)
- [x] **옵션 A-1: npx 제거 및 로컬 번들 사용** ✅
  - 배경:
    - 현재 구현은 `npx -y mcp-remote https://mcp.atlassian.com/v1/sse`를 실행하는 방식(MVP)이라,
      배포 환경에서 `npx`/PATH/Node 버전/네트워크 정책에 의해 실패할 수 있음.
  - 목표:
    - `npx` 의존성 제거로 **네트워크 불안정 문제 해결**
    - 실행 환경(경로/권한/네트워크) 변수를 줄여 **연결 안정성**을 높임
  - 구현 완료 (2025-01-03):
    - `mcp-remote`를 `esbuild`로 CJS 번들화 (`src-tauri/resources/mcp-proxy.cjs`)
    - `node` 명령어로 로컬 번들 실행 (npx 불필요)
    - `tauri.conf.json` resources에 번들 등록
  - 제한 사항:
    - **⚠️ Node.js 설치는 여전히 필요** (pkg 바이너리화 시도 → 호환성 문제로 실패)
  - 권장 안전장치:
    - Node.js 미설치 시 안내 메시지 표시
    - 연결 상태/재인증(토큰 만료) 안내 UX 정리

- [x] **옵션 A-2: Node.js 의존성 완전 제거 (Rust SSE 구현)** ✅
  - 배경:
    - 옵션 A-1은 Node.js가 필요하므로 일반 사용자 배포에 제약
    - pkg/nexe 등 Node.js 바이너리화 도구들의 ESM 호환성 문제
  - 목표:
    - **Node.js 설치 없이** Confluence_search 사용 가능
    - 단일 바이너리 배포로 설치 간소화
  - 구현 완료 (2025-01-03):
    - Rust에서 SSE 클라이언트 (`reqwest-eventsource`) 및 MCP 프로토콜 직접 구현
    - OAuth 2.1 PKCE 인증 흐름 Rust 네이티브 구현 (로컬 콜백 서버)
    - 주요 파일: `src-tauri/src/mcp/` (client.rs, oauth.rs, types.rs)
    - Tauri 커맨드: `mcp_connect`, `mcp_disconnect`, `mcp_get_status`, `mcp_get_tools`, `mcp_call_tool`
    - TypeScript 측 `McpClientManager`가 Rust 백엔드 호출로 전환
    - 기존 Node.js 의존성 제거: `mcp-proxy.cjs`, `TauriShellTransport.ts` 삭제
  - 사용 라이브러리: `reqwest-eventsource`, `oauth2`, `open`, `sha2`, `base64`

- [x] **옵션 A-3: OAuth 토큰 키체인 영속화** ✅
  - 배경:
    - 기존 구현에서는 OAuth 토큰이 메모리에만 저장되어 앱 재시작 시 재인증 필요
    - Dynamic Client ID도 휘발성이라 매번 새로 등록해야 함
  - 목표:
    - 한 번 인증하면 앱 재시작 후에도 자동으로 연결
    - 토큰 만료 시 자동 갱신
  - 구현 완료 (2025-01-04):
    - OAuth 토큰/client_id를 OS 키체인에 영속 저장 (`keyring` crate)
    - 앱 시작 시 키체인에서 저장된 토큰 자동 로드
    - 토큰 만료 5분 전부터 `refresh_token`으로 자동 갱신
    - 갱신 실패 시 다음 연결 시점에 재인증 요청
    - `McpConnectionStatus`에 `hasStoredToken`, `tokenExpiresIn` 필드 추가
    - Tauri 커맨드: `mcp_check_auth`, `mcp_logout`
    - 프론트엔드: `McpClientManager.initialize()` (앱 시작 시 자동 연결)

- [ ] **추가 MCP 서버 연동**
  - [ ] Google Drive MCP
  - [ ] 기타 외부 서비스 MCP

### 6.2 웹검색 도구 연동
- [x] 웹검색 도구 구현
  - [x] Brave Search API 연동 (이미 API 키 입력 UI는 존재)
  - [x] OpenAI Web Search 연동
  - [x] 검색 결과를 채팅 컨텍스트로 활용

### 6.3 외부 사전 API 연동
- [ ] 외부 사전 API 통합
  - [ ] 사전 API 선택 및 연동 방식 결정
  - [ ] 용어 검색 도구 구현