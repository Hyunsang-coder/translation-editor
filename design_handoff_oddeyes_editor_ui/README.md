# Handoff: OddEyes.ai 에디터 UI 개선 (Phase 1–4)

## Overview

OddEyes.ai(Tauri + React 번역 에디터)의 메인 에디터 화면 UI를 개선한다. 두 가지 문제를 푼다.

1. **숨겨진 기능** — 채팅 / 히스토리 / 내보내기 / 설정이 상단 우측 앱 아이콘 뒤 드롭다운(`Toolbar.tsx`)에 숨어 있고, 선택 영역 액션(부분 재번역 / 채팅에 추가 / 코멘트 / 복사)은 **우클릭으로만** 접근 가능하다.
2. **주요 액션의 낮은 시각적 위계** — 번역 / 검수 / 폴리싱이 `EditorCanvasTipTap` 헤더의 12px 세그먼트 컨트롤 하나에 뭉쳐 있어, 이 앱의 핵심 워크플로가 화면에서 가장 눈에 안 띄는 요소가 되어 있다.

이 문서는 **Phase 1–4**를 다룬다. 데이터 모델·스토어·백엔드 변경이 없고, 기존 컴포넌트의 마크업 재배치와 파생 상태 계산만으로 구현 가능한 범위다.

> **Phase 4.5 (정렬 검사 뷰)는 별도 문서 `PHASE_4_5_alignment_view.md` 에 있다.** 디자인 파일의 `2a` 화면이며, Phase 1–4를 마친 뒤 진행한다. 약 1.5주, 스키마 변경 없음.
>
> **Phase 5(영속 세그먼트 정렬)는 이 문서의 범위가 아니다.** 디자인 파일의 `1c` 화면에 포함되어 있지만 데이터 모델·`.ite` 스키마 변경이 필요하다. §Phase 5 섹션에 범위와 판단 근거만 기록해 둔다. **Phase 4.5를 먼저 하고, 그 결과 데이터로 Phase 5 착수 여부를 결정할 것을 권장한다.** 디자인 파일의 `1c` 화면에는 포함되어 있지만, 에디터 렌더링 구조를 바꿔야 하므로 별도 스펙이 필요하다. 이 문서의 §Phase 5 섹션에 범위만 기록해 둔다.

## 중요: "코드 변경 없음"이 아니다

정확한 범위는 다음과 같다.

| Phase | 내용 | 성격 |
|---|---|---|
| 1 | 디자인 토큰 추가 | `index.css` 변수 3개 추가. 순수 CSS |
| 2 | 상단 툴바 재구성 | **JSX 재배치.** 기존 핸들러를 그대로 옮겨 붙임. 새 상태 없음 |
| 3 | 워크플로 스테퍼 + 상태 스트립 | **새 컴포넌트 1개.** 기존 스토어에서 파생만 함. 새 스토어/필드 없음 |
| 4 | 인라인 선택 툴바 + 인스펙터 | **기존 컴포넌트 재조립.** 새 상태 1개(`selectionToolbar` 위치), 나머지는 기존 스토어 필터링 |

즉 **비즈니스 로직·IPC·SQLite 스키마·Zustand 스토어 형태는 건드리지 않는다.** 하지만 컴포넌트 코드는 당연히 바뀐다.

## About the Design Files

번들에 포함된 HTML은 **디자인 레퍼런스**다. 프로덕션 코드가 아니며 복사해서 쓰는 것이 아니다. 의도한 레이아웃·색·타이포·상태를 픽셀 단위로 보여주는 정적 시안이다.

작업은 **이 시안을 대상 코드베이스(React 18 + TypeScript + TailwindCSS + Zustand + TipTap)의 기존 패턴으로 재현**하는 것이다. Tailwind 유틸리티와 `tailwind.config.js`의 `editor-*` / `primary-*` 컬러 토큰을 사용하고, 아이콘은 이미 의존성에 있는 `lucide-react`를 쓴다. 시안의 인라인 스타일을 그대로 옮기지 말 것.

## Fidelity

**High-fidelity.** 최종 색상·타이포·간격·상태가 확정된 시안이다. 픽셀 단위로 재현하되, 값은 Tailwind 클래스와 CSS 변수로 표현한다.

시안 파일에는 3개 화면이 있다.

