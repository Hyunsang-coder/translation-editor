---
name: e2e-scenario
description: Tauri 런타임 E2E 시나리오 생성. 자연어로 테스트 시나리오를 설명하면 MCP 브리지 기반 자동화 스크립트를 생성합니다. 새 시나리오 추가, 회귀 테스트, 기능 검증 시 사용.
argument-hint: "<시나리오 설명> [--dry-run] [--attach-to-running]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# /e2e-scenario

자연어 설명으로 Tauri 런타임 E2E 테스트 시나리오를 자동 생성합니다.

## Usage

```
/e2e-scenario 프로젝트를 생성하고 설정을 채운 뒤 문서를 번역해봐
/e2e-scenario 히스토리 스냅샷을 저장하고 복원하는 시나리오
/e2e-scenario 채팅에서 번역문 요약을 요청하고 응답을 확인해봐
/e2e-scenario 커넥터 설정(Notion/Confluence) 연결 흐름 테스트
/e2e-scenario --dry-run 리뷰 후 수정 제안을 적용하는 전체 흐름
/e2e-scenario --attach-to-running 이미 실행 중인 Tauri 앱에 연결해서 채팅 테스트
```

---

## Architecture Overview

```
Test Script (.mjs)
    ↓ MCP Client (stdio)
MCP Server (tauri-testing-mcp)
    ↓ WebSocket (JSON-RPC 2.0)
Tauri Plugin (tauri-plugin-testing)
    ↓ JS Injection
bridge.js → DOM / Dialog / Tauri API
```

- **Script**: `scripts/tauri-testing-mcp-<name>.mjs`
- **MCP Server**: `tauri-testing-mcp/dist/index.js`
- **Bridge Plugin**: `crates/tauri-plugin-testing/`
- **Bridge JS**: `crates/tauri-plugin-testing/js/bridge.js`

---

## Available MCP Tools (36개)

### DOM 조회 (Query)

| Tool | Description | Key Params |
|------|-------------|------------|
| `tauri_dom_query_selector` | CSS 셀렉터로 요소 찾기 | `selector`, `index?` |
| `tauri_dom_get_text` | 텍스트 가져오기 | `selector`, `index?` |
| `tauri_dom_get_value` | input/textarea/contenteditable 값 | `selector`, `index?` |
| `tauri_dom_get_all` | 매칭되는 모든 요소 (max 100) | `selector` |
| `tauri_dom_get_page_content` | DOM 트리 직렬화 | `maxNodes?`, `maxDepth?` |

### DOM 조작 (Interaction)

| Tool | Description | Key Params |
|------|-------------|------------|
| `tauri_dom_click` | CSS 셀렉터로 클릭 | `selector`, `index?` |
| `tauri_dom_click_by_text` | 텍스트로 클릭 | `text`, `exact?`, `visibleOnly?`, `selector?` |
| `tauri_dom_fill` | input/textarea 값 설정 | `selector`, `value`, `index?` |
| `tauri_dom_fill_by_placeholder` | placeholder로 입력 | `placeholder`, `value` |
| `tauri_dom_type_contenteditable` | contenteditable에 타이핑 (인덱스) | `index`, `value`, `clear?` |
| `tauri_dom_type_contenteditable_by_selector` | contenteditable에 타이핑 (셀렉터) | `selector`, `value`, `clear?` |
| `tauri_dom_select` | `<select>` 옵션 선택 | `selector`, `value?`, `text?`, `optionIndex?` |
| `tauri_dom_keyboard` | 키보드 이벤트 발송 | `key`, `modifiers?`, `selector?` |
| `tauri_dom_scroll_to` | 스크롤 | `selector?`, `x?`, `y?` |

### DOM 대기 (Wait)

| Tool | Description | Key Params |
|------|-------------|------------|
| `tauri_dom_wait_for_selector` | 요소 출현 대기 | `selector`, `timeout?`, `visible?` |
| `tauri_dom_wait_for_text` | 텍스트 출현 대기 | `text`, `timeout?` |
| `tauri_dom_wait_for_hidden` | 요소 사라짐 대기 | `selector`, `timeout?` |

