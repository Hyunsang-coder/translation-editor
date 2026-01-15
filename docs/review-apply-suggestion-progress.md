# 검수 추천 적용 기능 - 진행 현황

> 계획 문서: `/docs/review-apply-suggestion.md`
> 시작일: 2026-01-15
> 상태: **Phase 1 완료**

---

## Phase 0: 프롬프트 개선

- [x] reviewTool.ts OUTPUT_FORMAT 수정
  - suggestedFix 형식 명세 추가 (`reviewTool.ts:130`)
  - few-shot 예시 추가 (`reviewTool.ts:135-144`)
  - 마크다운/설명 금지 명시
- [ ] 테스트: 검수 실행 후 suggestedFix 형식 확인

## Phase 1: 기본 기능

- [x] ReviewResultsTable.tsx
  - Apply 버튼 추가 (`ReviewResultsTable.tsx:193-201`)
  - onApply prop 추가 (`ReviewResultsTable.tsx:9`)
- [x] ReviewPanel.tsx
  - handleApplySuggestion 구현 (`ReviewPanel.tsx:202-241`)
  - 토스트 메시지 (`ReviewPanel.tsx:207-237`)
  - 빈 suggestedFix 삭제 확인 다이얼로그 (`ReviewPanel.tsx:215-217`)
- [x] i18n 키 추가
  - ko.json: review.apply, review.applyError.*, review.applySuccess, review.applyConfirm.*
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

### Phase 1 완료 후 (구현 완료, 테스트 필요)
- [ ] Apply 클릭 → 번역문 변경 확인
- [ ] 빈 suggestedFix → 삭제 확인 다이얼로그
- [ ] 텍스트 못 찾음 → 에러 토스트
- [ ] 자동저장 → SQLite 반영 확인

### Phase 2 완료 후
- [ ] 동일 텍스트 2개 → 올바른 위치 교체
- [ ] 사용자 편집 후 → 적절한 경고/처리

---

## 완료 로그

| 날짜 | 항목 | 비고 |
|------|------|------|
| 2026-01-15 | Phase 0 구현 완료 | OUTPUT_FORMAT, few-shot 예시 추가 |
| 2026-01-15 | Phase 1 구현 완료 | Apply 버튼, handleApplySuggestion, i18n |

## 이슈 트래킹

| # | 이슈 | 상태 | 해결 |
|---|------|------|------|
| - | - | - | - |
