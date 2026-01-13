🛠 [TRD] OddEyes.ai Technical Specifications

이 문서는 OddEyes.ai의 **기술 설계도(Source of Truth)**입니다. 구현/문서가 충돌하면 본 문서를 기준으로 정리합니다.

(내부 코드명: Integrated Translation Editor / ITE)

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
- 지원 포맷: Heading(H1-H6), Bullet/Ordered List, Bold, Italic, Strike, Blockquote, Link, Table, Image, Placeholder, (선택) Code Block
- 추가 포맷 (에디터 표시용): Underline, Highlight, Subscript, Superscript (Markdown 변환 시 손실)

3. AI 상호작용 및 Preview 워크플로우
3.1 문서 전체 번역 (Preview → Apply)
Why:
- HTML/서식 손상 없이 번역문을 적용하려면 Preview 후 사용자가 명시적으로 Apply 해야 합니다.
- **Markdown 중간 형식**을 사용하여 토큰 효율성을 높이고, 청킹 복잡도를 낮춥니다.

How:
- Translate 버튼/단축키로 Source 전체를 **Markdown으로 변환**하여 모델에 전달하고, 출력도 **Markdown**으로 받습니다.
- 응답 Markdown을 TipTap JSON으로 변환하여 Preview 모달에서 원문-번역 Diff를 보여주고, Apply 시 Target을 전체 덮어쓰기 합니다.
- 문서 전체 번역(Translate)은 채팅 히스토리를 컨텍스트에 포함하지 않습니다. (Settings의 페르소나/번역 규칙/Project Context/글로서리/문서 컨텍스트만 사용)

What:
- Trigger: Translate(Preview) 버튼/단축키
- Input: Source 문서를 **Markdown으로 변환** + project meta(sourceLanguage/targetLanguage/domain), translationRules, projectContext, translatorPersona, glossary/attachments(있는 경우)
- Output: **Markdown** (문서 전체) → TipTap JSON으로 변환 후 Preview 표시
- UX: Preview 모달(Preview/Diff), Apply 시 전체 덮어쓰기. 자동 적용 없음. **에러 시 Retry 버튼 표시**.
- API 구조: LangChain `BaseMessage[]` 배열
  - SystemMessage 1개: 번역 전용 프롬프트 (페르소나, 번역 규칙, Project Context 포함)
  - UserMessage 1개: **Markdown 문서**를 문자열로 전달
  - 히스토리 메시지 없음
- Markdown 변환 파이프라인:
  - **TipTap → Markdown**: `tiptap-markdown` extension 사용 (`editor.storage.markdown.getMarkdown()`)
  - **Markdown → TipTap**: `tiptap-markdown` extension 사용 (`editor.commands.setContent(markdown)`)
  - **지원 서식**: Headings, Bold, Italic, Strike, Lists (중첩), Blockquote (중첩), CodeBlock, Link, Table, HorizontalRule
  - **손실 가능 항목**: 링크의 `target` 속성, 복잡한 테이블(colspan/rowspan) - 번역에 영향 없음
