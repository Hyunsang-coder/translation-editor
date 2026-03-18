# OddEyes Desktop MCP

OddEyes 앱과 Claude Desktop을 로컬 MCP로 연결하는 개발용 가이드입니다.

## 목적

- OddEyes에서 현재 열려 있는 source/target 문서와 번역 컨텍스트를 Claude Desktop이 읽을 수 있게 합니다.
- Claude가 생성한 번역/수정안을 OddEyes의 Preview 모달로 먼저 보내고, 사용자가 직접 적용하거나 폐기할 수 있게 합니다.
- 문서 자동 반영 없이 기존 OddEyes 철학인 Preview → Apply 흐름을 유지합니다.

## 현재 구조

```text
Claude Desktop
  -> stdio launcher (run-oddeyes-desktop-mcp.sh/.cmd)
  -> oddeyes-desktop-mcp (Node MCP server, stdio mode)
  -> OddEyes bridge websocket
  -> OddEyes app bridge (frontend)
  -> translation preview store / preview modal

OddEyes app startup
  -> bridge port/token 자동 생성
  -> bridge websocket server 시작
  -> desktop MCP helper HTTP mode spawn + healthcheck
  -> Claude Desktop용 launcher/config 파일 생성
```

## 관련 파일

### Rust / app lifecycle

- `src-tauri/src/desktop_mcp.rs`
- `src-tauri/src/lib.rs`

### MCP server

- `oddeyes-desktop-mcp/src/index.ts`
- `oddeyes-desktop-mcp/src/tools/documents.ts`
- `oddeyes-desktop-mcp/src/tools/preview.ts`

### Frontend bridge / preview

- `src/desktop/oddeyesAppBridge.ts`
- `src/desktop/translationPreviewActions.ts`
- `src/stores/translationPreviewStore.ts`
- `src/components/editor/DesktopTranslationPreviewHost.tsx`

## 사용 방법

### 1. OddEyes dev 실행

```bash
npm run tauri:dev
```

앱 시작 시 다음이 자동으로 수행됩니다.

- `oddeyes-desktop-mcp` build
- bridge websocket 시작
- 로컬 HTTP helper spawn
- Claude Desktop launcher/config 파일 생성

### 2. 생성된 launcher/config 확인

macOS 기준 생성 위치:

```text
/Users/<you>/Library/Application Support/com.oddeyes.desktop/desktop-mcp/
```

생성 파일:

- `claude-desktop-config.json`
- `run-oddeyes-desktop-mcp.sh`

### 3. Claude Desktop에 MCP 등록

macOS 예시:

```json
{
  "mcpServers": {
    "oddeyes": {
      "command": "/bin/sh",
      "args": [
        "/Users/<you>/Library/Application Support/com.oddeyes.desktop/desktop-mcp/run-oddeyes-desktop-mcp.sh"
      ]
    }
  }
}
```

Windows는 `.cmd` launcher를 사용하면 됩니다.

### 4. Claude Desktop 재시작

- OddEyes를 먼저 켭니다.
- 그 다음 Claude Desktop을 재시작합니다.

브리지 포트/토큰은 OddEyes 앱 시작 시 동적으로 갱신되므로, OddEyes를 재시작한 뒤에는 Claude Desktop도 다시 시작하는 편이 안전합니다.

## 사용 가능한 도구

### Read-only

- `oddeyes_get_status`
- `oddeyes_get_source_document`
- `oddeyes_get_target_document`
- `oddeyes_get_translation_context`
- `oddeyes_get_translation_preview`

### Preview write/apply

- `oddeyes_set_translation_preview`
- `oddeyes_apply_translation_preview`
- `oddeyes_discard_translation_preview`

## 권장 테스트 순서

1. OddEyes 앱 실행
2. Claude Desktop 재시작
3. Claude에서 `oddeyes_get_status` 호출
4. `oddeyes_get_source_document` 호출
5. source 문서를 읽고 `oddeyes_set_translation_preview`로 프리뷰 생성
6. OddEyes에서 Preview 모달 확인
7. 필요 시 `oddeyes_apply_translation_preview` 또는 `oddeyes_discard_translation_preview`

## 현재 제약

- 현재는 개발 환경 기준으로 정리되어 있습니다.
- launcher는 저장소의 `oddeyes-desktop-mcp/dist/index.js`를 직접 참조합니다.
- OddEyes가 실행 중이어야 Claude Desktop 연결이 의미 있습니다.
- OddEyes 재시작 후 Claude Desktop 재시작이 필요할 수 있습니다.
- 최종 배포형 `.mcpb` 또는 sidecar packaging은 아직 정리되지 않았습니다.

## 구현 메모

- 앱 내부에서는 HTTP helper를 자동 spawn/healthcheck 합니다.
- Claude Desktop은 stdio launcher를 사용합니다.
- helper와 launcher는 같은 MCP 엔트리포인트를 다른 transport로 사용하는 구조입니다.
- 프리뷰는 target 문서에 즉시 적용되지 않고 Zustand preview store를 거쳐 모달에 표시됩니다.

## 다음 단계

- 배포 빌드에서 Node 런타임 의존성 제거
- `.mcpb` 또는 배포 가능한 sidecar 방향 결정
- Claude Desktop 설정을 더 자동화할지 결정
- 연결 상태/launcher 경로를 앱 UI에서 노출할지 결정
