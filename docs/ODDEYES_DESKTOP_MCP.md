# OddEyes Desktop MCP

OddEyes 앱과 Claude Desktop을 `.mcpb` 기반 local extension으로 연결하는 가이드입니다.

## 목표

- Claude Desktop Extensions에서 설치 가능한 OddEyes 전용 extension을 제공합니다.
- Claude가 OddEyes의 현재 source/target 문서와 번역 컨텍스트를 읽을 수 있게 합니다.
- Claude가 만든 번역/수정안은 항상 OddEyes Preview 모달로 먼저 보내고, 사용자가 직접 적용하거나 폐기하게 합니다.
- 수동 JSON config / launcher 의존성을 제거합니다.

## 현재 구조

```text
Claude Desktop
  -> installed OddEyes Desktop extension (.mcpb)
  -> bundled stdio MCP server (Node, inside extension)
  -> bridge.json runtime metadata
  -> OddEyes bridge websocket
  -> OddEyes app bridge (frontend)
  -> translation preview store / preview modal

OddEyes app startup
  -> bridge port/token 자동 생성
  -> bridge websocket server 시작
  -> packaged .mcpb resource를 app data에 복사
  -> runtime/bridge.json 작성
```

핵심 차이:

- Claude Desktop용 launcher/config 파일을 더 이상 만들지 않습니다.
- extension은 설치 후 자체 stdio MCP server로 실행됩니다.
- bridge 연결 정보는 app data 아래 `bridge.json`에서 읽습니다.
- OddEyes 재시작으로 포트/토큰이 바뀌어도 extension이 다음 호출에서 다시 읽고 재연결합니다.

## 관련 파일

### Rust / app lifecycle

- `src-tauri/src/desktop_mcp.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`

### MCP extension / packaging

- `oddeyes-desktop-mcp/src/index.ts`
- `oddeyes-desktop-mcp/src/bridgeRuntime.ts`
- `oddeyes-desktop-mcp/src/tools/documents.ts`
- `oddeyes-desktop-mcp/src/tools/preview.ts`
- `oddeyes-desktop-mcp/manifest.template.json`
- `oddeyes-desktop-mcp/scripts/build-bundle.mjs`

### Frontend bridge / preview

- `src/desktop/oddeyesAppBridge.ts`
- `src/desktop/translationPreviewActions.ts`
- `src/stores/translationPreviewStore.ts`
- `src/components/editor/DesktopTranslationPreviewHost.tsx`

## 빌드 산출물

`npm run oddeyes-desktop-mcp:build` 는 다음을 생성합니다.

- `oddeyes-desktop-mcp/build/extension/`
- `oddeyes-desktop-mcp/build/oddeyes-desktop.mcpb`

Tauri build/dev 시 `.mcpb` 파일은 app resource에 포함되고, 앱 시작 시 app data로 복사됩니다.

## 설치 흐름

### 1. OddEyes 실행

```bash
npm run tauri:dev
```

앱 시작 시 자동으로 수행되는 작업:

- `oddeyes-desktop-mcp` build
- bridge websocket 시작
- `.mcpb` resource 준비
- `runtime/bridge.json` 작성

### 2. 생성된 local extension 파일 확인

macOS 기준:

```text
/Users/<you>/Library/Application Support/com.oddeyes.desktop/desktop-mcp/oddeyes-desktop.mcpb
```

같은 디렉터리 아래 bridge metadata도 기록됩니다.

```text
/Users/<you>/Library/Application Support/com.oddeyes.desktop/desktop-mcp/runtime/bridge.json
```

### 3. Claude Desktop에서 extension 설치

1. Claude Desktop → Settings → Extensions
2. Advanced settings
3. Install Extension…
4. `oddeyes-desktop.mcpb` 선택

이 흐름에서는 Claude Desktop JSON config 편집이 필요 없습니다.

## Bridge 전략

`bridge.json` 예시:

```json
{
  "appId": "com.oddeyes.desktop",
  "appName": "OddEyes.ai",
  "bridgePort": 9966,
  "bridgeToken": "random-token",
  "updatedAt": "2026-03-18T04:00:00Z"
}
```

전략 요약:

