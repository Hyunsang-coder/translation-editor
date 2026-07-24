import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = process.cwd();
const port = String(process.env.TAURI_TEST_PORT ?? '9988');
const token = process.env.TAURI_TEST_TOKEN ?? 'tauri-testing-token';

function parseToolText(result) {
  const text = result?.content?.find?.((item) => item?.type === 'text')?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return { text }; }
}

async function callTool(client, name, args = {}) {
  const result = parseToolText(await client.callTool({ name, arguments: args }));
  if (typeof result?.text === 'string' && result.text.startsWith('RPC ')) {
    throw new Error(`${name} ${JSON.stringify(args)}: ${result.text}`);
  }
  return result;
}

async function clickWhenReady(client, selector, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await callTool(client, 'tauri_dom_wait_for_selector', {
        selector,
        timeout: Math.min(1000, Math.max(1, deadline - Date.now())),
        visible: true,
      });
      await callTool(client, 'tauri_dom_click', { selector });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  const page = await callTool(client, 'tauri_dom_get_page_content', {
    maxDepth: 5,
    maxNodes: 300,
  });
  throw new Error(
    `${lastError instanceof Error ? lastError.message : `Timed out clicking ${selector}`}\n`
    + `Current page: ${JSON.stringify(page).slice(0, 6000)}`,
  );
}

function ensureMcpBuilt() {
  const result = spawnSync('npm', ['--prefix', 'tauri-testing-mcp', 'run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) throw new Error('Failed to build tauri-testing-mcp');
}

async function runScenario(client) {
  const title = `Chat Selection E2E ${Date.now()}`;
  const selectedText = '닫힌 채팅에도 선택한 텍스트가 추가되어야 합니다.';
  let projectId = null;

  try {
    await callTool(client, 'tauri_dom_wait_for_selector', {
      selector: "button[data-testid='toolbar-sidebar-toggle']",
      timeout: 15000,
      visible: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 750));
    try {
      await callTool(client, 'tauri_dom_query_selector', {
        selector: "button[data-testid='project-new-button']",
      });
    } catch {
      await clickWhenReady(client, "button[data-testid='toolbar-sidebar-toggle']");
    }
    await clickWhenReady(client, "button[data-testid='project-new-button']", 15000);
    await callTool(client, 'tauri_dom_wait_for_selector', {
      selector: "input[data-testid='project-title-input']",
      timeout: 5000,
    });
    await callTool(client, 'tauri_dom_fill', {
      selector: "input[data-testid='project-title-input']",
      value: title,
    });
    await clickWhenReady(client, "button[data-testid='project-create-button']");
    await callTool(client, 'tauri_dom_wait_for_selector', {
      selector: "[data-testid='source-editor'] [contenteditable='true']",
      timeout: 10000,
    });
    // Project switching hydrates chat/session state independently from the editor.
    // Wait for that reset boundary before asserting that the shortcut opens a chat.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const sourceSelector = "[data-testid='source-editor'] [contenteditable='true']";
    await callTool(client, 'tauri_dom_fill', { selector: sourceSelector, value: selectedText });
    const selectResult = await callTool(client, 'tauri_dom_keyboard', {
      selector: sourceSelector,
      key: 'a',
      code: 'KeyA',
      modifiers: ['meta'],
    });
    if (!String(selectResult.selectionText ?? '').includes(selectedText)) {
      throw new Error(
        `Cmd+A did not select the source text: ${JSON.stringify(selectResult)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    const shortcutResult = await callTool(client, 'tauri_dom_keyboard', {
      selector: sourceSelector,
      key: 'l',
      code: 'KeyL',
      modifiers: ['meta'],
    });
    if (!shortcutResult.defaultPrevented) {
      throw new Error(
        `Cmd+L was not handled by the source editor: ${JSON.stringify(shortcutResult)}`,
      );
    }

    const composerSelector = "[data-testid='chat-composer-container'] [contenteditable='true']";
    await callTool(client, 'tauri_dom_wait_for_selector', {
      selector: composerSelector,
      timeout: 10000,
      visible: true,
    });
    let chipText = '';
    let sendButton = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      try {
        const chip = await callTool(client, 'tauri_dom_query_selector', {
          selector: "[data-testid='selection-context-chip']",
        });
        chipText = String(chip.textContent ?? '');
      } catch {
        chipText = '';
      }
      try {
        sendButton = await callTool(client, 'tauri_dom_query_selector', {
          selector: "button[data-testid='chat-send-button']",
        });
      } catch {
        sendButton = null;
      }
      if (chipText.includes(selectedText)) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!chipText.includes(selectedText)) {
      const page = await callTool(client, 'tauri_dom_get_page_content', {
        maxDepth: 10,
        maxNodes: 1000,
      });
      throw new Error(
        `Selection card missing from composer: text=${JSON.stringify(chipText)}, `
        + `sendDisabled=${String(sendButton?.disabled)}\n`
        + `Current page: ${JSON.stringify(page).slice(0, 12000)}`,
      );
    }
    await callTool(client, 'tauri_dom_fill', {
      selector: composerSelector,
      value: '이 문장의 의미를 설명해줘.',
    });
    sendButton = await callTool(client, 'tauri_dom_query_selector', {
      selector: "button[data-testid='chat-send-button']",
    });
    const composer = await callTool(client, 'tauri_dom_get_text', { selector: composerSelector });
    const composerText = String(composer.text ?? '').trim();
    if (composerText.includes(selectedText)) {
      throw new Error('Selection was appended as raw composer text instead of metadata');
    }
    if (sendButton?.disabled) {
      throw new Error('Question plus selection card should enable the chat send button');
    }

    process.stdout.write(`[success] Closed-chat selection card: ${chipText}\n`);
  } finally {
    const recent = await callTool(client, 'tauri_invoke', { command: 'list_recent_projects' });
    const projects = Array.isArray(recent) ? recent : recent?.result;
    projectId = projects?.find?.((project) => project.title === title)?.id ?? null;
    if (projectId) {
      await callTool(client, 'tauri_invoke', {
        command: 'delete_project',
        args: { args: { projectId } },
      });
    }
  }
}

async function main() {
  ensureMcpBuilt();
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    cwd: path.join(root, 'tauri-testing-mcp'),
    env: { ...process.env, TAURI_TEST_TOKEN: token, TAURI_TEST_PORT: port },
  });
  const client = new Client(
    { name: 'chat-selection-e2e', version: '0.1.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    await runScenario(client);
  } finally {
    try { await client.close(); } catch { /* no-op */ }
  }
}

main().catch((error) => {
  console.error(`[error] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
