# Phase 5: LangChain.js Tools 시스템

**목표**: 검수/오탈자/일관성 체크 등을 Tool로 정의하고 호출.

## 미완료(상세)

### 5.1 Tool 프레임워크 구축

- [x] Tool 인터페이스/스키마 정의 (Zod)
- [x] 기본 Tool 구조 생성
  - 문서 조회 Tool: `get_source_document`, `get_target_document` ✅
  - 제안 Tool: `suggest_translation_rule`, `suggest_project_context` ✅
  - Tool 호출 텔레메트리: 콘솔(`[AI tool_call]`) + `metadata.toolsUsed`
- [x] 채팅 응답 중 Tool 호출 진행 상태 UI 표시 (`metadata.toolCallsInProgress`)

### 5.2 추가 Tool 구현

**확장 가능한 Tool 구조**:
- Tool 프레임워크는 이미 구축되어 있으므로, 필요에 따라 새로운 Tool을 추가할 수 있습니다.

**현재 계획된 Tool들**:

#### 5.2.1 Translation Review Tool
- [x] 번역 품질 검수 프롬프트/로직
  - 포함 항목: 정확성, 누락/오역, 톤/문체, 맞춤법/오탈자, **용어 일관성**
- [ ] 용어집 연동 (일관성 검사 시 활용)
- [ ] 결과 JSON 스키마 정의
- [ ] 점수 + 피드백 형식 출력

**향후 추가 가능한 Tool들**:
- [ ] (추후 필요 시 추가)

### 5.5 Tool 호출 UI

**구현 방향 (검토 중)**:
- [ ] Tool 트리거 방식 결정 (버튼/메뉴/단축키 등)
- [ ] 검수 결과 표시 방식 결정
- [ ] 결과 항목과 문서 위치 연결 방식 결정


