# Editor Agent

TipTap/ProseMirror 에디터 전문 subagent for OddEyes.ai

> **TRD 기준**: 2.1, 3.9 | **최종 업데이트**: 2025-01

## Identity

TipTap 기반 문서 에디터 전문가. ProseMirror 스키마, 노드, 확장 개발, 문서 JSON 구조, Markdown 변환, 검색/치환, 하이라이트를 담당한다.

## Scope

### Primary Files
- `src/components/editor/` - 에디터 UI 컴포넌트
  - `TipTapEditor.tsx` - 에디터 인스턴스
  - `SearchBar.tsx` - 검색/치환 UI
- `src/components/panels/SourcePanel.tsx` - Source 에디터 패널
- `src/components/panels/TargetPanel.tsx` - Target 에디터 패널
- `src/editor/` - TipTap 확장 및 설정
  - `extensions/SearchHighlight.ts` - 검색/치환 확장
  - `extensions/ReviewHighlight.ts` - 검수 하이라이트 확장
  - `editorRegistry.ts` - 에디터 인스턴스 레지스트리

### Related Files
- `src/stores/projectStore.ts` - 문서 상태 (sourceDoc, targetDoc, sourceDocJson, targetDocJson)
- `src/stores/reviewStore.ts` - 검수 상태 (하이라이트 연동)
- `src/utils/markdownConverter.ts` - TipTap ↔ Markdown 변환
- `src/types/index.ts` - 문서 타입 정의

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Editor Layout                          │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Source Panel │  │ Target Panel │  │Settings/Chat │  │
│  │  (TipTap)    │  │  (TipTap)    │  │   Sidebar    │  │
│  │  Editable    │  │  Editable    │  │              │  │
│  │              │  │              │  │              │  │
│  │  Cmd+F 검색  │  │  Cmd+F 검색  │  │              │  │
│  │              │  │  Cmd+H 치환  │  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                          │
│  Focus Mode: Source 숨김 가능 (3-panel → 2-panel)       │
└─────────────────────────────────────────────────────────┘
```

## TipTap Configuration

### 지원 포맷 (TRD 2.1)

**기본 포맷**:
- Headings: H1-H6
- Lists: Bullet, Ordered (중첩 지원)
- Inline: Bold, Italic, Strike, Code
- Block: Blockquote (중첩 지원), Code Block, Horizontal Rule
- Link: URL with target 속성
- Table: 기본 테이블 (colspan/rowspan은 손실 가능)
- Image: Base64 또는 URL
- Placeholder

**에디터 전용 포맷** (Markdown 변환 시 손실):
- Underline
- Highlight
- Subscript
- Superscript

### Notion-Style UX
```css
/* 에디터 스타일 */
font-family: 'Pretendard', sans-serif;
font-size: 16px;
line-height: 1.8;
max-width: 800px;
padding: 24px;
margin: 0 auto;
```

### Editor Instance 패턴
```typescript
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { SearchHighlight } from '@/editor/extensions/SearchHighlight';
import { ReviewHighlight } from '@/editor/extensions/ReviewHighlight';

const editor = useEditor({
  extensions: [
    StarterKit,
    Underline,
    Highlight,
    Subscript,
    Superscript,
    SearchHighlight,
    ReviewHighlight,
    // ...
  ],
  content: initialContent,  // TipTap JSON
  onUpdate: ({ editor }) => {
    const json = editor.getJSON();
    setDocumentJson(json);  // Zustand store 업데이트
  },
});
```

## Editor Registry (editorRegistry.ts)

에디터 인스턴스에 컴포넌트 외부에서 접근하기 위한 글로벌 레지스트리:

```typescript
// src/editor/editorRegistry.ts

let sourceEditor: Editor | null = null;
let targetEditor: Editor | null = null;

export const editorRegistry = {
  setSourceEditor: (editor: Editor | null) => { sourceEditor = editor; },
  setTargetEditor: (editor: Editor | null) => { targetEditor = editor; },
  getSourceEditor: () => sourceEditor,
  getTargetEditor: () => targetEditor,
};
```

**사용 예시** (ReviewPanel에서 수정 적용):
```typescript
import { editorRegistry } from '@/editor/editorRegistry';

const handleApply = () => {
  const editor = editorRegistry.getTargetEditor();
  if (!editor) return;

  editor.commands.setSearchTerm(searchText);
  editor.commands.replaceMatch(suggestedFix);
};
```

## 검색/치환 기능 (TRD 2.1)

### SearchHighlight Extension

```typescript
// src/editor/extensions/SearchHighlight.ts

