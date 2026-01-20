---
paths: ["src/editor/**/*", "src/components/editor/**/*", "src/components/panels/SourcePanel.tsx", "src/components/panels/TargetPanel.tsx"]
alwaysApply: false
---

# Editor Rules

TipTap/ProseMirror 에디터 작업 시 적용되는 규칙.

## Critical Checklist

- [ ] `markdownConverter.ts`의 `getExtensions()`와 `TipTapEditor.tsx` 확장 동기화
- [ ] 새 확장 추가 시 양쪽 모두 업데이트 (Underline, Highlight, Subscript, Superscript 포함)
- [ ] Cross-node 검색 시 `buildTextWithPositions()` 사용 (단순 `indexOf` 금지)
- [ ] Focus Mode에서도 `sourceDocJson` 접근 가능한지 확인

## Editor Registry

```typescript
import { editorRegistry } from '@/editor/editorRegistry';
const editor = editorRegistry.getTargetEditor();
```

컴포넌트 외부에서 에디터 접근 시 반드시 Registry 사용.

## Supported Formats

**기본 (Markdown 변환 유지)**: Headings, Lists, Bold, Italic, Strike, Code, Blockquote, Link, Table, Image

**에디터 전용 (Markdown 변환 시 손실)**: Underline, Highlight, Subscript, Superscript

## Keyboard Shortcuts

| 단축키 | 동작 | 대상 |
|-------|------|------|
| Cmd+F | 검색 | Source, Target |
| Cmd+H | 치환 | Target만 |

## Common Pitfalls

1. **"no mark type underline in schema"**: `getExtensions()`에 확장 누락
2. **Cross-node 검색 실패**: `buildTextWithPositions()` 미사용
3. **하이라이트 오프셋 불일치**: 문서 변경 후 decoration 재계산 필요
4. **Focus Mode AI 도구 실패**: 프로젝트 로드 시 JSON 초기화 필수
