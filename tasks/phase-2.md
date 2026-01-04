# Phase 2: AI 연동 및 채팅 시스템

**목표**: LangChain.js 기반 AI 호출, 멀티 탭 채팅, 간결한 응답 프롬프트 구현.

## 완료(요약)

- [x] LangChain.js 설치/연동: `langchain`, `@langchain/openai` (Anthropic/Google 제거됨 - Phase 6.0)
- [x] 환경변수 기반 API Key 구성
- [x] ChatModel 생성 유틸 (`createChatModel`)
- [x] 요청 유형 감지 (`detectRequestType`) 및 기본 프롬프트 빌더
- [x] Selection → Chat (Cmd+L)
- [x] 문서 전체 번역(Preview → Apply) 기본 흐름
- [x] 채팅 UI + 멀티 탭 + Settings 화면 전환
- [x] Markdown(GFM) 렌더링
- [x] 스트리밍 응답 + UI 실시간 업데이트
- [x] 채팅/번역 로딩 표시 개선: typing indicator 적용(Progress bar 제거)
- [x] 메시지 수정(Edit Message) 및 (edited) 라벨 UI 완성
- [x] Settings 입력 필드 Markdown 미리보기 기능 추가
- [x] System Prompt 필드 툴팁 및 가이드 아이콘 추가
- [x] 채팅 입력창(Composer) UI 교체: 화살표 Send + 좌측 `+` 메뉴 + 웹 검색 토글

## 진행중/미완료(상세)

### 2.3 문서 전체 번역(Preview → Apply) 안정화

- [ ] **JSON 포맷 응답 누락 버그 수정**
  - **증상**: 문서 전체 번역 시 간헐적으로 모델이 TipTap JSON이 아닌 텍스트/설명 형태로 응답
  - **추정 트리거**: 전송 내용에 HTML 태그 등이 포함되어 있을 때
  - **완료 조건**
    - 항상 `doc` 루트의 TipTap JSON으로 파싱 성공하거나,
    - 실패 시 사용자에게 **명확한 오류 메시지** + **재시도/폴백** 동작이 일관되게 동작

### 2.4 AI Chat 패널 UX (완료)

- [x] **메시지 수정(Edit Message) 완성**
  - [x] 사용자 메시지 수정 시 이하 메시지 truncate
  - [x] `editedAt`, `originalContent` 저장/표시까지 포함해 “완전 구현”
  - **완료 조건**: 수정 후에도 히스토리/스트리밍/세션 저장이 깨지지 않음

- [x] **Settings 입력 필드 Markdown 지원**
  - **범위**: Settings 영역의 특정 입력(예: 번역 규칙/Active Memory 등)
  - **완료 조건**: 입력/미리보기(또는 표시)에서 Markdown 렌더링이 일관되며, HTML 렌더링은 금지

- [x] **System Prompt 필드 툴팁**
  - **완료 조건**: 각 필드 옆 아이콘 + 호버 시 툴팁 표시, 접근성(키보드 포커스) 고려


