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
    throw new Error(`${name}: ${result.text}`);
  }
  return result;
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
      selector: "button[data-testid='project-new-button']",
      timeout: 15000,
    });
    await callTool(client, 'tauri_dom_click', {
      selector: "button[data-testid='project-new-button']",
    });
    await callTool(client, 'tauri_dom_wait_for_selector', {
      selector: "input[data-testid='project-title-input']",
      timeout: 5000,
    });
    await callTool(client, 'tauri_dom_fill', {
      selector: "input[data-testid='project-title-input']",
      value: title,
    });
    await callTool(client, 'tauri_dom_click', {
      selector: "button[data-testid='project-create-button']",
    });
    await callTool(client, 'tauri_dom_wait_for_selector', {
      selector: "[data-testid='source-editor'] [contenteditable='true']",
      timeout: 10000,
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const sourceSelector = "[data-testid='source-editor'] [contenteditable='true']";
    await callTool(client, 'tauri_dom_fill', { selector: sourceSelector, value: selectedText });
    await callTool(client, 'tauri_dom_keyboard', {
      selector: sourceSelector,
      key: 'a',
      code: 'KeyA',
      modifiers: ['meta'],
    });
    await callTool(client, 'tauri_dom_keyboard', {
      selector: sourceSelector,
      key: 'l',
      code: 'KeyL',
      modifiers: ['meta'],
    });

    const composerSelector = "[data-testid='chat-composer-container'] [contenteditable='true']";
    await callTool(client, 'tauri_dom_wait_for_selector', {
      selector: composerSelector,
      timeout: 10000,
      visible: true,
    });
    let composerText = '';
    let sendButton = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const composer = await callTool(client, 'tauri_dom_get_text', { selector: composerSelector });
      composerText = String(composer.text ?? '');
      sendButton = await callTool(client, 'tauri_dom_query_selector', {
        selector: "button[data-testid='chat-send-button']",
      });
      if (composerText.includes(selectedText)) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!composerText.includes(selectedText)) {
      throw new Error(`Selected text missing from composer: text=${JSON.stringify(composerText)}, sendDisabled=${String(sendButton?.disabled)}`);
    }

    process.stdout.write(`[success] Closed-chat selection append: ${composerText}\n`);
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
