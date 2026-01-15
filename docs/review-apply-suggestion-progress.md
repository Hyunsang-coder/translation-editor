# 검수 추천 적용 기능 - 진행 현황

> 계획 문서: `/docs/review-apply-suggestion.md`
> 시작일: 2026-01-15
> 상태: 계획됨

---

## Phase 0: 프롬프트 개선

- [ ] reviewTool.ts OUTPUT_FORMAT 수정
  - suggestedFix 형식 명세 추가
  - few-shot 예시 추가
- [ ] 테스트: 검수 실행 후 suggestedFix 형식 확인

## Phase 1: 기본 기능

- [ ] ReviewResultsTable.tsx
  - Apply 버튼 추가
  - onApplySuggestion prop
- [ ] ReviewPanel.tsx
  - handleApplySuggestion 구현
  - 토스트 메시지
- [ ] i18n 키 추가
  - ko.json: review.apply*, review.applyError.*, review.applySuccess
  - en.json: 동일 키

## Phase 2: 안정성 (선택)

- [ ] segmentOrder 기반 컨텍스트 검색
- [ ] 문서 해시 비교로 변경 감지
- [ ] 적용 후 하이라이트 자동 제거

## Phase 3: UX 개선 (선택)

- [ ] "모두 적용" 버튼
- [ ] Undo 지원

---

## 테스트 체크리스트

### Phase 0 완료 후
- [ ] 검수 실행: suggestedFix가 순수 텍스트인지 확인
- [ ] 3회 반복: 일관된 형식 출력 확인

### Phase 1 완료 후
- [ ] Apply 클릭 → 번역문 변경 확인
- [ ] 빈 suggestedFix → 삭제 확인 다이얼로그
- [ ] 텍스트 못 찾음 → 에러 토스트
- [ ] 자동저장 → SQLite 반영 확인

### Phase 2 완료 후
- [ ] 동일 텍스트 2개 → 올바른 위치 교체
- [ ] 사용자 편집 후 → 적절한 경고/처리

---

## 이슈 트래킹

| # | 이슈 | 상태 | 해결 |
|---|------|------|------|
| - | - | - | - |
