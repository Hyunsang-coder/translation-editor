# 폰트 설정 기능 구현 계획

> **Status**: Planning
> **Created**: 2025-01-24
> **TRD Reference**: `docs/trd/02-editor.md` § 2.2

## 개요

에디터와 UI의 폰트를 사용자가 선택할 수 있는 기능 구현.

### 목표
- **에디터 폰트**: TipTapMenuBar에서 Source/Target 각각 독립적으로 설정
- **UI 폰트**: AppSettingsModal에서 앱 전체 인터페이스 폰트 설정
- 설정값 영속화 (localStorage)

### 비목표
- 웹폰트 동적 로드 (Google Fonts 등)
- 시스템 폰트 목록 동적 조회
- 에디터와 UI 폰트 동시 변경 UI

---

## 폰트 옵션

| 옵션 | 설명 | CSS 값 |
|------|------|--------|
| `Pretendard` | 기본값, 한/영 최적화 | `'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif` |
| `Noto Sans KR` | Google 오픈소스 한글 폰트 | `'Noto Sans KR', -apple-system, BlinkMacSystemFont, system-ui, sans-serif` |
| `system` | OS 기본 폰트 | `-apple-system, BlinkMacSystemFont, system-ui, sans-serif` |

---

## 수정 대상 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/stores/uiStore.ts` | 폰트 패밀리 상태 및 setter 추가 |
| `src/index.css` | CSS 변수 정의 |
| `src/components/editor/EditorCanvasTipTap.tsx` | 에디터 폰트 CSS 변수 주입 |
| `src/components/editor/TipTapMenuBar.tsx` | 폰트 드롭다운 UI 추가 |
| `src/App.tsx` | UI 폰트 CSS 변수 전역 적용 |
| `src/components/settings/AppSettingsModal.tsx` | UI 폰트 설정 섹션 추가 |
| `src/i18n/locales/ko.json` | i18n 키 추가 |
| `src/i18n/locales/en.json` | i18n 키 추가 |

---

## 구현 세부사항

### 1. uiStore 상태 추가

**파일**: `src/stores/uiStore.ts`

```typescript
// 타입 정의
type FontFamily = 'Pretendard' | 'Noto Sans KR' | 'system';

// 상태 추가
interface UIState {
  // ... 기존 상태
  sourceFontFamily: FontFamily;
  targetFontFamily: FontFamily;
  uiFontFamily: FontFamily;
}

// 액션 추가
interface UIActions {
  // ... 기존 액션
  setSourceFontFamily: (font: FontFamily) => void;
  setTargetFontFamily: (font: FontFamily) => void;
  setUIFontFamily: (font: FontFamily) => void;
}

// 기본값
sourceFontFamily: 'Pretendard',
targetFontFamily: 'Pretendard',
uiFontFamily: 'Pretendard',

// persist partialize에 추가
sourceFontFamily: state.sourceFontFamily,
targetFontFamily: state.targetFontFamily,
uiFontFamily: state.uiFontFamily,
```

### 2. 폰트 패밀리 매핑 유틸리티

**파일**: `src/utils/fontFamily.ts` (신규)

```typescript
export type FontFamily = 'Pretendard' | 'Noto Sans KR' | 'system';

const FALLBACK = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';

export const FONT_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: 'Pretendard', label: 'Pretendard' },
  { value: 'Noto Sans KR', label: 'Noto Sans KR' },
  { value: 'system', label: '시스템 기본' },
];

export function getFontFamilyCSS(font: FontFamily): string {
  switch (font) {
    case 'Pretendard': return `'Pretendard', ${FALLBACK}`;
    case 'Noto Sans KR': return `'Noto Sans KR', ${FALLBACK}`;
    case 'system': return FALLBACK;
  }
}
```

### 3. CSS 변수 정의

**파일**: `src/index.css`

```css
:root {
  --ui-font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}

/* .ProseMirror 수정 */
.ProseMirror {
  font-family: var(--editor-font-family, 'Pretendard'), -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  /* ... 기존 스타일 유지 */
}

/* body에 UI 폰트 적용 */
body {
  font-family: var(--ui-font-family);
}
```

### 4. 에디터 폰트 CSS 변수 주입

**파일**: `src/components/editor/EditorCanvasTipTap.tsx`