### Dialog 제어

| Tool | Description | Key Params |
|------|-------------|------------|
| `tauri_dialog_get_state` | 다이얼로그 이벤트 히스토리 | - |
| `tauri_dialog_set_auto_response` | 자동 응답 정책 설정 | `confirm?`, `promptText?`, `tauriAsk?`, `tauriConfirm?` |
| `tauri_dialog_push_response` | 1회성 응답 큐잉 | `type`, `value` |
| `tauri_dialog_clear` | 히스토리 초기화 | - |

### Tauri 명령

| Tool | Description | Key Params |
|------|-------------|------------|
| `tauri_invoke` | Tauri command 호출 | `command`, `args?` |
| `tauri_emit` | 이벤트 발행 | `event`, `payload?` |

### 윈도우 제어

| Tool | Description | Key Params |
|------|-------------|------------|
| `tauri_window_get_title` | 윈도우 타이틀 | `label?` |
| `tauri_window_get_size` | 윈도우 크기 | `label?` |
| `tauri_window_set_size` | 윈도우 크기 변경 | `width`, `height`, `label?` |
| `tauri_window_list` | 윈도우 목록 | - |
| `tauri_window_maximize` | 최대화 | `label?` |
| `tauri_window_minimize` | 최소화 | `label?` |
| `tauri_window_close` | 닫기 | `label?` |
| `tauri_window_screenshot` | 스크린샷 (macOS only) | `label?`, `path?` |

### 앱 제어

| Tool | Description | Key Params |
|------|-------------|------------|
| `tauri_app_ping` | 헬스 체크 | - |
| `tauri_app_quit` | 앱 종료 | - |

---

## Selector Reference (data-testid)

### Project & Navigation
```
button[data-testid='project-new-button']        # 새 프로젝트 생성
input[data-testid='project-title-input']         # 프로젝트 제목 입력
button[data-testid='project-create-button']      # 프로젝트 생성 확인
button[data-testid='project-app-settings-button'] # 앱 설정 열기
```

### Editor
```
[data-testid='source-editor']                    # Source 에디터 래퍼
[data-testid='target-editor']                    # Target 에디터 래퍼
[data-testid='source-editor'] [contenteditable='true']  # Source contenteditable
[data-testid='target-editor'] [contenteditable='true']  # Target contenteditable
button[data-testid='editor-translate-button']    # 번역 버튼
button[data-testid='editor-review-button']       # 검수 버튼
button[data-testid='target-language-select']     # 타겟 언어 선택
```

### Translation
```
button[data-testid='translate-preview-apply-button']  # 번역 미리보기 적용
```

### Toolbar
```
button[data-testid='toolbar-tools-button']       # 도구 메뉴 열기
button[data-testid='toolbar-menu-chat']          # 채팅 패널 열기
button[data-testid='toolbar-menu-review']        # 리뷰 패널 열기
button[data-testid='toolbar-menu-settings']      # 설정 패널 열기
```

### Chat
```
[data-testid='chat-composer-container']                           # 채팅 입력 컨테이너
[data-testid='chat-composer-container'] [contenteditable='true']  # 채팅 입력 필드
button[data-testid='chat-send-button']                            # 전송 버튼
button[data-testid='chat-model-select']                           # 모델 선택
div[data-testid='chat-message-user']                              # 유저 메시지
div[data-testid='chat-message-assistant']                         # 어시스턴트 메시지
```

### Settings
```
button[data-testid='app-settings-close-button']                   # 설정 닫기
textarea[data-testid='settings-translator-persona']               # 번역가 페르소나
textarea[data-testid='settings-translation-rules']                # 번역 규칙
textarea[data-testid='settings-project-context']                  # 프로젝트 컨텍스트
#anthropic-enabled                                                 # Anthropic 토글
```

### Review
```
button[data-testid='review-run-button']                           # 리뷰 실행
```

---

## Script Template

모든 시나리오 스크립트는 다음 구조를 따릅니다.

