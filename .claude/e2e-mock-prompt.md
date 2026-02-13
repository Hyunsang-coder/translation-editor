# Playwright E2E Mock Layer 구현

## 새 세션 프롬프트

```
Playwright E2E 테스트의 Tauri Mock Layer를 구현해줘.

## 배경
현재 `npm run test:e2e:web` 실행 시 Tauri 런타임이 없어서 `invoke()` 호출이 전부 실패한다.
`window.__TAURI_INTERNALS__`를 mock으로 주입하여 모든 UI 인터랙션이 동작하게 만들어야 한다.

## 계획 파일
`.claude/plans/piped-frolicking-star.md` 에 전체 구현 계획이 있어. 먼저 읽고 진행해.

## 작업 순서

### 1. `e2e/tauri-mock.ts` 생성
- `page.addInitScript()`로 브라우저에 주입할 mock 스크립트
- `window.__TAURI_INTERNALS__.invoke(cmd, args)` 가로채기
- 인메모리 상태 관리 (projects Map, sessions Map)
- 앱 부트스트랩 필수 명령 모킹:
  - `secrets_initialize` → `{ success: true, cached_count: 0 }`
  - `list_project_ids` → `[]`
  - `list_recent_projects` → `[]`
  - `mcp_registry_status` → `{ servers: {} }`
  - `connector_list_status` → `[]`
  - `cleanup_temp_images` → `0`
- 프로젝트 CRUD 모킹:
  - `create_project` → 인메모리 프로젝트 생성 후 반환
  - `load_project` → 인메모리에서 조회
  - `save_project` → 인메모리에 저장
  - `delete_project` → 인메모리에서 삭제
- 채팅/히스토리/시크릿 등은 기본 빈 응답

### 2. `e2e/fixtures/mock-data.ts` 생성
- `src/types/index.ts`의 타입 참조하여 mock 팩토리 함수 작성
- `mockProject()`, `mockChatSession()`, `mockSnapshot()`

### 3. `e2e/user-story.spec.ts` 수정
- `beforeEach`에서 `page.addInitScript()` 호출하여 mock 주입
- 셀렉터를 실제 UI에 맞게 개선
- 현재 실패하는 4개 테스트 수정

### 4. 검증
`npm run test:e2e:web` → 전체 통과 (paste-normalizer 11 + user-story 5)

## 참고 파일
- `src/tauri/invoke.ts` — isTauriRuntime() 체크, __TAURI_INTERNALS__ 사용
- `src/tauri/project.ts` — createProject() invoke 패턴
- `src/tauri/storage.ts` — listProjectIds(), listRecentProjects() 패턴
- `src/stores/projectStore.ts` — 앱 부트스트랩 시퀀스
- `src/test/setup.ts` — 기존 Vitest mock 패턴 참고
- `src/types/index.ts` — ITEProject, ProjectDomain 등 타입 정의
- `playwright.web.config.ts` — 현재 Playwright 설정 (port 1421)

## 65개 invoke 명령 카탈로그
`.claude/plans/piped-frolicking-star.md` 참조
```