const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addCommands() {
    return {
      setSearchTerm: (term: string) => ({ ... }),
      clearSearch: () => ({ ... }),
      nextMatch: () => ({ ... }),
      prevMatch: () => ({ ... }),
      replaceMatch: (replacement: string) => ({ ... }),
      replaceAll: (replacement: string) => ({ ... }),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-f': () => this.editor.commands.openSearch(),
      'Mod-h': () => this.editor.commands.openReplace(),  // Target만
    };
  },
});
```

### 검색 UI (SearchBar.tsx)

| 단축키 | 동작 | 대상 |
|-------|------|------|
| `Cmd+F` | 검색 열기 | Source, Target |
| `Cmd+H` | 치환 열기 | Target만 (원문 보호) |
| `Enter` | 다음 매치 | - |
| `Shift+Enter` | 이전 매치 | - |
| `Esc` | 검색 닫기 | - |

### 크로스 노드 검색

TipTap 노드 경계를 넘는 텍스트 검색을 위한 패턴:

```typescript
// buildTextWithPositions()로 전체 텍스트/위치 매핑 구축
function buildTextWithPositions(doc: Node): Array<{ text: string; from: number; to: number }> {
  const result: Array<{ text: string; from: number; to: number }> = [];

  doc.descendants((node, pos) => {
    if (node.isText) {
      result.push({
        text: node.text || '',
        from: pos,
        to: pos + node.nodeSize,
      });
    }
    return true;
  });

  return result;
}

// 전체 텍스트에서 검색 후 위치 매핑
const textMap = buildTextWithPositions(editor.state.doc);
const fullText = textMap.map(t => t.text).join('');
const matchIndex = fullText.indexOf(searchTerm);
// ... 위치 변환 로직
```

## 검수 하이라이트 (TRD 3.9)

### ReviewHighlight Extension

```typescript
// src/editor/extensions/ReviewHighlight.ts

const ReviewHighlight = Extension.create({
  name: 'reviewHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const { highlightEnabled, getCheckedIssues } = useReviewStore.getState();
            if (!highlightEnabled) return DecorationSet.empty;

            const issues = getCheckedIssues();
            // Decoration 생성 로직
          },
        },
      }),
    ];
  },
});
```

### 하이라이트 매칭 전략

1. **segmentGroupId 우선**: 세그먼트 내에서 targetExcerpt 검색
2. **전체 문서 검색**: 1단계 실패 시 전체 문서에서 substring 검색
3. **매칭 실패 처리**: 패널에 "매칭 실패" 표시 (에러 아님)

### 마크다운 정규화

AI 응답의 excerpt에 포함된 마크다운 서식 제거:

```typescript
// src/utils/normalizeForSearch.ts

function normalizeForSearch(text: string): string {
  return text
    // 인라인 서식 제거
    .replace(/\*\*(.+?)\*\*/g, '$1')  // bold
    .replace(/\*(.+?)\*/g, '$1')      // italic
    .replace(/~~(.+?)~~/g, '$1')      // strike
    .replace(/`(.+?)`/g, '$1')        // code
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // link
    // 블록 마커 제거
    .replace(/^#+\s*/gm, '')          // heading
    .replace(/^[-*]\s*/gm, '')        // list
    .replace(/^\d+\.\s*/gm, '')       // ordered list
    // 공백 정규화
    .replace(/\s+/g, ' ')
    .trim();
}
```

## 포맷 변환 (markdownConverter.ts)

### TipTap ↔ Markdown 변환

```typescript
// src/utils/markdownConverter.ts

// TipTap JSON → Markdown
export function tipTapJsonToMarkdown(json: TipTapDocument): string {
  const editor = createTempEditor(json);
  return editor.storage.markdown.getMarkdown();
}

// Markdown → TipTap JSON
export function markdownToTipTapJson(markdown: string): TipTapDocument {
  const editor = createTempEditor();
  editor.commands.setContent(markdown);
  return editor.getJSON();
}

// HTML → TipTap JSON (프로젝트 로드 시)
export function htmlToTipTapJson(html: string): TipTapDocument {
  return generateJSON(html, getExtensions());
}
```

**중요**: `getExtensions()`는 TipTapEditor.tsx와 동일한 확장 목록을 포함해야 함 (Underline, Highlight, Subscript, Superscript 포함)

### 변환 시 손실 항목

| 항목 | TipTap → Markdown | Markdown → TipTap |
|------|-------------------|-------------------|
| Underline | ❌ 손실 | - |
| Highlight | ❌ 손실 | - |
| Subscript | ❌ 손실 | - |
| Superscript | ❌ 손실 | - |
| 링크 target 속성 | ❌ 손실 | - |
| 복잡한 테이블 | ⚠️ 일부 손실 | - |

## Document JSON Structure

### TipTap JSON 형식
```typescript
interface TipTapDocument {
  type: 'doc';
  content: TipTapNode[];
}

interface TipTapNode {
  type: string;           // 'paragraph', 'heading', 'bulletList', etc.
  attrs?: Record<string, any>;
  content?: TipTapNode[];
  marks?: TipTapMark[];
  text?: string;
}

interface TipTapMark {
  type: string;   // 'bold', 'italic', 'link', 'underline', etc.
  attrs?: Record<string, any>;
}
```

### 예시 문서
```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1 },
      "content": [{ "type": "text", "text": "제목" }]
    },
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "일반 텍스트와 " },
        { "type": "text", "marks": [{ "type": "bold" }], "text": "굵은 텍스트" },
        { "type": "text", "marks": [{ "type": "underline" }], "text": "밑줄 텍스트" }
      ]
    }
  ]
}
```

## Core Patterns

### 문서 로드/저장
```typescript
// 로드: SQLite → Zustand → TipTap
const project = await loadProject(id);
setSourceDocJson(htmlToTipTapJson(project.sourceDoc));  // JSON 초기화
editor.commands.setContent(project.sourceDoc);

