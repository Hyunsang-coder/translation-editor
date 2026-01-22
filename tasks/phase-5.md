# Phase 5: LangChain.js Tools 시스템

**상태**: 🚧 진행 중

## 완료 항목

- Tool 인터페이스/스키마 정의 (Zod)
- 문서 조회 Tool: `get_source_document`, `get_target_document`
- 제안 Tool: `suggest_translation_rule`, `suggest_project_context`
- Tool 호출 UI 표시 (`metadata.toolCallsInProgress`)
- 번역 품질 검수 Tool

## 미완료

### 5.2 추가 Tool 구현

- [ ] 용어집 연동 (일관성 검사 시 활용)
- [ ] 결과 JSON 스키마 정의
- [ ] 점수 + 피드백 형식 출력

### 5.5 Tool 호출 UI

- [ ] Tool 트리거 방식 결정
- [ ] 검수 결과 표시 방식 결정
- [ ] 결과 항목과 문서 위치 연결 방식
