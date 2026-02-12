import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const configPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const targetDir = path.join(root, 'src-tauri', 'target');
const tauriBin = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';

// Tauri-only smoke: run a debug, no-bundle build to validate
// frontend + Rust + Tauri integration without relying on web-only Playwright.
const args = ['build', '--debug', '--no-bundle', '--config', configPath];

const child = spawn(tauriBin, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    CARGO_TARGET_DIR: targetDir,
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

