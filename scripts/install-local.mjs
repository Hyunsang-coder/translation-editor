/**
 * 로컬에서 릴리스 빌드를 만들어 /Applications의 설치본을 교체한다.
 * CI 릴리스를 기다리지 않고 방금 커밋한 버전을 바로 쓰기 위한 용도.
 *
 * 사용: npm run install:local [-- --skip-build]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, renameSync, cpSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tauriConf = JSON.parse(
  readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
const productName = tauriConf.productName;
const expectedVersion = tauriConf.version;
const appName = `${productName}.app`;
const builtApp = path.join(
  root, 'src-tauri', 'target', 'release', 'bundle', 'macos', appName,
);
const installedApp = path.join('/Applications', appName);
const backupApp = `${installedApp}.bak`;
const skipBuild = process.argv.includes('--skip-build');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function appVersion(appPath) {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  const result = spawnSync(
    'defaults', ['read', plist, 'CFBundleShortVersionString'], { encoding: 'utf8' },
  );
  return result.status === 0 ? result.stdout.trim() : null;
}

if (process.platform !== 'darwin') {
  fail('macOS 전용 스크립트입니다.');
}

// 실행 중인 번들을 갈아끼우면 앱이 이상하게 죽는다. 설치 경로로 매칭해야 한다 —
// 그냥 제품명으로 찾으면 개발용 `target/debug` 프로세스까지 잡혀 헛되이 막힌다.
const running = spawnSync('pgrep', ['-f', `${installedApp}/Contents/MacOS/`], {
  encoding: 'utf8',
});
if (running.status === 0) {
  fail(`${appName}이 실행 중입니다. 종료한 뒤 다시 실행해주세요.`);
}

if (!skipBuild) {
  console.log('🔨 릴리스 빌드 중...');
  const buildStartedAt = Date.now();
  const build = spawnSync('npm', ['run', 'tauri:build'], {
    stdio: 'inherit',
    cwd: root,
    env: {
      ...process.env,
      // Claude Code 등에서 상속되는 제한된 TMPDIR을 쓰면 rustc/ld가 임시 object
      // 파일을 못 만들어 링크 단계에서 EPERM으로 죽는다. 일반 터미널에선 무해.
      TMPDIR: spawnSync('getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' })
        .stdout.trim() || process.env.TMPDIR,
    },
  });
  // 종료 코드만 보고 판단하지 않는다. 업데이터 서명 키(TAURI_SIGNING_PRIVATE_KEY)가
  // 없으면 tauri가 마지막에 에러로 끝나지만, .app/.dmg는 그 전에 이미 만들어진다.
  // 로컬 설치에는 서명된 업데이터 아티팩트가 필요 없으므로 산출물로 판정한다.
  //
  // 다만 "있다"만으로는 부족하다. 빌드가 번들링 **전에** 죽으면 지난 실행의 산출물이
  // 그대로 남아 있어 낡은 앱이 조용히 설치된다 — 실제로 3.5.2 설치본이 어제 만든
  // 3.5.1로 downgrade된 적이 있다. 이번 빌드가 만든 것인지 mtime으로 가른다.
  if (build.status !== 0) {
    if (!existsSync(builtApp)) {
      fail('빌드에 실패했습니다.');
    }
    if (statSync(builtApp).mtimeMs < buildStartedAt) {
      fail(
        '빌드에 실패했고 산출물은 이전 실행의 것입니다. '
        + '낡은 앱을 설치하지 않고 중단합니다.',
      );
    }
    console.log('⚠️  업데이터 서명은 건너뛰었습니다(로컬 설치에는 불필요).');
  }
}

if (!existsSync(builtApp)) {
  fail(`빌드 산출물이 없습니다: ${builtApp}`);
}

const newVersion = appVersion(builtApp);
// --skip-build는 산출물을 그대로 믿는 경로라 낡음이 가장 잘 숨는다. 설정 버전과
// 대조해, 버전을 올린 뒤 빌드 없이 설치하는 실수를 여기서 잡는다.
if (newVersion !== expectedVersion) {
  fail(
    `빌드 산출물이 설정 버전과 다릅니다 (tauri.conf.json ${expectedVersion}, `
    + `산출물 ${newVersion ?? '읽기 실패'}). 낡은 산출물일 수 있어 중단합니다.`,
  );
}
const oldVersion = existsSync(installedApp) ? appVersion(installedApp) : null;

rmSync(backupApp, { recursive: true, force: true });
if (existsSync(installedApp)) {
  renameSync(installedApp, backupApp);
}

try {
  cpSync(builtApp, installedApp, { recursive: true, verbatimSymlinks: true });
} catch (error) {
  // 복사가 실패하면 설치본이 사라진 채로 끝나므로 되돌린다.
  rmSync(installedApp, { recursive: true, force: true });
  if (existsSync(backupApp)) renameSync(backupApp, installedApp);
  fail(`복사에 실패해 이전 버전으로 되돌렸습니다: ${error.message}`);
}

const installedVersion = appVersion(installedApp);
if (installedVersion !== newVersion) {
  rmSync(installedApp, { recursive: true, force: true });
  if (existsSync(backupApp)) renameSync(backupApp, installedApp);
  fail(`설치본 검증에 실패해 되돌렸습니다 (기대 ${newVersion}, 실제 ${installedVersion}).`);
}

rmSync(backupApp, { recursive: true, force: true });
console.log(
  `✅ ${appName} ${oldVersion ?? '(없음)'} → ${installedVersion} 교체 완료`,
);
console.log('   로컬 빌드라 quarantine 플래그가 없어 바로 실행됩니다.');
