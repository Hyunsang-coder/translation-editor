# Session Handoff

> Generated: 2026-04-07 00:15
> Branch: main

## 작업 요약

Desktop MCP와 Claude Code MCP에 `oddeyes_set_source_document`, `oddeyes_load_confluence_page` 도구를 추가했다. 이후 Claude Code MCP(`tauri-testing-mcp`)의 배포 방식을 `env!("CARGO_MANIFEST_DIR")` 기반 로컬 전용에서 **npx + bridge.json 자동 탐지 방식으로 통일**하는 작업이 필요함을 확인했다.

## 현재 상태

### 변경된 파일
- `M .claude/CLAUDE.md` — Recent Updates 섹션 갱신 (unstaged)
- `?? .agents/`, `?? AGENTS.md` — untracked (이번 작업과 무관)

### 커밋 이력 (이번 세션)
```
6b3a48f Add set_source_document and load_confluence_page MCP tools
```
- `oddeyes_set_source_document`: source 에디터에 문서 직접 설정 (markdown/tiptap_json/adf, content 또는 filePath)
- `oddeyes_load_confluence_page`: Confluence 페이지 ADF→TipTap 변환 후 source에 로드
- `read_text_file` Rust command: filePath 기반 텍스트 파일 읽기
- `oddeyesAppBridge.test.ts`: 12개 유닛 테스트

## 미완료 작업

- [ ] **Claude Code MCP를 npx + bridge.json 방식으로 통일** (메인 작업)
  - [ ] `tauri-testing-mcp`에 `bridgeRuntime.ts` 자동 탐지 로직 추가 (Desktop MCP의 구현 재사용)
  - [ ] env fallback 유지 (`TAURI_TEST_PORT`/`TAURI_TEST_TOKEN` — 기존 테스트 스크립트 호환)
  - [ ] `tauri-testing-mcp`를 npm에 퍼블리시 준비 (패키지명 결정 필요)
  - [ ] Rust `register_claude_code_mcp` 수정 — `npx <package>` 방식으로 변경
  - [ ] `oddeyes_mcp_server_entry()` 함수에서 `env!("CARGO_MANIFEST_DIR")` 제거
  - [ ] UI 스니펫(`CODE_SNIPPET` in `AppSettingsModal.tsx`) 업데이트
  - [ ] `claude_code_mcp_json_path()` 수정 — 현재 `CARGO_MANIFEST_DIR` 기반이라 빌드된 PC에서만 동작
- [ ] **수동 설정 버튼 UI 문제**: `<details><summary>` 의 selector 영역이 텍스트와 불일치해 혼란스러움 (사용자 리포트)
- [ ] `.claude/CLAUDE.md` 변경 커밋

## 핵심 결정 사항

- **Desktop MCP와 Claude Code MCP의 bridge.json 탐지 방식 통일**: 현재 Desktop MCP(`oddeyes-desktop-mcp`)는 `bridge.json` 자동 탐지를 사용하고 Claude Code MCP(`tauri-testing-mcp`)는 env 변수 기반. 다른 PC에서 작동하려면 bridge.json 방식으로 통일 필요. (대안: 두 패키지를 하나로 합치기 — 도구 범위가 다르므로 분리 유지가 나음)
- **`set_source_document`에 filePath 모드 추가**: 대형 ADF 문서를 MCP 인자로 직접 전달하면 Claude 컨텍스트를 많이 차지하므로, 파일 경로를 넘기고 앱이 직접 읽는 방식 추가. `read_text_file` Rust command 신규.
- **`loadConfluencePage` 브리지 구현**: `loadAdfAsSourceDocument()` (MCP client 경유)는 Desktop MCP 컨텍스트에서 동작 안 함 → Rust command `load_confluence_page_as_source` 직접 invoke로 변경.

## 주의사항

- **`env!("CARGO_MANIFEST_DIR")`**: 컴파일 시점에 `src-tauri/` 경로가 고정됨. `claude_code_mcp_json_path()`와 `oddeyes_mcp_server_entry()` 모두 이걸 사용하므로 릴리스 빌드에서는 다른 PC에서 절대 동작하지 않음. 이것이 "원클릭 버튼 안됨"의 근본 원인.
- **두 WebSocket 클라이언트가 거의 동일**: `oddeyes-desktop-mcp/src/client/websocket.ts` (`OddEyesBridgeClient`)와 `tauri-testing-mcp/src/client/websocket.ts` (`TauriBridgeClient`)는 구조가 동일. 통합 시 하나로 합칠 수 있음.
- **Confluence API 응답 구조**: `body.atlas_doc_format.value`는 **JSON 문자열**이라 `JSON.parse` 필요. `oddeyesAppBridge.ts`에 이미 처리됨.
- **`tauri-testing-mcp` 도구 범위**: DOM/Window/App 도구는 E2E 테스트 전용. npx 배포 시 이 도구들이 일반 사용자에게 노출되는 것이 적절한지 검토 필요.

## 핵심 파일

- `src-tauri/src/desktop_mcp.rs` — Rust: `register_claude_code_mcp`, `claude_code_mcp_json_path`, `oddeyes_mcp_server_entry` (수정 대상)
- `tauri-testing-mcp/src/index.ts` — Claude Code MCP 엔트리 (env 기반 → bridge.json 전환 대상)
- `oddeyes-desktop-mcp/src/bridgeRuntime.ts` — bridge.json 자동 탐지 참조 구현 (재사용 대상)
- `src/components/settings/AppSettingsModal.tsx:34-46,524-560` — UI 스니펫 + 원클릭 버튼 + 수동 설정
- `src/desktop/oddeyesAppBridge.ts` — 브리지 메서드 (이번 세션에서 setSourceDocument/loadConfluencePage 추가)

## 다음 세션 가이드

1. `/pickup`으로 이 문서를 로드
2. **bridge.json 통일 작업** 시작:
   - `oddeyes-desktop-mcp/src/bridgeRuntime.ts`를 공유 모듈로 추출하거나 `tauri-testing-mcp`에 복사
   - `tauri-testing-mcp/src/index.ts`에서 bridge.json 탐지 → env fallback 순서로 연결
   - Rust `desktop_mcp.rs`의 `oddeyes_mcp_server_entry()`를 `npx <package>` 방식으로 변경
   - `AppSettingsModal.tsx`의 `CODE_SNIPPET` 업데이트
3. npm 퍼블리시 여부/패키지명은 사용자에게 확인
4. 수동 설정 `<details>` UI 개선
