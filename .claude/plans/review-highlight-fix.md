# 검수 하이라이트 기능 문제 분석 및 개선 계획

## 1. 문제 원인 분석

### 하이라이트가 작동하지 않는 근본 원인: 아키텍처 불일치

**이전 구조 (작동함):**
```
EditorCanvasTipTap
  └─ TargetTipTapEditor (전체 문서, ReviewHighlight 확장 포함)
      └─ ProseMirror Plugin → Decoration 생성
```

**현재 구조 (작동 안 함):**
```
TargetPanel
  └─ TranslationBlock (블록 반복)
      └─ useBlockEditor (ReviewHighlight 확장 없음)
          └─ 개별 TipTap 에디터 (Decoration 생성 불가)
```

### 구체적 원인

| 파일 | 문제점 |
|------|--------|
| `useBlockEditor.ts` | ReviewHighlight 확장 미포함 (StarterKit만 사용) |
| `TranslationBlock.tsx` | highlightNonce 변경 감지 로직 없음 |
| `ReviewHighlight.ts` | 적용 대상 에디터가 없어서 Decoration 생성 안 됨 |

### 코드 증거

`useBlockEditor.ts` (41-50줄) - ReviewHighlight 없음:
```typescript
const editor = useEditor({
  extensions: [
    StarterKit.configure({...}),
    // ReviewHighlight 확장 없음!
  ],
});
```

`TipTapEditor.tsx` (201-203줄) - 여기엔 있지만 사용 안 됨:
```typescript
ReviewHighlight.configure({
  highlightClass: 'review-highlight',
}),
```

---

## 2. Source 패널 하이라이트 가능성 분석

### 결론: 기술적으로 가능

**이미 존재하는 것들:**
- `ReviewIssue.sourceExcerpt` 필드 (원문 구절 35자 이내)
- `ReviewHighlight` 확장 로직 (Decoration 기반)
- CSS 스타일 (이슈 유형별 색상)

**필요한 수정:**
1. ReviewHighlight 또는 별도 extension에서 sourceExcerpt 검색 지원
2. Source 패널의 useBlockEditor에 해당 extension 추가
3. highlightNonce 동기화 로직

### 제약사항

| 항목 | Source | Target |
|------|--------|--------|
| 구조 | 블록 기반 (여러 에디터) | 전체 문서 (단일 에디터) |
| Extension | useBlockEditor 사용 | TargetTipTapEditor 사용 |
| 동기화 | 각 블록별 독립 처리 필요 | 단일 에디터만 처리 |

---

## 3. 수정 계획

### Phase 1: Target 하이라이트 복구

**수정 파일:**
- `src/hooks/useBlockEditor.ts` - ReviewHighlight 확장 추가
- `src/components/editor/TranslationBlock.tsx` - highlightNonce 감지 로직

**변경 내용:**

```typescript
// useBlockEditor.ts
import { ReviewHighlight } from '@/editor/extensions/ReviewHighlight';

const editor = useEditor({
  extensions: [
    StarterKit.configure({...}),
    ReviewHighlight.configure({ highlightClass: 'review-highlight' }), // 추가
  ],
});
```

```typescript
// TranslationBlock.tsx
const highlightNonce = useReviewStore((s) => s.highlightNonce);

useEffect(() => {
  if (editor && highlightNonce > 0) {
    refreshEditorHighlight(editor);
  }
}, [editor, highlightNonce]);
```

### Phase 2: Source 하이라이트 추가 (선택)

**수정 파일:**
- `src/editor/extensions/ReviewHighlight.ts` - sourceExcerpt 검색 옵션
- 또는 새 extension `ReviewHighlightSource.ts` 생성

**변경 내용:**

```typescript
// ReviewHighlight.ts 수정 또는 새 extension
function createDecorations(doc, issues, highlightClass, field: 'sourceExcerpt' | 'targetExcerpt') {
  issues.forEach((issue) => {
    const searchText = issue[field];
    if (!searchText) return;
    // 기존 로직...
  });
}
```

---

## 4. 검증 방법

1. 검수 실행 후 체크박스 선택
2. Target 에디터에서 해당 텍스트 하이라이트 확인
3. (Phase 2) Source 에디터에서도 원문 구절 하이라이트 확인
4. 하이라이트 토글 on/off 테스트
5. 이슈 유형별 색상 (error=빨강, omission=주황 등) 확인

---

## 5. 관련 파일 목록

| 파일 | 역할 |
|------|------|
| `src/hooks/useBlockEditor.ts` | 블록 에디터 생성 (수정 필요) |
| `src/components/editor/TranslationBlock.tsx` | 블록 컴포넌트 (수정 필요) |
| `src/editor/extensions/ReviewHighlight.ts` | 하이라이트 확장 (작동 중) |
| `src/stores/reviewStore.ts` | 상태 관리 (작동 중) |
| `src/index.css` | 하이라이트 스타일 (작동 중) |

---

## 구현 상태

- [x] Phase 1: Target 하이라이트 복구
  - [x] useBlockEditor.ts 수정 - ReviewHighlight 확장 추가
  - [x] TranslationBlock.tsx 수정 - highlightNonce 감지 및 refreshEditorHighlight 호출
- [ ] Phase 2: Source 하이라이트 추가 (선택)
