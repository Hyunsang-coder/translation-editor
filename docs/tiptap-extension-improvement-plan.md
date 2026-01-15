# TipTap Extension 확장 및 HTML 임포트 개선 계획

> 작성일: 2026-01-13  
> 목적: 웹페이지 HTML 임포트 품질 개선

## 개요

웹페이지에서 복사한 원문의 포맷과 계층 구조를 더 잘 유지하기 위해 TipTap extension을 확장하고, 번역 파이프라인에 이미지 플레이스홀더 및 HTML 정규화 레이어를 추가합니다.

---

## 1. Extension 추가

5개의 TipTap extension을 설치하고 에디터에 적용합니다.

### 패키지 설치

```bash
npm install @tiptap/extension-underline @tiptap/extension-highlight @tiptap/extension-subscript @tiptap/extension-superscript @tiptap/extension-image
```

### Extension 역할

| Extension | HTML 태그 | Markdown 호환 | 용도 |
|-----------|----------|--------------|------|
| `@tiptap/extension-image` | `<img>` | ✅ `![alt](src)` | 이미지 표시 |
| `@tiptap/extension-underline` | `<u>` | ❌ | 에디터 표시용 |
| `@tiptap/extension-highlight` | `<mark>` | ❌ | 에디터 표시용 |
| `@tiptap/extension-subscript` | `<sub>` | ❌ | 에디터 표시용 |
| `@tiptap/extension-superscript` | `<sup>` | ❌ | 에디터 표시용 |

### 수정 파일

- `src/components/editor/TipTapEditor.tsx` - 3개 에디터 컴포넌트에 5개 extension 추가
- `src/utils/markdownConverter.ts` - Image extension만 추가 (Markdown 호환)
- `src/utils/tipTapText.ts` - Table(4개) + Image extension 추가 (현재 Table 누락 버그 수정 포함)

---

## 2. 이미지 플레이스홀더 로직

번역 요청 시 이미지 URL(특히 Base64)을 플레이스홀더로 대체하여 토큰을 절약하고, 번역 완료 시 복원합니다.

### 새 파일: `src/utils/imagePlaceholder.ts`

```typescript
/**
 * 이미지 플레이스홀더 유틸리티
 * 번역 시 이미지 URL을 플레이스홀더로 대체하여 토큰 절약
 */

/**
 * 번역 전: 이미지 URL → 플레이스홀더
 * Base64 이미지는 수만 자가 될 수 있으므로 반드시 대체 필요
 */
export function extractImages(markdown: string): {
  sanitized: string;
  imageMap: Map<string, string>;
};

/**
 * 번역 후: 플레이스홀더 → 원본 URL 복원
 */
export function restoreImages(
  markdown: string, 
  imageMap: Map<string, string>
): string;
```

### 수정 파일: `src/ai/translateDocument.ts`

- `tipTapJsonToMarkdown()` 후 `extractImages()` 호출
- `markdownToTipTapJson()` 전 `restoreImages()` 호출

### 데이터 흐름

```
TipTap JSON 
    ↓
Markdown (이미지 URL 포함)
    ↓
extractImages() → Sanitized MD + imageMap
    ↓
LLM Translation (토큰 절약)
    ↓
Translated MD
    ↓
restoreImages() → Complete MD
    ↓
TipTap JSON
```

---

## 3. HTML 정규화 유틸리티

웹페이지에서 복사한 HTML을 TipTap 호환 시맨틱 HTML로 정규화합니다.

### 새 파일: `src/utils/htmlNormalizer.ts`

주요 기능:

1. **DOMPurify로 위험 요소 제거** (이미 설치됨)
2. **허용 태그 화이트리스트 적용**
   - `p`, `br`, `h1-h6`, `strong`, `b`, `em`, `i`, `u`, `s`, `del`, `mark`
   - `sub`, `sup`, `a`, `ul`, `ol`, `li`, `blockquote`, `pre`, `code`, `hr`
   - `table`, `tr`, `th`, `td`, `img`
3. **인라인 스타일 → 시맨틱 태그 변환**
   - `font-weight: bold` → `<strong>`
   - `font-style: italic` → `<em>`
   - `text-decoration: underline` → `<u>`
4. **구조 정리**
   - `<div>` → `<p>` 변환
   - 불필요한 `<span>` 제거 (내용만 추출)

