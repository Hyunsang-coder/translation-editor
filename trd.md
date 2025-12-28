🛠 [TRD] Integrated Translation Editor (ITE) Technical Specifications

이 문서는 ITE의 **기술 설계도(Source of Truth)**입니다. 구현/문서가 충돌하면 본 문서를 기준으로 정리합니다.

표기 규칙:
- **Why**: 왜 필요한가(의도/리스크)
- **How**: 어떻게 구현할까(접근/전략)
- **What**: 정확히 무엇을 만든다(명세/규칙)
1. 아키텍처 개요 (System Architecture)
1.1 기반 기술 (The TipTap Document-First Approach)
Why:
- 전문 번역가는 대용량 텍스트를 다루며, 실시간 AI 응답을 검토/수락/거절하는 고부하 작업을 수행합니다.
- 가볍고 네이티브 접근이 가능한 Tauri + Rust, 문서 편집에 적합한 TipTap(ProseMirror) 조합이 유리합니다.

How:
- Backend (Rust): 파일 시스템 제어, SQLite DB 관리, 외부 도구(Sidecar) 실행
- Frontend (React + TS): UI 렌더링, TipTap 인스턴스 관리, 상태 관리(Zustand)

What:
- SQLite 기반 단일 `.ite` 프로젝트 파일을 지원하는 네이티브 데스크톱 애플리케이션

2. 에디터 엔진 설계 (Editor Engine: TipTap)
2.1 Target/Source Pane 커스터마이징 (Document Mode)
Why:
- 번역가는 코드가 아닌 문서를 다루므로, Notion 스타일의 문서 편집 경험이 필요합니다.

How:
- TipTap 두 인스턴스(Source, Target)를 사용하며, 공통 스타일을 적용합니다.
- Source/Target 모두 편집 가능 상태로 두되, Focus Mode에서 Source를 숨길 수 있습니다.

What (권장 옵션):
- 폰트/스타일: Pretendard, 16px, line-height 1.8, max-width 800px, padding 24px
- 지원 포맷: Heading(H1-H6), Bullet/Ordered List, Bold, Italic, Strike, Blockquote, Link, Placeholder, (선택) Code Block

3. AI 상호작용 및 Preview 워크플로우
3.1 문서 전체 번역 (Preview → Apply)
Why:
- HTML/서식 손상 없이 번역문을 적용하려면 TipTap JSON 단위로 Preview 후 사용자가 명시적으로 Apply 해야 합니다.

How:
- Translate 버튼/단축키로 Source 전체를 TipTap JSON으로 모델에 전달하고, 출력도 TipTap JSON으로 강제합니다.
- Preview 모달에서 원문-번역 Diff를 보여주고, Apply 시 Target을 전체 덮어쓰기 합니다.
- 문서 전체 번역(Translate)은 채팅 히스토리를 컨텍스트에 포함하지 않습니다. (Settings의 페르소나/번역 규칙/Project Context/글로서리/문서 컨텍스트만 사용)

What:
- Trigger: Translate(Preview) 버튼/단축키
- Input: sourceDocJson(TipTap JSON), project meta(sourceLanguage/targetLanguage/domain), translationRules, projectContext, translatorPersona, glossary/attachments(있는 경우)
- Output: TipTap JSON (문서 전체), JSON 파싱 실패 시 폴백 로직
- UX: Preview 모달(Preview/Diff), Apply 시 전체 덮어쓰기. 자동 적용 없음.
- API 구조: LangChain `BaseMessage[]` 배열
  - SystemMessage 1개: 번역 전용 프롬프트 (페르소나, 번역 규칙, Project Context 포함)
  - UserMessage 1개: TipTap JSON 문서를 문자열로 전달
  - 히스토리 메시지 없음

3.2 Context Collection 명세 (Payload 규칙)
Why:
- 번역/질문 시 원문 컨텍스트와 규칙을 일관되게 전달해야 품질을 유지할 수 있습니다.

How:
- UI 트리거 시 프로젝트/문서 상태에서 컨텍스트를 조립해 모델 payload에 포함합니다.
  - 단, 토큰 최적화를 위해 Question(채팅) 모드에서는 “초기 호출”에 문서 전체를 항상 포함하지 않을 수 있으며,
    필요 시 Agent/Tool(문서 조회 도구)로 on-demand로 불러옵니다.

