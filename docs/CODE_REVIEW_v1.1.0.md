# OddEyes.ai v1.1.0 코드 리뷰 보고서

**리뷰 일자**: 2026-01-20
**대상 브랜치**: beta-1.0
**리뷰어**: Claude Code

---

## 요약

| 영역 | 상태 | 발견 사항 |
|-----|-----|----------|
| TypeScript 컴파일 | ✅ 통과 | 에러 0건 |
| Rust 컴파일 | ⚠️ 경고 1건 | `build_request` 미사용 |
| 보안 | 🟡 주의 | CSP 정책 개선 필요 |
| 에러 처리 | 🔴 개선 필요 | Critical 5건, High 5건 |
| 디버그 코드 | 🟠 정리 필요 | alert 3건, console.log 228건+ |
| 빌드 설정 | ✅ 우수 | 버전 동기화, 최적화 양호 |

**종합 평가**: B+ (배포 가능, 필수 수정 3건 후 권장)

---

## 1. 필수 수정 사항 (배포 차단)

### 1.1 alert() 호출 제거

**파일**: `src/components/editor/EditorCanvasTipTap.tsx`

| 라인 | 현재 코드 | 수정 방향 |
|-----|----------|----------|
| 205 | `window.alert('Source 에디터가 아직 준비되지 않았습니다.')` | Toast 알림 |
| 210 | `window.alert('타겟 언어를 선택하세요.')` | Toast 알림 |
| 297 | `window.alert('Translation 에디터가 아직 준비되지 않았습니다.')` | Toast 알림 |

### 1.2 unwrap() 패닉 위험

| 파일 | 라인 | 문제 |
|-----|------|------|
| `src-tauri/src/lib.rs` | 216 | `.parse().unwrap()` |
| `src-tauri/src/mcp/client.rs` | 423 | `serde_json::to_value().unwrap()` |
| `src-tauri/src/mcp/notion_client.rs` | 145 | `serde_json::to_value().unwrap()` |
| `src-tauri/src/mcp/notion_client.rs` | 350 | `serde_json::to_value().unwrap()` |

**수정**: `?` 연산자 또는 `map_err()` 사용

### 1.3 localhost 하드코딩

| 파일 | 라인 | 값 |
|-----|------|-----|
| `src-tauri/src/lib.rs` | 216 | `http://localhost:1420` |

**수정**: 윈도우 현재 URL 사용 또는 조건부 처리

---

## 2. 권장 수정 사항

### 2.1 에러 처리 강화 (Critical)

1. **Tauri invoke 래퍼 필요**
   - 파일: `src/tauri/*.ts`
   - 문제: 대부분 try-catch 없음

2. **Promise rejection 처리**
   - 파일: `src/stores/chatStore.ts:310`
   - 문제: `persistNow()` 에러 무시

3. **AI 스트리밍 에러**
   - 파일: `src/ai/chat.ts:307-348`
   - 문제: 부분 응답 없을 때 제네릭 throw

4. **글로서리 검색 에러**
   - 파일: `src/stores/chatStore.ts:768-796`
   - 문제: 실패 시 사용자 알림 없음

5. **Review API 에러**
   - 파일: `src/ai/review/runReview.ts:80-98`
   - 문제: 스트리밍 에러 처리 없음

### 2.2 에러 처리 강화 (High)

1. **null/undefined 체크** - `src/ai/tools/documentTools.ts`
2. **번역 유효성 검사** - `src/ai/translateDocument.ts`
3. **abortController 정리** - `src/stores/chatStore.ts`
4. **사용자 에러 메시지** - 기술 용어 제거
5. **Tool 호출 타임아웃** - `src/ai/chat.ts`

### 2.3 CSP 정책 강화

**파일**: `src-tauri/tauri.conf.json`

| 현재 | 권장 |
|-----|------|
| `script-src 'self' 'unsafe-inline' 'unsafe-eval'` | `script-src 'self'` |
| `style-src 'self' 'unsafe-inline'` | `style-src 'self'` |

### 2.4 디버그 로그 정리

