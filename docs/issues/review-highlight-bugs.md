# Review Highlight 버그 분석 및 수정 방안

> 작성일: 2025-01-20
> 상태: **재검증 완료**, 수정 대기
> 마지막 업데이트: 2025-01-20

## 증상

1. **하이라이트가 안 보임**: 검수 결과가 있는데 에디터에 하이라이트가 표시되지 않음
2. **"적용" 버튼 클릭 시 모든 하이라이트 사라짐**: 하나만 적용했는데 전체 하이라이트가 제거됨

---

## 발견된 이슈

### Issue #1: `disableHighlight()`가 에디터 새로고침을 트리거하지 않음 ✅ 확인됨

**심각도**: 🔴 High

**위치**: `src/stores/reviewStore.ts:358-360`

**현재 코드**:
```typescript
disableHighlight: () => {
  set({ highlightEnabled: false });  // highlightNonce 증가 없음
},
```

**비교 - `toggleHighlight()` (정상 동작)**:
```typescript
toggleHighlight: () => {
  const { highlightEnabled, highlightNonce } = get();
  set({
    highlightEnabled: !highlightEnabled,
    highlightNonce: highlightNonce + 1,  // ✅ nonce 증가함
  });
},
```

**문제점**:
- `highlightEnabled: false`로 설정되지만 `highlightNonce`가 증가하지 않음
- `TipTapEditor.tsx:459-463`의 `useEffect`가 트리거되지 않음
- `refreshEditorHighlight(editor)`가 호출되지 않아 에디터의 decoration이 그대로 남음

**영향**:
- 스토어 상태는 `highlightEnabled: false`지만 에디터에는 하이라이트가 남아있음
- 상태와 UI 불일치

**수정 방안**:
```typescript
disableHighlight: () => {
  const { highlightNonce } = get();
  set({
    highlightEnabled: false,
    highlightNonce: highlightNonce + 1  // 에디터 새로고침 트리거
  });
},
```

---

### Issue #2: "적용" 버튼 클릭 시 cross-store subscription으로 인한 하이라이트 무효화 ✅ 확인됨

**심각도**: 🔴 High

**위치**: `src/stores/reviewStore.ts:389-410`

**트리거 흐름 분석**:
```
handleApplySuggestion() 호출
    ↓
setIsApplyingSuggestion(true)     // 1. Zustand 상태 업데이트 (동기)
    ↓
replaceMatch()                     // 2. tr.dispatch() → TipTap onUpdate → setTargetDocJson() (동기)
                                   //    → projectStore 상태 변경
                                   //    → cross-store subscription 트리거 (동기)
                                   //    → setTimeout(0) 등록 (콜백 예약)
    ↓
deleteIssue()                      // 3. results 변경 + highlightNonce++ (동기)
    ↓
setTimeout(500)                    // 4. setIsApplyingSuggestion(false) 예약

// --- 이벤트 루프 다음 tick ---
setTimeout(0) 콜백 실행             // 5. isApplyingSuggestion 체크 → true이면 스킵, false이면 disableHighlight()
```

**현재 코드 로직**:
```typescript
useProjectStore.subscribe((state) => {
  const { targetDocJson } = state;

  if (prevTargetDocJson !== null && targetDocJson !== prevTargetDocJson) {
    setTimeout(() => {
      const reviewState = useReviewStore.getState();
      if (
        reviewState.highlightEnabled &&
        reviewState.results.length > 0 &&
        !reviewState.isApplyingSuggestion  // 이 시점에 true여야 함
      ) {
        useReviewStore.getState().disableHighlight();
      }
    }, 0);
  }

  prevTargetDocJson = targetDocJson;
});
```

**문제점**:
- 정상적인 경우: `setTimeout(0)` 콜백 실행 시 `isApplyingSuggestion: true` → 스킵
- **문제 케이스**: Zustand 상태 업데이트 배칭이나 마이크로태스크 타이밍에 따라 `isApplyingSuggestion`이 아직 `false`일 수 있음

**영향**:
- "적용" 버튼 클릭 시 모든 하이라이트 사라짐 (간헐적)

