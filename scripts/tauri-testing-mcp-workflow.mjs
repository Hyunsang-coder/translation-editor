import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = process.cwd();
const port = Number(process.env.TAURI_TEST_PORT ?? '9876');
const token = process.env.TAURI_TEST_TOKEN ?? 'tauri-testing-token';

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseToolText(result) {
  const text = result?.content?.find?.((c) => c?.type === 'text')?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function isRpcError(parsed) {
  return parsed && typeof parsed.text === 'string'
    && (parsed.text.startsWith('RPC ') || parsed.text.startsWith('MCP error'));
}

async function waitForPortOpen(host, targetPort, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isOpen = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      const close = () => {
        socket.destroy();
        resolve(false);
      };
      socket.once('error', close);
      socket.once('timeout', close);
      socket.connect(targetPort, host);
    });
    if (isOpen) return;
    await sleep(300);
  }
  throw new Error(`Timeout waiting for ws://${host}:${targetPort}`);
}

function ensureMcpBuilt() {
  const result = spawnSync('npm', ['--prefix', 'tauri-testing-mcp', 'run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error('Failed to build tauri-testing-mcp');
  }
}

function startTauriDev() {
  const env = {
    ...process.env,
    TAURI_TESTING_ENABLED: '1',
    TAURI_TEST_TOKEN: token,
    TAURI_TEST_PORT: String(port),
  };

  const child = spawn('npx', ['tauri', 'dev', '--features', 'testing'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    const line = String(chunk);
    if (line.includes('tauri-plugin-testing') || line.includes('Running') || line.includes('error')) {
      process.stdout.write(`[tauri] ${line}`);
    }
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[tauri:err] ${String(chunk)}`);
  });

  return child;
}

async function callTool(client, name, args = {}) {
  const raw = await client.callTool({ name, arguments: args });
  const parsed = parseToolText(raw);
  log(`\n[tool] ${name}`);
  log(JSON.stringify(parsed, null, 2));
  if (isRpcError(parsed)) {
    throw new Error(`${name} failed: ${parsed.text}`);
  }
  return parsed;
}

async function tryTool(client, name, args = {}) {
  try {
    const raw = await client.callTool({ name, arguments: args });
    const parsed = parseToolText(raw);
    log(`\n[tool/try] ${name}`);
    log(JSON.stringify(parsed, null, 2));
    return !isRpcError(parsed);
  } catch {
    return false;
  }
}

async function callToolQuiet(client, name, args = {}) {
  const raw = await client.callTool({ name, arguments: args });
  const parsed = parseToolText(raw);
  if (isRpcError(parsed)) {
    throw new Error(`${name} failed: ${parsed.text}`);
  }
  return parsed;
}

async function closeClientSafely(client, timeoutMs = 2000) {
  try {
    await Promise.race([
      client.close(),
      sleep(timeoutMs),
    ]);
  } catch {
    // no-op
  }
}

async function getSelectorMatchCount(client, selector) {
  try {
    const result = await callToolQuiet(client, 'tauri_dom_query_selector', { selector });
    return Number(result.matchCount ?? (result.found ? 1 : 0));
  } catch {
    return 0;
  }
}

const LIST_LINE_PATTERN = /^(\s*)([-*+•]|\d+[.)])\s+(.+)$/u;

function extractListHierarchy(text) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  const lineItems = [];
  const lines = normalized.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, ' ').replace(/\t/g, '  ');
    const match = line.match(LIST_LINE_PATTERN);
    if (!match) continue;
    const marker = match[2] ?? '';
    const indent = (match[1] ?? '').length;
    lineItems.push({
      type: /^\d/.test(marker) ? 'ordered' : 'bullet',
      level: Math.floor(indent / 2),
    });
  }

  if (lineItems.length > 1) {
    return lineItems;
  }

  const markerItems = [];
  const markerPattern = /(\s*)([-*+•]|\d+[.)])\s+/gu;
  for (const match of normalized.matchAll(markerPattern)) {
    const marker = match[2] ?? '';
    const spaces = (match[1] ?? '').length;
    markerItems.push({
      type: /^\d/.test(marker) ? 'ordered' : 'bullet',
      level: Math.floor(Math.max(spaces - 1, 0) / 2),
    });
  }

  return markerItems;
}

function hierarchySignature(items) {
  return items.map((item) => `${item.type}:${item.level}`).join('|');
}

function assertListHierarchyPreserved({ sourceText, targetText, label }) {
  const sourceItems = extractListHierarchy(sourceText);
  const targetItems = extractListHierarchy(targetText);

  if (sourceItems.length === 0) {
    throw new Error('Source list test data has no list items');
  }
  if (targetItems.length === 0) {
    throw new Error(`${label}: no list markers detected in target text`);
  }

  const sourceTypes = new Set(sourceItems.map((item) => item.type));
  if (!sourceTypes.has('bullet') || !sourceTypes.has('ordered')) {
    throw new Error('Source list test data must include both bullet and ordered list markers');
  }

  const sourceSig = hierarchySignature(sourceItems);
  const targetSig = hierarchySignature(targetItems);
  if (sourceSig !== targetSig) {
    throw new Error(`${label}: list hierarchy mismatch (source=${sourceSig}, target=${targetSig})`);
  }

  return { sourceSig, targetSig, count: sourceItems.length };
}

async function waitForAssistantReply(client, { selector, previousCount, userText, timeoutMs = 120000 }) {
  const deadline = Date.now() + timeoutMs;
  const pendingHints = [
    '요청 분석',
    '답변 생성',
    '컨텍스트 확인 중',
    '툴 실행 중',
    '분석하고 있습니다',
  ];
  const timeOnlyPattern = /^(오전|오후)?\s*\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?$/i;
  while (Date.now() < deadline) {
    const count = await getSelectorMatchCount(client, selector);
    if (count > previousCount) {
      const last = await callToolQuiet(client, 'tauri_dom_query_selector', {
        selector,
        index: count - 1,
      });
      const text = String(last.textContent ?? '').trim();
      if (!text) {
        await sleep(300);
        continue;
      }
      if (text === userText || text.includes('답변 생성 중')) {
        await sleep(300);
        continue;
      }
      if (pendingHints.some((hint) => text.includes(hint))) {
        await sleep(500);
        continue;
      }
      if (timeOnlyPattern.test(text) || text.length < 10) {
        await sleep(500);
        continue;
      }
      if (text.startsWith('⚠️')) {
        throw new Error(`Assistant returned error response: ${text}`);
      }
      return text;
    }
    await sleep(1000);
  }
  throw new Error('Assistant reply did not arrive in time');
}

async function runWorkflow() {
  const projectTitle = `Workflow E2E ${Date.now()}`;
  const chatMessage = '번역문 내용 간략히 요약해줘';
  const toolbarSettingsSelector = "button[data-testid='toolbar-menu-settings']";
  const toolbarChatSelector = "button[data-testid='toolbar-menu-chat']";
  const chatSendButtonSelector = "button[data-testid='chat-send-button'], [data-testid='chat-composer-container'] ~ div button[type='submit']";
  const chatComposerEditableSelector = "[data-testid='chat-composer-container'] [contenteditable='true']";
  const chatModelSelectSelector = "button[data-testid='chat-model-select']";
  const assistantMessageSelector = "div[data-testid='chat-message-assistant']";
  const sourceText = [
    '1. 결제 API 통합 체크리스트',
    '   1) 인증 토큰을 발급받아 요청 헤더에 포함합니다.',
    '   2) 결제 요청에는 주문 ID, 금액, 통화를 반드시 포함합니다.',
    '2. 오류 처리 정책',
    '   - 실패 시 지수 백오프로 최대 3회 재시도합니다.',
    '   - 재시도 후에도 실패하면 에러 코드를 기록하고 알림을 전송합니다.',
    '3. 배포 검증',
    '   - 로그에서 4xx/5xx 비율을 확인합니다.',
    '     - 임계치 초과 시 롤백합니다.',
  ].join('\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    cwd: path.join(root, 'tauri-testing-mcp'),
    env: {
      ...process.env,
      TAURI_TEST_TOKEN: token,
      TAURI_TEST_PORT: String(port),
    },
  });

  const client = new Client({ name: 'mcp-workflow-client', version: '0.1.0' }, { capabilities: {} });

  try {
    await client.connect(transport);

    // 1) New project
    await callTool(client, 'tauri_dom_wait_for_text', { text: 'New', timeout: 15000 });
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-new-button']" });
    await callTool(client, 'tauri_dom_wait_for_selector', { selector: "input[data-testid='project-title-input']", timeout: 5000 });
    await callTool(client, 'tauri_dom_fill', { selector: "input[data-testid='project-title-input']", value: projectTitle });
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-create-button']" });
    await callTool(client, 'tauri_dom_wait_for_selector', { selector: `[title='${projectTitle}']`, timeout: 10000 });

    // 2) App settings: Anthropic provider enabled 확인
    await callTool(client, 'tauri_dom_wait_for_selector', { selector: "button[data-testid='project-app-settings-button']", timeout: 10000 });
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-app-settings-button']" });
    await callTool(client, 'tauri_dom_wait_for_selector', { selector: "#anthropic-enabled", timeout: 10000 });
    const anthropicToggle = await callTool(client, 'tauri_dom_query_selector', { selector: "#anthropic-enabled" });
    if (anthropicToggle.disabled) {
      throw new Error('Anthropic toggle is disabled. Check if ANTHROPIC_API_KEY is loaded into secure store.');
    }
    if (!anthropicToggle.checked) {
      await callTool(client, 'tauri_dom_click', { selector: "#anthropic-enabled" });
    }
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='app-settings-close-button']" });

    // 3) Open settings panel and fill rules/context
    await callTool(client, 'tauri_dom_wait_for_selector', { selector: toolbarSettingsSelector, timeout: 10000 });
    await callTool(client, 'tauri_dom_click', { selector: toolbarSettingsSelector });
    await callTool(client, 'tauri_dom_wait_for_selector', { selector: "textarea[data-testid='settings-translation-rules']", timeout: 5000 });
    await callTool(client, 'tauri_dom_fill', {
      selector: "textarea[data-testid='settings-translation-rules']",
      value: '1) 용어 일관성 유지\n2) 문장은 짧게\n3) 불필요한 의역 금지',
    });
    // 프로젝트 컨텍스트(legacy 필드)는 제거됨 → Project Memory 항목으로 대체
    await callTool(client, 'tauri_dom_fill', {
      selector: "[data-testid='project-memory-new-item']",
      value: '이 문서는 API 통합 가이드이며 독자는 개발자입니다.',
    });
    await callTool(client, 'tauri_dom_click', {
      selector: "[data-testid='project-memory-add']",
    });
    await sleep(700); // DebouncedTextarea 반영 대기

    // 4) Fill source and translate
    await callTool(client, 'tauri_dom_fill', {
      selector: "[data-testid='source-editor'] [contenteditable='true']",
      value: sourceText,
    });

    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='target-language-select']" });
    let languageSelected = await tryTool(client, 'tauri_dom_click_by_text', { text: '영어', visibleOnly: true, exact: true });
    if (!languageSelected) {
      languageSelected = await tryTool(client, 'tauri_dom_click_by_text', { text: 'English', visibleOnly: true, exact: true });
    }
    if (!languageSelected) {
      languageSelected = await tryTool(client, 'tauri_dom_click_by_text', { text: '영어', visibleOnly: true, exact: false });
    }
    if (!languageSelected) {
      languageSelected = await tryTool(client, 'tauri_dom_click_by_text', { text: 'English', visibleOnly: true, exact: false });
    }
    if (!languageSelected) {
      throw new Error('Failed to select target language as English');
    }

    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='editor-translate-button']" });
    await callTool(client, 'tauri_dom_wait_for_selector', {
      selector: "button[data-testid='translate-preview-apply-button']",
      timeout: 120000,
    });
    // 번역이 끝나 apply 버튼이 enable 될 때까지 대기
    let applyEnabled = false;
    for (let i = 0; i < 180; i += 1) {
      const state = await callTool(client, 'tauri_dom_query_selector', {
        selector: "button[data-testid='translate-preview-apply-button']",
      });
      if (!state.disabled) {
        applyEnabled = true;
        break;
      }
      await sleep(1000);
    }
    if (!applyEnabled) {
      throw new Error('Translate preview apply button did not become enabled in time');
    }
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='translate-preview-apply-button']" });

    // 번역 적용 후 target 문서에 텍스트가 존재하는지 확인
    await sleep(1000);
    const targetText = await callTool(client, 'tauri_dom_get_text', {
      selector: "[data-testid='target-editor'] [contenteditable='true']",
    });
    if (!targetText.text || String(targetText.text).trim().length === 0) {
      throw new Error('Target editor is empty after apply');
    }
    const listCheck = assertListHierarchyPreserved({
      sourceText,
      targetText: String(targetText.text),
      label: 'Translation output',
    });
    log(`[list] Hierarchy preserved (${listCheck.count} items): ${listCheck.targetSig}`);

    // 5) Review
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='editor-review-button']" });
    await callTool(client, 'tauri_dom_wait_for_selector', { selector: "button[data-testid='review-run-button']", timeout: 10000 });
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='review-run-button']" });

    // 검수는 모델/환경에 따라 완료 속도가 달라서 텍스트 2개를 fallback으로 확인
    const reviewing = await tryTool(client, 'tauri_dom_wait_for_text', { text: '분석하고 있습니다', timeout: 15000 });
    if (!reviewing) {
      const restarted = await tryTool(client, 'tauri_dom_wait_for_text', { text: '다시 검수', timeout: 15000 });
      if (!restarted) {
        throw new Error('Review phase did not show expected state text');
      }
    }

    // 6) Chat: 질문 전송 + assistant 응답 확인
    const chatContainerSelector = "[data-testid='chat-composer-container']";
    const isChatVisible = await tryTool(client, 'tauri_dom_wait_for_selector', {
      selector: chatContainerSelector,
      timeout: 1500,
      visible: true,
    });
    if (!isChatVisible) {
      await callTool(client, 'tauri_dom_click', { selector: toolbarChatSelector });
    }
    let chatVisible = await tryTool(client, 'tauri_dom_wait_for_selector', {
      selector: chatContainerSelector,
      timeout: 5000,
      visible: true,
    });
    if (!chatVisible) {
      // 첫 클릭이 "닫기"로 동작했을 수 있어 한 번 더 토글
      await callTool(client, 'tauri_dom_click', { selector: toolbarChatSelector });
      chatVisible = await tryTool(client, 'tauri_dom_wait_for_selector', {
        selector: chatContainerSelector,
        timeout: 5000,
        visible: true,
      });
    }
    if (!chatVisible) {
      throw new Error('Chat panel did not become visible');
    }

    await callTool(client, 'tauri_dom_wait_for_selector', {
      selector: chatComposerEditableSelector,
      timeout: 10000,
      visible: true,
    });
    await callTool(client, 'tauri_dom_wait_for_selector', {
      selector: chatSendButtonSelector,
      timeout: 10000,
      visible: true,
    });

    // 가능하면 Anthropic 모델을 선택해 키 불일치로 인한 실패를 줄임
    const modelSelectReady = await tryTool(client, 'tauri_dom_wait_for_selector', {
      selector: chatModelSelectSelector,
      timeout: 5000,
    });
    if (modelSelectReady) {
      await callTool(client, 'tauri_dom_click', { selector: chatModelSelectSelector });
      let modelSelected = await tryTool(client, 'tauri_dom_click_by_text', { text: 'Opus 4.6', visibleOnly: true, exact: true });
      if (!modelSelected) {
        modelSelected = await tryTool(client, 'tauri_dom_click_by_text', { text: 'Sonnet 4.5', visibleOnly: true, exact: true });
      }
      if (!modelSelected) {
        modelSelected = await tryTool(client, 'tauri_dom_click_by_text', { text: 'Haiku 4.5', visibleOnly: true, exact: true });
      }
      if (!modelSelected) {
        modelSelected = await tryTool(client, 'tauri_dom_click', { selector: "[role='option']", index: 0 });
      }
      if (!modelSelected) {
        log('[warn] Could not explicitly switch chat model; continuing with current model');
      }
    }

    const assistantCountBefore = await getSelectorMatchCount(client, assistantMessageSelector);

    let filled = false;
    for (let i = 0; i < 12; i += 1) {
      filled = await tryTool(client, 'tauri_dom_type_contenteditable_by_selector', {
        selector: chatComposerEditableSelector,
        value: chatMessage,
        clear: true,
      });
      if (filled) break;
      await sleep(250);
    }
    if (!filled) {
      throw new Error('Chat composer fill failed after retries');
    }

    let sendEnabled = false;
    for (let i = 0; i < 30; i += 1) {
      const sendState = await callToolQuiet(client, 'tauri_dom_query_selector', { selector: chatSendButtonSelector });
      if (!sendState.disabled) {
        sendEnabled = true;
        break;
      }
      await sleep(200);
    }
    if (!sendEnabled) {
      throw new Error('Chat send button stayed disabled');
    }

    await callTool(client, 'tauri_dom_click', { selector: chatSendButtonSelector });
    await callTool(client, 'tauri_dom_wait_for_text', { text: chatMessage, timeout: 20000 });
    const assistantReply = await waitForAssistantReply(client, {
      selector: assistantMessageSelector,
      previousCount: assistantCountBefore,
      userText: chatMessage,
      timeoutMs: 120000,
    });
    log(`[chat] Assistant reply received: ${assistantReply.slice(0, 160)}`);

    log(`\n[success] Workflow passed: ${projectTitle}`);
  } finally {
    await closeClientSafely(client);
  }
}

async function main() {
  ensureMcpBuilt();

  const tauri = startTauriDev();
  let stopping = false;

  const stopTauri = () => {
    if (stopping) return;
    stopping = true;
    if (!tauri.killed) tauri.kill('SIGINT');
  };

  process.on('SIGINT', () => {
    stopTauri();
    process.exit(130);
  });

  try {
    await waitForPortOpen('127.0.0.1', port, 120000);
    await runWorkflow();
  } finally {
    const waitExit = new Promise((resolve) => tauri.once('exit', resolve));
    stopTauri();
    const exitedGracefully = await Promise.race([
      waitExit.then(() => true),
      sleep(5000).then(() => false),
    ]);
    if (!exitedGracefully) {
      tauri.kill('SIGKILL');
      await Promise.race([waitExit, sleep(2000)]);
    }
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n[error] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