```javascript
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = process.cwd();
const port = Number(process.env.TAURI_TEST_PORT ?? '9876');
const token = process.env.TAURI_TEST_TOKEN ?? 'tauri-testing-token';

// ── Utility Functions (기존 workflow에서 재사용) ──

function log(msg) { process.stdout.write(`${msg}\n`); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function parseToolText(result) {
  const text = result?.content?.find?.((c) => c?.type === 'text')?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return { text }; }
}

function isRpcError(parsed) {
  return parsed && typeof parsed.text === 'string' && parsed.text.startsWith('RPC ');
}

async function callTool(client, name, args = {}) {
  const raw = await client.callTool({ name, arguments: args });
  const parsed = parseToolText(raw);
  log(`\n[tool] ${name}`);
  log(JSON.stringify(parsed, null, 2));
  if (isRpcError(parsed)) throw new Error(`${name} failed: ${parsed.text}`);
  return parsed;
}

async function tryTool(client, name, args = {}) {
  try {
    const raw = await client.callTool({ name, arguments: args });
    const parsed = parseToolText(raw);
    return !isRpcError(parsed);
  } catch { return false; }
}

async function callToolQuiet(client, name, args = {}) {
  const raw = await client.callTool({ name, arguments: args });
  const parsed = parseToolText(raw);
  if (isRpcError(parsed)) throw new Error(`${name} failed: ${parsed.text}`);
  return parsed;
}

async function getSelectorMatchCount(client, selector) {
  try {
    const r = await callToolQuiet(client, 'tauri_dom_query_selector', { selector });
    return Number(r.matchCount ?? (r.found ? 1 : 0));
  } catch { return 0; }
}

// ── Port / Build / Process helpers (기존 패턴) ──

async function waitForPortOpen(host, targetPort, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isOpen = await new Promise((resolve) => {
      const s = new net.Socket();
      s.setTimeout(500);
      s.once('connect', () => { s.destroy(); resolve(true); });
      const close = () => { s.destroy(); resolve(false); };
      s.once('error', close);
      s.once('timeout', close);
      s.connect(targetPort, host);
    });
    if (isOpen) return;
    await sleep(300);
  }
  throw new Error(`Timeout waiting for ws://${host}:${targetPort}`);
}

function ensureMcpBuilt() {
  const r = spawnSync('npm', ['--prefix', 'tauri-testing-mcp', 'run', 'build'], {
    cwd: root, stdio: 'inherit', env: process.env,
  });
  if (r.status !== 0) throw new Error('Failed to build tauri-testing-mcp');
}