- OddEyes 앱이 bridge 포트/토큰을 매 실행 시 갱신합니다.
- 앱은 고정 위치의 `bridge.json`에 현재 값을 기록합니다.
- extension 서버는 각 호출 전에 `bridge.json`을 읽고 현재 연결 정보로 websocket client를 맞춥니다.
- 기존 연결이 끊겼거나 앱이 재시작된 경우, extension은 client를 재생성하고 재시도합니다.
- app이 종료되면 `bridge.json`을 제거합니다.

이 구조 덕분에 extension 설치 후에는 Claude Desktop 재설치나 수동 재설정 포인트가 줄어듭니다.

## 사용 가능한 도구

### Desktop MCP Extension (oddeyes-desktop-mcp)

#### Read-only
- `oddeyes_get_status`
- `oddeyes_get_source_document`
- `oddeyes_get_target_document`
- `oddeyes_get_translation_context`
- `oddeyes_get_translation_preview`

#### Preview write/apply
- `oddeyes_set_translation_preview`
- `oddeyes_apply_translation_preview`
- `oddeyes_discard_translation_preview`

### Semantic Tools (tauri-testing-mcp, `oddeyes_*` prefix)

Claude가 앱의 구조화된 번역 데이터를 직접 읽고 쓸 수 있는 도구입니다.

#### Project
- `oddeyes_project_list` — 프로젝트 목록 조회
- `oddeyes_project_open` — 프로젝트 로드 (전체 구조 반환)

#### Document
- `oddeyes_document_get_blocks` — 정렬된 source↔target 블록 쌍 조회
- `oddeyes_document_set_blocks` — target 블록에 번역 내용 쓰기 (에디터 자동 갱신)

#### Settings & Glossary
- `oddeyes_settings_get` — 번역 설정 조회 (persona, rules, context, 프로젝트 메타데이터)
- `oddeyes_glossary_search` — 프로젝트 용어집 검색

#### Snapshots
- `oddeyes_snapshot_create` — 명명된 스냅샷 생성
- `oddeyes_snapshot_list` — 스냅샷 목록 조회

## 권장 테스트 순서

1. OddEyes 앱 실행
2. Claude Desktop에 `oddeyes-desktop.mcpb` 설치
3. Claude에서 `oddeyes_get_status` 호출
4. `oddeyes_get_source_document` 호출
5. source 문서를 읽고 `oddeyes_set_translation_preview`로 프리뷰 생성
6. OddEyes에서 Preview 모달 확인
7. 필요 시 `oddeyes_apply_translation_preview` 또는 `oddeyes_discard_translation_preview`
8. OddEyes를 재시작한 뒤 `oddeyes_get_status`를 다시 호출해 재연결 확인

## 현재 제약

- Claude Desktop custom extension 설치 자체는 아직 사용자가 로컬 `.mcpb` 파일을 선택해야 합니다.
- OddEyes가 실행 중이어야 extension 호출이 의미 있습니다.
- sidecar/native binary 패키징은 아직 하지 않았습니다.
- `.mcpb`는 우선 local install 기준으로 정리되어 있고, directory/organization 배포는 다음 단계입니다.

## 구현 메모

- extension manifest는 `manifest.template.json`에서 관리합니다.
- MCP server는 extension 내부에서 stdio transport로 실행됩니다.
- preview는 target 문서에 즉시 적용되지 않고 Zustand preview store를 거쳐 모달에 표시됩니다.
- repo 경로 직접 참조는 extension 실행 경로에서 제거했습니다. Claude Desktop은 bundle 내부 `${__dirname}` 기준으로 서버를 실행하고, 런타임 연결은 app data의 `bridge.json`을 사용합니다.

## 다음 단계

- `.mcpb` 서명/배포 정책 정리
- Claude Desktop extension directory 등록 가능 형태로 메타데이터 확장
- sidecar 또는 binary MCP server 필요성 재검토
- ~~app UI에서 extension bundle 경로 / 설치 상태 노출 여부 결정~~ → 완료 (AppSettingsModal에 Claude Desktop 섹션 추가)
- `oddeyes-desktop-mcp`에 semantic tools (document_get/set_blocks 등) 통합
