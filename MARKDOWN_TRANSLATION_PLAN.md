# Markdown 기반 번역 파이프라인 전환 계획

## 개요

TipTap JSON 직접 번역 대신 **Markdown 중간 형식**을 사용하는 단순하고 효율적인 번역/Review 파이프라인으로 전환합니다.

### 기대 효과
- **토큰 소비 감소**: JSON 구조 오버헤드 제거 (3-4배 절감)
- **청킹 단순화**: 복잡한 노드 분할 → 간단한 문자열 분할
- **LLM 응답 품질 향상**: Markdown은 LLM이 자연스럽게 생성
- **코드 복잡도 감소**: 1000줄+ 계획 → 100줄 이하 구현

---

## 배경

### 현재 방식의 문제점 (TipTap JSON 직접 번역)

```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "안녕하세요" }
  ]
}
```

- JSON 구조 오버헤드로 토큰 소비가 3-4배
- 복잡한 노드 기반 청킹 로직 필요
- LLM이 JSON 구조를 정확히 유지해야 하는 부담
- `response_format: { type: 'json_object' }` 필수

### Markdown 방식의 장점

| 항목 | TipTap JSON | Markdown |
|------|-------------|----------|
| 토큰 효율 | 낮음 (구조 오버헤드) | 높음 (텍스트 중심) |
| 청킹 복잡도 | 높음 (노드 경계 필요) | 낮음 (문자열 분할) |
| LLM 호환성 | JSON mode 필수 | 자연스러운 출력 |
| 디버깅 | 어려움 | 쉬움 (사람이 읽기 좋음) |

---

## 아키텍처

```
[현재 방식]
TipTap JSON ──직접 전송──> LLM ──JSON 응답──> TipTap JSON

[새 방식]
TipTap JSON ──변환──> Markdown ──간결한 텍스트──> LLM
                                                    │
TipTap JSON <──변환── Markdown <──Markdown 응답────┘
```

### 지원 서식 (대부분 Markdown으로 표현 가능, 일부 손실 있음)

| TipTap | Markdown | 현재 지원 |
|--------|----------|-----------|
| Headings (H1-H6) | `# ~ ######` | ✅ |
| Bold | `**bold**` | ✅ |
| Italic | `*italic*` | ✅ |
| Strike | `~~strike~~` | ✅ |
| BulletList (중첩) | `- item` | ✅ |
| OrderedList (중첩) | `1. item` | ✅ |
| Blockquote (중첩) | `> quote` | ✅ |
| CodeBlock | ` ```code``` ` | ✅ |
| Link | `[text](url)` | ✅ |
| HorizontalRule | `---` | ✅ |
| **Table** | `\| a \| b \|` | ❌ → 추가 예정 |

---

## 구현 계획

### 0. TipTap Table Extension 추가 (선행 작업)

현재 에디터에 테이블 지원이 없으므로, 테이블 extension을 먼저 추가합니다.

**패키지 설치**:
```bash
npm install @tiptap/extension-table @tiptap/extension-table-row @tiptap/extension-table-header @tiptap/extension-table-cell
```

**파일 수정**: `src/components/editor/TipTapEditor.tsx`

```typescript
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

// extensions 배열에 추가
extensions: [
  StarterKit,
  Link,
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  // ...기존 extensions
]
```

이제 웹에서 테이블을 복사/붙여넣기하면 에디터에서 테이블로 인식됩니다.

### 1. tiptap-markdown 패키지 설치

```bash
npm install tiptap-markdown
```

### 2. Markdown 변환 유틸리티 생성

**파일**: `src/utils/markdownConverter.ts` (신규)

```typescript
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';

// 공통 extension 구성 (에디터와 동일)
const extensions = [
  StarterKit,
  Link,
  Table.configure({ resizable: false }),  // 헤드리스에서는 리사이즈 불필요
  TableRow,
  TableHeader,
  TableCell,
  Markdown,
];

// TipTap JSON → Markdown 변환
export function tipTapJsonToMarkdown(json: TipTapDocJson): string {
  const editor = new Editor({ extensions, content: json });
  const markdown = editor.storage.markdown.getMarkdown();
  editor.destroy();
  return markdown;
}

// Markdown → TipTap JSON 변환
// ⚠️ setContent 사용으로 Markdown 파싱 보장
export function markdownToTipTapJson(markdown: string): TipTapDocJson {
  const editor = new Editor({ extensions });
  editor.commands.setContent(markdown);  // 명시적 Markdown 파싱
  const json = editor.getJSON() as TipTapDocJson;
  editor.destroy();
  return json;
}
```

