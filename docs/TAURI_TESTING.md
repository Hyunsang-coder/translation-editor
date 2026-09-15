# 테스트 가이드

## 기본 하네스

```bash
npm run test:harness
```

백그라운드에서 Vitest와 Rust 테스트만 실행한다. 브라우저, Tauri 앱, WebView, 녹화기, 실제 AI 호출은 시작하지 않는다.

## 필요할 때만 실행

```bash
npm run test:e2e:web  # 브라우저 상호작용 검증
npm run test:e2e      # Tauri debug/no-bundle 빌드
npm run test:tauri    # 릴리즈 전 전체 게이트
```

E2E는 UI 동작 자체가 검증 대상일 때만 추가한다. 순수 변환, 상태, 프롬프트, 저장 계약은 Vitest 또는 Rust 테스트로 검증한다.

세부 작성 규칙은 [`.claude/testing.md`](../.claude/testing.md)를 따른다.