What (의도/행동 정의):
- Add to chat: 채팅 입력창에 텍스트 추가(모델 호출 없음)
- Translate 요청: 문서 전체 번역(Preview → Apply)
- Question 요청: 질의/검수(모델 호출), 문서 자동 적용 없음

What (Payload 구성 규칙: 우선순위):
- 반드시 포함: 프로젝트 메타(sourceLanguage/targetLanguage/domain), Translation Rules(번역 규칙), Project Context(맥락 정보)
- 가능하면 포함(권장): 선택 텍스트(가능하면) + 주변 문맥(before/after) + 선택이 없으면 필요한 범위의 문서(부분/전체)
- Question(채팅) 모드: 문서(Source/Target)는 "항상" 초기 payload에 포함하지 않아도 되며, 아래 원칙을 따른다.
  - 목표: 불필요한 토큰 소비를 줄이고, 문맥이 필요한 질문에만 문서를 제공한다.
  - 방법: 모델이 필요하다고 판단하면 문서 조회 Tool을 호출하여 원문/번역문을 on-demand로 가져온다.
  - 보호(단순화): 현재는 Source/Target 접근 토글을 제공하지 않으며, 문서 조회는 on-demand Tool 호출로만 수행한다.
- 조건부 포함: Glossary/첨부, before/after 문맥
- 질문(Question) 모드에서만 포함: 최근 메시지(최대 10개)
- 출력 포맷 강제:
  - Translate: TipTap JSON 전체만 출력(설명 금지)
  - Question/검수: 간결한 답변 또는 JSON 리포트(필요 시)

What (API 구조 - 채팅 모드):
- LangChain `BaseMessage[]` 배열 사용
- ChatPromptTemplate으로 메시지 구성:
  - SystemMessage 1개: 요청 유형별 시스템 프롬프트 (translate/question/general)
  - SystemMessage 1개 (조건부): SystemContext (번역 규칙/Project Context/글로서리/문서/컨텍스트 블록)
  - SystemMessage 1개: Tool Guide (문서 조회 도구 및 제안 도구 사용 가이드)
  - MessagesPlaceholder: 히스토리 메시지 (question 모드에서만 최근 10개)
  - HumanMessage 1개: 사용자 입력
- Tool Calling 지원:
  - get_source_document: 원문 문서 on-demand 조회
  - get_target_document: 번역문 문서 on-demand 조회
  - suggest_translation_rule: 번역 규칙 제안
  - suggest_project_context: Project Context 제안

3.3 Selection/Context 매핑 (TipTap 기반)
Why:
- 선택/문서 컨텍스트를 안정적으로 주입해 일관된 응답을 받기 위함입니다.

How:
- TipTap 문서에서 선택 텍스트를 추출(Cmd+L)하고, Source/Target 전체 텍스트를 필요 시 포함합니다.

What (fallback 규칙):
- 선택 추출이 실패해도 최소한 Source/Target 전체 또는 번역 규칙/Project Context는 포함합니다.

3.4 편집 적용 정책
What:
- 모델 응답이 문서를 자동으로 변경하지 않습니다.
- 문서 전체 번역은 Preview 후 사용자가 Apply할 때만 Target에 반영됩니다.
- Diff/Keep/Discard, Pending Edit 세션, diff-match-patch 기반 워크플로우는 사용하지 않습니다.

3.5 워크플로우(사용자 여정) 기반 기술 요구사항 (user-journey.md 반영)
Why:
- 실제 사용 흐름(붙여넣기 → 참조 투입 → 번역 요청 → 비교/수정 → 질의 세션 분리 → 적용 결정)을 그대로 지원해야 제품이 “Cursor AI 방식의 번역 경험”이 됩니다.

What:
- 원문 붙여넣기
  - SourceDocument는 참조 전용이며, 프로젝트에 저장되고 항상 AI 컨텍스트로 주입 가능해야 함
