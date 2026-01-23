# OddEyes.ai 자동 업데이트 기능 구현 계획 (최소 버전)

## 개요

Tauri 2의 `tauri-plugin-updater`를 사용하여 자동 업데이트 기능을 구현합니다.
GitHub Releases를 업데이트 서버로 사용하므로 **별도 서버 불필요**.

## 사용자 시나리오

```
앱 시작 → 3초 후 버전 확인 → 새 버전 있으면 모달 표시
                                    ↓
                    [나중에] → 모달 닫힘, 다음에 다시 확인
                    [이 버전 건너뛰기] → 해당 버전 스킵, localStorage 저장
                    [지금 업데이트] → 다운로드 → 설치 → 자동 재시작
                                        ↓
                              [취소] → 다운로드 중단
```

---

## 구현 단계

### 1단계: 서명 키 생성 (1회)

```bash
# 키 생성
npx tauri signer generate -w ~/.tauri/oddeyes.key
```

**결과물:**
- `~/.tauri/oddeyes.key` - 비밀키 (**절대 커밋 금지**)
- `~/.tauri/oddeyes.key.pub` - 공개키 (tauri.conf.json에 복사)

**보안:**
- `.gitignore`에 `*.key` 추가
- CI/CD에서는 GitHub Secrets로 주입:
  - `TAURI_SIGNING_PRIVATE_KEY`: 비밀키 전체 내용
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: 키 생성 시 입력한 비밀번호 (없으면 빈 문자열)

---

### 2단계: Rust 설정

**파일:** `src-tauri/Cargo.toml`

```toml
[dependencies]
# 기존 의존성...
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

**파일:** `src-tauri/src/lib.rs`

```rust
pub fn run() {
    tauri::Builder::default()
        // 기존 플러그인...
        .plugin(tauri_plugin_updater::init())   // 추가
        .plugin(tauri_plugin_process::init())   // 추가
        // 나머지 설정...
}
```

> **참고**: Rust Command 추가는 불필요. 프론트엔드 JS API만으로 충분.

---

### 3단계: Tauri 설정

**파일:** `src-tauri/tauri.conf.json`

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "공개키 내용 (oddeyes.key.pub)",
      "endpoints": [
        "https://github.com/joo/oddeyes-release/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

**CSP 수정** (기존 `connect-src`에 추가):

현재:
```
connect-src 'self' ipc: https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com;
```

수정 후:
```
connect-src 'self' ipc: https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://github.com https://*.githubusercontent.com https://objects.githubusercontent.com;
```

---

### 4단계: 프론트엔드 구현

**패키지 설치:**
```bash
npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

**파일:** `src/hooks/useAutoUpdate.ts`

