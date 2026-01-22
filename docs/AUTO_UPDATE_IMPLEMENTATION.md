# OddEyes.ai 자동 업데이트 기능 구현 계획

## 개요

Tauri 2의 `tauri-plugin-updater`를 사용하여 앱 자동 업데이트 기능을 구현합니다.
Claude Desktop 앱처럼 새 버전이 감지되면 사용자에게 알림을 표시하고, 확인 시 자동으로 다운로드 및 설치합니다.

## 목표

- 앱 시작 시 자동으로 새 버전 확인
- 업데이트 발견 시 모달로 사용자에게 안내
- 사용자 확인 후 백그라운드 다운로드 및 설치
- 설치 완료 후 앱 자동 재시작

---

## 1단계: 사전 준비 - 서명 키 생성

### 1.1 키 페어 생성

업데이트 파일의 무결성 검증을 위한 Ed25519 키 페어를 생성합니다.

```bash
# Tauri CLI로 키 생성
npx tauri signer generate -w ~/.tauri/oddeyes.key
```

**출력:**
- `~/.tauri/oddeyes.key` - 비밀키 (빌드 시 사용, **절대 커밋 금지**)
- `~/.tauri/oddeyes.key.pub` - 공개키 (tauri.conf.json에 설정)

### 1.2 키 관리

| 키 종류 | 용도 | 저장 위치 |
|---------|------|-----------|
| 비밀키 (.key) | 빌드 시 바이너리 서명 | 로컬 또는 CI/CD 시크릿 |
| 공개키 (.key.pub) | 앱에서 업데이트 검증 | tauri.conf.json |

**보안 주의사항:**
- 비밀키는 `.gitignore`에 추가
- CI/CD 환경에서는 환경변수로 주입

---

## 2단계: Rust 백엔드 설정

### 2.1 의존성 추가

**파일:** `src-tauri/Cargo.toml`

```toml
[dependencies]
# 기존 의존성...
tauri-plugin-updater = "2"
tauri-plugin-process = "2"  # 앱 재시작용
```

### 2.2 플러그인 등록

**파일:** `src-tauri/src/lib.rs`

```rust
use tauri::Manager;
use std::sync::Mutex;

// 업데이트 상태 관리 구조체
pub struct PendingUpdate(pub Mutex<Option<tauri_plugin_updater::Update>>);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::init())      // 추가
        .plugin(tauri_plugin_process::init())      // 추가
        .setup(|app| {
            // 기존 setup 코드...

            // 업데이트 상태 관리자 등록 (데스크톱만)
            #[cfg(desktop)]
            app.manage(PendingUpdate(Mutex::new(None)));

            Ok(())
        })
        // 기존 invoke_handler...
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 2.3 업데이트 관련 Tauri Command 추가 (선택사항)

Rust에서 업데이트 로직을 처리하려면 별도 command 파일 생성:

**파일:** `src-tauri/src/commands/updater.rs`

```rust
use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;
use std::sync::Mutex;

pub struct PendingUpdate(pub Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

/// 업데이트 확인
#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(update) = update {
        let info = UpdateInfo {
            version: update.version.clone(),
            body: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        };

        // 나중에 설치할 수 있도록 저장
        *pending.0.lock().unwrap() = Some(update);

        Ok(Some(info))
    } else {
        Ok(None)
    }
}

/// 업데이트 다운로드 및 설치
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("No pending update")?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    // 앱 재시작
    app.restart();
}
```

---

## 3단계: Tauri 설정

**파일:** `src-tauri/tauri.conf.json`

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "OddEyes.ai",
  "version": "1.1.0",
  "identifier": "com.ite.app",
  "build": {
    // 기존 설정...
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "createUpdaterArtifacts": true,  // 추가: 업데이트 아티팩트 생성
    "icon": [...]
  },
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6...(공개키 내용)",
      "endpoints": [
        "https://github.com/user/oddeyes-release/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  },
  "app": {
    // 기존 설정...
  }
}
```

### 3.1 CSP 업데이트

업데이트 서버 연결을 위해 CSP에 도메인 추가:

```json
"security": {
  "csp": "... connect-src 'self' ipc: https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://github.com https://objects.githubusercontent.com; ..."
}
```

---

## 4단계: 프론트엔드 구현

### 4.1 패키지 설치