- 설정(Settings)/참조 문서(글로서리 등)
  - AI 채팅 패널에는 “Settings” 화면이 존재하며, 여기에서 사용자 편집 가능한 설정을 관리한다.
  - Settings 항목(최소): 시스템 프롬프트 오버레이(System Prompt Overlay), 번역 규칙(Translation Rules), Project Context, 첨부 파일(참조문서/글로서리)
  - 시스템 프롬프트 오버레이는 모델 호출 시 system 메시지에 반영된다.
  - 번역 규칙(Translation Rules): 포맷, 서식, 문체 등 번역에 적용되는 규칙 (예: "해요체 사용", "따옴표 유지", "고유명사는 음차")
  - Project Context: 번역 시 참고할만한 추가 맥락 정보(배경 지식, 프로젝트 컨텍스트 등)
  - 글로서리 주입은 비벡터(임베딩/벡터화 없음)로 한다.
- 멀티 채팅 세션
  - “번역 작업 세션”과 “개념 질의 세션”을 분리할 수 있어야 함
  - 세션별로 Project Context(요약)와 첨부 컨텍스트 상태(선택/블록/참조문서 범위)를 관리
- 선택 → 재수정
  - Add to chat은 “텍스트 추가” UX로 유지
  - Edit 요청은 반드시 원문/번역 자동 주입이 보장되어야 함(3.2~3.3)
- 적용 결정(반영/미반영)
  - 모든 편집 제안은 항상 Diff Preview를 거치며, Keep/Discard의 결과가 저장/히스토리와 정합해야 함
- 저장/재개
  - `.ite` 프로젝트 파일에 `blocks/segments/채팅 세션/참조 문서/요약 메모리`가 함께 저장되어 재개 시 그대로 복원되어야 함

3.6 AI Chat UX 명세 (Tabs, Settings, Message Edit)
Why:
- 번역 작업은 “문서 편집”과 “대화/검수”가 동시에 진행되므로, 채팅 UX가 일반적인 AI 앱(ChatGPT/Claude) 수준의 편집성과 멀티 스레드를 제공해야 한다.

What:
- 멀티 탭 채팅(Thread Tabs)
  - 하나의 프로젝트 내에서 AI 채팅 탭을 여러 개 생성/전환할 수 있어야 한다.
  - 탭 생성은 **최대 3개**로 제한한다.
    - UX: 탭이 3개가 되면 `+` 버튼은 **숨김** 처리한다.
    - 정책: 다른 경로(단축키/메뉴 등)로 “새 탭 생성”이 시도되더라도, 3개 초과 생성은 **조용히 무시**한다. (에러/토스트 없음)
  - 앱 재시작/프로젝트 재개 시 탭 복원 순서는 **최근 활동(각 탭의 마지막 메시지 timestamp)** 기준 내림차순이다.
  - 탭들은 동일 프로젝트의 Settings(시스템 프롬프트 오버레이/번역 규칙/Project Context/첨부 파일 등)를 공유한다.
  - 각 탭(thread)은 메시지 히스토리를 독립적으로 가진다.
- 응답 생성 상태 표시(Loading / Tool Calling)
  - AI 응답을 기다리는 동안, 일반적인 채팅 앱처럼 “typing/로딩 인디케이터”를 표시한다.
- AI가 Tool(웹검색/문서 조회/저장 제안 등)을 사용한 경우, 해당 메시지 하단에 “도구 사용됨/실행 중” 배지를 작게 표시할 수 있다. (가시성 목적, 자동 적용/자동 수정 없음)
  - 모델이 문서 조회 등 Tool을 호출하는 동안, “툴 실행 중” 상태를 표시할 수 있다. (예: `get_source_document`, `get_target_document`)
  - 상태 표시는 UX 보조용이며, 문서 자동 수정/자동 적용과 무관하다(Non-Intrusive 유지).
- 채팅 입력창(Composer)
  - 입력창 좌측 하단에 `+` 버튼을 두고, 클릭 시 드롭다운 메뉴를 연다.
    - 파일 또는 이미지 추가(프로젝트 단위 첨부)
    - 웹 검색 체크(웹검색 사용 여부)
  - 채팅 모델 선택 드롭다운은 Send 버튼(화살표) **왼쪽**에 둔다.
  - Send 버튼은 입력창 **우측 하단**에 **화살표 아이콘**으로 표시한다(문자 “Send”는 표시하지 않음).
  - 입력 내용이 있어야 Send 버튼이 활성화된다.
  - Enter=전송, Shift+Enter=줄바꿈을 기본값으로 둔다.
- 에디터 번역 버튼 주변
  - 번역 모델 선택 드롭다운은 Editor의 “번역” 버튼 **왼쪽**에 둔다.
  - 기본 모델은 `gpt-5.2`, 커스텀 모델 입력은 지원하지 않는다.
