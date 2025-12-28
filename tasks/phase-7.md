# Phase 7: MCP 연동 및 확장 기능

**목표**: MCP 프로토콜 연동, 웹검색 등 외부 도구 통합.

## 진행 중 / 계획

### 7.1 MCP 연동 
  - [ ] **외부 MCP 연동 진입점 (MVP)**
    - 완료 조건: 설정 화면에서 MCP 연동(Atlassian 등) 관리 화면으로 진입 가능, 인증 키 입력 및 활성화 기능
    - 구현 방식: Tauri Shell (`npx`) 사용 (개발/검증 단계)
    - 제약 사항: 사용자 PC에 Node.js 설치 필요 (개발자/얼리어답터 타겟)
    - 현재 상태: UI에 "Integrations" 섹션 placeholder 존재 (Coming soon)
    - 참고: 최종 배포 시 Sidecar 패턴으로 전환 예정 (Phase 7 참조)

- [ ] **Atlassian MCP 연동 (MVP)**
  - 완료 조건: 
    - App Settings에서 Atlassian MCP 설정 UI 제공 (Email, API Token, Site URL 입력)
    - Tauri Shell을 통한 `npx @modelcontextprotocol/server-atlassian` 실행
    - MCP 클라이언트 연결 및 LangChain 도구 연동
    - 프로세스 종료(Kill) 로직 구현 (Zombie Process 방지)
  - 구현 방식: **Tauri Shell (`npx`) 사용**
  - 제약 사항: 사용자 PC에 Node.js 설치 필요 (개발자/얼리어답터 타겟)
  - 기술 스택:
    - Frontend: `@modelcontextprotocol/sdk`, `@langchain/mcp-adapters`
    - Backend: `tauri-plugin-shell`
    - Custom Transport: `TauriShellTransport.ts` (stdio bridge)
  - 참고: 최종 배포 시 Sidecar 패턴으로 전환 예정 (아래 7.2 참조)

- [ ] **MCP 클라이언트 설정 관리**
  - 완료 조건: 여러 MCP 서버 설정 저장/로드, 연결 상태 표시
  - 구현: Zustand store 또는 SQLite에 설정 저장

### 7.2 MCP 연동 (Production - 배포 단계)

- [ ] **Sidecar 패턴으로 전환 (Node.js 의존성 제거)**
  - 완료 조건: 
    - MCP 서버(JS)를 바이너리로 패키징 (`pkg` 등 사용)
    - Tauri Sidecar로 등록 (`src-tauri/binaries/`)
    - 사용자가 Node.js 설치 없이도 MCP 기능 사용 가능
  - 목표: 일반 사용자 배포 시 Node.js 의존성 완전 제거
  - 작업 범위:
    - `@modelcontextprotocol/server-atlassian` 바이너리화
    - Tauri `sidecar` 설정 추가
    - `TauriShellTransport` → `TauriSidecarTransport` 전환 (또는 통합)

- [ ] **추가 MCP 서버 연동**
  - [ ] Google Drive MCP
  - [ ] 기타 외부 서비스 MCP

### 7.3 기타 확장 기능

- [ ] 웹검색 도구 연동
- [ ] 외부 사전 API 연동
- [ ] 타임라인 기반 수정 이력 UI (Smart History)
- [ ] 다크 모드/라이트 모드 지원
- [ ] 단축키 커스텀 설정