| 타입 | 개수 | 주요 위치 |
|-----|-----|----------|
| console.log (TS) | 78건 | stores/, ai/mcp/, editor/extensions/ |
| println!/eprintln! (Rust) | 150건+ | mcp/, secrets/ |

**권장**: 프로덕션 빌드에서 조건부 제거

---

## 3. 보안 검토 결과

### 3.1 안전한 부분 ✅

- **API Key 저장**: OS 키체인 사용 (XChaCha20-Poly1305)
- **SQL Injection**: 모든 쿼리 매개변수화
- **Path Traversal**: `validate_path()` 구현
- **HTML Sanitization**: DOMPurify 사용
- **파일 크기 제한**: 100MB/10MB 제한

### 3.2 개선 필요 ⚠️

- **CSP 정책**: `unsafe-inline`, `unsafe-eval` 사용 중
- **에러 로깅**: 민감 정보 포함 가능성 확인 필요

---

## 4. Rust 백엔드 검토

### 4.1 동시성 이슈

- **문제**: Sync Mutex가 async context에서 blocking
- **영향**: tokio 스레드풀 고갈 가능
- **위치**: `src-tauri/src/db/mod.rs` 전체
- **권장**: `tokio::sync::Mutex` 또는 connection pool

### 4.2 Dead Code

```
warning: method `build_request` is never used
  --> src/notion/client.rs:97:8
```

### 4.3 에러 타입 불일치

- **파일**: `src-tauri/src/commands/mcp.rs:17`
- **문제**: `String` 반환 (다른 파일은 `CommandError`)

---

## 5. 빌드 설정

### 5.1 버전 동기화 ✅

- `package.json`: 1.1.0
- `Cargo.toml`: 1.1.0
- `tauri.conf.json`: 1.1.0

### 5.2 최적화 설정 ✅

**Vite**:
- Target: chrome105/safari14
- Minify: esbuild
- Sourcemap: 조건부

**Cargo Release**:
- LTO: true
- opt-level: "s"
- strip: true

### 5.3 누락 파일

- `.env.example` 생성 필요

---

## 6. TODO 항목 (13건)

| 파일 | 내용 |
|-----|------|
| `src/tauri/connector.ts:99` | Phase 2-oauth 구현 |
| `src/components/settings/ConnectorsSection.tsx` | OAuth 구현 후 활성화 (3건) |
| `src/components/chat/ChatContent.tsx:689` | Settings로 이동하여 Notion 연결 |
| `src-tauri/src/db/mod.rs:514` | 히스토리 로드 구현 |
| `src-tauri/src/commands/history.rs` | 히스토리 기능 (4건) |
| `src-tauri/src/commands/block.rs` | 데이터베이스 저장 (2건) |
| `src-tauri/src/commands/connector.rs` | Phase 2-oauth (2건) |

---

## 7. 배포 체크리스트

### 필수 (배포 차단)
- [ ] alert() → Toast 교체 (3건)
- [ ] unwrap() 패닉 수정 (4건)
- [ ] localhost 하드코딩 제거

### 권장 (1주 내)
- [ ] Tauri invoke 에러 래퍼
- [ ] CSP 정책 `unsafe-*` 제거 검토
- [ ] `.env.example` 생성
- [ ] 주요 console.log 정리

### 선택 (차후)
- [ ] Rust async Mutex 마이그레이션
- [ ] TODO 완료 또는 이슈 등록
- [ ] Dead code 정리

---

## 부록: 주요 파일 목록

```
수정 필요:
- src/components/editor/EditorCanvasTipTap.tsx (alert 3건)
- src-tauri/src/lib.rs (unwrap, localhost)
- src-tauri/src/mcp/client.rs (unwrap 2건)
- src-tauri/src/mcp/notion_client.rs (unwrap 2건)
- src-tauri/tauri.conf.json (CSP)

정리 필요:
- src/stores/projectStore.ts (console.log)
- src/stores/chatStore.ts (console.log)
- src/ai/mcp/McpClientManager.ts (console.log 40건+)
- src/editor/extensions/ReviewHighlight.ts (console.log 5건)
```
