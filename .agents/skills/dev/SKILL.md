---
name: dev
description: Tauri 개발 서버 실행 및 로그 모니터링. 프론트엔드(Vite) + 백엔드(Rust) 동시 실행. 개발 시작 시 또는 HMR 테스트 시 사용.
disable-model-invocation: true
argument-hint: "[--frontend|--check-first|--clean]"
allowed-tools:
  - Bash
  - Read
---

# /dev

Tauri 개발 서버를 실행하고 로그를 모니터링합니다.

## Usage

```
/dev                 # 개발 서버 시작 (npm run tauri:dev)
/dev --frontend      # 프론트엔드만 (npm run dev)
/dev --check-first   # 타입 체크 후 실행
/dev --clean         # 캐시 정리 후 실행
```

## Execution Steps

### Pre-flight Checks (--check-first)
```bash
cd src-tauri && cargo check
npx tsc --noEmit
```

### Clean Build (--clean)
```bash
rm -rf node_modules/.vite
cd src-tauri && cargo clean -p translation-editor
```

### Start Server
```bash
npm run tauri:dev    # Full Tauri dev
npm run dev          # Frontend only
```

## Process Architecture

```
npm run tauri:dev
├── Vite Server (Port 1420) ← React HMR
└── Tauri Process (Rust Backend) ← File Watcher
```

## Common Issues

### Port Already in Use
```bash
lsof -ti:1420 | xargs kill -9
```

### Rust Rebuild 안됨
```bash
cd src-tauri && cargo clean && cargo build
```

### SQLite Lock
```bash
lsof +D ~/.local/share/com.oddeyesai.app/ | grep .db
```

## Recommended Workflow

```
1. /typecheck              # 타입 오류 확인
2. /dev --check-first      # 체크 후 실행
3. 코드 수정               # HMR로 자동 반영
4. /typecheck              # 수정 후 재확인
```
