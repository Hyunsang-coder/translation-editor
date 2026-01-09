# OddEyes.ai

> "AI를 동료로, 번역을 예술로."

**OddEyes.ai**는 전문 번역가를 위한 "Cursor AI 방식의 번역 워크스테이션"을 목표로 합니다.
이 레포의 최상위 제품/기술 기준은 **`prd.md` + `trd.md`** 입니다.

(내부 코드명: ITE / Integrated Translation Editor)

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
- **다국어 지원**: 한국어/영어 UI 전환 (App Settings에서 설정) ✅
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
- **Settings 화면**: 시스템 프롬프트, 번역 규칙, Project Context, 용어집 관리 ✅
- **메시지 수정/삭제**: 메시지 수정 시 이후 대화 truncate ✅
- **Markdown 렌더링**: 채팅 메시지 GFM 지원 (HTML 렌더링 금지) ✅
- **Add to Rules/Context**: assistant 응답을 규칙/컨텍스트에 추가 ✅
- **Smart Context Memory**: 대화 토큰 모니터링 및 요약 제안 ✅
- **실시간 토큰 스트리밍**: LangChain `.stream()` API 기반 실시간 응답 ✅
  - 첫 토큰 표시: 0.5~2초 (이전: 5~30초)
  - Claude App처럼 타이핑 효과
  - 도구 호출 중 상태 표시
- **LangChain.js**: OpenAI 모델 지원 ✅ (Anthropic은 UI에서 비활성화, 추후 활성화 예정)
- **Tool Calling**: 문서 조회(`get_source_document`, `get_target_document`), 제안(`suggest_translation_rule`, `suggest_project_context`) ✅

### MCP / 외부 커넥터
- **Atlassian MCP (Confluence/Jira)**: OAuth 2.1 PKCE 인증 ✅
  - **Rust 네이티브 SSE 클라이언트**: 외부 Node.js 의존성 없이 Rust에서 직접 연결 ✅
  - **Lazy OAuth**: 토글은 도구 활성화만 의미하며, 실제 사용 시 Connect 버튼을 통해 인증 시작 ✅
  - **토큰 자동 갱신**: 만료 시 refresh token으로 자동 갱신, 실패 시 토큰 삭제 후 재인증 ✅
  - **토큰 영속화**: 앱 재시작 시 자동 재연결 ✅
  - **동시 인증 방지**: 진행 중인 OAuth 플로우가 있으면 중복 요청 거부 ✅
- **Notion**: 페이지 및 데이터베이스 검색 지원 ✅
  - **Integration Token**: App Settings에서 Notion Integration Token 입력하여 연결 ✅
  - **토큰 영속화**: 앱 재시작 시 자동 재연결 ✅
  - **기존 토큰 재사용**: 연결 해제 후 재연결 시 기존 토큰 사용 가능 ✅
- **웹검색**: Brave Search / OpenAI Web Search 연동 완료 ✅
  - **웹검색 게이트**: 체크박스로 웹검색 사용 여부 제어 ✅

### AI Provider 및 API Key 관리
- **App Settings API Key 입력**: 사용자가 직접 API Key 입력 가능 ✅
- **보안 저장 (Secret Manager)**: Master Key + Encrypted Vault 패턴 ✅
  - Keychain에는 마스터키 1개만 저장 (앱 시작 시 1회 인증)
  - 모든 시크릿(API Key, OAuth 토큰 등)은 `secrets.vault`에 암호화 저장
  - XChaCha20-Poly1305 AEAD 암호화
  - `.ite` export에 시크릿 포함되지 않음
- **우선순위**: 사용자 입력 키(Vault)만 사용 ✅ (환경 변수 폴백 없음)
- **레거시 마이그레이션**: Settings에서 기존 Keychain 항목을 Vault로 마이그레이션 ✅

### 용어집 (Glossary)
- **CSV/Excel 임포트**: 용어집 파일 업로드 및 프로젝트 연결 ✅
- **텍스트 기반 검색**: 부분 매칭으로 관련 용어 추출 ✅

### Storage(.ite)
- **SQLite 기반 단일 파일(.ite) Import/Export** ✅
- **프로젝트 저장/로드**: TipTap JSON 저장/복원 ✅
- **채팅 세션 저장**: 프로젝트별 채팅 히스토리 영속화 ✅
- **자동 저장**: Auto-save 지원 ✅

