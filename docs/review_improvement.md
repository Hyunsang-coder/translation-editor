# 검수 프롬프트 개선 + 설정 UI 추가

> Status: **계획됨** (Planned)
> 작성일: 2026-01-13

## 문제 정의

| 문제 | 증상 |
|------|------|
| 과잉 검출 | 정상적인 의역도 "왜곡"으로 검출 |
| 일관성 부족 | 동일 문서를 매번 다르게 평가 |
| 설명 불명확 | 추상적인 설명으로 이해하기 어려움 |
| 유연성 부족 | 사용자가 검수 기준을 조절할 수 없음 |

## 개선 방향

- **설명 형식**: 문제-근거-영향 3줄 구조
- **검수 강도**: 3단계 드롭다운 (설명체 레이블)
- **검수 항목**: 체크박스로 on/off
- **UI 위치**: 접이식 섹션 (아코디언)

---

## 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/stores/reviewStore.ts` | 검수 설정 상태 추가 |
| `src/ai/tools/reviewTool.ts` | 프롬프트 개선 + 설정 반영 |
| `src/components/review/ReviewPanel.tsx` | 설정 UI 추가 |
| `src/i18n/locales/ko.json` | 한국어 번역 키 |
| `src/i18n/locales/en.json` | 영어 번역 키 |

---

## 1. reviewStore.ts - 설정 상태 추가

```typescript
// 검수 강도 타입
export type ReviewIntensity = 'minimal' | 'balanced' | 'thorough';

// 검수 항목 타입
export interface ReviewCategories {
  mistranslation: boolean;  // 오역
  omission: boolean;        // 누락
  distortion: boolean;      // 왜곡 (강도/범위 변경)
  consistency: boolean;     // 용어 일관성
}

// ReviewState에 추가
interface ReviewState {
  // ... 기존 상태
  intensity: ReviewIntensity;
  categories: ReviewCategories;
  settingsExpanded: boolean;  // 아코디언 상태
}

// 기본값
const defaultCategories: ReviewCategories = {
  mistranslation: true,
  omission: true,
  distortion: false,  // 기본 off (과잉 검출 방지)
  consistency: true,
};

// Actions 추가
setIntensity: (intensity: ReviewIntensity) => void;
toggleCategory: (category: keyof ReviewCategories) => void;
setSettingsExpanded: (expanded: boolean) => void;
```

---

## 2. reviewTool.ts - 프롬프트 개선

### 검수 강도별 프롬프트

```typescript
const INTENSITY_PROMPTS: Record<ReviewIntensity, string> = {
  minimal: `## 검출 기준: 명백한 오류만
- 의미가 정반대인 오역
- 금액/날짜/수량 등 팩트 누락
- 애매하면 검출하지 않음
- 의역/스타일 차이는 모두 허용`,

  balanced: `## 검출 기준: 중요한 오류
- 의미가 크게 달라진 오역
- 중요 정보(조건, 예외, 주의사항) 누락
- 확실한 경우만 검출
- 자연스러운 의역은 허용`,

  thorough: `## 검출 기준: 세밀한 검토
- 의미 차이가 있는 모든 오역
- 정보 누락 (사소한 것 포함)
- 강도/범위 변경 (must→can 등)
- 미세한 뉘앙스 차이도 검출`,
};
```

### 검수 항목별 지침

```typescript
const CATEGORY_PROMPTS: Record<keyof ReviewCategories, string> = {
  mistranslation: `**오역**: 원문과 번역문의 의미가 다른 경우`,
  omission: `**누락**: 원문에 있는 정보가 번역문에 없는 경우`,
  distortion: `**왜곡**: 강도(must→can), 범위(전체→부분), 조건 등이 변경된 경우`,
  consistency: `**일관성**: 같은 용어가 다르게 번역된 경우 (Glossary 기준)`,
};
```

### 개선된 출력 형식

```typescript
const OUTPUT_FORMAT = `## 출력 형식

문제 발견 시 JSON으로 출력:
{
  "issues": [
    {
      "segmentOrder": 1,
      "type": "오역|누락|왜곡|일관성",
      "sourceExcerpt": "원문 30자 이내",
      "targetExcerpt": "번역문 30자 이내",
      "problem": "무엇이 문제인지 (1줄)",
      "reason": "왜 문제인지 - 원문과 대비 (1줄)",
      "impact": "독자가 받을 오해 (1줄)",
      "suggestedFix": "수정 제안"
    }
  ]
}

문제 없음: { "issues": [] }`;
```

---

## 3. ReviewPanel.tsx - 설정 UI

### 아코디언 섹션 (검수 시작 전 초기 화면)

