# 4. AI Chat UX 명세

## 4.1 Tabs, Settings, Message Edit

### Why
- 번역 작업은 "문서 편집"과 "대화/검수"가 동시에 진행되므로, 채팅 UX가 일반적인 AI 앱(ChatGPT/Claude) 수준의 편집성과 멀티 스레드를 제공해야 한다.

### What

#### 멀티 탭 채팅(Thread Tabs)
- 하나의 프로젝트 내에서 AI 채팅 탭을 여러 개 생성/전환할 수 있어야 한다.
- 탭 생성은 **최대 5개**로 제한한다. (`MAX_CHAT_SESSIONS = 5`)
  - UX: 탭이 5개에 도달하면 확인 다이얼로그로 가장 오래된 세션 삭제 여부를 묻는다.
  - 정책: 사용자가 확인 시 가장 오래된 세션을 삭제하고 새 세션 생성
- 앱 재시작/프로젝트 재개 시 탭 복원 순서는 **최근 활동(각 탭의 마지막 메시지 timestamp)** 기준 내림차순이다.
- 탭들은 동일 프로젝트의 Settings(시스템 프롬프트 오버레이/번역 규칙/Project Context/첨부 파일 등)를 공유한다.
- 각 탭(thread)은 메시지 히스토리를 독립적으로 가진다.

#### 응답 생성 상태 표시(Loading / Tool Calling)
- AI 응답을 기다리는 동안, 일반적인 채팅 앱처럼 "typing/로딩 인디케이터"를 표시한다.
- AI가 Tool(웹검색/문서 조회/저장 제안 등)을 사용한 경우, 해당 메시지 하단에 "도구 사용됨/실행 중" 배지를 작게 표시할 수 있다. (가시성 목적, 자동 적용/자동 수정 없음)
- 모델이 문서 조회 등 Tool을 호출하는 동안, "툴 실행 중" 상태를 표시할 수 있다. (예: `get_source_document`, `get_target_document`)
- 상태 표시는 UX 보조용이며, 문서 자동 수정/자동 적용과 무관하다(Non-Intrusive 유지).

#### 채팅 입력창(Composer)
- 입력창 좌측 하단에 `+` 버튼을 두고, 클릭 시 드롭다운 메뉴를 연다.
  - 파일 또는 이미지 추가(프로젝트 단위 첨부)
  - 웹 검색 체크(웹검색 사용 여부)
  - Confluence 검색 체크(`Confluence_search`, Atlassian Rovo MCP 사용 여부)
- 채팅 모델 선택 드롭다운은 Send 버튼(화살표) **왼쪽**에 둔다.
- Send 버튼은 입력창 **우측 하단**에 **화살표 아이콘**으로 표시한다(문자 "Send"는 표시하지 않음).
- 입력 내용이 있어야 Send 버튼이 활성화된다.
- Enter=전송, Shift+Enter=줄바꿈을 기본값으로 둔다.

#### 에디터 번역 버튼 주변
- 번역 모델 선택 드롭다운은 Editor의 "번역" 버튼 **왼쪽**에 둔다.
- 기본 모델은 `gpt-5.2`, 커스텀 모델 입력은 지원하지 않는다.

---

## 4.2 웹검색 게이트

### 중요
- `webSearchEnabled` 기본값: **true** (새 세션에서 웹검색 기본 활성화)
- `webSearchEnabled`가 **true일 때만** 웹검색 도구를 사용할 수 있다.
- **기본 웹검색**: OpenAI 내장 `web_search_preview` 도구 사용 (Responses API)
- **폴백**: Brave Search API (OpenAI 웹검색 실패 시, Brave API Key가 설정된 경우에만)
- `webSearchEnabled=false`인 경우:
  - 명시적 트리거(`/web`, `웹검색:`)는 실행하지 않는다.
  - Tool-calling에서도 web search 도구를 모델에 바인딩/노출하지 않는다.

---

## 4.3 Confluence 검색 게이트

### 중요

#### 배경
- Atlassian Rovo MCP Server는 **OAuth 2.1 기반**이며, API Token/API Key를 사용자가 직접 입력해 연결하는 방식은 지원하지 않는다.
- **Rust 네이티브 SSE 클라이언트**로 Node.js 의존성 없이 직접 Atlassian MCP 서버에 연결한다.
- OAuth 2.1 PKCE 인증은 Rust에서 로컬 콜백 서버를 열어 처리한다.
- **OAuth 토큰은 SecretManager Vault에 영속화**되어 앱 재시작 후에도 재인증 없이 자동 연결된다 (아래 "OAuth 토큰 영속화" 섹션 참조).