### 호출 위치 (선택적)

- Source 에디터에 콘텐츠 붙여넣기 시
- 외부 HTML 파일 로드 시

---

## 4. 수정 파일 요약

| 파일 | 변경 내용 |
|------|----------|
| `package.json` | 5개 extension 의존성 추가 |
| `src/components/editor/TipTapEditor.tsx` | 모든 에디터에 extension 등록 |
| `src/utils/markdownConverter.ts` | Image extension 추가 |
| `src/utils/tipTapText.ts` | Table(4개) + Image extension 추가 |
| `src/ai/translateDocument.ts` | 이미지 플레이스홀더 적용 |
| **신규** `src/utils/imagePlaceholder.ts` | 이미지 추출/복원 유틸리티 |
| **신규** `src/utils/htmlNormalizer.ts` | HTML 정규화 유틸리티 |

---

## 5. 구현 우선순위 (TODO)

### Phase 1: Extension 기반 작업
- [ ] 5개 TipTap extension 패키지 설치
- [ ] TipTapEditor.tsx에 5개 extension 추가 (3개 에디터 컴포넌트)
- [ ] tipTapText.ts - Table(4개) + Image extension 추가 (기존 Table 누락 버그 수정)
- [ ] markdownConverter.ts에 Image extension 추가

### Phase 2: 이미지 플레이스홀더 시스템
- [ ] imagePlaceholder.ts 유틸리티 생성
- [ ] translateDocument.ts에 이미지 플레이스홀더 로직 통합

### Phase 3: HTML 정규화 (선택적)
- [x] htmlNormalizer.ts 유틸리티 생성
- [x] Source 에디터 붙여넣기 핸들러 연동
- [x] Target 에디터 붙여넣기 핸들러 연동
- [x] Confluence 테이블 헤더 중복 제거

---

## 6. 주의사항

1. **markdownConverter.ts의 `html: false` 설정 유지**
   - Underline, Highlight 등은 Markdown 표준 문법이 없음
   - 에디터 표시용으로만 사용, 번역 시 손실 허용 (의도된 동작)

2. **Image extension만 Markdown과 호환**
   - `![alt](src)` 형식으로 변환됨
   - 번역 파이프라인에 포함 가능

3. **Base64 이미지 처리 필수**
   - Base64 이미지는 수만 자가 될 수 있어 토큰 낭비 심함
   - 반드시 플레이스홀더로 대체 후 번역

4. **tipTapText.ts의 기존 Table 누락 버그**
   - 현재 Table extension이 누락되어 테이블 포함 문서에서 텍스트 추출 시 오류 가능
   - Phase 1에서 Table(4개) + Image extension 함께 추가하여 해결

5. **이미지 URL 라운드트립 무결성**
   - Markdown 변환 과정에서 특수문자 포함 URL(괄호, 공백, 유니코드)이 깨질 수 있음
   - imagePlaceholder.ts 구현 시 URL 인코딩/디코딩 처리 필요

---

## 7. 검토 결과 요약

### `@tiptap/html` 라이브러리 도입 여부

- **결론**: 도입 불필요
- **이유**: 현재 `setContent(html)`도 내부적으로 동일한 ProseMirror DOMParser 사용
- **핵심**: Extension 추가가 실질적인 개선 효과

### Extension별 Markdown 호환성

| Extension | Markdown 문법 | 번역 시 동작 |
|-----------|--------------|-------------|
| Image | `![alt](src)` | ✅ 보존 (플레이스홀더 적용) |
| Underline | 없음 | ❌ 손실 (에디터만) |
| Highlight | 없음 | ❌ 손실 (에디터만) |
| Subscript | 없음 | ❌ 손실 (에디터만) |
| Superscript | 없음 | ❌ 손실 (에디터만) |

---

## 8. 토큰 절약 예상치

| 이미지 유형 | 원본 크기 | 플레이스홀더 | 절약률 |
|------------|----------|-------------|--------|
| Base64 10KB | ~3,300 토큰 | 1-2 토큰 | 99.9% |
| Base64 50KB | ~16,500 토큰 | 1-2 토큰 | 99.99% |
| URL 200자 | ~67 토큰 | 1-2 토큰 | 97% |

> 이미지 10개 포함 문서 기준: Base64 시 최대 165,000 토큰 → 20 토큰으로 감소