### 3. 번역 모듈 수정

**파일**: `src/ai/translateDocument.ts`

변경 사항:
- 입력: TipTap JSON → Markdown 변환 (`tipTapJsonToMarkdown`)
- API 호출: Markdown 텍스트로 전송 (`response_format` 불필요)
- 출력: Markdown 응답 → TipTap JSON 변환 (`markdownToTipTapJson`)
- JSON 구조 설명 프롬프트 제거
- **출력 구분자 적용**: `---TRANSLATION_START/END---` (상세: "리스크 대응 > Medium 4")
- **토큰 추정 수정**: JSON 오버헤드(20%) 제거 (상세: "리스크 대응 > Medium 6")
- **Truncation 감지 수정**: 코드블록 홀수/미완성 리스트 체크 (상세: "리스크 대응 > Medium 6")

### 4. 청킹 로직 단순화 (Context-aware 분할)

**파일**: `src/ai/chunking/` 전체 재작성

복잡한 노드 기반 분할 → **Context-aware Markdown 문자열 분할**:

> ⚠️ 단순 heading/빈 줄 분할은 코드블록/리스트 내부를 끊을 수 있으므로 **Context-aware 분할** 필수
> (상세 구현은 "리스크 분석 및 대응 > High 2" 참조)

```typescript
function splitMarkdownSafely(markdown: string, targetTokens: number): string[] {
  // 1. 코드블록(```) 내부 분할 금지
  // 2. 리스트/blockquote 연속성 유지
  // 3. 안전한 분할점에서만 분할 (Heading 또는 리스트 외부 빈 줄)
  // 4. 오버랩: 이전 청크 마지막 2-3문장 복사 → 병합 시 해시 기반 중복 제거
}
```

### 5. Review 기능 (현재 방식 유지)

**파일**: `src/ai/tools/reviewTool.ts`

> ⚠️ Review는 **Markdown 변환 불필요** - 현재 segment 기반 stripHtml 방식 유지
> (상세 분석은 "리스크 분석 및 대응 > Medium 5" 참조)

- 현재: `project.segments` 기반 청킹 + `stripHtml`로 plain text 추출
- 변경 없음: Review는 plain text 비교이므로 Markdown 변환 오버헤드 불필요

### 6. 정리 및 삭제

- **삭제**: `CHUNKING_STRATEGY_PLAN.md` (더 이상 필요 없음)
- **정리**: 기존 청킹 코드의 복잡한 노드 분할 로직 제거

---

## 예상 효과

| 항목 | 현재 | 변경 후 |
|------|------|---------|
| 토큰 소비 | 높음 (JSON 오버헤드) | 낮음 (텍스트 중심) |
| 청킹 코드 | 5개 파일, 500줄+ | 1-2개 파일, 100줄 이하 |
| LLM 오류율 | JSON 파싱 실패 가능 | Markdown은 자연스럽게 생성 |
| 응답 속도 | 느림 (토큰 많음) | 빠름 |
| 유지보수 | 어려움 | 쉬움 |

---

## 리스크 분석 및 대응

### 🔴 High 1: Markdown 파싱 방식 명확화

**문제**: `content: markdown`으로 생성자에 전달 시 Markdown이 그대로 텍스트로 들어갈 수 있음

**확인 결과**: `tiptap-markdown` 문서에 따르면 Markdown extension이 있으면 **생성자 content에서도 자동 파싱됨**:

```javascript
const editor = new Editor({
    content: "# Welcome\n\nEdit **markdown** content here.",  // ✅ 자동 파싱
    extensions: [StarterKit, Markdown],
});
```

**대응**: 변환 유틸리티 코드에서 명시적으로 `setContent` 사용 권장:

```typescript
export function markdownToTipTapJson(markdown: string): TipTapDocJson {
  const editor = new Editor({ extensions });
  editor.commands.setContent(markdown);  // 명시적 Markdown 파싱
  const json = editor.getJSON() as TipTapDocJson;
  editor.destroy();
  return json;
}
```

---

### 🔴 High 2: 청킹 시 구조 깨짐 방지 (Context-aware 분할)

**문제**: `## Heading` 또는 빈 줄 기반 분할은 코드 블록, 리스트, blockquote 내부를 끊을 수 있음