function startTauriDev() {
  const child = spawn('npx', ['tauri', 'dev', '--features', 'testing'], {
    cwd: root,
    env: { ...process.env, TAURI_TESTING_ENABLED: '1', TAURI_TEST_TOKEN: token, TAURI_TEST_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => {
    const l = String(c);
    if (l.includes('tauri-plugin-testing') || l.includes('Running') || l.includes('error'))
      process.stdout.write(`[tauri] ${l}`);
  });
  child.stderr.on('data', (c) => process.stderr.write(`[tauri:err] ${String(c)}`));
  return child;
}

function createMcpClient() {
  return {
    transport: new StdioClientTransport({
      command: 'node', args: ['dist/index.js'],
      cwd: path.join(root, 'tauri-testing-mcp'),
      env: { ...process.env, TAURI_TEST_TOKEN: token, TAURI_TEST_PORT: String(port) },
    }),
    client: new Client({ name: 'mcp-scenario-client', version: '0.1.0' }, { capabilities: {} }),
  };
}

// ══════════════════════════════════════════
//  SCENARIO: AI가 여기에 시나리오를 작성합니다
// ══════════════════════════════════════════

async function runScenario(client) {
  // TODO: AI가 자연어 설명에 기반해 시나리오 로직을 생성합니다
  // 예시:
  // await callTool(client, 'tauri_dom_wait_for_text', { text: 'New', timeout: 15000 });
  // await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-new-button']" });
  // ...

  log('\n[success] Scenario passed');
}

// ── Main (boilerplate) ──

async function main() {
  ensureMcpBuilt();
  const tauri = startTauriDev();
  let stopping = false;
  const stopTauri = () => { if (stopping) return; stopping = true; if (!tauri.killed) tauri.kill('SIGINT'); };
  process.on('SIGINT', () => { stopTauri(); process.exit(130); });

  try {
    await waitForPortOpen('127.0.0.1', port, 120000);
    const { transport, client } = createMcpClient();
    try {
      await client.connect(transport);
      await runScenario(client);
    } finally {
      try { await client.close(); } catch {}
    }
  } finally {
    const waitExit = new Promise((r) => tauri.once('exit', r));
    stopTauri();
    const ok = await Promise.race([waitExit.then(() => true), sleep(5000).then(() => false)]);
    if (!ok && !tauri.killed) { tauri.kill('SIGKILL'); await Promise.race([waitExit, sleep(2000)]); }
  }
}

main().catch((e) => { console.error(`\n[error] ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
```

### --attach-to-running 변형 (이미 실행 중인 앱에 연결)

Tauri 앱이 이미 testing 모드로 실행 중이라면 `startTauriDev()`와 프로세스 관리를 생략합니다:

```javascript
async function main() {
  ensureMcpBuilt();
  // Tauri 프로세스 시작 없이 바로 MCP 연결
  const { transport, client } = createMcpClient();
  try {
    await client.connect(transport);
    await runScenario(client);
  } finally {
    try { await client.close(); } catch {}
  }
}
```

---

## Scenario Building Blocks

### Block 1: 프로젝트 생성

```javascript
async function createProject(client, title) {
  await callTool(client, 'tauri_dom_wait_for_text', { text: 'New', timeout: 15000 });
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-new-button']" });
  await callTool(client, 'tauri_dom_wait_for_selector', { selector: "input[data-testid='project-title-input']", timeout: 5000 });
  await callTool(client, 'tauri_dom_fill', { selector: "input[data-testid='project-title-input']", value: title });
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-create-button']" });
  await callTool(client, 'tauri_dom_wait_for_selector', { selector: `[title='${title}']`, timeout: 10000 });
}
```

### Block 2: 앱 설정 (Anthropic 활성화)

```javascript
async function ensureAnthropicEnabled(client) {
  await callTool(client, 'tauri_dom_wait_for_selector', { selector: "button[data-testid='project-app-settings-button']", timeout: 10000 });
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-app-settings-button']" });
  await callTool(client, 'tauri_dom_wait_for_selector', { selector: '#anthropic-enabled', timeout: 10000 });
  const toggle = await callTool(client, 'tauri_dom_query_selector', { selector: '#anthropic-enabled' });
  if (!toggle.checked) await callTool(client, 'tauri_dom_click', { selector: '#anthropic-enabled' });
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='app-settings-close-button']" });
}
```

### Block 3: 프로젝트 설정 (페르소나/규칙/컨텍스트)

```javascript
async function fillProjectSettings(client, { persona, rules, context }) {
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='toolbar-tools-button']" });
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='toolbar-menu-settings']" });
  await callTool(client, 'tauri_dom_wait_for_selector', { selector: "textarea[data-testid='settings-translator-persona']", timeout: 5000 });

  if (persona) await callTool(client, 'tauri_dom_fill', { selector: "textarea[data-testid='settings-translator-persona']", value: persona });
  if (rules)   await callTool(client, 'tauri_dom_fill', { selector: "textarea[data-testid='settings-translation-rules']", value: rules });
  if (context)  await callTool(client, 'tauri_dom_fill', { selector: "textarea[data-testid='settings-project-context']", value: context });
  await sleep(700); // DebouncedTextarea 반영 대기
}
```

### Block 4: Source 입력 + 번역

```javascript
async function translateDocument(client, { sourceText, targetLanguage = '영어' }) {
  // Source 입력
  await callTool(client, 'tauri_dom_fill', {
    selector: "[data-testid='source-editor'] [contenteditable='true']",
    value: sourceText,
  });

  // 타겟 언어 선택
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='target-language-select']" });
  let selected = await tryTool(client, 'tauri_dom_click_by_text', { text: targetLanguage, visibleOnly: true, exact: true });
  if (!selected) selected = await tryTool(client, 'tauri_dom_click_by_text', { text: targetLanguage, visibleOnly: true, exact: false });
  if (!selected) throw new Error(`Failed to select language: ${targetLanguage}`);

  // 번역 실행
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='editor-translate-button']" });
  await callTool(client, 'tauri_dom_wait_for_selector', {
    selector: "button[data-testid='translate-preview-apply-button']",
    timeout: 120000,
  });

  // Apply 버튼 활성화 대기
  for (let i = 0; i < 180; i++) {
    const state = await callToolQuiet(client, 'tauri_dom_query_selector', {
      selector: "button[data-testid='translate-preview-apply-button']",
    });
    if (!state.disabled) break;
    if (i === 179) throw new Error('Translate apply button did not enable');
    await sleep(1000);
  }
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='translate-preview-apply-button']" });
  await sleep(1000);

  // 번역 결과 확인
  const target = await callTool(client, 'tauri_dom_get_text', {
    selector: "[data-testid='target-editor'] [contenteditable='true']",
  });
  if (!target.text?.trim()) throw new Error('Target editor is empty after apply');
  return target.text;
}
```

### Block 5: 리뷰 실행

```javascript
async function runReview(client) {
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='editor-review-button']" });
  await callTool(client, 'tauri_dom_wait_for_selector', { selector: "button[data-testid='review-run-button']", timeout: 10000 });
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='review-run-button']" });

  const reviewing = await tryTool(client, 'tauri_dom_wait_for_text', { text: '분석하고 있습니다', timeout: 15000 });
  if (!reviewing) {
    const done = await tryTool(client, 'tauri_dom_wait_for_text', { text: '다시 검수', timeout: 15000 });
    if (!done) throw new Error('Review did not show expected state');
  }
}
```

### Block 6: 채팅 (메시지 전송 + 응답 대기)

```javascript
async function openChatPanel(client) {
  const chatSelector = "[data-testid='chat-composer-container']";
  const isVisible = await tryTool(client, 'tauri_dom_wait_for_selector', { selector: chatSelector, timeout: 1500, visible: true });
  if (!isVisible) {
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='toolbar-tools-button']" });
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='toolbar-menu-chat']" });
  }
  await callTool(client, 'tauri_dom_wait_for_selector', { selector: chatSelector, timeout: 5000, visible: true });
}

async function sendChatMessage(client, message, { timeoutMs = 120000 } = {}) {
  const composerSelector = "[data-testid='chat-composer-container'] [contenteditable='true']";
  const sendSelector = "button[data-testid='chat-send-button']";
  const assistantSelector = "div[data-testid='chat-message-assistant']";

  const countBefore = await getSelectorMatchCount(client, assistantSelector);

  // 메시지 입력
  for (let i = 0; i < 12; i++) {
    const ok = await tryTool(client, 'tauri_dom_type_contenteditable_by_selector', {
      selector: composerSelector, value: message, clear: true,
    });
    if (ok) break;
    if (i === 11) throw new Error('Chat composer fill failed');
    await sleep(250);
  }

  // 전송 버튼 활성화 대기
  for (let i = 0; i < 30; i++) {
    const s = await callToolQuiet(client, 'tauri_dom_query_selector', { selector: sendSelector });
    if (!s.disabled) break;
    if (i === 29) throw new Error('Send button stayed disabled');
    await sleep(200);
  }

  await callTool(client, 'tauri_dom_click', { selector: sendSelector });
  await callTool(client, 'tauri_dom_wait_for_text', { text: message, timeout: 20000 });

  // 응답 대기 (waitForAssistantReply 로직)
  const deadline = Date.now() + timeoutMs;
  const pendingHints = ['요청 분석', '답변 생성', '컨텍스트 확인 중', '툴 실행 중', '분석하고 있습니다'];
  const timeOnlyPattern = /^(오전|오후)?\s*\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?$/i;

  while (Date.now() < deadline) {
    const count = await getSelectorMatchCount(client, assistantSelector);
    if (count > countBefore) {
      const last = await callToolQuiet(client, 'tauri_dom_query_selector', { selector: assistantSelector, index: count - 1 });
      const text = String(last.textContent ?? '').trim();
      if (!text || text === message || text.includes('답변 생성 중')) { await sleep(300); continue; }
      if (pendingHints.some((h) => text.includes(h))) { await sleep(500); continue; }
      if (timeOnlyPattern.test(text) || text.length < 10) { await sleep(500); continue; }
      if (text.startsWith('⚠️')) throw new Error(`Assistant error: ${text}`);
      return text;
    }
    await sleep(1000);
  }
  throw new Error('Assistant reply timeout');
}
```

### Block 7: 모델 선택

```javascript
async function selectChatModel(client, preferredModels = ['Opus 4.6', 'Sonnet 4.5', 'Haiku 4.5']) {
  const ready = await tryTool(client, 'tauri_dom_wait_for_selector', {
    selector: "button[data-testid='chat-model-select']", timeout: 5000,
  });
  if (!ready) return false;
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='chat-model-select']" });
  for (const model of preferredModels) {
    if (await tryTool(client, 'tauri_dom_click_by_text', { text: model, visibleOnly: true, exact: true })) return true;
  }
  return await tryTool(client, 'tauri_dom_click', { selector: "[role='option']", index: 0 });
}
```

### Block 8: Dialog 사전 설정

```javascript
async function setupDialogAutoResponse(client, { confirm = true, tauriConfirm = true } = {}) {
  await callTool(client, 'tauri_dialog_set_auto_response', { confirm, tauriConfirm, tauriAsk: true });
}
```

---

## Scenario Patterns

### Pattern A: Full Translation Workflow
```
프로젝트 생성 → 앱 설정 → 프로젝트 설정 → 원문 입력 → 번역 → 리뷰 → 채팅
```
**용도**: 전체 기능 회귀 테스트, CI 파이프라인

### Pattern B: Translation Only
```
프로젝트 생성 → 원문 입력 → 번역 → 결과 확인
```
**용도**: 번역 기능 변경 후 빠른 검증

### Pattern C: Chat Scenario
```
프로젝트 생성 → 원문+번역 준비 → 채팅 열기 → 다양한 질문
```
**용도**: 채팅 관련 기능 테스트, 프롬프트 변경 후 검증

### Pattern D: Settings & Connector
```
프로젝트 생성 → 앱 설정 (API키/커넥터) → 프로젝트 설정 확인
```
**용도**: 설정 UI 변경 후 검증

### Pattern E: History Workflow
```
프로젝트 생성 → 번역 → 히스토리 저장 → 번역 수정 → 히스토리 비교/복원
```
**용도**: 히스토리 기능 테스트

### Pattern F: Edge Case Testing
```
빈 문서 번역 시도, 매우 긴 문서, 특수문자, 다국어 혼합 등
```
**용도**: 안정성 테스트

---

## Sample Source Texts (도메인별)

### 기술 문서 (기본)
```javascript
const techDoc = [
  '- 결제 API 통합 개요',
  '  - 인증 토큰을 발급받아 요청 헤더에 포함합니다.',
  '  - 결제 요청에는 주문 ID, 금액, 통화를 반드시 포함합니다.',
  '- 오류 처리 정책',
  '  - 실패 시 지수 백오프로 최대 3회 재시도합니다.',
].join('\n');
```

### 마케팅
```javascript
const marketingDoc = [
  '# 2025년 연간 사업 보고서',
  '',
  '올해 매출은 전년 대비 35% 성장하여 사상 최대치를 기록했습니다.',
  '특히 해외 시장에서의 약진이 두드러졌으며, 신규 파트너십 12건을 체결했습니다.',
  '',
  '## 주요 성과',
  '- 글로벌 사용자 100만 명 돌파',
  '- 신규 시장 3개국 진출 (일본, 베트남, 인도네시아)',
  '- 고객 만족도 NPS 72점 달성',
].join('\n');
```

### 법률
```javascript
const legalDoc = [
  '# 서비스 이용약관 (제3조)',
  '',
  '제3조 (서비스의 제공 및 변경)',
  '① 회사는 이용자에게 아래와 같은 서비스를 제공합니다.',
  '  1. 번역 서비스: AI 기반 문서 번역 및 검수',
  '  2. 저장 서비스: 번역 이력 및 스냅샷 관리',
  '② 회사는 서비스의 내용을 변경할 경우, 변경 사유 및 적용일자를 명시하여 7일 전에 공지합니다.',
].join('\n');
```

---

## Execution

### 새 시나리오 실행

```bash
# 1) 시나리오 스크립트 생성 후
node scripts/tauri-testing-mcp-<scenario-name>.mjs

# 2) 또는 package.json에 스크립트 등록 후
npm run test:e2e:tauri:mcp:<scenario-name>
```

### 이미 실행 중인 앱에 연결

```bash
# Tauri 앱이 testing 모드로 실행 중일 때
TAURI_TEST_PORT=9876 node scripts/tauri-testing-mcp-<name>.mjs
```

### package.json 스크립트 등록 규칙

```json
{
  "test:e2e:tauri:mcp:<name>": "node scripts/tauri-testing-mcp-<name>.mjs"
}
```

---

## Workflow: 스크립트 생성 과정

1. **사용자 설명 분석**: 어떤 기능을 테스트하는지 파악
2. **패턴 선택**: 위 Scenario Patterns에서 가장 적합한 패턴 결정
3. **빌딩 블록 조합**: 필요한 Block들을 조합하여 `runScenario()` 함수 작성
4. **소스 텍스트 선택**: 테스트 목적에 맞는 도메인별 샘플 사용
5. **어서션 추가**: 각 단계의 기대 결과를 검증하는 코드 추가
6. **스크립트 파일 저장**: `scripts/tauri-testing-mcp-<name>.mjs`
7. **package.json 등록**: npm script 추가

### --dry-run 모드

`--dry-run` 시 실제 스크립트를 생성하되 실행하지 않고, 시나리오 구조만 출력합니다:

```
═══════════════════════════════════════════════════════════
              E2E SCENARIO: <시나리오 이름>
═══════════════════════════════════════════════════════════

📋 PATTERN: Pattern A (Full Translation Workflow)
📦 BLOCKS: createProject → ensureAnthropicEnabled → fillProjectSettings → translateDocument → runReview → sendChatMessage
📄 FILE: scripts/tauri-testing-mcp-<name>.mjs
📝 SOURCE: 기술 문서 (5줄 계층형 bullet)
🎯 ASSERTIONS: 6개 (프로젝트 생성, 설정 반영, 번역 결과, 리뷰 상태, 채팅 응답, 오류 없음)

═══════════════════════════════════════════════════════════
```

---

## Important Notes

1. **TipTap contenteditable**: `fill`이 아닌 `type_contenteditable_by_selector`로 입력해야 TipTap이 인식합니다. `fill`은 Source 에디터 초기 입력에만 동작합니다.
2. **DebouncedTextarea**: 설정 필드는 `fill` 후 700ms 대기가 필요합니다.
3. **언어 선택 fallback**: 한/영 둘 다 시도하세요 (시스템 언어에 따라 다름).
4. **모델 선택**: Anthropic 키만 있으면 OpenAI 모델은 실패합니다. fallback 순서를 지키세요.
5. **Dialog**: 삭제/확인 팝업이 나오는 시나리오에선 반드시 `dialog.setAutoResponse` 선행.
6. **단일 클라이언트**: WebSocket은 1개 연결만 허용. 이전 연결이 남아있으면 새 연결이 실패합니다.
7. **기존 스크립트 보존**: `workflow.mjs`, `new-project.mjs`는 수정하지 않습니다. 새 시나리오는 별도 파일로 생성합니다.

## Related Skills

- `/tdd` - 유닛 테스트 TDD 워크플로우
- `/record-demo` - AI 주도 데모 영상 녹화
- `/typecheck` - 타입 체크 (스크립트 작성 후 검증)
- `/test-ai` - AI 페이로드 dry-run 테스트