```typescript
// Source Panel
<div style={{
  '--editor-font-size': `${sourceFontSize}px`,
  '--editor-line-height': sourceLineHeight,
  '--editor-font-family': getFontFamilyCSS(sourceFontFamily),  // 추가
} as CSSProperties}>

// Target Panel
<div style={{
  '--editor-font-size': `${targetFontSize}px`,
  '--editor-line-height': targetLineHeight,
  '--editor-font-family': getFontFamilyCSS(targetFontFamily),  // 추가
} as CSSProperties}>
```

### 5. TipTapMenuBar 폰트 드롭다운

**파일**: `src/components/editor/TipTapMenuBar.tsx`

기존 헤딩 메뉴 드롭다운 패턴 활용:

```typescript
const [fontMenuOpen, setFontMenuOpen] = useState(false);

// 폰트 메뉴 드롭다운 (폰트 크기 조정 왼쪽에 배치)
<div className="relative">
  <button onClick={() => setFontMenuOpen(!fontMenuOpen)}>
    {currentFontFamily === 'system' ? t('editor.fontSystem') : currentFontFamily}
  </button>
  {fontMenuOpen && (
    <>
      <div className="fixed inset-0" onClick={() => setFontMenuOpen(false)} />
      <div className="absolute top-full left-0 mt-1 ...">
        {FONT_OPTIONS.map(option => (
          <button key={option.value} onClick={() => {
            setFontFamily(option.value);
            setFontMenuOpen(false);
          }}>
            {option.label}
          </button>
        ))}
      </div>
    </>
  )}
</div>
```

### 6. UI 폰트 전역 적용

**파일**: `src/App.tsx`

```typescript
const uiFontFamily = useUIStore((s) => s.uiFontFamily);

useEffect(() => {
  document.documentElement.style.setProperty(
    '--ui-font-family',
    getFontFamilyCSS(uiFontFamily)
  );
}, [uiFontFamily]);
```

### 7. AppSettingsModal UI 폰트 섹션

**파일**: `src/components/settings/AppSettingsModal.tsx`

테마 설정 아래에 추가:

```typescript
{/* UI 폰트 */}
<div className="space-y-2">
  <label className="text-sm font-medium">{t('settings.uiFont')}</label>
  <div className="flex gap-2">
    {FONT_OPTIONS.map(option => (
      <label key={option.value} className="flex items-center gap-2">
        <input
          type="radio"
          name="uiFont"
          value={option.value}
          checked={uiFontFamily === option.value}
          onChange={() => setUIFontFamily(option.value)}
        />
        <span>{option.label}</span>
      </label>
    ))}
  </div>
</div>
```

### 8. i18n 키 추가

**`ko.json`**:
```json
{
  "settings": {
    "uiFont": "UI 폰트",
    "uiFontDescription": "앱 인터페이스에 사용되는 폰트"
  },
  "editor": {
    "font": "폰트",
    "fontSystem": "시스템 기본"
  }
}
```

**`en.json`**:
```json
{
  "settings": {
    "uiFont": "UI Font",
    "uiFontDescription": "Font used for app interface"
  },
  "editor": {
    "font": "Font",
    "fontSystem": "System Default"
  }
}
```

---

## 구현 순서

1. `src/utils/fontFamily.ts` 생성 (타입 + 유틸리티)
2. `src/stores/uiStore.ts` 상태 추가
3. `src/index.css` CSS 변수 수정
4. `src/components/editor/EditorCanvasTipTap.tsx` CSS 변수 주입
5. `src/components/editor/TipTapMenuBar.tsx` 폰트 드롭다운 추가
6. `src/App.tsx` UI 폰트 전역 적용
7. `src/components/settings/AppSettingsModal.tsx` UI 폰트 설정 추가
8. `src/i18n/locales/*.json` i18n 키 추가

---

## 검증 방법

1. **에디터 폰트 테스트**
   - TipTapMenuBar에서 폰트 변경 → Source/Target 에디터 즉시 반영 확인
   - Source와 Target에 다른 폰트 설정 → 각각 독립 적용 확인

2. **UI 폰트 테스트**
   - AppSettingsModal에서 UI 폰트 변경 → 사이드바, 채팅, 버튼 등 반영 확인
   - 에디터는 영향받지 않음 확인

3. **영속성 테스트**
   - 폰트 설정 후 앱 재시작 → 설정 유지 확인

4. **테마 호환성**
   - 다크/라이트 모드에서 각 폰트 렌더링 정상 확인

---

## 향후 확장 가능성

- 웹폰트 동적 로드 (Google Fonts)
- 폰트 크기/줄 높이와 함께 프리셋 저장
- 에디터 폰트 크기 범위 확장 (현재 10-24px)
