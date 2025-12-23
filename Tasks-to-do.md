남은 태스크

## 버그 수정
- [ ] 간혹 JSON FORMAT으로 응답이 안 오는 경우 여전히 발생 (문서 전체 번역 시)
- [ ] Preview 모달의 Diff 색상 대비 조정: 변경된 내용이 더 눈에 잘 띄도록

## UI/UX 개선
- [ ] 아이콘 생성 및 적용
- [ ] 메시지 수정 이력 보관 (editedAt, originalContent) - 현재 truncate만 구현됨

## 기능 구현
- [ ] LangChain.js 스트리밍 응답 처리 (현재 비스트리밍)
- [ ] 용어집 자동 주입: 모델 호출 시 관련 용어 자동 포함
- [ ] 첨부 파일 지원 확장: pdf, pptx, png/jpg, md, docx 등
- [ ] LangChain.js Tools 시스템 (checkSpelling, checkConsistency, reviewQuality)