- 출력 안정성:
  - **구분자 사용**: `---TRANSLATION_START---` / `---TRANSLATION_END---`로 번역 결과 구분
  - **후처리**: 구분자 사이 내용만 추출, 없으면 전체 응답 사용 (경고 로그)
  - **Truncation 감지**: 열린 코드블록(홀수 ` ``` `), 문서 끝 미완성 링크 체크 (보수적 판단으로 오탐 방지)
  - **finish_reason 검사**: `length`인 경우 토큰 제한 에러로 처리
- 동적 max_tokens 계산:
  - 입력 문서 크기 기반으로 출력 토큰 자동 계산 (JSON 오버헤드 없이 순수 텍스트 기준)
  - GPT-5 400k 컨텍스트 윈도우 기준, 안전 마진 10%
  - 문서가 너무 큰 경우 **Context-aware 청킹**으로 분할 번역 (코드블록/리스트 내부 분할 금지)
- 이미지 플레이스홀더 시스템:
  - **목적**: Base64 이미지(수만 토큰)를 플레이스홀더로 대체하여 토큰 절약
  - **처리 흐름**: Markdown → `extractImages()` → 번역 → `restoreImages()` → TipTap JSON
  - **토큰 절약**: Base64 50KB 기준 ~16,500 토큰 → 1-2 토큰 (99.99% 절약)
  - **구현 파일**: `src/utils/imagePlaceholder.ts`

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
- 질문(Question) 모드에서만 포함: 최근 메시지 (기본 20개, `VITE_AI_MAX_RECENT_MESSAGES` 환경변수로 조정 가능)
- 출력 포맷 강제:
  - Translate: **Markdown 전체만 출력**(설명 금지, `---TRANSLATION_START/END---` 구분자 사용)
  - Question/검수: 간결한 답변 또는 JSON 리포트(필요 시)
- 컨텍스트 길이 제한 (GPT-5 시리즈 400k 컨텍스트 윈도우 기준):
  - Translation Rules: 최대 10,000자
  - Project Context: 최대 30,000자
  - Glossary: 최대 30,000자
  - Source/Target Document: 최대 100,000자 (채팅 모드에서는 on-demand tool 호출)
  - 첨부파일 (개별): 최대 30,000자
  - 첨부파일 (총합): 최대 50,000자
  - Context Blocks: 최대 20개 블록, 블록당 최대 500자
  - 출력 토큰 (번역 모드): 최대 65,536 토큰

What (API 구조 - 채팅 모드):
- LangChain `BaseMessage[]` 배열 사용
- ChatPromptTemplate으로 메시지 구성:
  - SystemMessage 1개: 요청 유형별 시스템 프롬프트 (translate/question/general)
  - SystemMessage 1개 (조건부): SystemContext (번역 규칙/Project Context/글로서리/문서/컨텍스트 블록)
  - SystemMessage 1개: Tool Guide (문서 조회 도구 및 제안 도구 사용 가이드)
  - MessagesPlaceholder: 히스토리 메시지 (question 모드에서만 최근 10개)
  - HumanMessage 1개: 사용자 입력
- Tool Calling 지원 (적극적 도구 사용 정책):
  - get_source_document: 원문 문서 조회 (**Markdown 형식 반환**) - 문서 관련 질문 시 먼저 호출 권장
  - get_target_document: 번역문 문서 조회 (**Markdown 형식 반환**) - 번역 품질/표현 질문 시 먼저 호출 권장
  - suggest_translation_rule: 번역 규칙 제안
  - suggest_project_context: Project Context 제안
- 문서 조회 도구 Markdown 변환:
  - TipTap JSON이 있으면 `tipTapJsonToMarkdown()`으로 변환하여 서식 보존
  - 서식(헤딩, 리스트, 볼드, 이탤릭, 링크 등)이 Markdown으로 표현됨
  - 변환 실패 시 plain text fallback (stripHtml)
- Tool Calling Loop 설정:
  - maxSteps 기본값: 6 (이전: 4), 최대값: 12 (이전: 8)
  - 복합 쿼리 시 충분한 도구 호출 허용
- **채팅에서 지원하지 않는 기능** (전용 버튼/탭 사용):
  - 전체 문서 번역: **Translate 버튼** 사용 (Source 전체 → Target으로 번역)
  - 번역 검수: **Review 탭** 사용 (3.9 참조)
  - 사용자가 채팅에서 전체 번역/검수를 요청하면 해당 버튼/탭 사용을 안내
  - (외부 참조 도구, 조건부) Confluence 문서 검색/가져오기: Rovo MCP `search()` / `fetch()`
    - **Rust 네이티브 SSE 클라이언트**: Node.js 의존성 없이 Rust에서 직접 Atlassian MCP 서버에 SSE 연결.
    - OAuth 2.1 PKCE 인증도 Rust에서 네이티브로 처리 (로컬 콜백 서버 방식).
    - 사용자는 Chat 탭에서 `Confluence_search` 토글로 사용 여부를 제어한다(3.6 참조).
    - 토글이 꺼져 있으면 모델에 도구를 바인딩/노출하지 않는다(웹검색 게이트와 동일 원칙).
    - **SSE 연결 리소스 관리**:
      - 엔드포인트 수신 타임아웃(10초) 시 shutdown signal로 백그라운드 SSE 태스크 종료
      - 연결 실패/타임아웃 시 리소스 누수 방지

### 실시간 토큰 스트리밍 (Real-time Token Streaming)

Why:
- 번역가는 AI 응답을 기다리는 동안 불안감을 느끼며, 첫 토큰이 빠르게 표시될수록 "응답이 진행 중"임을 인지합니다.
- Claude App과 같은 실시간 타이핑 효과는 사용자 체감 응답성을 대폭 향상시킵니다.

How:
- LangChain `.stream()` API를 사용하여 토큰별로 실시간 수신
- 각 토큰을 즉시 UI 콜백(`onToken`)으로 전달
- 도구 호출 청크(`tool_call_chunks`)를 수집하여 완성된 도구 호출로 병합

What:
- 스트리밍 구현 위치: `src/ai/chat.ts` → `runToolCallingLoop()` 함수
- 응답 흐름:
  ```
  .stream() → for await (chunk) {
    - 텍스트 토큰: 즉시 onToken 콜백 호출
    - 도구 호출 청크: 수집 후 병합
    - 최종 메시지: concat으로 누적
  }
  ```
- 첫 토큰 표시 시간: 0.5~2초 (이전 의사-스트리밍: 5~30초)
- 도구 호출 중 상태 표시: `onToolCall` 콜백으로 진행 상태 전달
- 요청 취소: 기존 `AbortSignal` 패턴 유지
- 네트워크 에러 시: 부분 응답 반환 (토큰 손실 방지)

### 스트리밍 번역 (Streaming Translation)

Why:
- 번역 결과를 기다리는 동안 사용자에게 진행 상황을 실시간으로 보여줍니다.
- Preview 모달에서 번역 텍스트가 타이핑되는 효과를 제공합니다.

How:
- LangChain `.stream()` API를 사용하여 토큰별로 실시간 수신
- `onToken` 콜백으로 누적된 텍스트를 UI에 전달
- 완료 후 Markdown → TipTap JSON 변환

What:
- 스트리밍 구현 위치: `src/ai/translateDocument.ts` → `translateWithStreaming()` 함수
- Markdown 파이프라인과 동일: Source → Markdown → LLM (streaming) → Markdown → TipTap JSON
- 응답 흐름:
  ```
  .stream() → for await (chunk) {
    - 텍스트 토큰: 누적 후 onToken 콜백 호출
    - 완료 시: extractTranslationMarkdown() → markdownToTipTapJson()
  }
  ```
- 구분자 추출: `---TRANSLATION_START/END---` 마커 사용
- Truncation 감지: 완료 후 Markdown 구조 검증

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
    - Confluence 검색 체크(`Confluence_search`, Atlassian Rovo MCP 사용 여부)
  - 채팅 모델 선택 드롭다운은 Send 버튼(화살표) **왼쪽**에 둔다.
  - Send 버튼은 입력창 **우측 하단**에 **화살표 아이콘**으로 표시한다(문자 “Send”는 표시하지 않음).
  - 입력 내용이 있어야 Send 버튼이 활성화된다.
  - Enter=전송, Shift+Enter=줄바꿈을 기본값으로 둔다.
- 에디터 번역 버튼 주변
  - 번역 모델 선택 드롭다운은 Editor의 “번역” 버튼 **왼쪽**에 둔다.
  - 기본 모델은 `gpt-5.2`, 커스텀 모델 입력은 지원하지 않는다.
- 웹검색 게이트(중요)
  - `webSearchEnabled` 기본값: **true** (새 세션에서 웹검색 기본 활성화)
  - `webSearchEnabled`가 **true일 때만** 웹검색 도구를 사용할 수 있다.
  - **기본 웹검색**: OpenAI 내장 `web_search_preview` 도구 사용 (Responses API)
  - **폴백**: Brave Search API (OpenAI 웹검색 실패 시, Brave API Key가 설정된 경우에만)
  - `webSearchEnabled=false`인 경우:
    - 명시적 트리거(`/web`, `웹검색:`)는 실행하지 않는다.
    - Tool-calling에서도 web search 도구를 모델에 바인딩/노출하지 않는다.
 - Confluence 검색 게이트(중요)
  - 배경:
    - Atlassian Rovo MCP Server는 **OAuth 2.1 기반**이며, API Token/API Key를 사용자가 직접 입력해 연결하는 방식은 지원하지 않는다.
    - **Rust 네이티브 SSE 클라이언트**로 Node.js 의존성 없이 직접 Atlassian MCP 서버에 연결한다.
    - OAuth 2.1 PKCE 인증은 Rust에서 로컬 콜백 서버를 열어 처리한다.
    - **OAuth 토큰은 SecretManager Vault에 영속화**되어 앱 재시작 후에도 재인증 없이 자동 연결된다 (아래 "OAuth 토큰 영속화" 섹션 참조).
  - `confluenceSearchEnabled`가 **true일 때만** Rovo MCP의 `search()` / `fetch()` 도구를 사용할 수 있다.
  - `confluenceSearchEnabled=false`인 경우:
    - Tool-calling에서도 Rovo MCP 도구(`search`, `fetch`)를 모델에 바인딩/노출하지 않는다.
  - 상태/스코프:
    - `confluenceSearchEnabled`는 **채팅 탭(thread) 단위**로 관리한다.
  - OAuth 트리거(Non-Intrusive / Lazy):
    - 토글 ON은 “도구 사용 허용”만 의미한다(즉시 브라우저 인증을 강제하지 않는다).
    - 실제로 `search()` / `fetch()`가 필요한 시점에 연결이 없으면, UI에서 “Atlassian 연결(Connect)” CTA를 노출하고 **사용자 클릭으로만** OAuth를 시작한다.
  - 연결 엔드포인트:
    - `https://mcp.atlassian.com/v1/sse`
    - Rust 구현: `src-tauri/src/mcp/` (client.rs, oauth.rs, types.rs)
  - OAuth 토큰 영속화 (SecretManager Vault):
    - 저장 위치: `app_data_dir/secrets.vault` (마스터키로 암호화)
    - 키: `mcp/atlassian/oauth_token_json`, `mcp/atlassian/client_json`
    - 앱 시작 시 SecretManager가 vault에서 저장된 토큰 자동 로드 (Keychain 프롬프트 없음)
    - 토큰 만료 5분 전부터 `refresh_token`으로 자동 갱신 시도
    - 갱신 실패 시 토큰 삭제(메모리 + vault) 후 즉시 재인증 요청
    - **동시 OAuth 플로우 방지**: 진행 중인 인증이 있으면 새 인증 요청 거부 (single-flight guard)
    - **타임아웃/실패 시 상태 정리**: 5분 타임아웃 또는 콜백 실패 시 pending 상태 자동 정리
    - Tauri 커맨드: `mcp_check_auth` (저장된 토큰 확인), `mcp_logout` (토큰 삭제)
- 패널 레이아웃 (Hybrid Panel Layout)
  - **Settings/Review 사이드바**: 고정 사이드바로 우측에 배치
    - 드래그로 너비 조정 가능 (최소 280px ~ 최대 600px, 기본값 320px)
    - 탭 전환: Settings | Review (Review는 검수 시작 시에만 표시)
    - 닫기 버튼으로 사이드바 숨김/표시 전환
  - **플로팅 Chat 패널**: react-rnd 기반 드래그/리사이즈 가능한 플로팅 패널
    - 헤더로 드래그 이동 (화면 경계 내)
    - 8방향 리사이즈 (최소 320×400px)
    - 위치/크기는 localStorage에 persist
    - X 버튼 또는 플로팅 버튼으로 닫기
  - **플로팅 Chat 버튼**: 우측 하단 FAB 스타일 버튼
    - 드래그로 위치 변경 가능 (기본: 우측 하단)
    - 더블클릭으로 기본 위치 리셋
    - 클릭으로 Chat 패널 열기/닫기
  - **기본 상태**: Settings 사이드바 열림, Chat 패널 닫힘
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
- CSV/Excel뿐 아니라, PDF/PPTX/이미지/Markdown/DOCX 등 다양한 참고 자료를 "프로젝트에 첨부"하여 모델에 전달할 수 있어야 한다.

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
  - 향후(확장): Provider가 제공하는 "파일 업로드/첨부(file_id 등)" 메커니즘을 사용해 원형 전달을 지원할 수 있다.
  - (호환성/폴백) 특정 모델/Provider에서 멀티모달/첨부가 불가한 경우 에러 메시지 또는 안내 메시지로 폴백한다.
  - 과도한 컨텍스트 방지를 위해 파일별/전체 길이 제한 및 우선순위(사용자 선택/최근 첨부/키워드 매칭)를 둔다.

3.9 번역 검수 (Translation Review)
Why:
- 번역 완료 후 오역, 누락, 왜곡, 일관성 문제를 AI가 자동으로 검출하여 번역사의 검토 시간을 단축합니다.
- 검수 결과를 에디터에서 시각적으로 확인하며 수정할 수 있어야 합니다.

How:
- 문서를 청크로 분할하여 순차적으로 AI 검수 요청
- 검수 결과는 JSON 형식으로 파싱하여 테이블로 표시
- 체크된 이슈만 에디터에서 하이라이트 (TipTap Decoration)

What (핵심 원칙):
- **Non-Intrusive**: 문서 자동 변경 없음, Decoration은 비영속적
- **전용 UI로만 실행**: 채팅에서 검수 요청 불가, Review 탭에서만 실행
  - 채팅에서 검수 요청 시 "Review 탭을 사용해주세요" 안내
- **2분할 레이아웃 유지**: 새 컬럼 추가 대신 SettingsSidebar에 Review 탭 추가
- **JSON 출력 포맷**: TRD 3.2에서 "검수는 JSON 리포트 허용"으로 명시

What (UI 구성):
- **Review 탭**: SettingsSidebar의 기능 탭으로 추가 (Settings | Review)
  - Settings 사이드바 내에서 탭 전환 형태로 관리
  - 검수 시작 시에만 Review 탭 표시, 닫으면 Settings 탭으로 복귀
- **검수 시작**: 버튼 클릭으로 검수 시작, 취소 가능
- **결과 테이블**: 체크박스 + 이슈 정보 (컬럼: 체크 | # | 유형 | 원문 | 현재 번역 | 수정 제안 | 설명)
- **하이라이트 토글**: 체크된 이슈만 Target 에디터에서 하이라이트

What (데이터 모델):
```typescript
interface ReviewIssue {
  id: string;                    // 결정적 ID (hashContent로 생성)
  segmentOrder: number;
  segmentGroupId?: string;       // 세그먼트 단위 하이라이트용
  sourceExcerpt: string;         // 원문 구절 (35자 이내)
  targetExcerpt: string;         // 현재 번역 (하이라이트 대상)
  suggestedFix: string;          // 수정 제안
  type: 'error' | 'omission' | 'distortion' | 'consistency';
  description: string;
  checked: boolean;              // 체크 상태
}
```

What (AI 출력 형식):
```json
{
  "issues": [
    {
      "segmentOrder": 0,
      "segmentGroupId": "...",
      "type": "오역|누락|왜곡|일관성",
      "sourceExcerpt": "원문 35자 이내",
      "targetExcerpt": "현재 번역 35자 이내",
      "suggestedFix": "수정 제안",
      "description": "간결한 설명"
    }
  ]
}
```

What (하이라이트 매칭 전략):
1. segmentGroupId가 있으면 해당 세그먼트의 target 텍스트에서 targetExcerpt 검색
2. 1단계 실패 시 전체 문서에서 targetExcerpt substring 검색 (첫 매치)
3. 2단계도 실패 시 하이라이트 없이 패널에 "매칭 실패" 표시 (무해)

What (구현 파일):
| 파일 | 역할 |
|------|------|
| `src/stores/reviewStore.ts` | 검수 상태 관리 (체크, 하이라이트, 중복 제거) |
| `src/stores/uiStore.ts` | UI 상태 관리 (패널 위치, 크기, 탭 상태 등) |
| `src/components/panels/SettingsSidebar.tsx` | Settings/Review 사이드바 (탭 전환) |
| `src/components/panels/FloatingChatPanel.tsx` | 플로팅 Chat 패널 (react-rnd) |
| `src/components/chat/ChatContent.tsx` | Chat 기능 컨텐츠 |
| `src/components/ui/FloatingChatButton.tsx` | 플로팅 Chat 버튼 (드래그 가능) |
| `src/components/review/ReviewPanel.tsx` | Review 탭 콘텐츠 |
| `src/components/review/ReviewResultsTable.tsx` | 결과 테이블 + 체크박스 |
| `src/ai/review/parseReviewResult.ts` | AI 응답 JSON/마크다운 파싱 |
| `src/editor/extensions/ReviewHighlight.ts` | TipTap Decoration 하이라이트 |

What (상태 관리 - reviewStore):
- `initializeReview(project)`: 프로젝트를 청크로 분할, 상태 초기화
- `addResult(result)`: 청크별 검수 결과 추가
- `toggleIssueCheck(issueId)`: 이슈 체크 상태 토글
- `deleteIssue(issueId)`: 개별 이슈 삭제
- `setAllIssuesChecked(checked)`: 전체 선택/해제
- `getAllIssues()`: 중복 제거된 전체 이슈 목록
- `getCheckedIssues()`: 체크된 이슈만 반환
- `toggleHighlight()`: 하이라이트 활성화/비활성화
- `disableHighlight()`: Review 탭 닫을 때 호출

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
Why:
- 구조 단순화 및 OpenAI 내장 도구(web_search_preview 등) 활용을 위해 단일 Provider로 통일합니다.
- Anthropic/Google 등 멀티 Provider 지원은 코드 복잡도를 높이고, 각 Provider별 도구 호환성 문제를 야기합니다.

What:
- **OpenAI**: 유일한 활성 Provider (Responses API 사용)
- **Anthropic/Google**: 코드에서 제거 (향후 필요 시 재도입 가능)
- **Mock**: 번역 모드에서 제거됨. mock 설정 시 에러 발생하며 OpenAI API 키 설정 안내

7.2 API Key 관리 (SecretManager/Vault 아키텍처)
Why:
- 사용자가 App Settings에서 직접 API Key를 입력할 수 있어야 합니다.
- macOS 등에서 앱 실행 시마다 키체인 접근 권한을 묻는 횟수를 최소화(1회)해야 합니다.
- `.ite` export 파일에 시크릿이 절대 포함되지 않도록 보장해야 합니다.

How (Master Key + Encrypted Vault 아키텍처):
- **Keychain에는 마스터키 1개만 저장**: `ite:master_key_v1` (32 bytes, Base64)
- 모든 시크릿(API 키, OAuth 토큰, 커넥터 토큰 등)은 `app_data_dir/secrets.vault` 파일에 **AEAD(XChaCha20-Poly1305)로 암호화**하여 저장
- 앱 시작 시 SecretManager가:
  1. Keychain에서 마스터키를 1회 로드 (프롬프트 1회)
  2. `secrets.vault`를 복호화하여 메모리 캐시로 보관
  3. 이후 모든 시크릿 읽기/쓰기는 **메모리 + 로컬 파일 업데이트**만 수행 (Keychain 추가 접근 없음)
- 프론트는 secrets 명령(`secrets_get`, `secrets_set` 등)을 통해 저장/조회, localStorage에는 저장하지 않음
- **초기화 동시성 처리**:
  - 동시 초기화 호출 시 첫 번째 초기화 완료까지 대기 (최대 60초)
  - 타임아웃 시 상태를 `NotInitialized`로 리셋하여 재시도 가능
  - Vault 복호화 실패 시 에러 반환 (기존 토큰 보호)

What:
- **마스터키 저장 위치**: OS 키체인/키링 (서비스: `com.ite.app`, 키: `ite:master_key_v1`)
- **시크릿 저장 위치**: `app_data_dir/secrets.vault` (AEAD 암호화)
- **Vault 파일 포맷 (v1)**: `ITESECR1` (8 bytes magic) + nonce (24 bytes) + ciphertext
- **시크릿 키 네이밍**: namespace/key 형식 (예: `ai/openai_api_key`, `ai/brave_api_key`)
- **우선순위**: vault 저장값만 사용 (환경 변수 또는 localStorage 폴백 없음)
- **보안**: 
  - localStorage/DB(`ite.db`)에 저장하지 않음
  - `.ite` export는 DB 파일만 포함하므로 시크릿이 절대 포함되지 않음
  - 마스터키 메모리에서 `zeroize`로 drop 시 안전하게 삭제
  - 토큰/시크릿은 로그에 출력하지 않음 (`[REDACTED]`로 마스킹)
  - Vault 복호화 실패 시 에러 반환하여 기존 토큰 보호 (덮어쓰기 방지)
- **UI**: App Settings에서 API Key 입력 필드 제공, Clear 버튼으로 삭제 가능
- **Rust 모듈**: `src-tauri/src/secrets/` (mod.rs, vault.rs, manager.rs)
- **Tauri 명령**: `secrets_initialize`, `secrets_get`, `secrets_set`, `secrets_delete`, `secrets_has`, `secrets_list_keys`, `secrets_migrate_legacy`
- **에러 처리**:
  - 초기화 실패 시 `PreviousInitFailed` 전용 에러 타입 사용
  - Vault 복호화 실패 시 `VaultDecryptFailed` 에러 반환
  - 키체인 저장 실패 시 `Failed` 상태로 전환하여 무한 대기 방지

What (API Key 필드 목록):
| 필드 | 필수 여부 | 용도 |
|------|-----------|------|
| OpenAI API Key | **필수** | 모든 AI 기능 (번역, 채팅, 웹검색) |
| Brave Search API Key | 선택 (Optional) | 웹검색 폴백용 (OpenAI web_search_preview 실패 시) |

- Brave API Key가 없어도 기본 웹검색(OpenAI 내장)은 정상 동작합니다.
- Brave API Key가 입력된 경우, OpenAI 웹검색 실패 시 Brave Search로 폴백합니다.

7.3 External Connectors (MCP/OAuth)
Why:
- 번역 작업 시 외부 참조 문서(Confluence, Google Docs 등)에 접근해야 하는 경우가 많습니다.
- 각 커넥터는 OAuth 기반 인증을 사용하며, App Settings에서 통합 관리합니다.

How:
- 모든 커넥터는 **OAuth 2.1 PKCE** 기반으로 인증합니다 (Notion은 Integration Token 사용).
- OAuth 토큰은 **SecretManager Vault에 영속화**되어 앱 재시작 후에도 재인증 없이 사용 가능합니다.
- 커넥터 연결/해제는 App Settings에서 관리하며, 각 커넥터별로 연결 상태를 표시합니다.
- **Lazy OAuth**: 토글 ON은 "도구 사용 허용"만 의미하며, 실제 사용 시점에 연결이 없으면 CTA를 표시합니다.
- **토큰 자동 갱신**: OAuth 토큰 만료 5분 전부터 `refresh_token`으로 자동 갱신 시도

What (지원 커넥터):
| 커넥터 | 타입 | 상태 | 인증 방식 | 용도 |
|--------|------|------|-----------|------|
| Atlassian Confluence | MCP (Rovo) | 구현됨 | OAuth 2.1 PKCE | Confluence 문서 검색/참조 |
| Notion | REST API | 구현됨 | Integration Token | Notion 문서 검색/참조 |
| Google Drive | OpenAI Builtin | 준비 중 | OAuth 2.0 | Google Drive 파일 검색/접근 |
| Gmail | OpenAI Builtin | 준비 중 | OAuth 2.0 | Gmail 이메일 검색/읽기 |

What (커넥터 토큰 영속화):
- **Atlassian**: OAuth 토큰이 vault에 저장되어 앱 재시작 시 자동 재연결
- **Notion**: Integration Token이 vault에 저장되어 앱 재시작 시 자동 재연결
- **연결 해제**: App Settings에서 "연결 해제" 시 토큰은 유지, 연결만 해제 (재연결 시 기존 토큰 재사용 가능)
- **로그아웃**: 명시적 로그아웃 시에만 토큰 삭제

What (MCP 레지스트리):
- **McpRegistry**: 다중 MCP 서버를 통합 관리하는 Rust 모듈 (`src-tauri/src/mcp/registry.rs`)
- **지원 서버**: Atlassian (구현됨), Notion (구현됨)
- **Tauri 명령**: `mcp_registry_status`, `mcp_registry_connect`, `mcp_registry_disconnect`, `mcp_registry_logout`, `mcp_registry_get_tools`, `mcp_registry_call_tool`
- **TypeScript 래퍼**: `src/tauri/mcpRegistry.ts`

What (OAuth 토큰 관리 - SecretManager Vault):
- **저장 위치**: `app_data_dir/secrets.vault` (마스터키로 암호화)
- **키 패턴**: `mcp/<provider>/oauth_token_json`, `mcp/<provider>/client_json`, `connector/<id>/token_json`
- **예시 키**:
  - `mcp/atlassian/oauth_token_json`: Atlassian MCP OAuth 토큰
  - `mcp/atlassian/client_json`: Atlassian 등록된 클라이언트 정보
  - `mcp/notion/config_json`: Notion MCP 설정
  - `notion/integration_token`: Notion Integration Token
  - `connector/google/token_json`: Google 커넥터 토큰
- **토큰 갱신**: 만료 5분 전부터 자동 갱신 시도, 실패 시 재인증 CTA 표시
- **로그아웃**: App Settings에서 개별 커넥터 연결 해제 가능 (토큰은 유지, 연결만 해제)
- **마이그레이션**: Settings → Security에서 "기존 Keychain 로그인 정보 가져오기" 버튼으로 레거시 키체인 엔트리를 vault로 이전

What (OAuth 콜백 서버 - 리소스 관리):
- **포트**: `localhost:23456` (고정)
- **자동 종료 조건**:
  - `/callback` 성공 시 즉시 종료
  - 브라우저 열기(`open::that`) 실패 시 즉시 종료
  - 인증 타임아웃(5분) 시 즉시 종료
  - 서버 자체 타임아웃(6분) 시 자동 종료
- **shutdown signal**: `tokio::select!`로 shutdown signal과 accept를 동시 대기하여 즉시 종료 보장
- **재시도 보호**: 종료되지 않은 서버가 포트를 점유하는 것을 방지하여 즉시 재시도 가능

What (UI 구조 - App Settings):
```
App Settings
├── API Keys
│   ├── OpenAI API Key (필수)
│   └── Brave Search API Key (선택)
│
├── Connectors (구현됨: ConnectorsSection.tsx)
│   ├── Atlassian Confluence (MCP)
│   │   ├── 연결 상태: [연결됨 ✓] / [연결 안 됨]
│   │   ├── [연결] / [연결 해제] 버튼
│   │   └── "채팅에서 이 서비스 사용" 토글
│   ├── Notion (MCP)
│   │   ├── 연결 상태: [연결됨 ✓] / [연결 안 됨]
│   │   ├── [연결] / [연결 해제] 버튼
│   │   └── "채팅에서 이 서비스 사용" 토글
│   ├── Google Drive (OpenAI Builtin)
│   │   └── 준비 중 (Coming Soon)
│   └── Gmail (OpenAI Builtin)
│       └── 준비 중 (Coming Soon)
│
└── (기존 설정들...)
```

What (채팅 탭별 토글):
- 각 커넥터는 **채팅 입력창의 토글**로 개별 활성화/비활성화할 수 있습니다.
- 토글이 OFF인 경우 해당 커넥터의 도구는 모델에 바인딩되지 않습니다 (3.6 게이트 원칙).
- 커넥터가 App Settings에서 "연결 안 됨" 상태이면 토글은 비활성화(disabled)됩니다.

8. 다국어 지원 (i18n)
8.1 언어 설정
Why:
- 사용자가 한국어/영어 중 선호하는 언어로 UI를 사용할 수 있어야 합니다.

How:
- i18next + react-i18next를 사용하여 다국어 지원 구현
- 언어 설정은 uiStore에 저장되며 persist 미들웨어로 영속화
- App Settings에서 언어 선택 UI 제공 (한국어/English 라디오 버튼)

What:
- **지원 언어**: 한국어(ko), 영어(en)
- **기본 언어**: 한국어
- **저장 위치**: uiStore의 language 상태 (localStorage에 persist)
- **UI 위치**: App Settings → Language 섹션
- **번역 파일**: `src/i18n/locales/ko.json`, `src/i18n/locales/en.json`
- **번역 범위**: 모든 UI 문자열 (버튼, 레이블, 메시지, placeholder, 에러 메시지 등)
- **동적 변경**: 언어 변경 시 즉시 반영 (앱 재시작 불필요)

💡 기술적 체크포인트
Performance: TipTap 두 개(Source/Target) 동시 렌더링 시 60fps 근접 유지 확인.

IPC Latency: 대용량 텍스트 저장 시 Rust-React 간 통신 지연시간 50ms 미만 유지.

Diff Accuracy: 한글 특유의 조사 변화나 어미 변화 시 Diff 알고리즘이 자연스럽게 하이라이트를 생성하는지 검증.
