import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = process.cwd();
const port = Number(process.env.TAURI_TEST_PORT ?? '9876');
const token = process.env.TAURI_TEST_TOKEN ?? 'tauri-testing-token';

const TEXT = {
  saveSnapshot: ['Save Snapshot', '스냅샷 저장'],
  compare: ['Compare', '비교'],
  close: ['Close', '닫기'],
  save: ['Save', '저장'],
};

const LIST_LINE_PATTERN = /^(\s*)([-*+•]|\d+[.)])\s+(.+)$/u;

const SOURCE_TEXT = [
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

const TARGET_BASELINE_TEXT = [
  '1. Payment API integration checklist',
  '   1) Issue an auth token and include it in the request header.',
  '   2) Include order ID, amount, and currency in every payment request.',
  '2. Error handling policy',
  '   - Retry failures with exponential backoff up to 3 times.',
  '   - If retries still fail, log the error code and send an alert.',
  '3. Deployment validation',
  '   - Verify 4xx/5xx ratio in logs.',
  '     - Roll back when the threshold is exceeded.',
].join('\n');

const TARGET_MODIFIED_TEXT = [
  '1. Payment API integration checklist (updated)',
  '   1) Issue an auth token from a dedicated gateway endpoint.',
  '   2) Include order ID, amount, currency, and merchant ID in every request.',
  '2. Error handling policy (updated)',
  '   - Retry failures with exponential backoff up to 5 times.',
  '   - If retries still fail, open an incident ticket and notify on-call.',
  '3. Deployment validation (updated)',
  '   - Verify 4xx/5xx ratio and latency trend in logs.',
  '     - Roll back and freeze deploys when threshold is exceeded.',
].join('\n');

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

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

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
  const child = spawn('npx', ['tauri', 'dev', '--features', 'testing'], {
    cwd: root,
    env: {
      ...process.env,
      TAURI_TESTING_ENABLED: '1',
      TAURI_TEST_TOKEN: token,
      TAURI_TEST_PORT: String(port),
    },
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

async function clickByAnyText(client, texts, options = {}) {
  const selector = options.selector;
  const visibleOnly = options.visibleOnly ?? true;
  const exactFirst = options.exact ?? true;

  for (const text of texts) {
    const ok = await tryTool(client, 'tauri_dom_click_by_text', {
      text,
      selector,
      exact: exactFirst,
      visibleOnly,
    });
    if (ok) return text;
  }

  if (exactFirst) {
    for (const text of texts) {
      const ok = await tryTool(client, 'tauri_dom_click_by_text', {
        text,
        selector,
        exact: false,
        visibleOnly,
      });
      if (ok) return text;
    }
  }

  throw new Error(`Failed to click by texts: ${texts.join(', ')}`);
}

async function waitForSelectorIndex(client, selector, index, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await callToolQuiet(client, 'tauri_dom_query_selector', { selector, index });
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`Timeout waiting for selector index: ${selector}[${index}]`);
}

async function setCheckboxChecked(client, selector, index, expectedChecked) {
  const before = await callToolQuiet(client, 'tauri_dom_query_selector', { selector, index });
  if (Boolean(before.checked) !== expectedChecked) {
    await callTool(client, 'tauri_dom_click', { selector, index });
  }
  const after = await callToolQuiet(client, 'tauri_dom_query_selector', { selector, index });
  if (Boolean(after.checked) !== expectedChecked) {
    throw new Error(`Failed to set checkbox(${index}) checked=${expectedChecked}`);
  }
}

async function getButtonStateByAnyText(client, texts, selector = 'aside button') {
  const result = await callTool(client, 'tauri_dom_get_all', { selector, limit: 100 });
  const items = Array.isArray(result.items) ? result.items : [];
  const normalizedTargets = texts.map((text) => normalizeText(text).toLowerCase());

  for (const item of items) {
    const text = normalizeText(item.textContent).toLowerCase();
    if (!text) continue;
    if (normalizedTargets.some((target) => text === target || text.includes(target))) {
      return item;
    }
  }

  return null;
}

async function openHistoryDrawer(client) {
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='toolbar-menu-history']" });
  await callTool(client, 'tauri_dom_wait_for_selector', { selector: 'aside h2', timeout: 10000, visible: true });
}

async function closeHistoryDrawer(client) {
  await clickByAnyText(client, TEXT.close, { selector: 'aside button', exact: true, visibleOnly: true });
}

async function saveSnapshotViaDialog(client, description) {
  await clickByAnyText(client, TEXT.saveSnapshot, { selector: 'aside button', exact: false, visibleOnly: true });
  await callTool(client, 'tauri_dom_wait_for_selector', { selector: '#history-description', timeout: 10000, visible: true });
  await callTool(client, 'tauri_dom_fill', { selector: '#history-description', value: description });
  await clickByAnyText(client, TEXT.save, { selector: "[role='dialog'] button", exact: true, visibleOnly: true });
  await callTool(client, 'tauri_dom_wait_for_hidden', { selector: '#history-description', timeout: 10000 });
}

async function runScenario() {
  const projectTitle = `History Compare E2E ${Date.now()}`;
  const baselineSnapshot = `baseline-${Date.now()}`;
  const modifiedSnapshot = `modified-${Date.now()}`;
  const sourceEditable = "[data-testid='source-editor'] [contenteditable='true']";
  const targetEditable = "[data-testid='target-editor'] [contenteditable='true']";
  const checkboxSelector = 'aside input[type="checkbox"]';

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

  const client = new Client({ name: 'mcp-history-compare-client', version: '0.1.0' }, { capabilities: {} });

  try {
    await client.connect(transport);

    log('\n═══ Phase 1: Create Project ═══');
    await callTool(client, 'tauri_dom_wait_for_text', { text: 'New', timeout: 15000 });
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-new-button']" });
    await callTool(client, 'tauri_dom_wait_for_selector', { selector: "input[data-testid='project-title-input']", timeout: 5000 });
    await callTool(client, 'tauri_dom_fill', { selector: "input[data-testid='project-title-input']", value: projectTitle });
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-create-button']" });
    await callTool(client, 'tauri_dom_wait_for_selector', { selector: `[title='${projectTitle}']`, timeout: 10000 });

    log('\n═══ Phase 2: Fill Structured Source/Target ═══');
    await callTool(client, 'tauri_dom_fill', { selector: sourceEditable, value: SOURCE_TEXT });
    await callTool(client, 'tauri_dom_fill', { selector: targetEditable, value: TARGET_BASELINE_TEXT });
    await sleep(700);

    const baselineTarget = await callTool(client, 'tauri_dom_get_text', { selector: targetEditable });
    const baselineHierarchy = assertListHierarchyPreserved({
      sourceText: SOURCE_TEXT,
      targetText: String(baselineTarget.text),
      label: 'Baseline target',
    });
    log(`[list] Baseline hierarchy preserved (${baselineHierarchy.count} items): ${baselineHierarchy.targetSig}`);

    log('\n═══ Phase 3: Save Baseline Snapshot ═══');
    await openHistoryDrawer(client);
    const compareBefore = await getButtonStateByAnyText(client, TEXT.compare);
    if (!compareBefore) {
      throw new Error('Compare button not found in History drawer');
    }
    if (!compareBefore.disabled) {
      throw new Error('Compare button should be disabled before selecting two items');
    }
    await saveSnapshotViaDialog(client, baselineSnapshot);
    await closeHistoryDrawer(client);

    log('\n═══ Phase 4: Modify Target With Same Hierarchy ═══');
    await callTool(client, 'tauri_dom_type_contenteditable_by_selector', {
      selector: targetEditable,
      value: TARGET_MODIFIED_TEXT,
      clear: true,
    });
    await sleep(700);

    const modifiedTarget = await callTool(client, 'tauri_dom_get_text', { selector: targetEditable });
    const modifiedHierarchy = assertListHierarchyPreserved({
      sourceText: SOURCE_TEXT,
      targetText: String(modifiedTarget.text),
      label: 'Modified target',
    });
    log(`[list] Modified hierarchy preserved (${modifiedHierarchy.count} items): ${modifiedHierarchy.targetSig}`);

    log('\n═══ Phase 5: Save Modified Snapshot & Compare ═══');
    await openHistoryDrawer(client);
    await saveSnapshotViaDialog(client, modifiedSnapshot);

    await waitForSelectorIndex(client, checkboxSelector, 2, 10000);
    await setCheckboxChecked(client, checkboxSelector, 0, false); // current state off
    await setCheckboxChecked(client, checkboxSelector, 1, true);  // newest snapshot
    await setCheckboxChecked(client, checkboxSelector, 2, true);  // older snapshot

    const compareAfter = await getButtonStateByAnyText(client, TEXT.compare);
    if (!compareAfter) {
      throw new Error('Compare button not found after selection');
    }
    if (compareAfter.disabled) {
      throw new Error('Compare button should be enabled when exactly two snapshots are selected');
    }

    await clickByAnyText(client, TEXT.compare, { selector: 'aside button', exact: false, visibleOnly: true });
    await callTool(client, 'tauri_dom_wait_for_selector', { selector: '#history-compare-base', timeout: 10000, visible: true });
    await callTool(client, 'tauri_dom_wait_for_selector', { selector: '#history-compare-target', timeout: 10000, visible: true });

    const baseValue = await callTool(client, 'tauri_dom_get_value', { selector: '#history-compare-base' });
    const targetValue = await callTool(client, 'tauri_dom_get_value', { selector: '#history-compare-target' });
    if (!String(baseValue.value ?? '').trim()) {
      throw new Error('Compare base snapshot select should have a selected value');
    }
    if (!String(targetValue.value ?? '').trim()) {
      throw new Error('Compare target snapshot select should auto-select the newer snapshot');
    }
    if (String(baseValue.value) === String(targetValue.value)) {
      throw new Error('Compare base and target snapshot should be different');
    }

    await callTool(client, 'tauri_dom_wait_for_text', { text: 'changes:', selector: "[role='dialog']", timeout: 10000, exact: false });
    await callTool(client, 'tauri_dom_keyboard', { key: 'Escape' });
    await callTool(client, 'tauri_dom_wait_for_hidden', { selector: '#history-compare-base', timeout: 10000 });
    await closeHistoryDrawer(client);

    log(`\n[success] History compare scenario passed: ${projectTitle}`);
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
    await runScenario();
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