**대응책 - Context-aware 분할**:

```typescript
function splitMarkdownSafely(markdown: string, targetTokens: number): string[] {
  const lines = markdown.split('\n');
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let inCodeBlock = false;
  let inList = false;
  
  for (const line of lines) {
    // 코드 블록 경계 추적
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }
    
    // 리스트 연속성 추적
    const isListItem = /^(\s*[-*+]|\s*\d+\.)\s/.test(line);
    if (isListItem) inList = true;
    else if (line.trim() === '') inList = false;
    
    // 안전한 분할점: 코드블록/리스트 외부의 빈 줄 또는 Heading
    const isSafeSplitPoint = !inCodeBlock && !inList && 
      (line.trim() === '' || /^#{1,6}\s/.test(line));
    
    // 토큰 목표 도달 + 안전한 분할점
    if (isSafeSplitPoint && estimateTokens(currentChunk) >= targetTokens) {
      chunks.push(currentChunk.join('\n'));
      currentChunk = [];
    }
    
    currentChunk.push(line);
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'));
  }
  
  return chunks;
}
```

**오버랩 병합 전략**:
- 이전 청크 마지막 2-3문장을 다음 청크 시작에 복사
- 병합 시: 텍스트 해시 기반 중복 감지 → 첫 번째 청크 우선

---

### 🟡 Medium 3: 손실 가능 서식 목록

**현재 에디터 구성 분석 (StarterKit + Link + Table)**:

| 서식 | Markdown 표현 | 손실 여부 |
|------|--------------|-----------|
| Headings (H1-H6) | `#` ~ `######` | 없음 |
| Bold/Italic/Strike | `**` `*` `~~` | 없음 |
| BulletList (중첩) | `- ` + 들여쓰기 | 없음 |
| OrderedList (중첩) | `1. ` + 들여쓰기 | 없음 |
| Blockquote (중첩) | `>` `>>` | 없음 |
| CodeBlock | ` ``` ` | 없음 |
| InlineCode | `` ` `` | 없음 |
| Link | `[text](url)` | **target 속성 손실** |
| HardBreak | `\` + 줄바꿈 | 없음 |
| Table | `\| a \| b \|` | 없음 (단순 테이블) |
| Table (colspan/rowspan) | HTML fallback | **손실 가능** |

**커스텀 노드/마크**:
- `ReviewHighlight`: Decoration 기반, 저장되지 않음 → 번역 무관

**결론**: 현재 에디터 구성에서 번역에 영향을 주는 손실은 없음

---

### 🟡 Medium 4: LLM 출력 오염 방지

**문제**: JSON mode 없이 "Here is the translation:" 같은 접두어가 포함될 수 있음

**대응책 - 구분자 및 검증**:

```typescript
const TRANSLATION_PROMPT = `
번역 결과만 출력하세요. 설명, 인사말, 접두어 없이 Markdown 형식으로만 응답하세요.

출력 형식:
---TRANSLATION_START---
[번역된 Markdown]
---TRANSLATION_END---
`;