```bash
npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

### 4.2 업데이트 체크 훅 생성

**파일:** `src/hooks/useAutoUpdate.ts`

```typescript
import { useEffect, useState, useCallback } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

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

  const checkForUpdate = useCallback(async () => {
    setState(prev => ({ ...prev, checking: true, error: null }));

    try {
      const update = await check();

      if (update) {
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

    setState(prev => ({ ...prev, downloading: true, progress: 0 }));

    try {
      let contentLength = 0;
      let downloaded = 0;

      await state.update.downloadAndInstall((event) => {
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

      // 설치 완료 후 재시작
      await relaunch();
    } catch (error) {
      setState(prev => ({
        ...prev,
        downloading: false,
        error: error instanceof Error ? error.message : 'Update failed',
      }));
    }
  }, [state.update]);

  // 앱 시작 시 자동 체크
  useEffect(() => {
    // 개발 모드에서는 스킵
    if (import.meta.env.DEV) return;

    // 시작 후 3초 뒤 체크 (앱 로딩 완료 후)
    const timer = setTimeout(() => {
      checkForUpdate();
    }, 3000);

    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  return {
    ...state,
    checkForUpdate,
    downloadAndInstall,
  };
}
```

### 4.3 업데이트 모달 컴포넌트

**파일:** `src/components/ui/UpdateModal.tsx`

```typescript
import React from 'react';
import { useTranslation } from 'react-i18next';

interface UpdateModalProps {
  isOpen: boolean;
  version: string;
  releaseNotes?: string;
  downloading: boolean;
  progress: number;
  onUpdate: () => void;
  onSkip: () => void;
}

export function UpdateModal({
  isOpen,
  version,
  releaseNotes,
  downloading,
  progress,
  onUpdate,
  onSkip,
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

        {downloading ? (
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span>{t('update.downloading', '다운로드 중...')}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-3">
            <button
              onClick={onSkip}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
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
        )}
      </div>
    </div>
  );
}
```

### 4.4 App.tsx에 통합

**파일:** `src/App.tsx`

```typescript
import { useAutoUpdate } from './hooks/useAutoUpdate';
import { UpdateModal } from './components/ui/UpdateModal';

function App() {
  const {
    available,
    downloading,
    progress,
    update,
    downloadAndInstall
  } = useAutoUpdate();

  const [showUpdateModal, setShowUpdateModal] = useState(false);

  useEffect(() => {
    if (available && update) {
      setShowUpdateModal(true);
    }
  }, [available, update]);

  return (
    <>
      {/* 기존 앱 컴포넌트 */}

      <UpdateModal
        isOpen={showUpdateModal}
        version={update?.version ?? ''}
        releaseNotes={update?.body ?? undefined}
        downloading={downloading}
        progress={progress}
        onUpdate={downloadAndInstall}
        onSkip={() => setShowUpdateModal(false)}
      />
    </>
  );
}
```

---

## 5단계: 업데이트 서버 설정 (GitHub Releases)

### 5.1 GitHub Releases 사용 (권장)

별도 서버 없이 GitHub Releases를 업데이트 서버로 사용합니다.

**저장소 구조:**
```
oddeyes-release/
├── releases/
│   └── latest/
│       └── download/
│           ├── latest.json           # 버전 정보
│           ├── OddEyes.ai_1.2.0_x64.dmg
│           ├── OddEyes.ai_1.2.0_x64.dmg.sig
│           ├── OddEyes.ai_1.2.0_x64-setup.exe
│           └── OddEyes.ai_1.2.0_x64-setup.exe.sig
```

### 5.2 latest.json 형식

Tauri가 읽을 수 있는 버전 정보 파일:

```json
{
  "version": "1.2.0",
  "notes": "- 버그 수정\n- 성능 개선\n- 새로운 기능 추가",
  "pub_date": "2024-01-23T10:00:00Z",
  "platforms": {
    "darwin-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "url": "https://github.com/user/oddeyes-release/releases/download/v1.2.0/OddEyes.ai_1.2.0_x64.app.tar.gz"
    },
    "darwin-aarch64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "url": "https://github.com/user/oddeyes-release/releases/download/v1.2.0/OddEyes.ai_1.2.0_aarch64.app.tar.gz"
    },
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "url": "https://github.com/user/oddeyes-release/releases/download/v1.2.0/OddEyes.ai_1.2.0_x64-setup.nsis.zip"
    }
  }
}
```

### 5.3 플랫폼 키 참고

| OS | 아키텍처 | 키 |
|----|----------|-----|
| macOS | Intel | `darwin-x86_64` |
| macOS | Apple Silicon | `darwin-aarch64` |
| Windows | 64bit | `windows-x86_64` |
| Linux | 64bit | `linux-x86_64` |

---

## 6단계: 빌드 및 배포

### 6.1 서명된 빌드 생성

```bash
# 환경변수로 비밀키 설정
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/oddeyes.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""  # 키에 암호가 있으면 설정

# 빌드
npm run tauri:build
```

### 6.2 생성되는 아티팩트

`createUpdaterArtifacts: true` 설정 시 추가 생성:

**macOS:**
- `OddEyes.ai.app.tar.gz` - 업데이트용 압축 파일
- `OddEyes.ai.app.tar.gz.sig` - 서명 파일

**Windows:**
- `OddEyes.ai_1.2.0_x64-setup.nsis.zip` - 업데이트용 압축 파일
- `OddEyes.ai_1.2.0_x64-setup.nsis.zip.sig` - 서명 파일

### 6.3 릴리즈 배포 스크립트

**파일:** `scripts/release.sh`

```bash
#!/bin/bash
set -e

VERSION=$(node -p "require('./package.json').version")

echo "Building OddEyes.ai v$VERSION..."

# 서명 키 확인
if [ -z "$TAURI_SIGNING_PRIVATE_KEY" ]; then
  export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/oddeyes.key)
fi

# 빌드
npm run tauri:build

# latest.json 생성 (macOS example)
cat > latest.json << EOF
{
  "version": "$VERSION",
  "notes": "$(git log -1 --pretty=%B)",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$(cat src-tauri/target/release/bundle/macos/OddEyes.ai.app.tar.gz.sig)",
      "url": "https://github.com/user/oddeyes-release/releases/download/v$VERSION/OddEyes.ai.app.tar.gz"
    }
  }
}
EOF

