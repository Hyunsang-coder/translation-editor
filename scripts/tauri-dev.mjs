import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const configPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const targetDir = path.join(root, 'src-tauri', 'target');

const tauriBin = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';

const child = spawn(
  tauriBin,
  ['dev', '--config', configPath],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Folder rename(english-playground → translation-editor) 후에도 절대경로로 고정
      CARGO_TARGET_DIR: targetDir,
    },
  },
);

child.on('exit', (code) => {
  process.exit(code ?? 1);
});


