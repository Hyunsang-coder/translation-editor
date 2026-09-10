# Testing & Debugging

## Frontend Testing (Vitest + Testing Library)

```bash
npm test              # Watch mode (development)
npm run test:run      # Single run (CI)
npm run test:ui       # Browser UI
npm run test:coverage # Coverage report
```

- **Framework**: Vitest with jsdom environment
- **Location**: Test files co-located with source (`*.test.ts`, `*.spec.ts`)
- **Setup**: `src/test/setup.ts` (Tauri mocking, DOM APIs)
- **Config**: `vitest.config.ts`
- **TDD Skill**: `/tdd` for Red-Green-Refactor workflow

### Test Env API Key Fallback

- `vitest.config.ts`가 테스트 실행 시 `.env.local`의 `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`를 `test.env`로 주입합니다.
- `getAiConfig()`는 **테스트 런타임에서만** `process.env` fallback을 허용합니다.
- 런타임 앱(Tauri)에서는 fallback을 사용하지 않고, 설정 화면/secure store 키를 사용합니다.

## Pre-Deploy Test Gate

```bash
npm run test:tauri    # ⭐ Full gate: unit + e2e + rust + release check
```

Runs sequentially: `test:run` → `test:e2e` → `cargo test` → `cargo check --release`

## E2E Testing (Tauri Smoke + Playwright)

```bash
npm run test:e2e          # Tauri smoke test (default, builds debug app)
npm run test:e2e:web      # Web harness (Playwright, optional)
npm run test:e2e:web:ui   # Playwright UI mode
npm run test:harness      # Editor test harness (manual testing)
```

- **Default (`test:e2e`)**: Tauri smoke test — `node scripts/tauri-smoke.mjs` (빌드 + 실행 검증)
- **Web (`test:e2e:web`)**: Playwright web harness — `playwright.web.config.ts`
- **Location**: `e2e/*.spec.ts`
- **Test Harness**: 루트 `test-harness.html` (`npm run test:harness`가 포트 1421에서 `/test-harness.html` 서빙) - Tauri/API 키 없이 에디터만 독립 테스트

### Tauri Runtime Automation (Testing Plugin + MCP)

MCP 시나리오 스크립트(`scripts/tauri-testing-mcp-*.mjs`)는 자기완결적(MCP 서버 빌드 → `--features testing` 앱 자동 구동 → 포트 대기 → 시나리오 실행 → 프로세스 정리)이므로 단일 명령으로 실행됩니다:

```bash
npm run test:e2e:tauri:mcp:workflow         # 워크플로우 전체 (번역+리뷰+채팅)
npm run test:e2e:tauri:mcp:new-project      # 새 프로젝트 생성 smoke test
npm run test:e2e:tauri:mcp:review-highlight # 리뷰 하이라이트 검증
npm run test:e2e:tauri:mcp:history-compare  # 히스토리 스냅샷 비교 검증
npm run test:e2e:tauri:mcp:chat-selection   # SelectionContext 카드 숏컷
```

(선택) 이미 실행 중인 앱에 수동으로 붙일 때만 2개 분리 실행:

```bash
# 1) 앱 실행 (testing feature + env)
TAURI_TESTING_ENABLED=1 \
TAURI_TEST_TOKEN=tauri-testing-token \
TAURI_TEST_PORT=9988 \
npx tauri dev --features testing --no-watch --config src-tauri/tauri.conf.json --config '{"build":{"beforeDevCommand":""}}'

# 2) MCP 서버 실행 (다른 터미널)
TAURI_TEST_TOKEN=tauri-testing-token TAURI_TEST_PORT=9988 npm run tauri-testing-mcp:start
```

구성:
- Runtime bridge plugin: `crates/tauri-plugin-testing/`
- MCP server: `tauri-testing-mcp/`