echo "Done! Upload artifacts to GitHub Release."
```

---

## 7단계: CI/CD 설정 (GitHub Actions)

**파일:** `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: universal-apple-darwin
          - os: windows-latest
            target: x86_64-pc-windows-msvc

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup Rust
        uses: dtolnay/rust-action@stable

      - name: Install dependencies
        run: npm ci

      - name: Build Tauri
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
        with:
          tagName: v__VERSION__
          releaseName: 'OddEyes.ai v__VERSION__'
          releaseBody: 'See the changelog for details.'
          releaseDraft: true
          prerelease: false
          args: --target ${{ matrix.target }}
```

---

## 8단계: i18n 키 추가

**파일:** `src/i18n/locales/ko.json`

```json
{
  "update": {
    "newVersionAvailable": "새로운 버전이 있습니다",
    "versionInfo": "OddEyes.ai {{version}} 버전을 사용할 수 있습니다.",
    "downloading": "다운로드 중...",
    "later": "나중에",
    "updateNow": "지금 업데이트",
    "updateFailed": "업데이트 실패",
    "checkingForUpdates": "업데이트 확인 중..."
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
    "updateFailed": "Update Failed",
    "checkingForUpdates": "Checking for updates..."
  }
}
```

---

## 구현 체크리스트

### 1단계: 준비
- [ ] 서명 키 페어 생성 (`npx tauri signer generate`)
- [ ] 비밀키 안전한 곳에 보관
- [ ] `.gitignore`에 키 파일 추가

### 2단계: Rust 백엔드
- [ ] `Cargo.toml`에 `tauri-plugin-updater`, `tauri-plugin-process` 추가
- [ ] `lib.rs`에 플러그인 등록

### 3단계: Tauri 설정
- [ ] `tauri.conf.json`에 `createUpdaterArtifacts: true` 추가
- [ ] `plugins.updater` 섹션 추가 (pubkey, endpoints)
- [ ] CSP에 업데이트 서버 도메인 추가

### 4단계: 프론트엔드
- [ ] npm 패키지 설치
- [ ] `useAutoUpdate` 훅 생성
- [ ] `UpdateModal` 컴포넌트 생성
- [ ] App.tsx에 통합
- [ ] i18n 키 추가

### 5단계: 배포
- [ ] GitHub Release 저장소 생성 (또는 기존 저장소 사용)
- [ ] 릴리즈 스크립트 작성
- [ ] CI/CD 워크플로우 설정

### 6단계: 테스트
- [ ] 로컬 빌드 후 서명 파일 생성 확인
- [ ] latest.json 수동 생성 및 테스트
- [ ] 실제 업데이트 흐름 E2E 테스트

---

## 주의사항

1. **개발 모드에서는 업데이트 체크 비활성화** - `import.meta.env.DEV` 체크
2. **비밀키 절대 커밋 금지** - CI/CD 시크릿으로만 관리
3. **버전 동기화 필수** - package.json, Cargo.toml, tauri.conf.json 버전 일치
4. **HTTPS 필수** - 프로덕션에서는 반드시 HTTPS 엔드포인트 사용
5. **서명 검증** - 모든 업데이트 파일은 서명 필수

---

## 참고 자료

- [Tauri 2 Updater Plugin 공식 문서](https://v2.tauri.app/plugin/updater/)
- [Tauri Signer 문서](https://v2.tauri.app/distribute/sign/)
- [GitHub Releases API](https://docs.github.com/en/rest/releases)