```typescript
import { useEffect, useState, useCallback, useRef } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const SKIPPED_VERSION_KEY = 'oddeyes_skipped_update_version';

interface UpdateState {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  progress: number;
  error: string | null;
  update: Update | null;
}

export function useAutoUpdate() {
  const [state, setState] = useState<UpdateState>({
    checking: false,
    available: false,
    downloading: false,
    progress: 0,
    error: null,
    update: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const checkForUpdate = useCallback(async () => {
    setState(prev => ({ ...prev, checking: true, error: null }));

    try {
      const update = await check();

      if (update) {
        // 스킵된 버전인지 확인
        const skippedVersion = localStorage.getItem(SKIPPED_VERSION_KEY);
        if (skippedVersion === update.version) {
          setState(prev => ({ ...prev, checking: false, available: false }));
          return null;
        }

        setState(prev => ({
          ...prev,
          checking: false,
          available: true,
          update,
        }));
        return update;
      } else {
        setState(prev => ({ ...prev, checking: false, available: false }));
        return null;
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        checking: false,
        error: error instanceof Error ? error.message : 'Update check failed',
      }));
      return null;
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!state.update) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setState(prev => ({ ...prev, downloading: true, progress: 0, error: null }));

    try {
      let contentLength = 0;
      let downloaded = 0;

      await state.update.downloadAndInstall((event) => {
        // 취소 확인
        if (controller.signal.aborted) {
          throw new Error('Download cancelled');
        }

        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            const progress = contentLength > 0
              ? Math.round((downloaded / contentLength) * 100)
              : 0;
            setState(prev => ({ ...prev, progress }));
            break;
          case 'Finished':
            setState(prev => ({ ...prev, progress: 100 }));
            break;
        }
      });

      await relaunch();
    } catch (error) {
      if (controller.signal.aborted) {
        setState(prev => ({
          ...prev,
          downloading: false,
          progress: 0,
          error: null,
        }));
      } else {
        setState(prev => ({
          ...prev,
          downloading: false,
          error: error instanceof Error ? error.message : 'Update failed',
        }));
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [state.update]);

  const cancelDownload = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setState(prev => ({ ...prev, downloading: false, progress: 0 }));
  }, []);

  const skipVersion = useCallback((version: string) => {
    localStorage.setItem(SKIPPED_VERSION_KEY, version);
    setState(prev => ({ ...prev, available: false, update: null }));
  }, []);

  const dismissUpdate = useCallback(() => {
    setState(prev => ({ ...prev, available: false }));
  }, []);

  // 앱 시작 시 자동 체크 (프로덕션만)
  useEffect(() => {
    if (import.meta.env.DEV) return;

    const timer = setTimeout(() => {
      checkForUpdate();
    }, 3000);

    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  return {
    ...state,
    checkForUpdate,
    downloadAndInstall,
    cancelDownload,
    skipVersion,
    dismissUpdate,
  };
}
```

**파일:** `src/components/ui/UpdateModal.tsx`

```typescript
import { useTranslation } from 'react-i18next';

interface UpdateModalProps {
  isOpen: boolean;
  version: string;
  releaseNotes?: string;
  downloading: boolean;
  progress: number;
  error: string | null;
  onUpdate: () => void;
  onCancel: () => void;
  onSkipVersion: () => void;
  onDismiss: () => void;
}

export function UpdateModal({
  isOpen,
  version,
  releaseNotes,
  downloading,
  progress,
  error,
  onUpdate,
  onCancel,
  onSkipVersion,
  onDismiss,
}: UpdateModalProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[400px] p-6">
        <h2 className="text-lg font-semibold mb-4">
          {t('update.newVersionAvailable', '새로운 버전이 있습니다')}
        </h2>

        <p className="text-gray-600 dark:text-gray-300 mb-4">
          {t('update.versionInfo', 'OddEyes.ai {{version}} 버전을 사용할 수 있습니다.', { version })}
        </p>

        {releaseNotes && (
          <div className="bg-gray-100 dark:bg-gray-700 rounded p-3 mb-4 max-h-32 overflow-y-auto text-sm">
            <p className="whitespace-pre-wrap">{releaseNotes}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded p-3 mb-4 text-sm">
            {t('update.downloadFailed', '다운로드에 실패했습니다. 나중에 다시 시도해주세요.')}
          </div>
        )}

        {downloading ? (
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span>{t('update.downloading', '다운로드 중...')}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                {t('update.cancel', '취소')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between">
            <button
              onClick={onSkipVersion}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              {t('update.skipVersion', '이 버전 건너뛰기')}
            </button>
            <div className="flex gap-3">
              <button
                onClick={onDismiss}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                {t('update.later', '나중에')}
              </button>
              <button
                onClick={onUpdate}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {t('update.updateNow', '지금 업데이트')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

**파일:** `src/App.tsx` (통합)

```typescript
// 기존 import 유지...
import { useState, useEffect } from 'react';
import { useAutoUpdate } from './hooks/useAutoUpdate';
import { UpdateModal } from './components/ui/UpdateModal';