주요 도구:
- DOM: `tauri_dom_query_selector`, `tauri_dom_click`, `tauri_dom_click_by_text`, `tauri_dom_fill`, `tauri_dom_fill_by_placeholder`, `tauri_dom_type_contenteditable`, `tauri_dom_type_contenteditable_by_selector`, `tauri_dom_wait_for_selector`, `tauri_dom_wait_for_text`
- Dialog: `tauri_dialog_get_state`, `tauri_dialog_set_auto_response`, `tauri_dialog_push_response`, `tauri_dialog_clear`

워크플로우 검증 스크립트(`scripts/tauri-testing-mcp-workflow.mjs`):
- 실행: `npm run test:e2e:tauri:mcp:workflow`
- 검증 기준:
  - 원문 에디터에 5줄 계층형 bullet(`-`) 한국어 입력
  - 타깃 언어를 영어로 명시 선택(선택 실패 시 즉시 실패)
  - 채팅 패널에서 `'번역문 내용 간략히 요약해줘'` 전송
  - assistant 메시지가 새로 생성되고 오류(`⚠️`)가 아닌 응답인지 확인

### E2E Test Files

| File | Tests / Description |
|------|---------------------|
| `e2e/user-story.spec.ts` | 프로젝트 생성, 문서 입력, 번역/리뷰 UI, 히스토리, 컨텍스트 메뉴 (7 TC) |
| `e2e/paste-normalizer.spec.ts` | HTML 붙여넣기 정규화 (Confluence, XSS, 테이블 등) |
| `e2e/selection-editing.spec.ts` | 인라인 툴바, 선택 재번역/적용, 멀티블록 선택, 표 셀 선택(채팅·코멘트·복사) |
| `e2e/alignment-view.spec.ts` | 정렬 검사 뷰(문단 대조, 불일치 배너, 문서 보기 점프) |
| `e2e/project-memory-import.spec.ts` | 프로젝트 메모리(용어/가이드라인) 임포트 및 검증 |
| `e2e/project-sidebar-new.spec.ts` | 프로젝트 사이드바 새 프로젝트 생성/전환 |
| `e2e/record-demos.spec.ts` | 데모 영상 녹화기 (`playwright.web.config.ts`의 `testIgnore`로 회귀 스위트에서 제외) |
| `e2e/record-ai.spec.ts` | AI 데모 영상 녹화기 (타이핑 지연 + `.webm`을 `remotion-demo/public/recordings`로 복사. 주의: 현재 `testIgnore`에 없어 회귀 스위트에 섞여 실행됨) |

**여러 블록이 필요한 테스트는 문서를 주입한다** (`seedProject` in `selection-editing.spec.ts`):

- 키보드로 문단을 늘리면(`ControlOrMeta+End` → Enter → 타이핑) 캐럿이 레이아웃에 따라 다른 곳에 놓여 **두 문단이 하나로 합쳐진다**. 실제로 이 셋업 사고로 테스트가 거짓 실패했다(단독 실행은 통과, 전체 실행은 실패).
- 문서 본문은 `segments`를 타고 `blocks`에서 조립된다(`buildTargetDocument`). `segments: []`면 에디터가 **빈 문서**로 뜬다.
- 표처럼 문서 구조를 바꾸는 픽스처는 별도 프로젝트(별도 `describe` + `beforeEach`)로 분리한다. 공용 문서에 표를 넣으면 기존 테스트의 문단 개수 단언이 깨진다.
- 표 다중 셀 선택은 `page.mouse`로 첫 셀 → 마지막 셀 드래그해야 `CellSelection`이 만들어진다. `selectText()`로는 안 된다.
- 클립보드 검증은 `page.context().grantPermissions(['clipboard-read', 'clipboard-write'])` 선행 필수(기본 설정은 권한을 주지 않는다).
- 인라인 툴바는 150ms 디바운스 후 뜬다 — 병렬 부하에서 간헐적으로 놓칠 수 있다(관측된 flake).

### Test Harness

