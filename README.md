# Integrated Translation Editor (ITE)

> "AI를 동료로, 번역을 예술로."

**Integrated Translation Editor (ITE)** 는 전문 번역가를 위한 “Cursor AI 방식의 번역 워크스테이션”을 목표로 합니다.  
이 레포의 최상위 제품/기술 기준은 **`prd.md` + `trd.md`** 입니다.

---

## ✅ 문서 기준(Source of Truth)
- **PRD**: `prd.md` (제품 비전/UX 원칙/성공지표)
- **TRD**: `trd.md` (아키텍처/에디터/AI 인터랙션/저장/특화 기능)

README를 포함한 다른 문서/구현과 내용이 충돌할 경우, 원칙적으로 **PRD/TRD를 기준으로 정리**합니다.

---

## 🚀 핵심 사용자 경험(PRD 요약)
- **Document-First 번역 에디터**: Notion 스타일의 리치 텍스트 편집 환경
- **3-패널 레이아웃**: Source(참조/편집) / Target(편집) / AI Chat
- **Focus Mode**: Source 패널을 숨기고 번역/대화에 집중
- **문서 전체 번역(Preview→Apply)**: Source 전체를 번역하여 Preview로 확인 후 Apply로 Target 전체 덮어쓰기
- **Selection → Chat**: 선택 텍스트를 채팅 입력창에 추가하는 보조 UX
- **Keyboard-First**: 단축키로 대부분의 핵심 액션 수행

---

## 🛠 목표 기술 스택(TRD 요약)
### Frontend
- **React + TypeScript**
- **Editor**: TipTap (ProseMirror 기반, Source/Target 2개 인스턴스)
- **State**: Zustand (필요 시 Immer)
- **AI**: LangChain.js (OpenAI, Anthropic)

### Backend
- **Tauri + Rust**
- **Storage**: SQLite (rusqlite) 기반 단일 `.ite` 프로젝트 파일

---

## ✅ 현재 구현 현황(요약)
아래는 **PRD/TRD 대비 "현재 코드베이스"의 구현 상태**입니다.

### Editor (TipTap 기반)
- **TipTap 에디터**: Source/Target 모두 편집 가능 ✅
- **지원 포맷**: 헤딩(H1-H6), 불릿/번호 리스트, 볼드, 이탤릭, 취소선, 인용 블록, 링크 ✅
- **Notion 스타일**: Pretendard 폰트, 행간 1.8, 16px, max-width 800px ✅
- **TipTap JSON 저장**: SQLite `documents` 테이블에 JSON 형식으로 저장 ✅

### UI / UX
- **3-패널 레이아웃**: Source(편집 가능) / Target(편집) / Chat ✅
- **Focus Mode**: Source 패널 숨김 토글 ✅
- **선택 시 'Add to chat'**: 
  - Source/Target TipTap에서 텍스트 선택 시 버튼 표시 ✅
  - 동작: **채팅 입력창에 붙여넣기만**(자동 전송 X) ✅

### 문서 전체 번역 (Preview → Apply)
- **Translate 버튼**: Source 전체를 번역하여 Preview 모달 표시 ✅
- **Preview 모달**: 번역 결과를 읽기 전용 TipTap으로 미리보기 ✅
- **Apply**: Preview 확인 후 Target 문서 전체 덮어쓰기 ✅
- **JSON 출력 강제**: TipTap JSON 형식으로 서식 보존 ✅

### AI Chat 시스템
- **멀티 탭 채팅**: 여러 채팅 세션 생성/전환/삭제 ✅
- **Settings 화면**: 시스템 프롬프트, 번역 규칙, Active Memory, 용어집 관리 ✅
- **메시지 수정/삭제**: 메시지 수정 시 이후 대화 truncate ✅
- **Markdown 렌더링**: 채팅 메시지 GFM 지원 (HTML 렌더링 금지) ✅
- **Add to Rules/Memory**: assistant 응답을 규칙/메모리에 추가 ✅
- **Smart Context Memory**: 대화 토큰 모니터링 및 요약 제안 ✅
- **LangChain.js**: OpenAI, Anthropic 모델 지원 ✅

### 용어집 (Glossary)
- **CSV/Excel 임포트**: 용어집 파일 업로드 및 프로젝트 연결 ✅
- **텍스트 기반 검색**: 부분 매칭으로 관련 용어 추출 ✅

### Storage(.ite)
- **SQLite 기반 단일 파일(.ite) Import/Export** ✅
- **프로젝트 저장/로드**: TipTap JSON 저장/복원 ✅
- **채팅 세션 저장**: 프로젝트별 채팅 히스토리 영속화 ✅
- **자동 저장**: Auto-save 지원 ✅

### 제거된 기능 (참고)
- ~~Monaco Editor~~ → TipTap으로 대체
- ~~Diff Preview / Keep / Discard~~ → 사용자 직접 수정 방식으로 불필요
- ~~Ghost Chips~~ → 기능 제거
- ~~Range-based Tracking~~ → 불필요

---

## 📁 프로젝트 구조(요약)
```
english-playground/
├── src/                          # Frontend (React)
│   ├── components/               # UI 컴포넌트
│   │   ├── editor/               # 에디터 관련 UI
│   │   ├── layout/               # 레이아웃/툴바
│   │   └── panels/               # Source/Target/Chat 패널
│   ├── editor/                   # 에디터 엔진/확장/어댑터(TipTap 기반)
│   ├── ai/                       # 프롬프트/클라이언트/대화 로직
│   ├── stores/                   # Zustand 스토어
│   ├── tauri/                    # 프론트↔타우리 invoke 래퍼
│   ├── types/                    # 타입 정의
│   └── utils/                    # 유틸리티 함수
├── src-tauri/                    # Backend (Rust)
│   ├── src/
│   │   ├── commands/             # Tauri commands
│   │   ├── db/                   # SQLite 레이어
│   │   └── ...
│   ├── Cargo.toml
│   └── tauri.conf.json
└── prd.md / trd.md               # 최상위 기준 문서
```

---

## 🚀 시작하기
### 사전 요구사항
- Node.js 18+
- Rust (stable)

### 설치 / 실행
```bash
npm install
npm run tauri dev
```

### 빌드
```bash
npm run tauri build
```

---

## 🔐 환경 변수(AI)
AI 환경 변수 설정은 `ENV.md` 를 참고하세요.

