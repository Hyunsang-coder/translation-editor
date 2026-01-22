# OddEyes.ai

> "AI를 동료로, 번역을 예술로."

전문 번역가를 위한 AI 기반 번역 워크스테이션 (내부 코드명: ITE)

## Source of Truth

- **PRD**: `prd.md` - 제품 비전/UX 원칙
- **TRD**: `docs/trd/` - 아키텍처/기술 명세 (README.md가 인덱스)
- **Tasks**: `tasks/README.md` - 구현 현황

## 핵심 기능

- **Document-First Editor**: Notion 스타일 TipTap 에디터 (Source/Target)
- **AI Chat**: LangChain.js 기반 멀티 탭 채팅, 플로팅 패널 + 고정(Pin) 기능
- **Multi-Provider AI**: OpenAI/Anthropic 동시 사용, 모델별 자동 프로바이더 선택
- **문서 전체 번역**: Preview → Apply 워크플로우 (채팅에서도 전체 문서 번역/검수 가능)
- **번역 검수**: 오역/누락/일관성 검출 + 에디터 하이라이트 + 수정 제안 적용
- **검색/치환**: 에디터 내 검색 (Cmd+F) 및 치환 (Cmd+H, Target 전용)
- **외부 연동**: Confluence (MCP), Notion, 웹검색

## 기술 스택

| 영역 | 기술 |
|------|------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS |
| Editor | TipTap (ProseMirror) |
| State | Zustand |
| AI | LangChain.js (OpenAI, Anthropic) |
| Backend | Tauri 2 + Rust |
| Storage | SQLite (.ite 파일) |

## 시작하기

```bash
npm install
npm run tauri:dev    # 개발 서버
npm run tauri:build  # 프로덕션 빌드
```

## 테스트

```bash
npm test              # Watch mode
npm run test:run      # Single run
npm run test:coverage # Coverage report
```

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

배포용 문서 복사: `/release-docs` (Claude Code 스킬)

## 프로젝트 구조

```
├── src/                  # Frontend (React)
│   ├── ai/               # AI/LangChain 로직
│   ├── components/       # UI 컴포넌트
│   ├── editor/           # TipTap 에디터
│   ├── stores/           # Zustand 스토어
│   └── tauri/            # Tauri IPC 래퍼
├── src-tauri/            # Backend (Rust)
│   ├── src/commands/     # Tauri 명령
│   ├── src/mcp/          # MCP 클라이언트
│   ├── src/notion/       # Notion API
│   └── src/secrets/      # Secret Manager
├── docs/                 # 문서
├── release/              # 배포용 문서 (README, CHANGELOG)
├── tasks/                # 구현 태스크
├── prd.md                # 제품 요구사항
└── docs/trd/             # 기술 요구사항 (분리된 TRD)
```

## 보안

- API Key는 OS 키체인에 마스터키 저장, 시크릿은 암호화된 Vault에 저장
- `.ite` export 파일에 시크릿 포함되지 않음

## 문서 네비게이션

→ `docs/INDEX.md` 참조
