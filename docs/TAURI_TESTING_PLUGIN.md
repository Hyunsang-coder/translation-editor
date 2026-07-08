# Tauri Testing Plugin 구현 명세 (MVP)

> 최종 수정: 2026-02-13  
> 대상 리포지토리: `translation-editor` (OddEyes.ai, Tauri v2)

## 1. 목표

OddEyes 앱을 **Tauri 런타임 기준으로 자동화 테스트**하기 위한 테스트 브리지 체계를 구현한다.

- Rust 플러그인: 앱 내부(WebView + window + invoke) 제어
- MCP 서버: LLM 에이전트가 사용할 도구 인터페이스 제공
- 전제: macOS 우선 (WKWebView), Tauri v2

## 2. 범위

### 2.1 포함

- `tauri-plugin-testing` (Rust)
- WebSocket + JSON-RPC 브리지
- DOM 제어, `invoke` 호출, 윈도우 조회/제어 API
- 로컬 stdio 기반 MCP 서버(별도 Node 프로세스)

### 2.2 제외 (MVP 외)

- CDP 호환 또는 Playwright 완전 대체
- 네트워크 인터셉트
- 멀티 클라이언트 동시 접속
- 크로스플랫폼(Windows/Linux) 최적화

## 3. 현재 리포 기준 전제

- Tauri 설정: `/Users/hyunsang_joo/Documents/GitHub/translation-editor/src-tauri/tauri.conf.json`
- Capability 파일: `/Users/hyunsang_joo/Documents/GitHub/translation-editor/src-tauri/capabilities/default.json`
- 앱 진입점: `/Users/hyunsang_joo/Documents/GitHub/translation-editor/src-tauri/src/lib.rs`
- 기존 테스트 명령: `npm run test:tauri`, `npm run test:e2e`, `cargo test --manifest-path src-tauri/Cargo.toml`

참고: 현재 리포에는 테스트 플러그인 자체가 아직 없다. 이 문서는 신규 구현 기준이다.

## 4. 산출물

### 4.1 Rust 쪽

- `/Users/hyunsang_joo/Documents/GitHub/translation-editor/crates/tauri-plugin-testing/Cargo.toml`
- `/Users/hyunsang_joo/Documents/GitHub/translation-editor/crates/tauri-plugin-testing/src/lib.rs`
- `/Users/hyunsang_joo/Documents/GitHub/translation-editor/crates/tauri-plugin-testing/src/bridge/*`
- `/Users/hyunsang_joo/Documents/GitHub/translation-editor/crates/tauri-plugin-testing/js/bridge.js`

### 4.2 앱 통합

- `/Users/hyunsang_joo/Documents/GitHub/translation-editor/src-tauri/Cargo.toml`
- `/Users/hyunsang_joo/Documents/GitHub/translation-editor/src-tauri/src/lib.rs`

### 4.3 MCP 서버

- `/Users/hyunsang_joo/Documents/GitHub/translation-editor/tauri-testing-mcp/package.json`
- `/Users/hyunsang_joo/Documents/GitHub/translation-editor/tauri-testing-mcp/src/index.ts`
- `/Users/hyunsang_joo/Documents/GitHub/translation-editor/tauri-testing-mcp/src/client/websocket.ts`
- `/Users/hyunsang_joo/Documents/GitHub/translation-editor/tauri-testing-mcp/src/tools/*.ts`

## 5. 보안/활성화 규칙

테스트 기능은 아래 2개 조건을 동시에 만족할 때만 동작해야 한다.

1. 컴파일 타임: `--features testing`
2. 런타임: `TAURI_TESTING_ENABLED=1` 또는 `true`

추가 제약:

- WebSocket 바인딩: `127.0.0.1`만 허용
- 기본 포트: `9876` (`TAURI_TEST_PORT`로 오버라이드)
- 인증: Bearer 토큰 필수 (`TAURI_TEST_TOKEN` 미설정 시 서버 미기동, 상수 시간 비교)
- Origin 검증: 브라우저 Origin은 tauri/dev 서버 origin만 허용 (Origin 헤더 없는 비브라우저 클라이언트는 허용)
- 연결 수: 단일 클라이언트만 허용

## 6. 앱 통합 스펙

### 6.1 `src-tauri/Cargo.toml`

```toml
[dependencies]
tauri-plugin-testing = { path = "../crates/tauri-plugin-testing", optional = true }

[features]
testing = ["tauri-plugin-testing"]
```

### 6.2 `src-tauri/src/lib.rs`

`run()` 빌더에서 테스트 플러그인을 조건부 등록한다.

```rust
#[cfg(feature = "testing")]
{
    builder = builder.plugin(tauri_plugin_testing::init());
}
```

핵심 요구사항:

- 기본 빌드(기능 플래그 없음)에서는 링크/동작 영향이 없어야 한다.
- feature만 켜져 있고 환경변수가 없으면 no-op 이어야 한다.

## 7. 플러그인 프로토콜

전송 규약: `WebSocket + JSON-RPC 2.0`

요청 예시:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "dom.click",
  "params": { "selector": "button[data-testid='run']" }
}
```

성공 응답 예시:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "clicked": true }
}
```

