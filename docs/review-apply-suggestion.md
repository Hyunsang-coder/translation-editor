# 검수 추천 문장 적용 기능

> Status: **계획됨** (Planned)
> 작성일: 2026-01-15

## 개요

검수 결과 테이블에서 "수정 제안" 클릭 시 번역문에 즉시 반영하는 기능.

## 문제 정의

| 현재 상태 | 문제점 |
|-----------|--------|
| suggestedFix 읽기 전용 | 수동 복사/붙여넣기 필요 |
| 프롬프트 형식 미지정 | AI가 설명 형태로 응답 가능 |

## 구현 범위

### Phase 0: 프롬프트 개선 (필수)
- [ ] `reviewTool.ts` OUTPUT_FORMAT에 suggestedFix 형식 명세
- [ ] few-shot 예시 추가
- [ ] 마크다운/설명 금지 명시

### Phase 1: 기본 기능
- [ ] ReviewResultsTable에 Apply 버튼
- [ ] ReviewPanel에 handleApplySuggestion
- [ ] 성공/실패 토스트
- [ ] 빈 suggestedFix 시 삭제 확인

### Phase 2: 안정성 (선택)
- [ ] segmentOrder 기반 컨텍스트 검색
- [ ] 문서 변경 감지 (해시 비교)
- [ ] 적용 후 하이라이트 제거

### Phase 3: UX 개선 (선택)
- [ ] "모두 적용" 버튼
- [ ] Undo 지원

---

## 기술 설계

### 프롬프트 수정 (`reviewTool.ts:130`)

변경 전:
```json
"suggestedFix": "수정 제안"
```

변경 후:
```json
"suggestedFix": "targetExcerpt를 대체할 정확한 텍스트만 (설명/지시문 없이)"
```

추가 지침:
```
## suggestedFix 작성 규칙
- targetExcerpt를 직접 대체할 텍스트만 작성
- 설명, 지시문, 따옴표, 마크다운 없이 순수 번역문만
- 예시:
  - ✅ 좋음: targetExcerpt "사용자 인터페이스" → suggestedFix: "UI"
  - ❌ 나쁨: suggestedFix: "'사용자 인터페이스'를 'UI'로 바꾸세요"
  - ❌ 나쁨: suggestedFix: "**UI**로 변경 권장"
```

### 적용 로직 (`ReviewPanel.tsx`)

```typescript
const handleApplySuggestion = useCallback((issue: ReviewIssue) => {
  const { targetDocument, setTargetDocument } = useProjectStore.getState();

  if (!issue.targetExcerpt || !issue.suggestedFix) {
    toast.error(t('review.applyError.missingData'));
    return;
  }

  // 빈 suggestedFix = 삭제 제안
  if (issue.suggestedFix === '') {
    // 확인 다이얼로그
    if (!confirm(t('review.applyConfirm.delete'))) return;
  }

  const index = targetDocument.indexOf(issue.targetExcerpt);
  if (index === -1) {
    toast.error(t('review.applyError.notFound'));
    return;
  }

  const newDoc =
    targetDocument.slice(0, index) +
    issue.suggestedFix +
    targetDocument.slice(index + issue.targetExcerpt.length);

  setTargetDocument(newDoc);
  toast.success(t('review.applySuccess'));

  // 체크 상태 변경 (선택)
  toggleIssueCheck(issue.id);
}, [toggleIssueCheck]);
```

---

## 엣지 케이스

| 케이스 | 처리 방법 |
|--------|----------|
| 텍스트 중복 | 첫 번째만 교체 (Phase 2에서 segmentOrder 활용) |
| 사용자 편집 후 | indexOf 실패 → 에러 메시지 |
| 빈 suggestedFix | 확인 다이얼로그 후 삭제 |
| 마크다운 포함 | 프롬프트에서 금지 (Phase 0) |

### AI 응답 형식 위험

| 형태 | 예시 | 자동 적용 가능? |
|------|------|----------------|
| ✅ 교체 텍스트만 | `"올바른 번역"` | ✅ 바로 적용 |
| ⚠️ 설명 포함 | `"'X'를 'Y'로 바꾸세요"` | ❌ 설명까지 삽입됨 |
| ⚠️ 여러 문장 | `"A를 B로. C도 D로."` | ❌ 전체 삽입됨 |
| ⚠️ 마크다운 | `"**강조** 필요"` | ❌ 마크다운 그대로 |
| ⚠️ 빈 값 | `""` | 텍스트 삭제됨 |

**실제 위험 시나리오**:
```
targetExcerpt: "사용자 인터페이스"
suggestedFix: "'사용자 인터페이스'를 'UI'로 변경하는 것이 좋습니다"

// 클릭 시 결과:
원본: "사용자 인터페이스를 개선했습니다"
결과: "'사용자 인터페이스'를 'UI'로 변경하는 것이 좋습니다를 개선했습니다"  // 💥
```

→ **Phase 0 프롬프트 개선이 필수인 이유**

---

## 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/ai/tools/reviewTool.ts` | suggestedFix 형식 명세 |
| `src/components/review/ReviewResultsTable.tsx` | Apply 버튼 UI |
| `src/components/review/ReviewPanel.tsx` | 적용 핸들러 |
| `src/i18n/locales/ko.json` | 번역 키 |
| `src/i18n/locales/en.json` | 번역 키 |

---

## 검증 방법

1. **프롬프트 검증**: 검수 실행 후 suggestedFix가 순수 텍스트인지 확인
2. **적용 검증**: Apply 버튼 클릭 → 번역문 변경 확인
3. **엣지 케이스**: 중복 텍스트, 빈 값, 사용자 편집 후 테스트

---

## 관련 문서

- 검수 프롬프트 개선: `/docs/review_improvement.md`
- 검수 하이라이트: `src/editor/extensions/ReviewHighlight.ts`
- 검수 결과 파싱: `src/ai/review/parseReviewResult.ts`
