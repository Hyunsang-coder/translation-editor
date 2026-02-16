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
    await new Promise((r) => setTimeout(r, 300));
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
  if (
    parsed
    && typeof parsed.text === 'string'
    && (parsed.text.startsWith('RPC ') || parsed.text.startsWith('MCP error'))
  ) {
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

async function runScenario() {
  const title = `MCP E2E ${Date.now()}`;
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

  const client = new Client({ name: 'mcp-smoke-client', version: '0.1.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    await callTool(client, 'tauri_dom_wait_for_text', { text: 'New', timeout: 15000 });
    await callTool(client, 'tauri_dom_query_selector', { selector: "button[data-testid='project-new-button']" });
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-new-button']" });
    await callTool(client, 'tauri_dom_wait_for_selector', {
      selector: "input[data-testid='project-title-input']",
      timeout: 5000,
    });
    await callTool(client, 'tauri_dom_fill', {
      selector: "input[data-testid='project-title-input']",
      value: title,
    });
    await callTool(client, 'tauri_dom_click', { selector: "button[data-testid='project-create-button']" });
    await callTool(client, 'tauri_dom_wait_for_selector', {
      selector: `[title='${title}']`,
      timeout: 10000,
    });
    log(`\n[success] Created project: ${title}`);
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
      new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
    if (!exitedGracefully) {
      tauri.kill('SIGKILL');
      await Promise.race([
        waitExit,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
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
