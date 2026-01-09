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

### 1. Pre-flight Checks (Optional)

`--check-first` 사용 시:
```bash
# Rust 컴파일 체크
cd src-tauri && cargo check

# TypeScript 타입 체크
npx tsc --noEmit
```

### 2. Clean Build (Optional)

`--clean` 사용 시:
```bash
# Vite 캐시 정리
rm -rf node_modules/.vite

# Rust target 정리 (incremental만)
cd src-tauri && cargo clean -p translation-editor
```

### 3. Start Development Server

```bash
# Full Tauri dev (Frontend + Backend)
npm run tauri:dev

# Frontend only
npm run dev
```

## Process Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   npm run tauri:dev                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────┐      ┌─────────────────┐          │
│  │   Vite Server   │      │  Tauri Process  │          │
│  │   (Port 1420)   │◄────►│  (Rust Backend) │          │
│  └────────┬────────┘      └────────┬────────┘          │
│           │                        │                    │
│           ▼                        ▼                    │
│  ┌─────────────────┐      ┌─────────────────┐          │
│  │  React HMR      │      │  File Watcher   │          │
│  │  Hot Reload     │      │  Rust Rebuild   │          │
│  └─────────────────┘      └─────────────────┘          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Log Monitoring

### Frontend Logs (Vite)
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:1420/
➜  Network: http://192.168.x.x:1420/

[HMR] connected
```

### Backend Logs (Tauri/Rust)
```
   Compiling translation-editor v0.1.0
    Finished `dev` profile [unoptimized + debuginfo]
     Running `target/debug/translation-editor`

[tauri] window created
[tauri] IPC call: load_project
```

### Error Patterns to Watch

```
❌ RUST COMPILE ERROR
───────────────────────────────────────────────────────────
error[E0308]: mismatched types
  --> src/commands/project.rs:45:12
   |
45 |     return value;
   |            ^^^^^ expected `String`, found `&str`

💡 Fix: Add .to_string() or change return type

───────────────────────────────────────────────────────────

❌ VITE BUILD ERROR
───────────────────────────────────────────────────────────
[vite] Internal server error:
Transform failed with 1 error:
src/components/Editor.tsx:23:4: ERROR: Expected "}" but found "const"

💡 Fix: Check for missing closing braces

───────────────────────────────────────────────────────────

❌ TAURI RUNTIME ERROR
───────────────────────────────────────────────────────────
thread 'main' panicked at src/main.rs:15:5:
called `Result::unwrap()` on an `Err` value: ...

💡 Fix: Use proper error handling instead of unwrap()
```

## Environment Setup

### Required Environment
```bash
# .env.local (개발용, git ignored)
VITE_DEV_MODE=true
```

### Port Configuration
- **Vite Dev Server**: 1420 (tauri.conf.json에서 설정)
- **Tauri DevTools**: 자동 할당

## Quick Actions

### 서버 재시작
```
Ctrl+C → /dev
```

### Rust만 재빌드 (프론트엔드 유지)
```bash
# Tauri가 자동으로 감지하지만, 수동 필요시:
cd src-tauri && cargo build
```

### HMR 강제 새로고침
```
브라우저에서 Cmd+Shift+R (Hard Reload)
```

## Common Issues

### 1. Port Already in Use
```bash
# 기존 프로세스 종료
lsof -ti:1420 | xargs kill -9
```

### 2. Rust Rebuild 안됨
```bash
# Cargo 캐시 문제
cd src-tauri && cargo clean && cargo build
```

### 3. HMR 연결 끊김
```
# Vite 서버 재시작
Ctrl+C → npm run dev
```

### 4. SQLite Lock
```bash
# 이전 프로세스가 DB 잠금 중
lsof +D ~/.local/share/com.oddeyesai.app/ | grep .db
```

## Integration

### With /typecheck
```
/typecheck --fix 후 자동으로 /dev 실행 제안
```

### With Agents
- **tauri-bridge**: IPC 에러 발생 시 관련 agent 참조
- **store-sync**: 상태 관련 에러 시 참조

## Recommended Workflow

```
1. /typecheck              # 타입 오류 확인
2. /dev --check-first      # 체크 후 실행
3. 코드 수정               # HMR로 자동 반영
4. /typecheck              # 수정 후 재확인
```
