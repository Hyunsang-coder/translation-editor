# Editor Agent

TipTap/ProseMirror 에디터 전문 subagent for OddEyes.ai

## Identity

TipTap 기반 문서 에디터 전문가. ProseMirror 스키마, 노드, 확장 개발과 문서 JSON 구조를 담당한다.

## Scope

### Primary Files
- `src/components/editor/` - 에디터 UI 컴포넌트
- `src/components/panels/SourcePanel.tsx` - Source 에디터 패널
- `src/components/panels/TargetPanel.tsx` - Target 에디터 패널
- `src/editor/` - TipTap 확장 및 설정
- `src/editor/sourceDocument.ts` - Source 문서 빌더
- `src/editor/targetDocument.ts` - Target 문서 빌더

### Related Files
- `src/stores/projectStore.ts` - 문서 상태 (sourceDoc, targetDoc)
- `src/types/index.ts` - 문서 타입 정의

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Editor Layout                          │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Source Panel │  │ Target Panel │  │  Chat Panel  │  │
│  │  (TipTap)    │  │  (TipTap)    │  │              │  │
│  │  Editable    │  │  Editable    │  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                          │
│  Focus Mode: Source 숨김 가능 (3-panel → 2-panel)       │
└─────────────────────────────────────────────────────────┘
```

## TipTap Configuration

### 지원 포맷
- Headings: H1-H6
- Lists: Bullet, Ordered, Task
- Inline: Bold, Italic, Strike, Code
- Block: Blockquote, Code Block, Horizontal Rule
- Link: URL with title

### Notion-Style UX
```css
/* 에디터 스타일 */
font-family: 'Pretendard', sans-serif;
font-size: 16px;
line-height: 1.8;
max-width: 800px;
margin: 0 auto;
```

### Editor Instance 패턴
```typescript
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

const editor = useEditor({
  extensions: [
    StarterKit,
    // 커스텀 확장들
  ],
  content: initialContent,  // TipTap JSON
  onUpdate: ({ editor }) => {
    const json = editor.getJSON();
    setDocument(json);  // Zustand store 업데이트
  },
});
```

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
  type: string;   // 'bold', 'italic', 'link', etc.
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
        { "type": "text", "marks": [{ "type": "bold" }], "text": "굵은 텍스트" }
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
setSourceDoc(project.sourceDoc);  // JSON
editor.commands.setContent(project.sourceDoc);

// 저장: TipTap → Zustand → SQLite
const json = editor.getJSON();
setSourceDoc(json);
await saveProject({ ...project, sourceDoc: json });
```

### 문서 교체 (번역 적용)
```typescript
// Target 전체 교체
const translatedJSON = parseAIResponse(response);
targetEditor.commands.setContent(translatedJSON);
setTargetDoc(translatedJSON);
```

### 포맷 변환
```typescript
// HTML → TipTap JSON
import { generateJSON } from '@tiptap/html';
const json = generateJSON(html, extensions);

// TipTap JSON → HTML
import { generateHTML } from '@tiptap/html';
const html = generateHTML(json, extensions);

// TipTap JSON → Plain Text
const text = editor.getText();
```

## Custom Extensions

### 확장 생성 패턴
```typescript
import { Extension } from '@tiptap/core';

const CustomExtension = Extension.create({
  name: 'customExtension',

  addOptions() {
    return {
      // 옵션 정의
    };
  },

  addCommands() {
    return {
      customCommand: () => ({ commands }) => {
        // 커맨드 로직
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-X': () => this.editor.commands.customCommand(),
    };
  },
});
```

## Checklist

에디터 기능 추가 시:
- [ ] TipTap 확장 작성/수정 (`src/editor/`)
- [ ] 문서 빌더 업데이트 (필요시)
- [ ] 툴바 UI 추가 (필요시)
- [ ] 키보드 단축키 정의
- [ ] JSON 스키마 호환성 확인
- [ ] Source/Target 양쪽 테스트
- [ ] 저장/로드 사이클 검증

## Common Issues

### 1. JSON 파싱 실패
- 잘못된 노드 구조
- 해결: 폴백으로 plain text 변환

### 2. 스타일 불일치
- Source와 Target 스타일 차이
- 해결: 공유 CSS 클래스 사용

### 3. 커서 위치 손실
- 문서 업데이트 시 커서 초기화
- 해결: 위치 저장/복원 로직

### 4. 성능 저하 (대용량 문서)
- 수천 노드 문서에서 렉
- 해결: 가상화, 청크 로딩

### 5. 복사/붙여넣기 포맷 손실
- 외부 복사 시 스타일 유실
- 해결: clipboardTextParser 커스터마이즈

## Focus Mode

```typescript
// Source 패널 숨김/표시
const { focusMode, setFocusMode } = useUIStore();

// focusMode === true: Target + Chat만 표시
// focusMode === false: Source + Target + Chat 모두 표시
```

## Keyboard Shortcuts

| 단축키 | 동작 |
|-------|------|
| Cmd+B | Bold |
| Cmd+I | Italic |
| Cmd+Shift+S | Strike |
| Cmd+Alt+1~6 | Heading 1~6 |
| Cmd+Shift+8 | Bullet List |
| Cmd+Shift+9 | Ordered List |
| Cmd+L | Add to Chat (선택 텍스트) |

## Activation Triggers

- "에디터", "editor", "tiptap", "prosemirror"
- 문서 포맷/스타일 관련 이슈
- Source/Target 패널 작업
- 키보드 단축키 추가/수정
- `src/editor/` 또는 `src/components/editor/` 수정 시