- ~~Monaco Editor~~ → TipTap으로 대체
- ~~Diff Preview / Keep / Discard~~ → 사용자 직접 수정 방식으로 불필요
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
│   ├── i18n/                     # 다국어 지원 (i18next)
│   │   ├── config.ts             # i18next 설정
│   │   └── locales/              # 번역 파일
│   │       ├── ko.json           # 한국어
│   │       └── en.json           # 영어
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

## 📡 AI API 호출 Payload 구조

OddEyes.ai는 **LangChain.js**를 사용하여 AI 모델(OpenAI/Anthropic)에 요청을 전달합니다.  
실제 API 호출은 LangChain이 내부적으로 처리하지만, 전달되는 메시지 구조는 다음과 같습니다.

### 요청 유형별 메시지 구조

#### 1. 문서 전체 번역 (Translate)

```typescript
// translateDocument.ts → translateSourceDocToTargetDocJson()
BaseMessage[] = [
  SystemMessage({ 
    content: `
      당신은 경험많은 전문 번역가입니다.
      아래에 제공되는 TipTap/ProseMirror 문서 JSON의 텍스트를 Source에서 Target으로 자연스럽게 번역하세요.
      
      중요: 출력은 반드시 "단 하나의 JSON 객체"만 반환하세요.
      - 마크다운, 코드펜스(```), 설명, 인사, 부연, HTML을 절대 출력하지 마세요.
      - 출력 JSON은 다음 형태 중 하나여야 합니다:
        - 성공: {"doc": {"type":"doc","content":[...]} }
        - 실패: {"error": "사유", "doc": null }
      
      [번역 규칙]
      ${translationRules}
      
      [Project Context]
      ${projectContext}
    `
  }),
  HumanMessage({ 
    content: `
      다음 JSON 문서를 번역하여, 위에서 지정한 형태의 JSON 객체로만 반환하세요.
      
      ${JSON.stringify(sourceDocJson)}
    `
  })
]
```

**특징**:
- 채팅 히스토리 포함하지 않음
- TipTap JSON을 문자열로 전달
- 출력은 TipTap JSON만 강제
- Translation Rules: 포맷, 서식, 문체 등 번역 규칙
- Project Context: 번역 시 참고할 맥락 정보(배경 지식, 프로젝트 컨텍스트 등)

#### 2. 채팅/질문 (Question)

```typescript
// chat.ts → buildLangChainMessages() + ChatPromptTemplate
BaseMessage[] = [
  SystemMessage({ content: systemPrompt }),      // 요청 유형별 시스템 프롬프트
  SystemMessage({ content: systemContext }),     // 컨텍스트 (규칙/컨텍스트/글로서리/문서/블록)
  SystemMessage({ content: toolGuide }),         // Tool 사용 가이드
  ...historyMessages,                            // (question 모드에서만) 최근 채팅 메시지 (최대 10개)
  HumanMessage({ content: userMessage }),        // 사용자 입력
]
```

**특징**:
- ChatPromptTemplate으로 구성
- Tool Calling 지원 (문서 조회, 규칙/메모리 제안)
- 초기 payload에 Source/Target 문서를 포함하지 않음 (on-demand tool 호출)
- question 모드에서만 히스토리 포함

### 실제 API Payload 형식

LangChain이 내부적으로 OpenAI/Anthropic API 형식으로 변환합니다:

#### OpenAI API 형식 (채팅 모드 예시)

```json
{
  "model": "gpt-5.2",
  "messages": [
    {
      "role": "system",
      "content": "당신은 경험많은 전문 번역가입니다.\n\n프로젝트: general\n언어: Source → Target\n\n핵심 원칙:\n- 번역사가 주도권을 가지고, AI는 요청 시에만 응답합니다.\n..."
    },
    {
      "role": "system",
      "content": "[번역 규칙]\n해요체 사용\n\n[Project Context]\n이 프로젝트는 게임 UI 번역이며, 캐릭터 대사는 캐주얼한 톤을 유지한다.\n\n[컨텍스트 블록]\n- [paragraph] Example text"
    },
    {
      "role": "system",
      "content": "문서/문맥 접근 도구:\n- get_source_document: 원문(Source) 문서를 가져옵니다.\n- get_target_document: 번역문(Target) 문서를 가져옵니다.\n\n제안 도구 (번역 규칙/컨텍스트):\n- suggest_translation_rule: 새로운 번역 규칙을 발견하면 즉시 사용하세요.\n- suggest_project_context: Project Context에 추가할 맥락 정보를 발견하면 즉시 사용하세요."
    },
    {
      "role": "user",
      "content": "이 문장이 자연스러운가요?"
    },
    {
      "role": "assistant",
      "content": "네, 자연스럽습니다."
    },
    {
      "role": "user",
      "content": "번역 규칙을 확인해주세요"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_source_document",
        "description": "원문(Source) 문서를 가져옵니다."
      }
    },
    {
      "type": "function",
      "function": {
        "name": "get_target_document",
        "description": "번역문(Target) 문서를 가져옵니다."
      }
    },
    {
      "type": "function",
      "function": {
        "name": "suggest_translation_rule",
        "description": "새로운 번역 규칙을 제안합니다."
      }
    },
    {
      "type": "function",
      "function": {
        "name": "suggest_project_context",
        "description": "Project Context를 제안합니다."
      }
    }
  ]
}
```

**참고**: 번역 모드에서는 히스토리 메시지가 없고, Tool Guide도 없습니다.

#### Anthropic API 형식 (채팅 모드 예시)

```json
{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 4096,
  "system": "당신은 경험많은 전문 번역가입니다.\n\n프로젝트: general\n언어: Source → Target\n\n핵심 원칙:\n- 번역사가 주도권을 가지고, AI는 요청 시에만 응답합니다.\n...\n\n[번역 규칙]\n해요체 사용\n\n[Project Context]\n이 프로젝트는 게임 UI 번역이며, 캐릭터 대사는 캐주얼한 톤을 유지한다.\n\n[컨텍스트 블록]\n- [paragraph] Example text\n\n문서/문맥 접근 도구:\n- get_source_document: 원문(Source) 문서를 가져옵니다.\n- get_target_document: 번역문(Target) 문서를 가져옵니다.\n\n제안 도구 (번역 규칙/컨텍스트):\n- suggest_translation_rule: 새로운 번역 규칙을 발견하면 즉시 사용하세요.\n- suggest_project_context: Project Context에 추가할 맥락 정보를 발견하면 즉시 사용하세요.",
  "messages": [
    {
      "role": "user",
      "content": "이 문장이 자연스러운가요?"
    },
    {
      "role": "assistant",
      "content": "네, 자연스럽습니다."
    },
    {
      "role": "user",
      "content": "번역 규칙을 확인해주세요"
    }
  ],
  "tools": [
    {
      "name": "get_source_document",
      "description": "원문(Source) 문서를 가져옵니다."
    },
    {
      "name": "get_target_document",
      "description": "번역문(Target) 문서를 가져옵니다."
    },
    {
      "name": "suggest_translation_rule",
      "description": "새로운 번역 규칙을 제안합니다."
    },
    {
      "name": "suggest_project_context",
      "description": "Project Context를 제안합니다."
    }
  ]
}
```

**참고**: Anthropic은 system 메시지를 하나로 합쳐서 전달합니다.

### Payload 구성 요소

#### 1. System Prompt (요청 유형별)

- **translate 모드**: 번역 전용 프롬프트 (설명 없이 번역문만 출력)
- **question 모드**: 질문/검수 프롬프트 (번역 생성 금지, 검수/리뷰만 허용)
- **general 모드**: 기본 프롬프트

각 모드는 다음 정보를 포함:
- Translator Persona (사용자 설정 또는 기본값)
- 프로젝트 메타데이터 (domain, sourceLanguage, targetLanguage)

#### 2. System Context (조건부 포함)

다음 항목이 비어있지 않으면 포함됩니다 (우선순위 순):

1. **Translation Rules** (`[번역 규칙]`)
   - 포맷, 서식, 문체 등 번역에 적용되는 규칙
   - 예: "해요체 사용", "따옴표 유지", "고유명사는 음차"
   - 사용자가 Settings에서 입력한 고정 번역 규칙 (최대 10,000자)

2. **Project Context** (`[Project Context]`)
   - 번역 시 참고할만한 추가 맥락 정보(배경 지식, 프로젝트 컨텍스트 등)
   - 대화 중 발견된 일시적 맥락 정보 요약 (최대 30,000자)

3. **Glossary** (`[글로서리(주입)]`)
   - 채팅 전송 시 자동 검색된 관련 용어 (최대 30,000자)

4. **Source Document** (`[원문]`)
   - Source 패널의 전체 텍스트 (최대 100,000자, HTML 제거)
   - **채팅 모드에서는 초기 payload에 포함하지 않음** (on-demand tool 호출)

5. **Target Document** (`[번역문]`)
   - Target 패널의 전체 텍스트 (최대 100,000자, HTML 제거)
   - **채팅 모드에서는 초기 payload에 포함하지 않음** (on-demand tool 호출)

6. **Context Blocks** (`[컨텍스트 블록]`)
   - 사용자가 선택한 에디터 블록들 (타입별로 표시)
   - 최대 20개 블록, 블록당 최대 500자

7. **첨부 파일** (`[첨부 파일]`)
   - 프로젝트에 첨부된 참고 문서들
   - 파일별 최대 30,000자, 전체 최대 50,000자

**참고**: 번역 모드에서는 Source Document가 UserMessage에 TipTap JSON으로 포함됩니다.

#### 3. Tool Guide (채팅 모드에서만 포함)

- 문서 조회 도구 사용 가이드
- 제안 도구(번역 규칙/Project Context) 사용 가이드
- 번역 모드에서는 포함하지 않음

#### 4. History Messages (조건부 포함)

- **question 모드**: 최근 채팅 메시지 최대 10개 포함 (MessagesPlaceholder로 삽입)
- **translate 모드**: 채팅 히스토리 포함하지 않음 (Settings의 페르소나/룰/메모리/글로서리/문서 컨텍스트만 사용)
- **general 모드**: 히스토리 포함하지 않음

#### 5. User Message

- 사용자가 입력한 메시지 (채팅 입력창 또는 선택 텍스트)
- 번역 모드: TipTap JSON 문서를 문자열로 전달
- 채팅 모드: 사용자 입력 텍스트

### 요청 유형별 Payload 차이

| 요청 유형 | System Prompt | System Context | Tool Guide | History | Tool Calling | 출력 포맷 |
|---------|--------------|----------------|------------|---------|--------------|----------|
| **translate** | 번역 전용 프롬프트 | 번역 규칙/Project Context | 없음 | 없음 | 없음 | TipTap JSON만 (설명 금지) |
| **question** | 질문/검수 프롬프트 | 번역 규칙/Project Context/글로서리/컨텍스트 블록 | 있음 | 최근 10개 | 지원 | 간결한 답변 또는 JSON 리포트 |
| **general** | 기본 프롬프트 | 번역 규칙/Project Context/글로서리/컨텍스트 블록 | 있음 | 없음 | 지원 | 일반 응답 |

### 구현 위치

- **메시지 구성 (채팅)**: `src/ai/prompt.ts` → `buildLangChainMessages()` (ChatPromptTemplate 사용)
- **메시지 구성 (번역)**: `src/ai/translateDocument.ts` → `translateSourceDocToTargetDocJson()` (직접 배열 구성)
- **API 호출 (채팅)**: `src/ai/chat.ts` → `streamAssistantReply()` / `generateAssistantReply()` (Tool calling 지원)
- **API 호출 (번역)**: `src/ai/translateDocument.ts` → `translateSourceDocToTargetDocJson()` (단순 invoke)
- **클라이언트**: `src/ai/client.ts` → `createChatModel()` (LangChain ChatOpenAI/ChatAnthropic)

---

## 🔐 보안 저장소 (Secret Manager)

### 아키텍처
- **Master Key**: OS Keychain에 1개만 저장 (`ite:master_key_v1`)
- **Encrypted Vault**: `app_data_dir/secrets.vault` 파일에 XChaCha20-Poly1305 AEAD로 암호화 저장
- **앱 시작 시**: Keychain에서 마스터키 1회 로드 → Vault 복호화 → 메모리 캐시

### 저장되는 시크릿
- `ai/api_keys_bundle`: OpenAI, Anthropic, Brave 등 API 키 번들
- `mcp/atlassian/oauth_token_json`: Atlassian OAuth 토큰
- `notion/integration_token`: Notion Integration Token
- `connector/<id>/token_json`: 기타 커넥터 토큰

### 보안 원칙
- API Key는 Vault에만 저장 (환경 변수/localStorage 사용 안 함)
- `.ite` export 파일에 시크릿 포함되지 않음
- App Settings에서 Clear 버튼으로 저장된 키 삭제 가능
- Settings → Security에서 기존 Keychain 항목을 Vault로 마이그레이션 가능