function App() {
  // 기존 코드 유지...

  const {
    available,
    downloading,
    progress,
    error,
    update,
    downloadAndInstall,
    cancelDownload,
    skipVersion,
    dismissUpdate,
  } = useAutoUpdate();
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  useEffect(() => {
    if (available && update) {
      setShowUpdateModal(true);
    }
  }, [available, update]);

  return (
    <div className="min-h-screen bg-editor-bg text-editor-text">
      <MainLayout />

      <UpdateModal
        isOpen={showUpdateModal}
        version={update?.version ?? ''}
        releaseNotes={update?.body ?? undefined}
        downloading={downloading}
        progress={progress}
        error={error}
        onUpdate={downloadAndInstall}
        onCancel={cancelDownload}
        onSkipVersion={() => {
          if (update?.version) {
            skipVersion(update.version);
          }
          setShowUpdateModal(false);
        }}
        onDismiss={() => {
          dismissUpdate();
          setShowUpdateModal(false);
        }}
      />
    </div>
  );
}

export default App;
```

---

### 5단계: i18n 키 추가

**파일:** `src/i18n/locales/ko.json`
```json
{
  "update": {
    "newVersionAvailable": "새로운 버전이 있습니다",
    "versionInfo": "OddEyes.ai {{version}} 버전을 사용할 수 있습니다.",
    "downloading": "다운로드 중...",
    "later": "나중에",
    "updateNow": "지금 업데이트",
    "skipVersion": "이 버전 건너뛰기",
    "cancel": "취소",
    "downloadFailed": "다운로드에 실패했습니다. 나중에 다시 시도해주세요."
  }
}
```

**파일:** `src/i18n/locales/en.json`
```json
{
  "update": {
    "newVersionAvailable": "New Version Available",
    "versionInfo": "OddEyes.ai {{version}} is available.",
    "downloading": "Downloading...",
    "later": "Later",
    "updateNow": "Update Now",
    "skipVersion": "Skip This Version",
    "cancel": "Cancel",
    "downloadFailed": "Download failed. Please try again later."
  }
}
```

---

### 6단계: GitHub Actions 수정

**파일:** `.github/workflows/build.yml`

```yaml
name: Build

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            target: universal-apple-darwin
            bundles: dmg
          - platform: windows-latest
            target: x86_64-pc-windows-msvc
            bundles: nsis

    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Add macOS universal targets
        if: matrix.platform == 'macos-latest'
        run: |
          rustup target add x86_64-apple-darwin
          rustup target add aarch64-apple-darwin

      - name: Install dependencies
        run: npm ci

      - name: Build Tauri
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: v__VERSION__
          releaseName: 'OddEyes v__VERSION__'
          releaseBody: 'See CHANGELOG.md for details.'
          releaseDraft: true
          prerelease: false
          args: --target ${{ matrix.target }} --bundles ${{ matrix.bundles }}
