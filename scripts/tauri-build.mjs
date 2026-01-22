import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const configPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const targetDir = path.join(root, 'src-tauri', 'target');

const tauriBin = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';

const child = spawn(
  tauriBin,
  ['build', '--config', configPath],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      CARGO_TARGET_DIR: targetDir,
    },
  },
);

child.on('exit', (code) => {
  process.exit(code ?? 1);
});


