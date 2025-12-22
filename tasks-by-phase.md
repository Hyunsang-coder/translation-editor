📑 Integrated Translation Editor (ITE) Implementation Tasks

> **아키텍처 변경 (2024-12)**: Monaco → TipTap, Diff/Pending Edit 제거, LangChain.js Tools 기반으로 전환

---

## 🚀 Phase 1: 기반 구축 및 TipTap 에디터 설정

**목표**: Tauri 환경 세팅 및 TipTap 에디터를 Notion 스타일로 구성하여 3패널 레이아웃 완성.

### 1.1 프로젝트 초기화 및 환경 설정

[x] Tauri + React + TypeScript + Vite 프로젝트 생성

[x] 필수 라이브러리 설치: zustand, tailwindcss, langchain

[ ] TipTap 관련 패키지 설치: @tiptap/react, @tiptap/starter-kit, @tiptap/extension-*

[x] 전역 테마 및 Pretendard 폰트 설정

### 1.2 TipTap 에디터 "Document Mode" 구현

[ ] TipTap 기본 에디터 컴포넌트 생성

[ ] Source(ReadOnly) / Target(Editable) TipTap 에디터 구현

[ ] 지원 포맷 Extension 설정:
  - StarterKit (기본)
  - Heading (H1-H6)
  - BulletList / OrderedList
  - Bold, Italic, Strike
  - Blockquote
  - Link
  - Placeholder

[ ] Notion 스타일 CSS 적용 (Pretendard, lineHeight 1.8, 16px)

### 1.3 3패널 레이아웃 및 Focus Mode

[x] 좌(Source) / 중(Target) / 우(AI Chat) 3패널 레이아웃 구현

[x] 원문 패널 숨기기(Focus Mode) 토글

[ ] TipTap 에디터로 패널 컴포넌트 교체

---

## 🧠 Phase 2: AI 연동 및 채팅 시스템

**목표**: LangChain.js 기반 AI 호출, 멀티 탭 채팅, 간결한 응답 프롬프트 구현.

### 2.1 LangChain.js 설정

[ ] LangChain.js 패키지 설치/업데이트: langchain, @langchain/openai, @langchain/anthropic

[ ] API Key 환경변수 기반 구성 (VITE_OPENAI_API_KEY, VITE_ANTHROPIC_API_KEY)

[ ] 기본 ChatModel 인스턴스 생성 유틸

### 2.2 프롬프트 전략 구현

[ ] 번역 요청 프롬프트 템플릿 (번역문만 출력)

[ ] 질문 요청 프롬프트 템플릿 (간결한 설명)

[ ] 프로젝트 메타 자동 주입 (sourceLanguage, targetLanguage, domain)

### 2.3 Context Collection (맥락 수집)

[ ] TipTap에서 선택 텍스트 추출

[ ] Source/Target 문서 전체 텍스트 추출 (TipTap JSON → Plain Text)

[ ] Add to Chat: 선택 텍스트를 채팅 입력창에 추가하는 UX

### 2.4 AI Chat 패널

[x] 기본 채팅 UI (메시지 리스트 + 입력창)

[ ] 멀티 탭 채팅 (Thread Tabs) 구현
  - 탭 생성/전환/삭제
  - 각 탭 독립적인 메시지 히스토리

[ ] Settings 화면 (채팅 화면과 교체 방식)
  - 시스템 프롬프트 오버레이
  - 번역 규칙
  - Active Memory
  - 첨부 파일 관리

[ ] 메시지 수정 (Edit Message)
  - 사용자 메시지 수정 시 이하 메시지 삭제
  - 수정 이력 보관 (editedAt, originalContent)

### 2.5 스트리밍 응답

[ ] LangChain.js 스트리밍 응답 처리

[ ] 채팅 UI 실시간 업데이트

---

## 💾 Phase 3: 데이터 관리 및 .ite 파일 시스템

**목표**: SQLite 기반 프로젝트 저장, TipTap JSON 저장/복원.

### 3.1 Rust 백엔드 데이터 레이어

[x] rusqlite 연동 및 기본 테이블 스키마

