import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const configPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const targetDir = path.join(root, 'src-tauri', 'target');

const tauriBin = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const isHeadlessShell = !process.stdout.isTTY || !process.stdin.isTTY;

const env = {
  ...process.env,
  CARGO_TARGET_DIR: targetDir,
};

// In non-interactive shells, force CI mode so DMG bundling skips Finder AppleScript.
if (isHeadlessShell && !process.env.CI) {
  env.CI = 'true';
}

const buildMcp = spawnSync(
  npmBin,
  ['run', 'oddeyes-desktop-mcp:build'],
  {
    stdio: 'inherit',
    cwd: root,
    env,
  },
);

if (buildMcp.status !== 0) {
  process.exit(buildMcp.status ?? 1);
}

const child = spawn(
  tauriBin,
  ['build', '--config', configPath],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  },
);

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