- 웹검색 게이트(중요)
  - `webSearchEnabled`가 **true일 때만** 웹검색 도구(Brave/OpenAI web search)를 사용할 수 있다.
  - `webSearchEnabled=false`인 경우:
    - 명시적 트리거(`/web`, `웹검색:`)는 실행하지 않는다.
    - Tool-calling에서도 web search 도구를 모델에 바인딩/노출하지 않는다.
- 패널 레이아웃/폭 (PanelGroup 규칙)
  - 메인 에디터 영역(프로젝트 사이드바 제외)은 2분할 PanelGroup으로 구성한다: Editor Panel + AI Chat Panel
  - 기본 분할 비율은 Editor 60% / Chat 40%이며, 사용자가 리사이즈 핸들로 최소 Chat 25% ~ 최대 80% 범위에서 조절할 수 있어야 한다.
  - Chat이 80%까지 확장되도록 Editor Panel의 최소 폭은 20%로 제한하되, 기본 상태에서는 Document-First 철학을 위해 60%를 유지한다.
  - PanelGroup의 설정은 패널 스왑(좌/우 위치 변경) 시에도 동일한 폭 규칙을 적용한다.
- Settings 화면 전환(Replace)
  - 기존 “System Prompt” 버튼은 “Settings”로 명명한다.
  - Settings를 열면 채팅 메시지 리스트/입력창은 숨겨지고, 해당 탭의 화면이 Settings UI로 “교체(replace)”된다.
  - Settings를 닫으면 원래의 채팅 화면으로 복귀한다.
- 메시지 수정(Edit Message) — 일반 AI 채팅 UX
  - 사용자는 기존 사용자 메시지(내가 보낸 메시지)를 수정할 수 있어야 한다.
  - 메시지를 수정하면, 그 메시지 “이하”의 메시지는 모두 삭제(truncate)된다.
  - 삭제(truncate) 이후의 흐름은 사용자가 재전송/재생성을 명시적으로 요청할 때만 진행한다(On-Demand 유지).
  - (권장) 수정 이력: `editedAt`, `originalContent`를 보관하여 디버깅/재현성을 확보한다.
- EditSession 정합성(중요)
  - 메시지 수정으로 인해 삭제된 요청에서 파생된 `pending` EditSession은 자동으로 `discarded` 처리한다.
  - 이미 `kept`된 변경은 문서 상태로 확정된 것이므로 되돌리지 않는다(되돌림은 별도 히스토리/undo 정책으로 처리).

3.7 Settings 필드명/프롬프트 변수명 일관화
What:
- Settings의 “참조문서/용어집 메모(모델에 그대로 전달)” 필드명은 “번역 규칙”으로 변경한다.
- 내부 변수명도 `referenceNotes` 대신 `translationRules`로 일관되게 변경한다.
- Payload/프롬프트 섹션 라벨 또한 “번역 규칙(Translation Rules)”로 통일한다.

3.8 첨부 파일(Reference Attachments) 확장 명세
Why:
- CSV/Excel뿐 아니라, PDF/PPTX/이미지/Markdown/DOCX 등 다양한 참고 자료를 “프로젝트에 첨부”하여 모델에 전달할 수 있어야 한다.

What:
- 지원 파일(1차 목표): csv, xlsx/xls, pdf, pptx, png/jpg/webp, md, docx
- 저장/공유:
  - 첨부 파일은 프로젝트 단위로 관리되며, 모든 채팅 탭이 동일 첨부 목록을 공유한다.
- 채팅 전용 첨부(추가):
  - 채팅 입력창(Composer)에서 첨부하는 파일/이미지는 **일회성(비영속)** 으로 관리한다.
  - 채팅 전용 첨부는 **프로젝트 첨부(Settings)** 목록에 합쳐지지 않으며, **해당 메시지의 모델 호출 payload에만** 포함된다.
