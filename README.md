# OddEyes.ai

전문 번역가를 위한 AI 기반 번역 에디터

## 핵심 기능

- **Document-First Editor**: Notion 스타일 TipTap 에디터 (Source/Target)
- **AI Chat**: LangChain.js 기반 멀티 탭 채팅, 플로팅 패널 + 고정(Pin) 기능
- **Multi-Provider AI**: OpenAI/Anthropic 동시 사용, 모델별 자동 프로바이더 선택
- **문서 전체 번역**: Preview → Apply 워크플로우 (채팅에서도 전체 문서 번역/검수 가능)
- **번역 검수**: 오역/누락/일관성 검출 + 에디터 하이라이트 + 수정 제안 적용 + 재번역
- **히스토리 스냅샷**: 문서 버전 저장/비교/복원/이름변경, 스냅샷 간 diff 비교
- **내보내기**: PDF/DOCX/HTML/Markdown, 대역(Source+Target) 레이아웃 지원
- **용어집**: 프로젝트별 용어 관리, 번역/검수 시 자동 참조
- **검색/치환**: 에디터 내 검색 (Cmd+F) 및 치환 (Cmd+H, Target 전용)
- **외부 연동**: Confluence (MCP), Notion, 웹검색
- **자동 업데이트**: GitHub Releases 기반 인앱 업데이트 (macOS/Windows)

## 기술 스택

| 영역 | 기술 |
|------|------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS |
| Editor | TipTap (ProseMirror) |
| State | Zustand 5 |
| AI | LangChain.js (OpenAI, Anthropic) |
| Backend | Tauri 2 + Rust |
| Storage | SQLite (.ite 파일) |
| E2E | Playwright + Tauri MCP Bridge |

## 시작하기

```bash
npm install
npm run tauri:dev    # 개발 서버
npm run tauri:build  # 프로덕션 빌드
```

## 린트 & 테스트

```bash
npm run lint          # ESLint 검사
npm run lint:fix      # 자동 수정
npm test              # Watch mode
npm run test:run      # Unit/Component/Store 단일 실행
npm run test:coverage # Unit coverage report
npm run test:e2e:web  # Playwright 웹 E2E (Tauri IPC mock 기반)
npm run test:e2e      # Tauri build smoke (debug/no-bundle 빌드 검증)
npm run test:ci:local # CI verify와 동일한 로컬 프리플라이트
npm run test:tauri    # 배포 전 전체 점검 (lint+unit+smoke+rust+release check)
```

### Tauri MCP E2E 테스트

```bash
npm run test:e2e:tauri:mcp:workflow          # Full workflow (번역+리뷰+채팅)
npm run test:e2e:tauri:mcp:new-project       # 프로젝트 생성 smoke test
npm run test:e2e:tauri:mcp:review-highlight  # 검수 하이라이트 테스트
npm run test:e2e:tauri:mcp:history-compare   # 히스토리 비교(선택 기반 UI) 테스트
```

**배포 전 체크리스트**: `npm run test:tauri`로 모든 테스트를 한 번에 실행합니다.
- ESLint (0 경고)
- Unit Tests (Vitest)
- Tauri Build Smoke (`tauri build --debug --no-bundle`)
- Rust Tests (`cargo test`)
- Release Build 검증

### 테스트 환경 API 키

- **런타임 앱(Tauri)**: Settings에서 입력한 API 키를 secure store(OS keychain + 암호화 vault)에서 읽습니다.
- **Vitest 테스트 실행 시에만**: `.env.local`의 `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`를 fallback으로 참조할 수 있습니다.
- Store에 키가 있으면 Store 값이 우선됩니다.

## 빌드 및 배포

```bash
npm run tauri:build   # 프로덕션 빌드 (현재 OS에 맞는 번들 자동 생성)
```

### 빌드 출력 경로

| 플랫폼 | 번들 타입 | 경로 |
|--------|----------|------|
| macOS | `.dmg` | `src-tauri/target/release/bundle/dmg/` |
| macOS | `.app` | `src-tauri/target/release/bundle/macos/` |
| Windows | `.exe` (NSIS) | `src-tauri/target/release/bundle/nsis/` |
| Windows | `.msi` | `src-tauri/target/release/bundle/msi/` |

### 특정 번들만 빌드

```bash
npx tauri build --bundles dmg    # macOS DMG만
npx tauri build --bundles nsis   # Windows NSIS만
```

### macOS Universal 빌드 (Intel + Apple Silicon)

```bash
# 사전 준비: 두 아키텍처 타겟 설치
rustup target add x86_64-apple-darwin
rustup target add aarch64-apple-darwin

# Universal 빌드
npx tauri build --target universal-apple-darwin
```

출력: `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`

`tauri.conf.json`의 `bundle.targets`는 `"all"`로 설정되어 있어 현재 OS에 맞는 번들이 자동 선택됩니다.

### CI/CD

GitHub Actions로 자동 빌드 (`v*` 태그 push 시):
- macOS Universal (Intel + Apple Silicon)
- Windows x64 (NSIS)

릴리즈 노트는 커밋 히스토리 기반 자동 생성됩니다.

## 설치

### macOS

[Releases](https://github.com/Hyunsang-coder/translation-editor/releases)에서 `.dmg` 파일을 다운로드하여 설치합니다.

> **"앱이 손상되었습니다" 오류 발생 시**
>
> 현재 Apple Developer 계정으로 공증되지 않아 macOS Gatekeeper 경고가 발생할 수 있습니다.
> 터미널에서 다음 명령어를 실행하세요:
> ```bash
> xattr -cr /Applications/OddEyes.ai.app
> ```
> 또는 앱을 **우클릭 → 열기**로 실행하면 됩니다.

### Windows

[Releases](https://github.com/Hyunsang-coder/translation-editor/releases)에서 `.exe` 설치 파일을 다운로드하여 설치합니다.

## 프로젝트 구조

```
├── src/                     # Frontend (React)
│   ├── ai/                  # AI/LangChain 로직 (번역, 검수, 채팅)
│   ├── components/          # UI 컴포넌트
│   │   ├── chat/            # AI 채팅 패널
│   │   ├── editor/          # 에디터 관련 (번역 미리보기 등)
│   │   ├── export/          # 내보내기 모달
│   │   ├── history/         # 히스토리 스냅샷 UI
│   │   ├── review/          # 번역 검수 패널
│   │   ├── settings/        # 앱/프로젝트 설정
│   │   └── ui/              # 공통 UI (ErrorBoundary 등)
│   ├── editor/              # TipTap 에디터 확장
│   ├── i18n/                # 다국어 (ko/en)
│   ├── stores/              # Zustand 스토어
│   ├── tauri/               # Tauri IPC 래퍼
│   └── utils/               # 유틸리티 (export, hash, diff 등)
├── src-tauri/               # Backend (Rust)
│   ├── src/commands/        # Tauri 명령
│   ├── src/mcp/             # MCP 클라이언트
│   ├── src/notion/          # Notion API
│   └── src/secrets/         # Secret Manager
├── crates/                  # Rust 크레이트
│   └── tauri-plugin-testing/  # E2E 테스트 브리지 플러그인
├── tauri-testing-mcp/       # MCP 서버 (E2E 런타임 제어)
├── scripts/                 # 빌드/테스트 스크립트
├── docs/                    # 문서
└── tasks/                   # 구현 태스크
```

## 보안

- API Key는 OS 키체인에 마스터키 저장, 시크릿은 암호화된 Vault에 저장
- `.ite` export 파일에 시크릿 포함되지 않음

## 문서 네비게이션

-> `docs/INDEX.md` 참조
