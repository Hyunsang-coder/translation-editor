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
- **Document-First 번역 에디터**: 코딩 에디터 수준의 성능을 문서 편집 감성으로 제공
- **3-패널 레이아웃**: Source(참조) / Target(편집) / AI Chat
- **Focus Mode**: Source 패널을 숨기고 번역/대화에 집중
- **Selection → Apply → Diff → Accept/Reject**: Cursor 스타일의 인라인 수정 제안 워크플로우
- **Ghost Chips**: `{user}`, `<br>` 등 태그/변수 보호
- **Keyboard-First**: 단축키로 대부분의 핵심 액션 수행

---

## 🛠 목표 기술 스택(TRD 요약)
### Frontend
- **React + TypeScript**
- **Editor(목표)**: Monaco Editor (Source/Target 2개 인스턴스)
- **State**: Zustand (필요 시 Immer)
- **Diff**: diff-match-patch 기반 델타 계산 + 시각화

### Backend
- **Tauri + Rust**
- **Storage**: SQLite (rusqlite) 기반 단일 `.ite` 프로젝트 파일

---

## ✅ 현재 구현 현황(요약)
아래는 **PRD/TRD 대비 “현재 코드베이스”의 구현 상태**입니다. (목표와 다를 수 있음)

### UI / UX (Cursor 유사)
- **3-패널 레이아웃**: Source(참고) / Target(편집) / Chat ✅
- **Focus Mode**: Source 숨김 ✅
- **선택 시 ‘Add to chat’**:
  - Source(일반 DOM selection) ✅
  - Target(Monaco selection) ✅
  - 동작: **채팅 입력창에 붙여넣기만**(자동 전송 X) ✅
- **단축키**
  - `Cmd+L`: Target selection 기반 Apply 요청 ✅
  - `Cmd+K`: Chat 포커스 진입(1차) ✅
  - `Cmd+Y` / `Cmd+N`: Diff Accept/Reject ✅

### Editor / Apply / Diff
- **Target 에디터(현재)**: Monaco **단일 문서** ✅
- **Diff Preview(현재)**: Monaco DiffEditor 기반 모달 ✅
- **Accept/Reject(현재)**: pending diff 기준 반영/취소 ✅
- **Range tracking(현재)**: Monaco decoration(tracked range) 기반으로 target blocks 구간 추적 ✅

### Ghost Chips(태그 보호)
- **감지**: `{var}`, `<tag>`, `<br>` 패턴 감지 ✅
- **표시/보호(현재, Target Monaco)**: chip 데코레이션 + 편집 시 자동 undo + toast 경고 ✅

### Storage(.ite)
- **SQLite 기반 단일 파일(.ite) Import/Export** ✅
- **Save 시점 브릿지(현재)**: Target 단일 문서 → tracked range 기준으로 blocks에 역투영 후 저장 ✅

---

## 📁 프로젝트 구조(요약)
```
english-playground/
├── src/                          # Frontend (React)
│   ├── components/               # UI 컴포넌트
│   │   ├── editor/               # 에디터 관련 UI
│   │   ├── layout/               # 레이아웃/툴바
│   │   └── panels/               # Source/Target/Chat 패널
│   ├── editor/                   # 에디터 엔진/확장/어댑터(목표: Monaco 중심)
│   ├── ai/                       # 프롬프트/클라이언트/대화 로직
│   ├── stores/                   # Zustand 스토어
│   ├── tauri/                    # 프론트↔타우리 invoke 래퍼
│   ├── types/                    # 타입 정의
│   └── utils/                    # diff/ghost-chip 등 유틸
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

