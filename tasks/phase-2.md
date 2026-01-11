# Phase 2: AI 연동 및 채팅 시스템

**상태**: ✅ 대부분 완료

## 완료 항목

- LangChain.js 연동 (OpenAI)
- ChatModel 생성 유틸 (`createChatModel`)
- 요청 유형 감지 (`detectRequestType`)
- Selection → Chat (Cmd+L)
- 문서 전체 번역 (Preview → Apply)
- 채팅 UI + 멀티 탭 + Settings 화면
- Markdown(GFM) 렌더링
- 스트리밍 응답 + UI 실시간 업데이트
- 메시지 수정(Edit Message)
- Composer UI (화살표 Send + `+` 메뉴)

## 미완료

### 2.3 문서 전체 번역 안정화

- [ ] **JSON 포맷 응답 누락 버그**
  - 증상: 간헐적으로 TipTap JSON 대신 텍스트로 응답
  - 추정 원인: 전송 내용에 HTML 태그 포함 시
  - 조건: 파싱 성공 또는 명확한 오류 메시지 + 재시도