`http://localhost:1421/test-harness.html`에서 붙여넣기 정규화를 실시간 테스트:
- Input HTML / Normalized HTML / Editor HTML / Editor JSON 비교
- Quick Test Cases 버튼으로 엣지 케이스 테스트
- 실제 TipTap 에디터와 동일한 설정 사용

### Unit Tests (Vitest)

- **테스트 파일 검색 패턴**: `vitest.config.ts`의 `include: ['src/**/*.{test,spec}.{ts,tsx}']`
- **테스트 파일 개수 확인**:
  ```bash
  find src -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.spec.ts" | wc -l
  ```
- 테스트 코드는 대상 소스와 동일 디렉토리에 위치(`*.test.ts`, `*.test.tsx`, `*.spec.ts`)하며, 특정 파일 목록은 코드 변경에 따라 지속적으로 갱신되므로 위 명령어로 실시간 개수를 파악합니다.

## Backend Testing (Rust)

```bash
cd src-tauri && cargo test
```

- **Location**: `src-tauri/src/` with `#[cfg(test)]` modules
- **Current focus**: `db/mod.rs` snapshot lifecycle test (create/list/get/delete + rename + legacy null filtering)

## Integration Testing

- Test full workflows: load project → edit → save → AI chat
- Manual testing recommended for complex UI interactions

## Debugging Tips

### Frontend Issues

```bash
# Check Vite console for build errors
npm run dev

# Inspect Zustand state
# Use React DevTools → Components → find store hooks
```

### Backend Issues

```bash
# Rust compilation errors
cd src-tauri && cargo check

# Runtime errors
# Check Tauri console logs in dev mode
```

### AI Integration Issues

- **LangChain Errors**: Check `src/ai/client.ts` model initialization
- **Tool Call Failures**: Verify tool schemas match function signatures
- **Token Limit**: Reduce context size (glossary, context blocks, attachments)

### MCP Connection Issues

- **OAuth Failures**: Verify redirect URIs in MCP server config
- **SSE Connection Drops**: Check network logs for event stream errors

### Tauri Testing Bridge Issues

- **`Method not found: dom.*`**
  - 원인: Rust RPC 허용 목록 누락
  - 확인: `crates/tauri-plugin-testing/src/lib.rs`의 `handle_rpc_request` match arm

- **`failed to bind websocket server: Address already in use`**
  - 원인: 포트 충돌
  - 해결: `TAURI_TEST_PORT`를 다른 포트로 변경 (앱/MCP 동일 값 사용)

- **`unauthorized` / 연결 직후 종료**
  - 원인: 토큰 불일치
  - 해결: 앱 실행 env의 `TAURI_TEST_TOKEN`과 MCP 실행 env를 동일하게 맞춤

- **버튼/텍스트를 못 찾음**
  - 단일 CSS selector보다 `tauri_dom_click_by_text` + `selector` 범위 지정 사용
  - 다수 매치 시 `tauri_dom_query_selector`로 후보 수 확인 후 `index` 지정
  - 동적 렌더링 UI는 `tauri_dom_wait_for_selector` 또는 `tauri_dom_wait_for_text` 선행

- **확인 팝업 처리 실패**
  - DOM에 안 보이는 native dialog일 수 있음
  - `tauri_dialog_set_auto_response`로 기본 응답 정책 설정 후 실행
  - 필요 시 `tauri_dialog_push_response`로 다음 confirm/prompt 1회 응답 주입
  - 발생 이벤트는 `tauri_dialog_get_state`로 확인

## File Organization & Version Management

- **File Organization**: 주요 디렉토리 구조 및 아키텍처는 `.claude/CLAUDE.md`의 `Key Directories` 및 `.claude/architecture.md`를 참조하세요.
- **Version Management**: 버전 동기화 대상 4개 파일(`package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`) 및 관리 규칙은 `.claude/CLAUDE.md`를 참조하세요.

## Version Control

- **Branch Strategy**: `main` (단일 브랜치, 직접 커밋)
- **Commit Messages**: Use imperative mood (Korean preferred)