[ ] TipTap JSON 저장을 위한 documents 테이블 스키마 수정
```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'source' | 'target'
  content TEXT NOT NULL, -- TipTap JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

[x] create/load/save 프로젝트 Tauri Command

### 3.2 프로젝트 세이브/로드 시스템

[x] SQLite DB를 단일 `.ite` 파일로 패킹/언패킹

[x] 최근 프로젝트 목록 + 자동 저장(Auto-save)

[x] Import/Export 기능

[ ] TipTap JSON ↔ DB 저장/복원 테스트

### 3.3 채팅 세션 저장

[x] 프로젝트별 채팅 세션 저장/복원

[ ] 멀티 탭 채팅 세션 저장 구조 확장

[ ] Settings (시스템 프롬프트, 번역 규칙 등) DB 저장

---

## 🛡️ Phase 4: 전문 기능 (용어집 & Context Memory)

**목표**: 용어집 검색, Smart Context Memory 구현.

### 4.1 용어집 (Glossary) - 비벡터 방식

[x] CSV/Excel 용어집 임포트 (Tauri command)

[x] 텍스트 기반 검색 (부분 매칭)

[ ] 모델 호출 시 관련 용어 자동 주입

[ ] 주입된 용어 리스트 UI 표시 (디버깅용)

### 4.2 Smart Context Summarizer

[~] 대화 토큰 임계치 모니터링

[~] "Memory에 추가할까요?" 제안 UX (Confirm-to-Add)

[x] Active Memory 요약을 모델 호출 payload에 주입

### 4.3 첨부 파일 (Reference Attachments)

[ ] 지원 파일 확장: csv, xlsx, pdf, pptx, png/jpg, md, docx

[ ] 프로젝트별 첨부 파일 관리

[ ] 모델 호출 시 파일 첨부 또는 텍스트 추출 폴백

---

## 🤖 Phase 5: LangChain.js Tools 시스템

**목표**: 검수, 오탈자, 일관성 체크 등을 Tool로 정의하고 호출.

### 5.1 Tool 프레임워크 구축

[ ] Tool 인터페이스/스키마 정의 (Zod)

[ ] 기본 Tool 구조 생성

### 5.2 checkSpelling Tool

[ ] 오탈자 검사 프롬프트/로직

[ ] 결과 JSON 스키마 정의

[ ] UI 리포트 렌더링

### 5.3 checkConsistency Tool

[ ] 용어 일관성 검사 프롬프트/로직

[ ] 용어집 연동

[ ] 결과 JSON 스키마 정의

### 5.4 reviewQuality Tool

[ ] 번역 품질 검수 프롬프트/로직

[ ] 점수 + 피드백 형식 출력

### 5.5 Tool 호출 UI

[ ] 버튼/메뉴/단축키로 Tool 트리거

[ ] 검수 결과 리스트 렌더링

[ ] 항목 클릭 시 해당 위치로 점프

---

## 🔮 Phase 6: MCP 연동 및 확장 기능 (추후)

**목표**: MCP 프로토콜 연동, 웹검색 등 외부 도구 통합.

### 6.1 MCP 연동 기반 구축

[ ] MCP 클라이언트 설정

[ ] 웹검색 도구 연동

[ ] 외부 사전 API 연동

### 6.2 전체 덮어쓰기 기능

[ ] AI 번역문으로 Target 전체 교체 기능

[ ] 확인 다이얼로그 + 실행 취소(Undo) 지원

### 6.3 고급 기능

[ ] 타임라인 기반 수정 이력 UI (Smart History)

[ ] 다크 모드/라이트 모드 지원

[ ] 단축키 커스텀 설정

---

## 🗑️ 제거된 기능 (참고용)

다음 기능들은 제품 방향성 변경으로 제거되었습니다:

- ~~Monaco Editor~~ → TipTap으로 대체
- ~~Range-based Tracking~~ → 불필요
- ~~Diff Preview / Keep / Discard~~ → 사용자 직접 수정
- ~~Pending Edit / EditSession~~ → 제거
- ~~Ghost Chips (태그 보호)~~ → 제거
- ~~diff-match-patch~~ → 불필요
- ~~LangGraph Agent 루프~~ → 단순 Tool 호출로 대체 (1차)