- 모델 전달 원칙:
  - 현재 구현(Phase 1):
    - 문서(pdf/docx/pptx/md/txt)는 로컬에서 텍스트를 추출하여 system context로 주입한다(길이 제한 적용).
    - 이미지(png/jpg/jpeg/webp/gif)는 **멀티모달(vision) 입력**으로, 로컬 파일을 base64로 읽어 표준 content blocks로 모델 입력에 포함한다(파일 크기/개수 제한 적용).
  - 향후(확장): Provider가 제공하는 “파일 업로드/첨부(file_id 등)” 메커니즘을 사용해 원형 전달을 지원할 수 있다.
  - (호환성/폴백) 특정 모델/Provider에서 멀티모달/첨부가 불가한 경우 에러 메시지 또는 안내 메시지로 폴백한다.
  - 과도한 컨텍스트 방지를 위해 파일별/전체 길이 제한 및 우선순위(사용자 선택/최근 첨부/키워드 매칭)를 둔다.

4. 데이터 영속성 (Data & Storage)
4.1 SQLite 기반의 단일 파일 구조 (.ite)
Why:
- 번역 데이터, AI 대화 로그, 수정 이력(History)이 모두 하나의 맥락 안에서 보존되어야 합니다.

How:
- Rust 백엔드에서 `rusqlite`로 프로젝트 DB를 관리하고, 저장 시 단일 `.ite` 파일로 패킹합니다.

What (Schema 개요):
- `blocks`: 각 문단/문장의 원문 및 번역문 데이터
- `chat_sessions`: 대화 로그 및 컨텍스트 요약본
- `snapshots`: 특정 시점의 전체 텍스트 상태(Version Control)

What (Project Metadata UX):
- 사이드바에서 Project 이름을 수정(rename)할 수 있어야 한다.
- 변경된 Project 이름은 프로젝트 메타데이터로 저장되며 `.ite`에 영속화되어 재개 시 복원되어야 한다.

5. 특화 기능 명세 (Specialized Sub-systems)
5.1 Ghost Chips (태그 보호)
What:
- 특정 특수 문자나 태그(예: <tag>, {var})가 번역 과정에서 손상되지 않도록 보호하기 위해 **Ghost Chips**를 사용합니다.
- `chatStore.ts`와 `ghostMask.ts`를 통해 모델 호출 전 마스킹하고, 응답 후 복원하는 과정을 거칩니다.

5.2 Smart Context Summarizer
What:
- 대화 토큰 임계치 모니터링과 Project Context 제안 UX는 점진 구현 중이며, Add to Rules / Add to Context 버튼을 통해 수동 반영합니다.

6. 개발 도구 및 환경 (Dev Tools)
State Management: Zustand (Global Store), Immer (Immutable Updates).

Formatting/Linting: Prettier, ESLint.

Testing: Vitest (Unit), Playwright (E2E for Tauri).

7. AI Provider 및 API Key 관리
7.1 Provider 지원 현황
What:
- **OpenAI**: 활성화됨 (기본 provider)
- **Anthropic**: UI에서 비활성화됨 (코드는 유지, 추후 활성화 예정)
- **Mock**: UI에서 제거됨 (타입은 유지, 개발/테스트용)

7.2 API Key 관리
Why:
- 사용자가 App Settings에서 직접 API Key를 입력할 수 있어야 합니다.
- 환경 변수와 사용자 입력 키의 우선순위를 명확히 해야 합니다.

How:
- Tauri 백엔드에서 OS 키체인/키링을 사용해 API Key 저장
- 프론트는 secure store 명령을 통해 저장/조회, localStorage에는 저장하지 않음
- 앱 시작 시 키체인에서 로드하여 메모리에 반영

What:
- **저장 위치**: OS 키체인/키링 (서비스: `com.ite.app`, 키: `ai:openai|anthropic|google|brave`)
- **우선순위**: 키체인 저장값만 사용 (환경 변수 또는 localStorage 폴백 없음)
- **보안**: localStorage/DB에 저장하지 않음. 키는 OS 보안 저장소에만 존재
- **UI**: App Settings에서 API Key 입력 필드 제공, Clear 버튼으로 삭제 가능
- **비고**: Tauri 런타임이 아닌 경우 키는 메모리에서만 유지

💡 기술적 체크포인트
Performance: TipTap 두 개(Source/Target) 동시 렌더링 시 60fps 근접 유지 확인.

IPC Latency: 대용량 텍스트 저장 시 Rust-React 간 통신 지연시간 50ms 미만 유지.

Diff Accuracy: 한글 특유의 조사 변화나 어미 변화 시 Diff 알고리즘이 자연스럽게 하이라이트를 생성하는지 검증.
