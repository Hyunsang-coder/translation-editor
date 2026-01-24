# 10. 개발 도구 및 환경 (Dev Tools)

## 10.1 기술 스택

- **State Management**: Zustand (Global Store), Immer (Immutable Updates)
- **Formatting/Linting**: Prettier, ESLint
- **Testing**: Vitest (Unit), Rust 테스트 (`cargo test`)
- **E2E Testing**: 미구현 (Playwright 도입 예정)
- **Git Hooks**: Native Git Hooks (pre-commit TypeScript 타입 체크)

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

### 테스트 파일 목록

| 파일 | 테스트 대상 | 테스트 수 |
|------|-------------|-----------|
| `src/ai/prompt.test.ts` | 요청 유형 감지, 블록 컨텍스트 빌더 | 19 |
| `src/ai/review/parseReviewResult.test.ts` | 리뷰 결과 JSON 파싱, 중복 제거 | 25 |
| `src/ai/tools/buildAlignedChunks.test.ts` | 청킹 알고리즘 (동기/비동기) | 8 |
| `src/stores/chatStore.selectors.test.ts` | Zustand 그룹 셀렉터 | 7 |
| `src/utils/normalizeForSearch.test.ts` | 텍스트 정규화, 유니코드 처리 | 22 |
| `src/utils/imagePlaceholder.test.ts` | 이미지 추출/복원, 토큰 절약 계산 | 21 |

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

---

## 10.4 빌드 및 배포

### CI/CD (GitHub Actions)

`v*` 태그 push 시 자동 빌드:
- **macOS**: Universal binary (Intel + Apple Silicon)
- **Windows**: x64 NSIS 설치 파일

워크플로우: `.github/workflows/build.yml`

### 자동 업데이트

#### Why
- 사용자가 수동으로 GitHub Releases를 확인하지 않아도 최신 버전 유지 가능
- 보안 패치 및 버그 수정의 빠른 배포

#### How
- Tauri Updater Plugin (`@tauri-apps/plugin-updater`)
- GitHub Releases의 `latest.json` 참조
- 서명 파일(`.sig`)로 무결성 검증

#### What
- 앱 시작 시 자동 버전 확인 (프로덕션 빌드만, 3초 딜레이)
- 다운로드 진행률 표시
- "이 버전 건너뛰기" 옵션 (localStorage)
- 다운로드 중 취소 가능 (AbortController)
- UI: `UpdateModal.tsx`, Hook: `useAutoUpdate.ts`