오류 응답 예시:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": { "code": -32000, "message": "Element not found" }
}
```

## 8. MVP API 목록

### 8.1 DOM

- `dom.querySelector` `{ selector }`
- `dom.click` `{ selector }`
- `dom.fill` `{ selector, value }` (React input 이벤트 포함)
- `dom.getText` `{ selector }`
- `dom.waitForSelector` `{ selector, timeout? }`
- `dom.getPageContent` `{ maxDepth?, maxNodes?, selector? }`

### 8.2 Tauri

- `tauri.invoke` `{ command, args? }`
- `tauri.emit` `{ event, payload? }`

### 8.3 Window

- `window.getTitle` `{ label? }`
- `window.getSize` `{ label? }`
- `window.setSize` `{ width, height, label? }`
- `window.list` `{}`
- `window.screenshot` `{ label?, path? }`

## 9. JS Bridge 요구사항

- 전역 네임스페이스: `window.__TAURI_TESTING_BRIDGE__`
- 응답 이벤트명: `plugin:testing://bridge-response`
- 중복 주입 방지 로직 필수
- `dom.fill`은 React 호환 입력 이벤트(`input`, `change`)를 명시적으로 발생
- `getPageContent`는 `SCRIPT/STYLE/NOSCRIPT/SVG` 제외, `maxDepth/maxNodes` 제한 준수

## 10. MCP 서버 구현 스펙

### 10.1 의존성

- `@modelcontextprotocol/sdk`
- `zod` (현 리포는 v3 사용 중이며 SDK와 호환)
- `ws`

### 10.2 기본 구조

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "tauri-testing", version: "0.1.0" });

server.registerTool(
  "tauri_dom_click",
  {
    description: "Click an element in Tauri WebView by CSS selector",
    inputSchema: { selector: z.string() },
  },
  async ({ selector }) => {
    const result = await bridge.request("dom.click", { selector });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### 10.3 도구 네이밍 규칙

- 접두사 고정: `tauri_*`
- 액션 중심 이름: `tauri_dom_click`, `tauri_invoke`, `tauri_window_get_size`
- read-only 툴은 annotations로 명시 (`readOnlyHint: true`)

## 11. 단계별 구현 체크리스트

### Phase 1: 플러그인 골격

- [ ] `crates/tauri-plugin-testing` 생성
- [ ] `init()` + feature gate + env gate 구현
- [ ] `src-tauri` 빌드 통합
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml --features testing` 통과

### Phase 2: WebSocket + JSON-RPC

- [ ] localhost 서버 기동
- [ ] Bearer 토큰 인증
- [ ] 요청/응답 라우터
- [ ] 단일 연결 제한

완료 기준: `wscat`/테스트 클라이언트로 ping 유사 요청 성공

### Phase 3: JS Bridge + DOM API

- [ ] `bridge.js` 주입
- [ ] `dom.querySelector/click/fill/getText/waitForSelector`
- [ ] `dom.getPageContent`
- [ ] 브리지 응답 이벤트 정상 수신

완료 기준: 버튼 클릭 후 DOM 상태 변화를 외부 요청으로 검증 가능

### Phase 4: `tauri.invoke` + window API

- [ ] `tauri.invoke` 래핑
- [ ] `window.getSize/setSize/list`
- [ ] `window.screenshot` 저장

완료 기준: 기존 커맨드 1개 이상 invoke 성공 + 창 크기 변경 성공

### Phase 5: MCP 서버

- [ ] stdio 서버 기동
- [ ] WebSocket 클라이언트 구현
- [ ] 핵심 툴 8개 이상 등록
- [ ] Claude/Codex MCP 연결 확인

완료 기준: 에이전트가 DOM 조회 -> 입력 -> 클릭 -> 결과 검증 시나리오 수행

## 12. 운영 명령(예시)

```bash
# 앱 실행 (테스트 기능 활성)
TAURI_TESTING_ENABLED=1 cargo tauri dev --features testing

# MCP 서버 실행 (별도 터미널)
node tauri-testing-mcp/dist/index.js

# 기본 회귀 테스트
npm run test:tauri
cargo test --manifest-path src-tauri/Cargo.toml
```

## 13. 완료 기준 (Definition of Done)

아래가 모두 충족되면 MVP 완료로 본다.

1. 기본 빌드와 testing feature 빌드가 모두 성공한다.
2. 인증 없는 WebSocket 접근이 거부된다.
3. `dom.fill`이 React 입력 필드에서 실제 상태를 변경한다.
4. `tauri.invoke`로 실제 명령 1개 이상 호출 가능하다.
5. MCP 도구로 end-to-end 시나리오 1개 이상 자동화 성공한다.

## 14. 리스크 및 대응

- WKWebView 한계로 Playwright 수준 기능 미제공  
  -> DOM/API 자동화에 집중하고 범위를 명확히 고정
- 브리지 이벤트 유실 가능성  
  -> 요청 타임아웃, 재시도, pending 정리 루틴 구현
- 테스트 코드가 프로덕션에 유입될 위험  
  -> feature gate + env gate + CI 검증으로 차단

## 15. 참고

- Tauri v2 Plugin: https://v2.tauri.app/develop/plugins/
- Tauri Event/Invoke: https://v2.tauri.app/develop/calling-rust/
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- JSON-RPC 2.0: https://www.jsonrpc.org/specification