function extractTranslation(response: string): string {
  const startMarker = '---TRANSLATION_START---';
  const endMarker = '---TRANSLATION_END---';
  
  const startIdx = response.indexOf(startMarker);
  const endIdx = response.indexOf(endMarker);
  
  if (startIdx !== -1 && endIdx !== -1) {
    return response.slice(startIdx + startMarker.length, endIdx).trim();
  }
  
  // Fallback: 구분자 없으면 전체 응답 사용 (경고 로그)
  console.warn('[Translation] No markers found, using raw response');
  return response.trim();
}
```

---

### 🟡 Medium 5: Review 파이프라인 적용 방법

**현재 상태**: Review는 `project.segments` 기반 청킹 사용

```typescript
// reviewTool.ts
buildAlignedChunks(project) → segments 기반 청킹
각 segment: { sourceText, targetText }
```

**대응**: Review는 **segment 단위** Markdown 변환 (전체 문서 변환 X)

```typescript
// 변경 전: HTML strip
const sourceText = seg.sourceIds.map(id => stripHtml(project.blocks[id]?.content)).join('\n');

// 변경 후: Markdown 변환 (필요시)
// Review는 plain text 비교이므로 stripHtml 유지해도 무방
// Markdown 변환은 번역 기능에만 적용
```

**결론**: Review는 현재 방식(stripHtml) 유지, Markdown 변환 불필요

---

### 🟡 Medium 6: 토큰 추정 및 Truncation 로직 수정

**변경 필요 사항**:

1. **토큰 추정 (단순화)**:
```typescript
// 변경 전: JSON 오버헤드 20% 추가
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 3 * 1.2);  // JSON 오버헤드
}

// 변경 후: Markdown은 순수 텍스트
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 3);  // 오버헤드 없음
}
```

2. **Truncation 감지 (Markdown용)**:
```typescript
// 변경 전: JSON 브레이스 매칭
const openBrace = (raw.match(/\{/g) || []).length;

// 변경 후: Markdown 구조 검증
function detectMarkdownTruncation(markdown: string): boolean {
  // 열린 코드 블록 체크
  const codeBlockCount = (markdown.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) return true;
  
  // 미완성 리스트 아이템 체크 (줄 끝에 - 만 있는 경우)
  if (/\n-\s*$/.test(markdown)) return true;
  
  return false;
}
```

---

## 주의사항

1. **attrs 손실**: 링크의 `target="_blank"` 같은 TipTap attrs는 Markdown에서 표현 불가
   - 번역에는 영향 없음 (텍스트 내용만 번역)
   
2. **헤드리스 에디터 성능**: 변환마다 에디터 인스턴스 생성/파괴
   - 필요시 싱글톤 패턴으로 최적화 가능

3. **기존 호환성**: 저장된 TipTap JSON 형식은 그대로 유지
   - 변환은 API 호출 시에만 발생

---

## 구현 순서

1. [ ] TipTap Table extension 설치 및 에디터에 추가
2. [ ] `tiptap-markdown` 패키지 설치
3. [ ] Markdown 변환 유틸리티 생성 (`src/utils/markdownConverter.ts`)
4. [ ] `translateDocument.ts`를 Markdown 파이프라인으로 수정
   - 출력 구분자 적용 (`---TRANSLATION_START/END---`)
   - 토큰 추정 로직 수정 (JSON 오버헤드 제거)
   - Truncation 감지 로직 수정 (Markdown 구조 검증)
5. [ ] 청킹 로직을 Context-aware Markdown 분할로 재작성
   - 코드블록/리스트/blockquote 내부 분할 금지
   - 오버랩 병합 시 텍스트 해시 기반 중복 제거
6. [ ] ~~Review 기능에 Markdown 변환 적용~~ → 현재 방식 유지 (변경 불필요)
7. [ ] `CHUNKING_STRATEGY_PLAN.md` 삭제 및 불필요 코드 정리

---

## 테이블 지원 상세

### Markdown 테이블 문법

```markdown
| 헤더 1 | 헤더 2 | 헤더 3 |
|--------|--------|--------|
| 셀 1   | 셀 2   | 셀 3   |
| 셀 4   | 셀 5   | 셀 6   |
```

### tiptap-markdown 테이블 지원

`tiptap-markdown`은 Table extension이 설치되어 있으면 자동으로 테이블 변환을 지원합니다:
- TipTap Table → Markdown 테이블
- Markdown 테이블 → TipTap Table

**주의**: colspan/rowspan 같은 복잡한 테이블 구조는 HTML로 fallback될 수 있습니다.