```tsx
{/* 검수 설정 - 접이식 섹션 */}
<div className="border border-editor-border rounded-lg overflow-hidden">
  <button
    onClick={() => setSettingsExpanded(!settingsExpanded)}
    className="w-full px-4 py-3 flex items-center justify-between bg-editor-surface/50 hover:bg-editor-surface transition-colors"
  >
    <span className="text-sm font-medium">{t('review.settings', '검수 설정')}</span>
    <ChevronIcon expanded={settingsExpanded} />
  </button>

  {settingsExpanded && (
    <div className="px-4 py-3 space-y-4 border-t border-editor-border">
      {/* 검수 강도 */}
      <div>
        <label className="block text-xs text-editor-muted mb-2">
          {t('review.intensity', '검수 강도')}
        </label>
        <select
          value={intensity}
          onChange={(e) => setIntensity(e.target.value as ReviewIntensity)}
          className="w-full px-3 py-2 text-sm rounded border border-editor-border bg-editor-bg"
        >
          <option value="minimal">{t('review.intensity.minimal', '명백한 오류만 검출')}</option>
          <option value="balanced">{t('review.intensity.balanced', '중요한 오류 검출')}</option>
          <option value="thorough">{t('review.intensity.thorough', '세밀하게 검토')}</option>
        </select>
      </div>

      {/* 검수 항목 */}
      <div>
        <label className="block text-xs text-editor-muted mb-2">
          {t('review.categories', '검수 항목')}
        </label>
        <div className="space-y-2">
          {/* CheckboxItem 컴포넌트들 */}
        </div>
      </div>
    </div>
  )}
</div>
```

---

## 4. i18n 번역 키

### ko.json (추가)
```json
{
  "review": {
    "settings": "검수 설정",
    "intensity": "검수 강도",
    "intensity.minimal": "명백한 오류만 검출",
    "intensity.balanced": "중요한 오류 검출",
    "intensity.thorough": "세밀하게 검토",
    "categories": "검수 항목",
    "category.mistranslation": "오역",
    "category.mistranslation.desc": "의미가 다르게 번역된 경우",
    "category.omission": "누락",
    "category.omission.desc": "원문 정보가 빠진 경우",
    "category.distortion": "왜곡",
    "category.distortion.desc": "강도/범위/조건이 변경된 경우",
    "category.consistency": "용어 일관성",
    "category.consistency.desc": "같은 용어가 다르게 번역된 경우"
  }
}
```

### en.json (추가)
```json
{
  "review": {
    "settings": "Review Settings",
    "intensity": "Review Intensity",
    "intensity.minimal": "Obvious errors only",
    "intensity.balanced": "Important errors",
    "intensity.thorough": "Thorough review",
    "categories": "Review Categories",
    "category.mistranslation": "Mistranslation",
    "category.mistranslation.desc": "Meaning differs from source",
    "category.omission": "Omission",
    "category.omission.desc": "Source information missing",
    "category.distortion": "Distortion",
    "category.distortion.desc": "Intensity/scope/conditions changed",
    "category.consistency": "Term Consistency",
    "category.consistency.desc": "Same term translated differently"
  }
}
```

---

## 5. 프롬프트 생성 로직

```typescript
// ReviewPanel.tsx - runReview 함수 내
const buildReviewPrompt = (
  intensity: ReviewIntensity,
  categories: ReviewCategories,
  segmentsText: string
) => {
  const enabledCategories = Object.entries(categories)
    .filter(([_, enabled]) => enabled)
    .map(([key]) => CATEGORY_PROMPTS[key as keyof ReviewCategories])
    .join('\n');

  return `당신은 번역 품질 검수자입니다.

${INTENSITY_PROMPTS[intensity]}

## 검수 항목 (이것만 검출)
${enabledCategories}

## 검출하지 않는 것
- 어순, 문체, 표현 방식 차이
- 자연스러운 의역
- 위에서 지정하지 않은 항목

${OUTPUT_FORMAT}

## 검수 대상
${segmentsText}`;
};
```

---

## 검증 방법

1. **설정 UI 동작 확인**
   - 아코디언 열림/닫힘
   - 드롭다운 선택
   - 체크박스 토글

2. **프롬프트 반영 확인**
   - 강도별로 다른 프롬프트 생성 확인
   - 비활성화된 항목이 프롬프트에서 제외되는지 확인

3. **검수 품질 확인**
   - "명백한 오류만": 정상 의역 통과, 명백한 오역만 검출
   - 동일 문서 3회 검수 시 일관성 확인

---

## 예상 효과

| 문제 | 해결책 | 기대 효과 |
|------|--------|----------|
| 과잉 검출 | "왜곡" 기본 off + 보수적 강도 | 오탐 80% 감소 |
| 일관성 부족 | 명확한 이진 기준 | 일관성 70%→90% |
| 설명 불명확 | 문제-근거-영향 구조 | 즉시 이해 가능 |
| 유연성 부족 | 강도/항목 설정 UI | 사용자 맞춤 검수 |

---

## 관련 파일

- 기존 검수 구현: `docs/archive/review_tool_improvement.md`
- 검수 결과 파싱: `src/ai/review/parseReviewResult.ts`
- 검수 하이라이트: `src/editor/extensions/ReviewHighlight.ts`
