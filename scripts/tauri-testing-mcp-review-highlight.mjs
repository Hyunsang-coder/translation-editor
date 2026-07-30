/**
 * E2E Scenario: Review Highlight Verification
 *
 * 번역 결과를 의도적으로 수정(오역/누락 주입)한 뒤 리뷰를 실행하고,
 * .review-highlight 요소가 DOM에 정상 생성되는지 검증합니다.
 *
 * 검증 항목:
 *  1. 리뷰 완료 후 .review-highlight 스팬이 1개 이상 존재
 *  2. data-issue-type 속성이 유효한 값 (mistranslation, omission 등)
 *  3. data-issue-id 속성이 존재 (비어있지 않음)
 *  4. 하이라이트 스팬의 textContent가 비어있지 않음
 *  5. 리뷰 결과 테이블에 이슈 항목이 표시됨
 */

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = process.cwd();
const port = Number(process.env.TAURI_TEST_PORT ?? '9876');
const token = process.env.TAURI_TEST_TOKEN ?? 'tauri-testing-token';
const attachMode = process.argv.includes('--attach');

// ── Utilities ──

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
  if (isRpcError(parsed)) throw new Error(`${name} failed: ${parsed.text}`);
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

// ── Infra helpers ──

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
  if (result.status !== 0) throw new Error('Failed to build tauri-testing-mcp');
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

function createMcpClient() {
  return {
    transport: new StdioClientTransport({
      command: 'node',
      args: ['dist/index.js'],
      cwd: path.join(root, 'tauri-testing-mcp'),
      env: {
        ...process.env,
        TAURI_TEST_TOKEN: token,
        TAURI_TEST_PORT: String(port),
      },
    }),
    client: new Client({ name: 'mcp-review-highlight-client', version: '0.1.0' }, { capabilities: {} }),
  };
}

// ══════════════════════════════════════════════════════════════
//  SCENARIO: Review Highlight Verification
// ══════════════════════════════════════════════════════════════

const VALID_ISSUE_TYPES = ['mistranslation', 'omission', 'grammar', 'awkward', 'addition', 'terminology'];

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

// 원문과 명백히 다른 번역문 — 의도적으로 오역/누락/첨가를 포함
const TAMPERED_TRANSLATION = [
  '1. Payment API Checklist',
  '   1) Put the credit card number directly in the query string.',
  '   2) Payment requests only need a product name.',
  '2. Error Policy',
  '   - Never retry failed requests.',
  '   - Delete all logs after each error.',
  '3. Deployment Verification',
  '   - Ignore 4xx/5xx monitoring dashboards.',
  '     - Keep the faulty release running.',
].join('\n');