**수정 방안**:
```typescript
useProjectStore.subscribe((state) => {
  const { targetDocJson } = state;

  if (prevTargetDocJson !== null && targetDocJson !== prevTargetDocJson) {
    // 즉시 체크로 레이스 컨디션 방지 (동기 시점에서 확인)
    const immediateState = useReviewStore.getState();
    if (immediateState.isApplyingSuggestion) {
      prevTargetDocJson = targetDocJson;
      return;  // 적용 중이면 즉시 스킵
    }

    setTimeout(() => {
      const reviewState = useReviewStore.getState();
      if (
        reviewState.highlightEnabled &&
        reviewState.results.length > 0 &&
        !reviewState.isApplyingSuggestion
      ) {
        useReviewStore.getState().disableHighlight();
      }
    }, 0);
  }

  prevTargetDocJson = targetDocJson;
});
```

---

### Issue #3: `isApplyingSuggestion` 플래그 해제 타이밍 ⚠️ 잠재적 문제

**심각도**: 🟡 Medium

**위치**: `src/components/review/ReviewPanel.tsx:281-293`

**현재 코드**:
```typescript
setIsApplyingSuggestion(true);
editor.commands.replaceMatch(replaceText);
editor.commands.setSearchTerm('');
deleteIssue(issue.id);
setTimeout(() => {
  setIsApplyingSuggestion(false);
}, 500);  // 고정 딜레이
```

**문제점**:
- `replaceMatch()` 내부에서 `setTimeout(0)` 사용하여 매치 재계산
- 500ms는 대부분의 경우 충분하지만, 보장되지 않음
- `requestAnimationFrame` 기반이 더 안정적

**수정 방안**:
```typescript
setIsApplyingSuggestion(true);
editor.commands.replaceMatch(replaceText);
editor.commands.setSearchTerm('');
deleteIssue(issue.id);

// 모든 비동기 작업 완료 후 플래그 해제 (2 프레임 대기)
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    setIsApplyingSuggestion(false);
  });
});
```

---

### Issue #4: `useBlockEditor.ts`에서 `highlightNonce` 미구독 ✅ 수정 완료

**심각도**: 🟡 Medium

**위치**: `src/hooks/useBlockEditor.ts`

**문제점**:
- TranslationBlock 기반 에디터에서 `highlightNonce` 변경을 감지하지 않음
- `ReviewHighlight` extension은 포함되어 있지만, 외부에서 `refreshEditorHighlight()` 호출이 없음

**영향**:
- TranslationBlock 사용 시 하이라이트 업데이트 안됨

**수정 완료** (2025-01-20):
```typescript
import { useReviewStore } from '@/stores/reviewStore';
import { refreshEditorHighlight } from '@/editor/extensions/ReviewHighlight';

// 훅 내부에 추가
const highlightNonce = useReviewStore((s) => s.highlightNonce);

useEffect(() => {
  if (editor && highlightNonce > 0) {
    refreshEditorHighlight(editor);
  }
}, [editor, highlightNonce]);
```

---

### Issue #5: 텍스트 검색 불일치로 하이라이트 실패 ⚠️ 장기 과제

**심각도**: 🟡 Medium (장기)

**위치**: `src/editor/extensions/ReviewHighlight.ts:69`

**현재 코드**:
```typescript
const index = fullText.indexOf(searchText);  // 첫 번째 매치만
```

**문제점**:
1. AI의 `targetExcerpt`와 에디터 텍스트가 정확히 일치하지 않으면 하이라이트 안됨
2. `normalizeForSearch()`가 마크다운만 제거하고 공백/줄바꿈 차이는 완전히 해결 못함
3. 동일 텍스트가 여러 번 등장하면 첫 번째 위치만 하이라이트

**영향**:
- 일부 이슈가 하이라이트되지 않음

**수정 방안** (장기):
- 공백 정규화 강화
- fuzzy matching 도입 고려
- 세그먼트 기반 검색으로 검색 범위 제한

---

## 재검증 노트

### "무시" 버튼 vs "적용" 버튼

| 버튼 | 문서 변경 | targetDocJson 변경 | subscription 트리거 |
|------|----------|-------------------|-------------------|
| 무시 | ❌ | ❌ | ❌ |
| 적용 | ✅ | ✅ | ✅ |

**결론**: "무시" 버튼은 문서를 변경하지 않으므로 cross-store subscription이 트리거되지 않음.
문제는 **"적용" 버튼**에서 발생하며, `isApplyingSuggestion` 플래그 타이밍 문제로 보임.

---