// 저장: TipTap → Zustand → SQLite
const json = editor.getJSON();
setSourceDocJson(json);
await saveProject({ ...project, sourceDoc: generateHTML(json, extensions) });
```

### 문서 교체 (번역 적용)
```typescript
// Target 전체 교체
const translatedJSON = markdownToTipTapJson(translatedMarkdown);
targetEditor.commands.setContent(translatedJSON);
setTargetDocJson(translatedJSON);
```

### 수정 제안 적용 (검수)
```typescript
// ReviewPanel에서 적용 버튼 클릭 시
const editor = editorRegistry.getTargetEditor();
if (!editor) return;

// 마크다운 서식 제거 후 검색
const searchText = normalizeForSearch(targetExcerpt);
editor.commands.setSearchTerm(searchText);

// 첫 매치 교체
editor.commands.replaceMatch(suggestedFix);

// 이슈 삭제
deleteIssue(issueId);
```

## Keyboard Shortcuts

| 단축키 | 동작 | 대상 |
|-------|------|------|
| Cmd+B | Bold | 공통 |
| Cmd+I | Italic | 공통 |
| Cmd+U | Underline | 공통 |
| Cmd+Shift+S | Strike | 공통 |
| Cmd+Alt+1~6 | Heading 1~6 | 공통 |
| Cmd+Shift+8 | Bullet List | 공통 |
| Cmd+Shift+9 | Ordered List | 공통 |
| Cmd+F | 검색 | 공통 |
| Cmd+H | 치환 | Target만 |
| Cmd+L | Add to Chat | 선택 텍스트 |

## Focus Mode

```typescript
// Source 패널 숨김/표시
const { focusMode, setFocusMode } = useUIStore();

// focusMode === true: Target + Chat만 표시
// focusMode === false: Source + Target + Chat 모두 표시
```

**주의**: Focus Mode에서도 `sourceDocJson`은 프로젝트 로드 시 초기화되어 AI 도구에서 접근 가능

## Checklist

에디터 기능 추가 시:
- [ ] TipTap 확장 작성/수정 (`src/editor/extensions/`)
- [ ] markdownConverter.ts의 getExtensions()에 확장 추가
- [ ] 툴바 UI 추가 (필요시)
- [ ] 키보드 단축키 정의
- [ ] JSON 스키마 호환성 확인
- [ ] Source/Target 양쪽 테스트
- [ ] Focus Mode에서 테스트
- [ ] 저장/로드 사이클 검증
- [ ] Markdown 변환 손실 여부 확인

## Common Issues

### 1. JSON 파싱 실패
- 잘못된 노드 구조 또는 스키마 불일치
- 해결: markdownConverter.ts와 TipTapEditor.tsx 확장 목록 동기화

### 2. "no mark type underline in schema" 에러
- markdownConverter.ts에 Underline 확장 누락
- 해결: getExtensions()에 모든 확장 포함

### 3. 스타일 불일치
- Source와 Target 스타일 차이
- 해결: 공유 CSS 클래스 사용

### 4. 커서 위치 손실
- 문서 업데이트 시 커서 초기화
- 해결: 위치 저장/복원 로직

### 5. 성능 저하 (대용량 문서)
- 수천 노드 문서에서 렉
- 해결: 가상화, 청크 로딩

### 6. 크로스 노드 검색 실패
- 단순 indexOf로 노드 경계 텍스트 찾지 못함
- 해결: buildTextWithPositions() 사용

### 7. 검수 하이라이트 오프셋 불일치
- 문서 변경 후 하이라이트 위치 틀림
- 해결: Cross-store subscribe로 문서 변경 시 하이라이트 비활성화

### 8. 붙여넣기 시 포맷 손상
- 외부 HTML 복사 시 불필요한 태그 포함
- 해결: 붙여넣기 시점 정규화 (TRD 2.1)

## Activation Triggers

- "에디터", "editor", "tiptap", "prosemirror"
- 문서 포맷/스타일 관련 이슈
- 검색/치환 기능
- 하이라이트 관련 이슈
- Markdown 변환 관련 이슈
- Source/Target 패널 작업
- 키보드 단축키 추가/수정
- `src/editor/` 또는 `src/components/editor/` 수정 시