- `1a` — **현재 UI의 재현.** 코드에서 읽은 값 그대로. 비교 기준일 뿐, 구현 대상이 아니다.
- `1b` — **보수적 개선.** 기존 골격 유지. Phase 1–2, 4의 인라인 선택 툴바가 여기 있다.
- `1c` — **목표 상태.** Phase 3의 워크플로 스테퍼, Phase 4의 인스펙터, Phase 5의 세그먼트 정렬 뷰가 여기 있다. **컬러는 1c 기준을 따른다** (앱 기존 sky 계열).
- `2a` — **Phase 4.5 정렬 검사 뷰.** 읽기 전용 대조 테이블. 상세 스펙은 `PHASE_4_5_alignment_view.md`.

구현 시 **레이아웃은 1b, 컬러/타이포는 1c** 를 따른다. 1b의 붉은 액센트(#ec3013)는 디자인 시스템 원본 색이며 **사용하지 않는다.**

---

## Design Tokens

### Colors — 기존 값 그대로 사용

`src/index.css`의 `:root`에 이미 정의되어 있다. 새로 만들지 말 것.

| 토큰 | 값 (light) | 용도 |
|---|---|---|
| `--editor-bg` | `#ffffff` | 에디터 본문 바탕 |
| `--editor-surface` | `#f8fafc` | 툴바 / 패널 바탕 |
| `--editor-border` | `#e2e8f0` | 구분선 |
| `--editor-text` | `#1e293b` | 본문 |
| `--editor-muted` | `#64748b` | 보조 텍스트 |
| `--primary-500` | `#0284c7` | **주 액센트.** 기본 액션, 활성 상태 |
| `--primary-600` | `#0369a1` | hover / pressed, 틴트 위 텍스트 |
| `--primary-400` | `#0ea5e9` | 아이콘 강조 |

### Colors — 신규 추가 (Phase 1)

`src/index.css`의 `:root`와 `.dark`에 추가한다. 라이트 모드만 우선 적용해도 된다(사용자 결정: 라이트 전용).

```css
:root {
  /* 세그먼트/이슈 상태 — sky 계열 파생 */
  --accent-tint:      #f0f9ff;  /* sky-50  : 선택된 행/카드 바탕 */
  --accent-highlight: #e0f2fe;  /* sky-100 : 본문 내 하이라이트 */
  --accent-deep:      #075985;  /* sky-800 : 틴트 위 본문 텍스트 (대비 확보) */
}
```

Tailwind에서 쓰려면 `tailwind.config.js`의 `theme.extend.colors`에 추가한다.

```js
accent: {
  tint:      'var(--accent-tint)',
  highlight: 'var(--accent-highlight)',
  deep:      'var(--accent-deep)',
},
```

> **주의**: 시안의 붉은색(`#ec3013`, `#ae1800`, `#fff2ef`, `#ffe0d9`)은 1b 화면에만 남아 있는 디자인 시스템 원색이다. 구현에는 위 sky 토큰을 쓴다.

### 심각도 색 — 기존 값 유지

`ReviewResultsTable.tsx`의 `getSeverityColor` / `getIssueTypeColor`가 이미 정의한 값을 그대로 쓴다. 변경하지 않는다.

| 심각도 | 텍스트 | 배경 |
|---|---|---|
| critical (심각) | `text-red-600` | `bg-red-500/10` |
| major (중요) | `text-orange-600` | `bg-orange-500/10` |
| minor (경미) | `text-blue-500` | `bg-blue-500/10` |

### Typography

폰트는 `tailwind.config.js`의 `font-sans` (Pretendard) 그대로. Archivo는 시안 전용이며 **앱에 도입하지 않는다.**

| 역할 | 크기 / 굵기 | Tailwind |
|---|---|---|
| 상단 바 프로젝트 제목 | 14px / 800 | `text-sm font-extrabold` |
| 상단 바 액션 라벨 | 14px / 700 | `text-sm font-bold` |
| 툴바 보조 버튼 라벨 | 13px / 600 | `text-[13px] font-semibold` |
| 섹션 캡션 (원문·EN 등) | 12px / 800, `tracking-[.12em] uppercase` | `text-xs font-extrabold tracking-[.12em] uppercase` |
| 상태 스트립 | 12px / 400·600 | `text-xs` |
| 메타 / 타임스탬프 | 11px / 400 | `text-[11px]` |
| 배지·태그 | 10px / 700 | `text-[10px] font-bold` |
| 단축키 칩 | 11px / 400 | `text-[11px]` |
| 에디터 본문 | `var(--editor-font-size)` (기본 14px) / 1.4 | 변경 없음 |

**최소 크기 규칙**: 어떤 인터랙티브 요소의 라벨도 11px 미만으로 내리지 않는다. 현재 `Toolbar.tsx`의 줌 인디케이터가 `text-[10px]`를 쓰고 있는데, 11px로 올린다.

### Spacing / Radius / Elevation

- 간격: Tailwind 기본 스케일 (`gap-1` … `gap-5`). 시안의 px 값은 4px 배수로 반올림한다.
- 라운드: **기존 앱 값 유지** (`rounded-md` = 6px, `rounded-lg` = 8px). 시안의 0px 라운드는 디자인 시스템 특성이며 앱에 적용하지 않는다.
- 그림자: 기존 `shadow-lg` 유지. 드롭다운/팝오버에만 사용.
- 구분선: 기존 `border-editor-border` 1px 유지. 시안의 2px 룰은 적용하지 않는다.

---

## Phase 1 — 토큰 추가

**파일**: `src/index.css`, `tailwind.config.js`

위 §Design Tokens의 신규 3개 변수 추가. 그 외 변경 없음. 이 단계만으로는 화면 변화가 없다.

**완료 기준**: `npm run lint` 통과, 기존 화면 시각적 변화 없음.

---

## Phase 2 — 상단 툴바 재구성

**파일**: `src/components/layout/Toolbar.tsx`, `src/components/editor/EditorCanvasTipTap.tsx`

### 2-1. Tools 드롭다운 해체

**현재** (`Toolbar.tsx` 우측): `<img src="/app-icon-64.png" class="w-6 h-6" />` + `▼` 버튼 하나. 클릭 시 `w-48` 드롭다운에 AI 채팅 / 히스토리 / 내보내기 / 설정 4개 메뉴.

**변경**: 드롭다운을 제거하고 4개를 아이콘 + 라벨 버튼으로 상단 바 우측에 나열한다.

| 버튼 | 아이콘 (lucide-react) | 라벨 | 기존 핸들러 |
|---|---|---|---|
| 코멘트 | `NotebookPen` 16 | `코멘트 {commentCount}` | `openCommentsPanel()` — 현재 `EditorCanvasTipTap` 헤더에 있음. 여기로 이동 |
| AI 채팅 | `MessageSquare` 16 | `AI 채팅` | `handleChat` (기존) |
| 히스토리 | `Clock3` 16 | `히스토리` | `handleHistory` (기존) |
| 내보내기 | `Download` 16 | `내보내기` | `handleExport` (기존) |
| 설정 | `Settings` 17 | (아이콘만) | `handleProjectSettings` (기존) |

- 각 버튼: `h-[34px] px-[11px] flex items-center gap-[7px] rounded-md text-[13px] font-semibold text-editor-text hover:bg-editor-border transition-colors`
- `disabled={!project}` 는 그대로 유지.
- 설정 앞에 `w-px h-[22px] bg-editor-border mx-1.5` 구분선.
- 코멘트 카운트는 `useCommentStore((s) => s.comments.length)` — 이미 `EditorCanvasTipTap`에 있는 구독을 `Toolbar`로 옮긴다.
- `dropdownOpen` state, `dropdownRef`, 외부 클릭/ESC useEffect **전부 삭제**.
- `data-testid`는 유지한다: `toolbar-menu-chat`, `toolbar-menu-export`, `toolbar-menu-settings`. (E2E 스펙이 참조 중 — `e2e/user-story.spec.ts` 등)

### 2-2. 워크플로 액션을 툴바로 승격

**현재**: `EditorCanvasTipTap.tsx` 헤더의 `inline-flex ... rounded-md border` 세그먼트 컨트롤 (번역 / 검수 / 폴리싱, 각 `px-2.5 py-1 text-xs`).

**변경**: 세그먼트 컨트롤을 해체해 `Toolbar.tsx` 좌측·중앙 영역으로 옮기고 크기를 키운다. 상태와 핸들러(`handleTranslateClick`, `openReviewPanel`, `handlePolishClick`)는 `EditorCanvasTipTap`에 남아 있으므로, **`uiStore`에 액션 트리거를 두거나** 워크플로 버튼 그룹을 별도 컴포넌트로 뽑아 두 곳에서 쓸 수 있게 한다.

> 권장: `src/components/layout/WorkflowActions.tsx` 를 새로 만들고, 기존 핸들러를 `EditorCanvasTipTap`에서 그대로 옮긴다. 번역/폴리싱 모달 상태(`retranslateModalOpen`, `polishModalOpen`)도 함께 이동한다. 검수는 이미 `uiStore.openReviewPanel()` + `reviewStore.reviewTrigger` 패턴이라 그대로 쓴다.

레이아웃 (좌 → 우):

```
[번역 실행]  —  [검수 (5)]  —  [폴리싱]   |   [모델 셀렉트]
  primary        secondary    secondary        h-[38px]
```

- **번역 실행**: `h-[38px] px-4 bg-primary-500 text-white text-sm font-bold flex items-center gap-2 rounded-md hover:bg-primary-600`
  - 아이콘 `Sparkles` 17
  - 라벨 `문서 번역`
  - 우측에 단축키 칩: `text-[11px] px-1.5 py-0.5 bg-white/20 rounded`, 내용 `⌘T`
  - 로딩 시 기존 스피너 마크업 유지, 라벨 `번역 중…`
- **검수**: `h-[38px] px-3.5 border border-editor-border rounded-md text-sm font-bold flex items-center gap-2 hover:bg-editor-surface`
  - 아이콘 `ClipboardCheck` 16
  - 미해결 이슈가 있으면 카운트 배지: `min-w-[18px] h-[18px] px-1.5 bg-primary-500 text-white text-[11px] font-bold rounded-sm inline-flex items-center justify-center` — `useReviewStore((s) => s.getAllIssues().length)`
  - 단축키 칩 `⌘R` — `text-[11px] px-1.5 py-0.5 bg-editor-border/60 text-editor-muted rounded`
- **폴리싱**: 검수와 동일 스타일. 아이콘 `Highlighter` 16, 단축키 `⌘P`, `disabled={!hasTargetContent}`
- 버튼 사이에 `w-4 h-0.5 bg-editor-border` 연결선 — 세 액션이 순서 있는 워크플로임을 드러낸다.
- **모델 셀렉트**: 기존 `<Select size="sm">` 를 `h-[38px]`로 키우고 2행 라벨로 바꾼다. 위: `AI 모델` (`text-[10px] uppercase tracking-[.1em] text-editor-muted`), 아래: 모델명 (`text-[13px] font-semibold`). `Select.tsx`에 `size="lg"` 변형을 추가하거나, 이 자리만 커스텀 트리거로 감싼다.

### 2-3. 단축키 등록

현재 `⌘T` / `⌘R` / `⌘P` 는 **바인딩되어 있지 않다.** 칩에 표시했으면 실제로 동작해야 한다.

`MainLayout.tsx`의 기존 `Ctrl+Shift+D` 핸들러 옆에 같은 패턴으로 추가한다. TipTap 에디터가 포커스를 가진 상태에서도 동작해야 하므로 `document` 레벨에 등록하고 `e.preventDefault()` 한다.

**완료 기준**: 드롭다운 없이 모든 도구에 1클릭 접근. 기존 E2E(`test:e2e:web`) 통과 — `toolbar-menu-*` testid가 유지되어야 한다.

---

## Phase 3 — 워크플로 스테퍼 + 상태 스트립

**신규 파일**: `src/components/layout/WorkflowStepper.tsx`, `src/components/layout/StatusStrip.tsx`

### 3-1. 워크플로 스테퍼

`Toolbar` 아래(또는 `Toolbar` 내부 중앙)에 5단계 스테퍼를 둔다. **모든 상태는 기존 스토어에서 파생한다. 새 필드를 만들지 않는다.**

| 단계 | 라벨 | 완료 판정 | 보조 텍스트 |
|---|---|---|---|
| 1 | 원문 준비 | `stripHtml(sourceDocument).trim().length > 0` | `{n} 세그먼트` — `project.segments.length` |
| 2 | 번역 | `stripHtml(targetDocument).trim().length > 0` | `{model} · {time}` — 마지막 자동 스냅샷 설명에서 파싱, 또는 `historyStore` 최신 스냅샷 `createdAt` |
| 3 | 검수 | `reviewStore.results.length > 0 && !isReviewing` | 진행 중이면 `청크 {completed}/{total}` + 진행 바 |
| 4 | 폴리싱 | 자동 스냅샷 설명에 폴리싱 항목 존재 | `검수 후 진행` |
| 5 | 내보내기 | (항상 미완료) | `DOCX · PDF` |

시각 사양:

- 각 단계: `flex items-center gap-2.5 px-[22px]`
- 완료: 원형 아님 — `w-[22px] h-[22px] bg-editor-text text-white flex items-center justify-center` + `Check` 아이콘 13px
- 진행 중: `w-[22px] h-[22px] bg-primary-500 text-white` + 단계 번호. 컨테이너에 `bg-accent-tint border-2 border-primary-500 h-[52px]`
- 미시작: `w-[22px] h-[22px] border-2 border-editor-border` + 번호, 부모에 `opacity-45`
- 라벨 `text-[13px] font-extrabold`, 보조 `text-[11px] text-editor-muted`
- 단계 사이 연결선: `w-[34px] h-0.5 bg-editor-border`
- 진행 바: `w-24 h-[5px] bg-editor-border` 위에 `bg-primary-500` 채움

### 3-2. "다음 액션" 버튼

스테퍼 우측 끝에 **현재 상태에서 해야 할 일 하나**만 큰 버튼으로 노출한다. 파생 상태에 대한 `switch` 하나로 결정한다.

| 조건 | 라벨 | 보조 | 액션 |
|---|---|---|---|
| 원문 없음 | `원문 붙여넣기` | `Cmd+V 또는 파일 열기` | source 에디터 포커스 |
| 번역문 없음 | `문서 번역하기` | `{model}` | `handleTranslateClick()` |
| 검수 미실행 | `검수 시작하기` | `{n} 세그먼트` | `openReviewPanel()` + `reviewStore.triggerReview()` |
| 미해결 이슈 있음 | `이슈 {n}건 검토하기` | `심각 {n}건 포함` | `openReviewPanel()` |
| 이슈 없음 | `폴리싱하기` | `원어민 관점으로 다듬기` | `handlePolishClick()` |

`h-[44px] px-5 bg-primary-500 text-white`, 2행 라벨(`text-[15px] font-extrabold` + `text-[11px] opacity-85`), 좌측 아이콘 18px. **라벨은 좌측 정렬.**

### 3-3. 상태 스트립

스테퍼가 무겁다면 대안으로, 또는 함께: `h-[30px] bg-editor-surface border-b border-editor-border` 한 줄에 아래를 `gap-5`로 나열한다 (`text-xs text-editor-muted`).

- 진행 상태 + 진행 바 + 경과 시간 — `reviewStore.progress`, 기존 `elapsedSeconds` 로직을 스토어로 올려서 공유
- `모든 변경사항 저장됨 · {HH:mm}` — `projectStore.lastSavedAt`. `isDirty`면 `저장 중…`
- `자동 스냅샷 {n}분 전 ({설명})` — `historyStore` 최신 스냅샷
- 우측 정렬: `원문 {n} 단어 · 번역문 {n} 단어` — 기존 `countTotalWords` 결과를 그대로 올림. **이 값들은 현재 각 패널 헤더에 있는데, 스트립으로 옮기면 패널 헤더가 가벼워진다.**

**완료 기준**: 새 Zustand 필드 0개. `WorkflowStepper`는 순수 파생 컴포넌트여야 한다.

---

## Phase 4 — 인라인 선택 툴바 + 인스펙터

### 4-1. 인라인 선택 툴바

**파일**: `src/components/editor/EditorCanvasTipTap.tsx`, `src/components/ui/SelectionActionMenu.tsx`

**현재**: `attachSelectionWatcher`가 `contextmenu` 이벤트에만 반응해 `SelectionActionMenu`를 띄운다. 즉 **우클릭해야만 부분 재번역 / 채팅에 추가 / 코멘트 기능의 존재를 알 수 있다.**

**변경**: `selectionUpdate`에서 선택 범위가 비어있지 않으면 선택 영역 **위쪽에 자동으로** 툴바를 띄운다. 우클릭 메뉴는 그대로 남긴다(제거하지 않는다).

- 위치: `editor.view.coordsAtPos(from)` 으로 선택 시작 좌표를 얻고, 툴바 높이 + 8px 만큼 위에 배치. 화면 상단을 넘으면 선택 아래로 뒤집는다. 기존 `openSelectionActionMenuAt`의 클램프 로직을 재사용한다.
- 기존 `zoom: 1 / editorZoom` 보정을 그대로 적용한다.
- 선택이 사라지거나 에디터가 blur되면 숨긴다 (기존 `onSelection` / `onBlur` 핸들러 재사용).
- **디바운스 150ms** — 드래그 중에 툴바가 따라다니지 않게 한다.

시각 사양 (수평 바, 항목 사이 `border-l border-editor-border`):

| 항목 | 아이콘 | 라벨 | 조건 |
|---|---|---|---|
| 부분 재번역 | `Sparkles` 14 | `부분 재번역` | `field === 'target'` 일 때만 |
| 채팅에 추가 | `MessageSquare` 14 | `채팅에 추가` + `⌘L` | 항상 |
| 코멘트 | `NotebookPen` 14 | `코멘트` | 항상 |
| 복사 | `Copy` 14 | `복사` | 항상 |

- 컨테이너: `border border-editor-text bg-editor-surface shadow-lg` (라운드 없음 — 이 요소만 예외적으로 `rounded-md` 사용해도 무방, 앱 일관성 우선)
- 첫 항목(부분 재번역)만 `bg-primary-500 text-white`, 나머지는 `text-editor-text`
- 각 항목 `h-[34px] px-3 gap-1.5 text-xs font-semibold`

### 4-2. 검수 패널 → 카드 리스트

**파일**: `src/components/review/ReviewResultsTable.tsx`

**현재**: 250px 사이드바 안에 3열 `table-fixed` (컬럼 리사이즈 핸들 포함). 좁은 폭에서 텍스트가 뭉개진다.

**변경**: 테이블을 카드 리스트로 교체한다. 컬럼 리사이즈 로직(`colPct`, `handleResizeStart`, 관련 useEffect)은 전부 제거된다.

카드 하나 (`p-3.5 border-b border-editor-border border-l-[3px]`):

```
[✓] [심각 · 오역]  문단 3 · 무기 밸런스        ← 체크박스 + 배지 + 위치
초탄 4발 구간의 수직 반동이                    ← 취소선, text-editor-muted
첫 4발 구간의 수직 반동이                      ← font-bold text-accent-deep
원문 "first four shots"은 …                    ← text-xs text-editor-muted
[적용] [본문에서 보기] [무시]                  ← h-7 액션
```

- 선택된 카드: `bg-accent-tint border-l-primary-500`. 미선택: `border-l-transparent`
- 배지: `px-1.5 py-0.5 text-[10px] font-bold` — 심각도별 색은 §Design Tokens의 기존 값
- **`본문에서 보기`는 신규 액션**: `issue.targetExcerpt`를 타겟 에디터에서 찾아 스크롤·하이라이트한다. `scrollIntoView`를 쓰지 말고 `editor.commands.setTextSelection` + `editor.commands.focus()` 로 처리한다. 기존 `applySuggestionToEditor`의 텍스트 탐색 로직(`reviewApply.ts`)을 재사용한다.
- 기존 `onApply` / `onCopy` / `onDelete` / `onToggleCheck` 시그니처는 그대로 유지.
- 사이드바 폭 하한을 `LAYOUT.SIDEBAR_MIN` 200 → **280**으로 올린다 (`src/constants/layout.ts`).

### 4-3. 세그먼트 인스펙터 (선택)

**신규 파일**: `src/components/panels/SegmentInspector.tsx`

현재 커서가 놓인 세그먼트의 모든 맥락을 한 패널에 모은다. **새 데이터 소스가 없다** — 전부 기존 스토어를 `segmentGroupId`로 필터링한 것이다.

| 블록 | 데이터 출처 |
|---|---|
| 이슈 | `reviewStore.getAllIssues().filter(i => i.segmentGroupId === active)` |
| 용어 | `resolveGlossaryEntries({ projectId, text: segmentText, domain, limit: 12 })` — `utils/glossaryInject.ts` |
| 코멘트 | `commentStore.comments.filter(c => c.segmentGroupId === active)` |
| 버전 기록 | `historyStore` 스냅샷 설명 |

`activeSegmentGroupId`는 `EditorCanvasTipTap`의 기존 `segmentGroupId` 추출 로직(`resolved.node(depth).attrs?.segmentGroupId`)을 `selectionUpdate`에 붙여 얻는다. `uiStore`에 필드 하나 추가하는 것이 가장 단순하다.

하단에 `이슈 {i} / {n}` + `이전` / `다음 이슈 →` 내비게이션. 이게 검수 워크플로의 실제 진입점이 된다.

**완료 기준**: 우클릭 없이 선택 액션 4종 접근 가능. 검수 이슈가 250px에서 잘리지 않음.

---

## Phase 4.5 — 정렬 검사 뷰

→ **`PHASE_4_5_alignment_view.md`** 참조. 시안 `2a`. 약 1.5주, 스키마 변경 0.

정렬을 저장하지 않고 뷰를 열 때마다 계산하는 **읽기 전용 대조 테이블**이다. Phase 5의 1단계를 미리 만들어 두는 작업이며 버려지지 않는다.

---

## Phase 5 — 영속 세그먼트 정렬 (범위 밖)

시안 `1c`의 중앙 영역. 편집 가능한 세그먼트 정렬 테이블.

**착수 전 경고 — 정렬 기반이 없다.** 근거는 `PHASE_4_5_alignment_view.md` §0에 정리되어 있다. 요약:

- `projectStore.addSegment()`는 **호출부가 한 군데도 없다.** `project.segments`는 프로젝트 생성 시 기본 2개에서 늘어나지 않는다.
- `materializeBlocksFromDocuments`는 문자 오프셋으로 역투영하며 길이 차이를 마지막 블록에 몰아준다. 편집 후 블록 경계는 신뢰할 수 없다.
- `translationUnitId`는 원문/번역문에서 독립 발급되고, `reattachTranslationUnitIds`는 노드 토폴로지가 완전 일치할 때만 동작한다.

따라서 Phase 5의 작업량은 UI가 아니라 **정렬 레이어 신설**이다.

1. 영속 정렬 링크 — `.ite`(SQLite) 스키마 변경 + 기존 파일 마이그레이션
2. 정렬 유지 로직 — ProseMirror `Step` 매핑 기반. 분할/병합/삽입/삭제/이동에서 링크 보존. `SelectionAnchor` 익스텐션이 단일 선택에 대해 하는 일과 같은 성격이며 참고 대상
3. 깨진 정렬의 UX — 1:N, N:1, 수동 분할/병합
4. 성능 — 편집 중인 행만 TipTap 마운트, 가상 스크롤

예상 4~6주. 최대 리스크는 `.ite` 마이그레이션 — 기존 프로젝트에는 정렬 정보가 없어 휴리스틱 추정이 필요하고, 추정이 틀리면 사용자에게 잘못된 짝을 보여준다.

**Phase 4.5의 `정렬 리포트` JSONL이 이 판단의 근거다.** 여러 프로젝트에서 `ratio`가 0.95 이상으로 유지되면 Phase 5는 불필요하다. 0.7 근처면 착수 가치가 있다.

구현하게 된다면 반드시 지킬 것:

1. **행마다 TipTap 인스턴스를 만들지 말 것.** 편집 중인 행 하나만 마운트한다.
2. **`문서 보기` 토글을 유지할 것.** 긴 산문에서는 2분할이 여전히 낫다. 정렬 뷰를 기본값으로 강제하지 않는다.

---

## Interactions & Behavior

- **hover**: 모든 인터랙티브 요소는 `hover:bg-editor-border` 또는 `hover:bg-editor-surface`. 기본 액션은 `hover:bg-primary-600`.
- **focus**: `focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2`. 브라우저 기본 파란 링을 남기지 않는다.
- **disabled**: 기존 패턴 유지 — `disabled:opacity-50 disabled:cursor-not-allowed`.
- **transition**: `transition-colors` (기본 150ms). 새 애니메이션을 추가하지 않는다.
- **로딩**: 번역/폴리싱 진행 중에는 해당 버튼에 기존 스피너 마크업(`w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin`)을 유지하고, 진행률은 상태 스트립에서 보여준다.
- **선택 툴바 표시 지연**: 150ms 디바운스. 드래그 종료 후에만 나타난다.

## State Management

새로 추가되는 상태는 다음 2개뿐이다.

| 상태 | 위치 | 타입 | 용도 |
|---|---|---|---|
| `selectionToolbar` | `EditorCanvasTipTap` 로컬 | `{ top, left, field, from, to } \| null` | 인라인 선택 툴바 위치 |
| `activeSegmentGroupId` | `uiStore` | `string \| null` | 인스펙터가 보여줄 세그먼트 |

나머지는 전부 기존 스토어(`projectStore`, `reviewStore`, `commentStore`, `historyStore`, `uiStore`, `aiConfigStore`)에서 파생한다.

## Assets

- `assets/app-icon-64.png` — 앱 아이콘. 레포의 `public/app-icon-64.png` 원본을 그대로 복사한 것이다. 별도 작업 불필요.
- 아이콘은 전부 `lucide-react`. 사용 목록: `Sparkles`, `ClipboardCheck`, `Highlighter`, `MessageSquare`, `NotebookPen`, `Clock3`, `Download`, `Settings`, `Copy`, `Check`, `Search`, `PanelLeft`, `PanelLeftOpen`, `PanelRightOpen`, `ChevronDown`, `ChevronUp`. 새로 그리지 말 것.

## Files

### 이 번들

| 파일 | 내용 |
|---|---|
| `PHASE_4_5_alignment_view.md` | Phase 4.5 상세 구현 스펙 |
| `OddEyes UI 개선.dc.html` | 4개 화면 시안 (1a 현재 / 1b 보수적 / 1c 목표 / 2a 정렬 검사). 브라우저에서 바로 열림 |
| `support.js` | 시안 렌더링 런타임. 함께 있어야 시안이 열린다 |
| `assets/app-icon-64.png` | 앱 아이콘 |
| `_ds/` | 시안이 참조하는 스타일시트. **앱에 도입하지 않는다** |

### 수정 대상 (레포)

| 파일 | Phase |
|---|---|
| `src/index.css` | 1 |
| `tailwind.config.js` | 1 |
| `src/components/layout/Toolbar.tsx` | 2 |
| `src/components/layout/WorkflowActions.tsx` *(신규)* | 2 |
| `src/components/ui/Select.tsx` | 2 (`size="lg"` 추가) |
| `src/components/layout/MainLayout.tsx` | 2 (단축키), 3 (스테퍼 마운트) |
| `src/components/layout/WorkflowStepper.tsx` *(신규)* | 3 |
| `src/components/layout/StatusStrip.tsx` *(신규)* | 3 |
| `src/components/editor/EditorCanvasTipTap.tsx` | 2 (액션 이관), 4 (선택 툴바) |
| `src/components/ui/SelectionActionMenu.tsx` | 4 |
| `src/components/review/ReviewResultsTable.tsx` | 4 |
| `src/components/review/reviewApply.ts` | 4 (`본문에서 보기` 탐색 재사용) |
| `src/components/panels/SegmentInspector.tsx` *(신규)* | 4 |
| `src/constants/layout.ts` | 4 (`SIDEBAR_MIN` 280) |
| `src/stores/uiStore.ts` | 4 (`activeSegmentGroupId`) |

### 참고 (읽기만)

`src/components/panels/UnifiedSidebar.tsx`, `src/components/layout/ProjectSidebar.tsx`, `src/components/review/ReviewPanel.tsx`, `src/editor/extensions/TranslationUnitId.ts`, `src/i18n/locales/ko.json`

## 검증

각 Phase 완료 시:

```bash
npm run lint          # 0 경고
npm run test:run      # 유닛/컴포넌트/스토어
npm run test:e2e:web  # Playwright 웹 E2E
```

특히 다음 테스트가 툴바/검수 UI를 직접 참조하므로 함께 확인한다.

- `e2e/user-story.spec.ts`, `e2e/project-sidebar-new.spec.ts`
- `src/components/review/ReviewPanel.test.tsx`, `ReviewResultsTable.test.tsx`
- `src/components/ui/SelectionActionMenu.test.tsx`

`data-testid`는 **하나도 제거하지 않는다.** 요소를 옮기더라도 testid는 따라간다.

## 문구

UI 언어는 한국어. 모든 문자열은 `src/i18n/locales/ko.json` / `en.json` 에 넣는다. 기존 키를 최대한 재사용한다 — `editor.translate`(번역), `editor.review`(검수), `review.polish`(폴리싱), `toolbar.aiChat`(AI 채팅), `history.title`, `export.title`, `comment.title`(코멘트) 등이 이미 있다.

신규 키가 필요한 곳: 워크플로 스테퍼 단계명, 다음 액션 버튼 라벨 5종, 상태 스트립 문구, 선택 툴바 항목, `본문에서 보기`.