## 수정 우선순위 및 병렬 진행 가능 여부

### 의존성 분석

```
Issue #1 (disableHighlight)     ─┐
                                 ├─→ 독립적, 병렬 가능
Issue #4 (useBlockEditor)       ─┘

Issue #2 (subscription race)    ─┬─→ 같은 파일 (#1과), 순차 권장
                                 │
Issue #3 (flag timing)          ─┘─→ #2와 연관, 함께 테스트 필요

Issue #5 (텍스트 검색)           ─→ 독립적, 별도 진행 가능 (장기 과제)
```

### 병렬 작업 그룹

| 그룹 | 이슈 | 파일 | 병렬 가능 |
|------|------|------|----------|
| **A** | #1 | `reviewStore.ts` | ✅ |
| **A** | #4 | `useBlockEditor.ts` | ✅ |
| **B** | #2 | `reviewStore.ts` | ⚠️ #1과 같은 파일, 순차 |
| **B** | #3 | `ReviewPanel.tsx` | ✅ (별도 파일이지만 #2와 함께 테스트) |

### 권장 진행 순서

1. **Phase 1** (병렬 가능):
   - Issue #1: `disableHighlight()` 수정 (`reviewStore.ts`)
   - Issue #4: `useBlockEditor.ts` 수정
   - **두 파일이 다르므로 병렬 진행 가능**

2. **Phase 2** (Phase 1 완료 후, 순차):
   - Issue #2: Cross-store subscription 수정 (`reviewStore.ts`) - #1과 같은 파일
   - Issue #3: `isApplyingSuggestion` 타이밍 수정 (`ReviewPanel.tsx`)
   - **#2와 #3은 함께 테스트해야 효과 확인 가능**

3. **Phase 3** (장기 과제):
   - Issue #5: 텍스트 검색 개선

### 실제 병렬 진행 가능 조합

```
┌─────────────────────────────────────────────────────┐
│  Phase 1 (병렬)                                      │
│  ┌─────────────────┐  ┌─────────────────┐          │
│  │ Issue #1        │  │ Issue #4        │          │
│  │ reviewStore.ts  │  │ useBlockEditor  │          │
│  │ disableHighlight│  │ highlightNonce  │          │
│  └────────┬────────┘  └────────┬────────┘          │
│           │                    │                    │
│           ▼                    ▼                    │
│  ┌─────────────────────────────────────────────┐   │
│  │            Phase 1 완료 후 테스트             │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  Phase 2 (순차, 같은 파일 또는 연관 테스트)           │
│  ┌─────────────────┐                               │
│  │ Issue #2        │                               │
│  │ reviewStore.ts  │ → subscription 즉시 체크 추가  │
│  └────────┬────────┘                               │
│           │                                         │
│           ▼                                         │
│  ┌─────────────────┐                               │
│  │ Issue #3        │                               │
│  │ ReviewPanel.tsx │ → rAF 기반 플래그 해제         │
│  └────────┬────────┘                               │
│           │                                         │
│           ▼                                         │
│  ┌─────────────────────────────────────────────┐   │
│  │       Phase 2 완료 후 통합 테스트             │   │
│  │  ("적용" 버튼 → 다른 이슈 하이라이트 유지 확인)  │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 테스트 시나리오

### 수정 전 재현 테스트

1. **하이라이트 안 보임**:
   - 검수 실행 → 결과 확인 → 문서 수동 편집 → 하이라이트 상태 확인

2. **모든 하이라이트 사라짐**:
   - 검수 실행 → 여러 이슈 발견 → "무시" 버튼 1회 클릭 → 다른 이슈 하이라이트 확인

### 수정 후 검증 테스트

1. `disableHighlight()` 호출 시 에디터 하이라이트 즉시 제거 확인
2. "무시" 버튼 클릭 시 해당 이슈만 제거, 다른 이슈 하이라이트 유지 확인
3. "적용" 버튼 클릭 시 해당 이슈만 제거, 다른 이슈 하이라이트 유지 확인
4. TranslationBlock 에디터에서 하이라이트 업데이트 확인

---

## 관련 파일

- `src/stores/reviewStore.ts`
- `src/components/review/ReviewPanel.tsx`
- `src/editor/extensions/ReviewHighlight.ts`
- `src/hooks/useBlockEditor.ts`
- `src/components/editor/TipTapEditor.tsx`