#### 게이트 동작
- `confluenceSearchEnabled`가 **true일 때만** Rovo MCP의 `search()` / `fetch()` 도구를 사용할 수 있다.
- `confluenceSearchEnabled=false`인 경우:
  - Tool-calling에서도 Rovo MCP 도구(`search`, `fetch`)를 모델에 바인딩/노출하지 않는다.

#### 상태/스코프
- `confluenceSearchEnabled`는 **채팅 탭(thread) 단위**로 관리한다.

#### OAuth 트리거(Non-Intrusive / Lazy)
- 토글 ON은 "도구 사용 허용"만 의미한다(즉시 브라우저 인증을 강제하지 않는다).
- 실제로 `search()` / `fetch()`가 필요한 시점에 연결이 없으면, UI에서 "Atlassian 연결(Connect)" CTA를 노출하고 **사용자 클릭으로만** OAuth를 시작한다.

#### 연결 엔드포인트
- `https://mcp.atlassian.com/v1/sse`
- Rust 구현: `src-tauri/src/mcp/` (client.rs, oauth.rs, types.rs)

#### OAuth 토큰 영속화 (SecretManager Vault)
- **저장 위치**: `app_data_dir/secrets.vault` (마스터키로 암호화)
- **키**: `mcp/atlassian/oauth_token_json`, `mcp/atlassian/client_json`
- 앱 시작 시 SecretManager가 vault에서 저장된 토큰 자동 로드 (Keychain 프롬프트 없음)
- 토큰 만료 5분 전부터 `refresh_token`으로 자동 갱신 시도
- 갱신 실패 시 토큰 삭제(메모리 + vault) 후 즉시 재인증 요청
- **동시 OAuth 플로우 방지**: 진행 중인 인증이 있으면 새 인증 요청 거부 (single-flight guard)
- **타임아웃/실패 시 상태 정리**: 5분 타임아웃 또는 콜백 실패 시 pending 상태 자동 정리
- Tauri 커맨드: `mcp_check_auth` (저장된 토큰 확인), `mcp_logout` (토큰 삭제)

---

## 4.4 패널 레이아웃 (Hybrid Panel Layout)

### Settings/Review 사이드바
- 고정 사이드바로 우측에 배치
- 드래그로 너비 조정 가능 (최소 280px ~ 최대 600px, 기본값 320px)
- 탭 전환: Settings | Review (Review는 검수 시작 시에만 표시)
- 닫기 버튼으로 사이드바 숨김/표시 전환

### 플로팅 Chat 패널
- react-rnd 기반 드래그/리사이즈 가능한 플로팅 패널
- 헤더로 드래그 이동 (화면 경계 내)
- 8방향 리사이즈 (최소 320×400px)
- 위치/크기는 localStorage에 persist
- X 버튼 또는 플로팅 버튼으로 닫기

### 플로팅 Chat 버튼
- 우측 하단 FAB 스타일 버튼
- 드래그로 위치 변경 가능 (기본: 우측 하단)
- 더블클릭으로 기본 위치 리셋
- 클릭으로 Chat 패널 열기/닫기

### 기본 상태
- Settings 사이드바 열림, Chat 패널 닫힘

---

## 4.5 Settings 화면 전환(Replace)
- 기존 "System Prompt" 버튼은 "Settings"로 명명한다.
- Settings를 열면 채팅 메시지 리스트/입력창은 숨겨지고, 해당 탭의 화면이 Settings UI로 "교체(replace)"된다.
- Settings를 닫으면 원래의 채팅 화면으로 복귀한다.

---

## 4.6 메시지 수정(Edit Message) — 일반 AI 채팅 UX
- 사용자는 기존 사용자 메시지(내가 보낸 메시지)를 수정할 수 있어야 한다.
- 메시지를 수정하면, 그 메시지 "이하"의 메시지는 모두 삭제(truncate)된다.
- 삭제(truncate) 이후의 흐름은 사용자가 재전송/재생성을 명시적으로 요청할 때만 진행한다(On-Demand 유지).
- (권장) 수정 이력: `editedAt`, `originalContent`를 보관하여 디버깅/재현성을 확보한다.

---

## 4.7 EditSession 정합성

### 중요
- 메시지 수정으로 인해 삭제된 요청에서 파생된 `pending` EditSession은 자동으로 `discarded` 처리한다.
- 이미 `kept`된 변경은 문서 상태로 확정된 것이므로 되돌리지 않는다(되돌림은 별도 히스토리/undo 정책으로 처리).

---

## 4.8 Settings 필드명/프롬프트 변수명 일관화

### What
- Settings의 "참조문서/용어집 메모(모델에 그대로 전달)" 필드명은 "번역 규칙"으로 변경한다.
- 내부 변수명도 `referenceNotes` 대신 `translationRules`로 일관되게 변경한다.
- Payload/프롬프트 섹션 라벨 또한 "번역 규칙(Translation Rules)"로 통일한다.
