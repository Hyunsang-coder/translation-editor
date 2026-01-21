# 10. 개발 도구 및 환경 (Dev Tools)

## 10.1 기술 스택

- **State Management**: Zustand (Global Store), Immer (Immutable Updates)
- **Formatting/Linting**: Prettier, ESLint
- **Testing**: Vitest (Unit), Rust 테스트 (`cargo test`)
- **E2E Testing**: 미구현 (Playwright 도입 예정)
- **Git Hooks**: Husky (pre-commit TypeScript 타입 체크, post-merge 자동 npm install)

---

## 10.2 테스트 환경

### Frontend (Vitest)

```bash
npm test              # Watch mode
npm run test:run      # Single run (CI)
npm run test:ui       # Browser UI
npm run test:coverage # Coverage report
```

- **Environment**: jsdom
- **Setup**: `src/test/setup.ts` (Tauri IPC mocking, DOM API polyfills)
- **Config**: `vitest.config.ts`
- **Location**: 소스와 동일 디렉토리 (`*.test.ts`, `*.spec.ts`)

### Backend (Rust)

```bash
cd src-tauri && cargo test
```

### TDD 워크플로우

`/tdd` 스킬로 Red-Green-Refactor 사이클 지원:
1. 실패하는 테스트 작성
2. 테스트 실행 및 실패 확인
3. 최소 구현으로 테스트 통과
4. 리팩토링

---

## 10.3 기술적 체크포인트

### Performance
- TipTap 두 개(Source/Target) 동시 렌더링 시 60fps 근접 유지 확인

### IPC Latency
- 대용량 텍스트 저장 시 Rust-React 간 통신 지연시간 50ms 미만 유지

### Diff Accuracy
- 한글 특유의 조사 변화나 어미 변화 시 Diff 알고리즘이 자연스럽게 하이라이트를 생성하는지 검증
