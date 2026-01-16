# 10. 개발 도구 및 환경 (Dev Tools)

## 10.1 기술 스택

- **State Management**: Zustand (Global Store), Immer (Immutable Updates)
- **Formatting/Linting**: Prettier, ESLint
- **Testing**: Vitest (Unit), Playwright (E2E for Tauri)

---

## 10.2 기술적 체크포인트

### Performance
- TipTap 두 개(Source/Target) 동시 렌더링 시 60fps 근접 유지 확인

### IPC Latency
- 대용량 텍스트 저장 시 Rust-React 간 통신 지연시간 50ms 미만 유지

### Diff Accuracy
- 한글 특유의 조사 변화나 어미 변화 시 Diff 알고리즘이 자연스럽게 하이라이트를 생성하는지 검증