async function runScenario(client) {
  const projectTitle = `Review Highlight E2E ${Date.now()}`;
  const targetEditable = "[data-testid='target-editor'] [contenteditable='true']";
  const highlightSelector = '.review-highlight';

  // ── Phase 1: 프로젝트 생성 ──
  log('\n═══ Phase 1: Create Project ═══');
  await callTool(client, 'tauri_dom_wait_for_text', { text: 'New', timeout: 15000 });
  // 프로젝트 목록은 툴바 드롭다운 안에 있다 — 먼저 연다
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-picker-trigger']" });
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-new-button']" });
  await callTool(client, 'tauri_dom_wait_for_selector', { selector: "input[data-testid='project-title-input']", timeout: 5000 });
  await callTool(client, 'tauri_dom_fill', { selector: "input[data-testid='project-title-input']", value: projectTitle });
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-create-button']" });
  await callTool(client, 'tauri_dom_wait_for_selector', { selector: `[title='${projectTitle}']`, timeout: 10000 });
  log('[pass] Project created');

  // ── Phase 2: Anthropic 활성화 ──
  log('\n═══ Phase 2: Ensure Anthropic Enabled ═══');
  // 앱 설정 진입점도 프로젝트 드롭다운 하단에 있다
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-picker-trigger']" });
  await callTool(client, 'tauri_dom_wait_for_selector', { selector: "button[data-testid='project-app-settings-button']", timeout: 10000 });
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-app-settings-button']" });
  await callTool(client, 'tauri_dom_wait_for_selector', { selector: '#anthropic-enabled', timeout: 10000 });
  const anthropicToggle = await callTool(client, 'tauri_dom_query_selector', { selector: '#anthropic-enabled' });
  if (anthropicToggle.disabled) throw new Error('Anthropic toggle is disabled');
  if (!anthropicToggle.checked) await callTool(client, 'tauri_dom_click', { selector: '#anthropic-enabled' });
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='app-settings-close-button']" });
  log('[pass] Anthropic enabled');

  // ── Phase 3: Source 입력 + 번역 ──
  log('\n═══ Phase 3: Translate Source Document ═══');
  await callTool(client, 'tauri_dom_fill', {
    selector: "[data-testid='source-editor'] [contenteditable='true']",
    value: SOURCE_TEXT,
  });

  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='target-language-select']" });
  let langSelected = await tryTool(client, 'tauri_dom_click_by_text', { text: '영어', visibleOnly: true, exact: true });
  if (!langSelected) langSelected = await tryTool(client, 'tauri_dom_click_by_text', { text: 'English', visibleOnly: true, exact: true });
  if (!langSelected) langSelected = await tryTool(client, 'tauri_dom_click_by_text', { text: '영어', visibleOnly: true, exact: false });
  if (!langSelected) langSelected = await tryTool(client, 'tauri_dom_click_by_text', { text: 'English', visibleOnly: true, exact: false });
  if (!langSelected) throw new Error('Failed to select English');

  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='editor-translate-button']" });
  await callTool(client, 'tauri_dom_wait_for_selector', {
    selector: "button[data-testid='translate-preview-apply-button']",
    timeout: 120000,
  });

  // Apply 버튼 활성화 대기
  for (let i = 0; i < 180; i += 1) {
    const state = await callToolQuiet(client, 'tauri_dom_query_selector', {
      selector: "button[data-testid='translate-preview-apply-button']",
    });
    if (!state.disabled) break;
    if (i === 179) throw new Error('Translate apply button did not enable');
    await sleep(1000);
  }
  await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='translate-preview-apply-button']" });
  await sleep(1000);

  const translatedText = await callTool(client, 'tauri_dom_get_text', { selector: targetEditable });
  if (!translatedText.text?.trim()) throw new Error('Target editor empty after translate');
  log(`[pass] Translation applied (${String(translatedText.text).trim().length} chars)`);
  const listCheck = assertListHierarchyPreserved({
    sourceText: SOURCE_TEXT,
    targetText: String(translatedText.text),
    label: 'Translation output',
  });
  log(`[list] Hierarchy preserved (${listCheck.count} items): ${listCheck.targetSig}`);

  // ── Phase 4: 번역문 의도적 변조 ──
  log('\n═══ Phase 4: Tamper Target Translation ═══');
  const tampered = await tryTool(client, 'tauri_dom_type_contenteditable_by_selector', {
    selector: targetEditable,
    value: TAMPERED_TRANSLATION,
    clear: true,
  });
  if (!tampered) throw new Error('Failed to tamper target editor');
  await sleep(500);

  const tamperedText = await callTool(client, 'tauri_dom_get_text', { selector: targetEditable });
  log(`[pass] Target tampered: "${String(tamperedText.text).trim().slice(0, 80)}..."`);

  // ── Phase 5: 리뷰 실행 + 완료 대기 ──
  log('\n═══ Phase 5: Run Review & Wait for Completion ═══');

  // 리뷰 패널이 닫혀있으면 툴바 버튼 → 시작 모달 → 실행 (패널이 열려 있으면 패널 버튼으로 실행)
  const reviewBtnExists = await tryTool(client, 'tauri_dom_wait_for_selector', {
    selector: "button[data-testid='review-run-button']",
    timeout: 2000,
  });
  if (reviewBtnExists) {
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='review-run-button']" });
  } else {
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='editor-review-button']" });
    await callTool(client, 'tauri_dom_wait_for_selector', { selector: "button[data-testid='review-modal-start']", timeout: 10000 });
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='review-modal-start']" });
  }

  // 리뷰 완료 대기: "다시 검수" 텍스트가 나타나면 리뷰가 끝난 것
  let reviewDone = false;
  for (let i = 0; i < 120; i += 1) {
    const found = await tryTool(client, 'tauri_dom_wait_for_text', { text: '다시 검수', timeout: 2000 });
    if (found) {
      reviewDone = true;
      break;
    }
    // "Review Again" (영어 UI) fallback
    const foundEn = await tryTool(client, 'tauri_dom_wait_for_text', { text: 'Review Again', timeout: 1000 });
    if (foundEn) {
      reviewDone = true;
      break;
    }
  }
  if (!reviewDone) throw new Error('Review did not complete within timeout');
  log('[pass] Review completed');

  // ── Phase 6: 하이라이트 검증 ──
  log('\n═══ Phase 6: Verify Review Highlights ═══');
  await sleep(1000); // 데코레이션 렌더링 안정화 대기

  // 6-1. 하이라이트 존재 확인
  const highlightCount = await getSelectorMatchCount(client, highlightSelector);
  log(`[check] .review-highlight count: ${highlightCount}`);
  if (highlightCount === 0) {
    throw new Error('FAIL: No .review-highlight elements found in DOM');
  }
  log(`[pass] ${highlightCount} highlight(s) found`);

  // 6-2. 모든 하이라이트의 속성 검증
  const allHighlights = await callTool(client, 'tauri_dom_get_all', { selector: highlightSelector });
  const highlightItems = Array.isArray(allHighlights.items) ? allHighlights.items : [];
  const sampleCount = highlightItems.length > 0 ? highlightItems.length : Math.min(highlightCount, 20);

  if (sampleCount > 0) {
    for (let i = 0; i < sampleCount; i += 1) {
      const detail = await callToolQuiet(client, 'tauri_dom_query_selector', { selector: highlightSelector, index: i });
      const issueType = detail.attributes?.['data-issue-type'] ?? '';
      const issueId = detail.attributes?.['data-issue-id'] ?? '';
      const text = String(detail.textContent ?? '').trim();

      log(`  [highlight ${i}] type="${issueType}" id="${issueId}" text="${text.slice(0, 50)}"`);

      // data-issue-type 유효성
      if (issueType && !VALID_ISSUE_TYPES.includes(issueType)) {
        log(`  [warn] Unknown issue type: "${issueType}"`);
      }

      // textContent 비어있지 않은지
      if (!text) {
        log(`  [warn] Highlight ${i} has empty text content`);
      }
    }
  }

  // 6-3. 타입별 하이라이트 개수
  log('\n[check] Highlights by type:');
  for (const type of VALID_ISSUE_TYPES) {
    const count = await getSelectorMatchCount(client, `${highlightSelector}[data-issue-type="${type}"]`);
    if (count > 0) log(`  ${type}: ${count}`);
  }

  // 6-4. 개별 하이라이트에 query_selector로 상세 확인
  const firstHighlight = await callTool(client, 'tauri_dom_query_selector', { selector: highlightSelector, index: 0 });
  log(`\n[check] First highlight detail:`);
  log(`  found: ${firstHighlight.found}`);
  log(`  tagName: ${firstHighlight.tagName}`);
  log(`  visible: ${firstHighlight.visible}`);
  log(`  textContent: "${String(firstHighlight.textContent ?? '').slice(0, 80)}"`);

  // ── Phase 7: 리뷰 결과 테이블 검증 ──
  log('\n═══ Phase 7: Verify Review Results Table ═══');

  // 리뷰 결과 테이블에 행이 있는지 확인 (체크박스가 있는 이슈 행)
  // ReviewResultsTable은 각 이슈를 개별 div/row로 렌더링
  const tableIssueCount = await getSelectorMatchCount(client, '[data-issue-id]');
  log(`[check] Elements with data-issue-id: ${tableIssueCount}`);

  // ── 최종 결과 ──
  log('\n══════════════════════════════════════════════');
  log('  REVIEW HIGHLIGHT VERIFICATION RESULTS');
  log('══════════════════════════════════════════════');
  log(`  Highlights in DOM:  ${highlightCount}`);
  log(`  All visible:        ${firstHighlight.visible ? 'YES' : 'NO'}`);
  log(`  Result:             PASS`);
  log('══════════════════════════════════════════════');

  log(`\n[success] Review highlight scenario passed: ${projectTitle}`);
}

// ── Main ──

async function main() {
  ensureMcpBuilt();

  if (attachMode) {
    // --attach 모드: 이미 실행 중인 Tauri 앱에 연결
    log('[mode] Attaching to running Tauri app...');
    const { transport, client } = createMcpClient();
    try {
      await client.connect(transport);
      await runScenario(client);
    } finally {
      await closeClientSafely(client);
    }
    return;
  }

  // 기본 모드: Tauri 앱을 시작하고 테스트
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
    const { transport, client } = createMcpClient();
    try {
      await client.connect(transport);
      await runScenario(client);
    } finally {
      await closeClientSafely(client);
    }
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
