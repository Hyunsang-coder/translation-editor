# Tauri 중심 테스트 가이드

OddEyes는 데스크톱 앱(Tauri) 배포를 목표로 하므로, 기본 E2E 흐름을 웹 기반이 아니라 Tauri 기준으로 운영합니다.

## 테스트 명령

```bash
npm run test:tauri
npm run test:ci:local
npm run lint
npm run test:run
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --release --manifest-path src-tauri/Cargo.toml
```

### `npm run test:tauri`가 하는 일

- `lint` + `vitest` + `Tauri smoke` + `cargo test/check`를 순차 실행합니다.
- 릴리즈 전 기본 게이트로 사용합니다.

### `npm run test:ci:local`가 하는 일

- CI `verify` 게이트와 동일하게 `lint` → `test:run` → `test:e2e:web` → `cargo test`를 순차 실행합니다.
- 로컬에서 CI 실패를 미리 재현할 때 사용합니다.

## Vitest API 키 주입 정책

- 테스트 실행 시에만 `.env.local`의 `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`를 fallback으로 사용할 수 있습니다.
- 런타임 앱(Tauri)에서는 fallback을 사용하지 않고, 설정 UI/secure store 키를 사용합니다.

### `npm run test:e2e`가 하는 일

- `scripts/tauri-smoke.mjs`를 실행합니다.
- 내부적으로 `tauri build --debug --no-bundle`를 수행해 다음을 한 번에 검증합니다.
- 프런트엔드 빌드
- Rust 백엔드 컴파일
- Tauri 통합 빌드 경로

`--no-bundle`을 사용하므로 DMG/NSIS 패키징 실패와 분리해서 "앱 실행 가능 상태"를 먼저 확인할 수 있습니다.

## 웹 Playwright 테스트 위치

웹 하네스 테스트는 유지하되 기본 게이트에서 제외합니다.

```bash
npm run test:e2e:web
npm run test:e2e:web:ui
```

설정 파일: `playwright.web.config.ts`

## 릴리즈 전 수동 스모크(권장)

1. `npm run tauri:dev` 실행
2. 새 프로젝트 생성
3. Source/Target 입력
4. 저장/재시작 후 프로젝트 복구 확인
5. 업데이트 모달, 파일 첨부, 설정 모달 진입 확인