```

---

### 7단계: 빌드 및 배포

**로컬 서명 빌드:**
```bash
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/oddeyes.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password"  # 없으면 생략
npm run tauri:build
```

**생성되는 파일:**
```
macOS: OddEyes.ai.app.tar.gz + OddEyes.ai.app.tar.gz.sig
Windows: OddEyes.ai_x.x.x_x64-setup.nsis.zip + OddEyes.ai_x.x.x_x64-setup.nsis.zip.sig
```

**GitHub Release에 업로드:**
1. `latest.json` (아래 형식)
2. 앱 파일 (`.tar.gz` 또는 `.nsis.zip`)
3. 서명 파일 (`.sig`)

**latest.json 형식:**
```json
{
  "version": "1.2.0",
  "notes": "- 버그 수정\n- 성능 개선",
  "pub_date": "2025-01-23T10:00:00Z",
  "platforms": {
    "darwin-x86_64": {
      "signature": "서명 파일(.sig) 내용 전체",
      "url": "https://github.com/joo/oddeyes-release/releases/download/v1.2.0/OddEyes.ai.app.tar.gz"
    },
    "darwin-aarch64": {
      "signature": "서명 파일(.sig) 내용 전체",
      "url": "https://github.com/joo/oddeyes-release/releases/download/v1.2.0/OddEyes.ai.app.tar.gz"
    },
    "windows-x86_64": {
      "signature": "서명 파일(.sig) 내용 전체",
      "url": "https://github.com/joo/oddeyes-release/releases/download/v1.2.0/OddEyes.ai_1.2.0_x64-setup.nsis.zip"
    }
  }
}
```

> **참고**: macOS Universal Binary는 `darwin-x86_64`와 `darwin-aarch64` 모두 같은 URL 사용 가능.

---

## 테스트

### 로컬 테스트 (UI 확인용)

1. **Mock 서버 설정:**
```bash
mkdir -p /tmp/update-test
cat > /tmp/update-test/latest.json << 'EOF'
{
  "version": "99.0.0",
  "notes": "테스트 업데이트",
  "pub_date": "2025-01-23T10:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "test", "url": "http://localhost:8080/fake.tar.gz" },
    "darwin-x86_64": { "signature": "test", "url": "http://localhost:8080/fake.tar.gz" }
  }
}
EOF
cd /tmp/update-test && python3 -m http.server 8080
```

2. **tauri.conf.json 임시 수정:**
```json
"endpoints": ["http://localhost:8080/latest.json"]
```

3. **useAutoUpdate.ts에서 DEV 체크 임시 비활성화:**
```typescript
// if (import.meta.env.DEV) return;  // 주석 처리
```

4. **테스트 후 원복 필수**

### E2E 테스트 (릴리즈 전 1회)

1. v1.1.0으로 서명 빌드 후 설치
2. 코드에서 v1.1.1로 버전 업
3. v1.1.1로 서명 빌드
4. GitHub Release에 latest.json + 빌드 파일 업로드
5. v1.1.0 앱 실행 → 업데이트 모달 확인 → 다운로드 → 재시작 확인

---

## 체크리스트

| 단계 | 작업 | 필수 |
|------|------|------|
| 1 | 서명 키 생성 | ✅ |
| 1 | GitHub Secrets 등록 (TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD) | ✅ |
| 2 | Cargo.toml 의존성 추가 | ✅ |
| 2 | lib.rs 플러그인 등록 | ✅ |
| 3 | tauri.conf.json updater 설정 | ✅ |
| 3 | tauri.conf.json CSP 도메인 추가 | ✅ |
| 4 | npm 패키지 설치 | ✅ |
| 4 | useAutoUpdate 훅 | ✅ |
| 4 | UpdateModal 컴포넌트 | ✅ |
| 4 | App.tsx 통합 | ✅ |
| 5 | i18n 키 추가 (ko.json, en.json) | ✅ |
| 6 | GitHub Actions 서명 환경변수 추가 | ✅ |
| 7 | GitHub Release에 latest.json 업로드 | ✅ |

---

## 주의사항

1. **비밀키 절대 커밋 금지** - `.gitignore`에 `*.key` 추가 확인
2. **버전 동기화** - package.json, Cargo.toml, tauri.conf.json 일치 필수
3. **개발 모드** - 업데이트 체크 자동 비활성화 (`import.meta.env.DEV`)
4. **Universal Binary** - macOS는 `darwin-x86_64`, `darwin-aarch64` 둘 다 같은 파일 가리킴
5. **CSP 오류** - 업데이트 실패 시 DevTools Network 탭에서 차단된 요청 확인
6. **서명 불일치** - `.sig` 파일 내용과 latest.json의 signature가 정확히 일치해야 함

---

## 참고 자료

- [Tauri 2 Updater Plugin](https://v2.tauri.app/plugin/updater/)
- [Tauri Signer](https://v2.tauri.app/distribute/sign/)
