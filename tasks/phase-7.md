# Phase 7: MCP 연동 및 확장 기능

**목표**: MCP 프로토콜 연동, 웹검색 등 외부 도구 통합.

## 진행 중 / 계획

### 7.1 Rovo MCP 연동 (Confluence: `search()` / `fetch()`) — MVP
- [ ] **Chat Panel: `Confluence_search` 게이트 토글 추가**
  - 완료 조건:
    - Chat composer 하단 `+` 메뉴에 `Confluence_search` 체크 항목 추가
    - 토글은 **채팅 탭(thread) 단위**로 on/off (웹검색 체크와 동일한 UX)
  - 정책:
    - 토글 ON은 “도구 사용 허용”만 의미 (즉시 OAuth 강제하지 않음, Lazy)
    - 토글 OFF 시 모델에 Rovo MCP 도구를 바인딩/노출하지 않음

- [ ] **OAuth 2.1 인증 (Lazy) + 연결 UX**
  - 배경:
    - Rovo MCP는 **API Token/API Key 입력 방식 미지원**. OAuth 2.1 기반이 전제.
  - 완료 조건:
    - Confluence 도구 사용이 실제로 필요할 때(모델/사용자 흐름상) 연결이 없으면 “Atlassian 연결(Connect)” CTA 노출
    - 사용자가 CTA를 눌렀을 때만 브라우저 OAuth를 시작

- [ ] **Rovo MCP 연결 방식(MVP): `mcp-remote` 프록시 사용**
  - 근거(공식 가이드): `https://support.atlassian.com/atlassian-rovo-mcp-server/docs/setting-up-ides/`
  - 완료 조건:
    - 로컬에서 `npx -y mcp-remote https://mcp.atlassian.com/v1/sse` 실행을 통해 OAuth 플로우 완료
    - 이후 MCP 프로토콜로 연결하여 tool 목록 조회/호출 가능
  - 제약 사항:
    - 사용자 PC에 Node.js(18+) 필요 (MVP 단계)
    - 토큰 만료 시 재인증 필요 (프록시 재실행/재로그인)

- [ ] **도구 연동: `search()` → `fetch()` (Confluence 문서 검색/가져오기)**
  - 완료 조건:
    - 모델이 Confluence 문서를 필요로 할 때 `search()`로 후보를 찾고 `fetch()`로 본문/메타를 가져오는 2단계 사용
    - 결과는 **채팅 컨텍스트 보조용**으로만 사용 (문서 자동 적용 없음)
  - 안전장치(권장):
    - 가져온 문서의 길이 제한/요약 정책으로 토큰 폭주 방지
    - Tool 사용 여부 표시(“도구 사용됨/실행 중”)는 보조 UX로 제공 가능

### 7.2 MCP 연동 (Production - 배포 단계)

- [ ] **Node.js 의존성 제거(선택지 비교 후 결정)**
  - 옵션 A: `mcp-remote`를 바이너리화/번들링하여 Sidecar로 포함
  - 옵션 B(권장 방향): 앱이 OAuth 2.1을 직접 처리하고, `https://mcp.atlassian.com/v1/sse`로 직접 MCP 연결 (프록시 제거)
  - 목표: 일반 사용자 배포 시 Node.js 설치 없이도 Confluence_search 사용 가능

- [ ] **추가 MCP 서버 연동**
  - [ ] Google Drive MCP
  - [ ] 기타 외부 서비스 MCP

### 7.3 기타 확장 기능

- [ ] 웹검색 도구 연동
- [ ] 외부 사전 API 연동
- [ ] 타임라인 기반 수정 이력 UI (Smart History)
- [ ] 다크 모드/라이트 모드 지원
- [ ] 단축키 커스텀 설정


