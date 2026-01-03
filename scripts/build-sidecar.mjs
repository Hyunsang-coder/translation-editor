import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * MCP Proxy 번들 빌드 스크립트
 * 
 * pkg 바이너리화 대신 esbuild로 CJS 번들만 생성합니다.
 * 런타임에 시스템의 Node.js를 사용하여 실행합니다.
 * 
 * 장점:
 * - pkg의 ESM/CJS 호환성 문제 회피
 * - npx 없이 직접 번들 실행 (네트워크 의존성 제거)
 * - 빠른 시작 시간
 * 
 * 단점:
 * - Node.js 설치 필요 (향후 Rust SSE 구현으로 대체 예정)
 */

const OUT_DIR = 'src-tauri/resources';
const BUNDLE_NAME = 'mcp-proxy.cjs';

// Output directory 생성
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// mcp-remote path
const mcpRemotePath = path.resolve('node_modules/mcp-remote/dist/proxy.js');
const bundledPath = path.resolve(OUT_DIR, BUNDLE_NAME);

if (!fs.existsSync(mcpRemotePath)) {
  console.error('Error: mcp-remote not found. Run npm install.');
  process.exit(1);
}

console.log('Bundling mcp-remote to CJS...');
try {
  // esbuild 배너 설정:
  // - import.meta.url을 CJS 환경에서 사용할 수 있도록 폴리필
  // - File 클래스 폴리필 (일부 환경에서 필요)
  const banner = `
const import_meta_url = (function() { 
  return require('url').pathToFileURL(__filename).href; 
})(); 
if (!globalThis.File) { 
  globalThis.File = class File extends Blob { 
    constructor(parts, filename, options) { 
      super(parts, options); 
      this.name = filename; 
    } 
  }; 
}
`.replace(/\n/g, ' ').trim();

  // esbuild로 번들링
  // --define:import.meta.url=import_meta_url로 import.meta.url 대체
  execSync(
    `npx esbuild "${mcpRemotePath}" ` +
    `--bundle ` +
    `--platform=node ` +
    `--target=node18 ` +
    `--format=cjs ` +
    `--outfile="${bundledPath}" ` +
    `--external:node:sqlite ` +
    `--define:import.meta.url=import_meta_url ` +
    `--banner:js="${banner}"`,
    { stdio: 'inherit' }
  );

  // node:sqlite require를 빈 객체로 대체 (사용되지 않는 의존성)
  let content = fs.readFileSync(bundledPath, 'utf-8');
  content = content.replace(/require\("node:sqlite"\)/g, '{}');
  content = content.replace(/require\('node:sqlite'\)/g, '{}');
  fs.writeFileSync(bundledPath, content);

  console.log(`\n✓ Bundle created: ${bundledPath}`);
  console.log(`  Size: ${(fs.statSync(bundledPath).size / 1024 / 1024).toFixed(2)} MB`);

} catch (e) {
  console.error('Failed to bundle mcp-remote', e);
  process.exit(1);
}

// 이전 bin 디렉토리의 바이너리 정리 (더 이상 사용하지 않음)
const oldBinDir = 'src-tauri/bin';
if (fs.existsSync(oldBinDir)) {
  const oldBinaries = fs.readdirSync(oldBinDir).filter(f => f.startsWith('mcp-proxy'));
  if (oldBinaries.length > 0) {
    console.log('\nCleaning up old binaries...');
    for (const binary of oldBinaries) {
      const binPath = path.join(oldBinDir, binary);
      fs.unlinkSync(binPath);
      console.log(`  Removed: ${binPath}`);
    }
  }
}

console.log('\n✓ MCP Proxy bundle build complete.');
console.log('  Note: Requires Node.js at runtime. Will be replaced with Rust SSE implementation.');
