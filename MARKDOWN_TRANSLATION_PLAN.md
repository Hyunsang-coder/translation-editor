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

### 지원 서식 (모두 Markdown으로 표현 가능)

| TipTap | Markdown |
|--------|----------|
| Headings (H1-H6) | `# ~ ######` |
| Bold | `**bold**` |
| Italic | `*italic*` |
| Strike | `~~strike~~` |
| BulletList | `- item` |
| OrderedList | `1. item` |
| Blockquote | `> quote` |
| CodeBlock | ` ```code``` ` |
| Link | `[text](url)` |
| HorizontalRule | `---` |

---

## 구현 계획

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
import { Markdown } from 'tiptap-markdown';

// 헤드리스 에디터로 변환
export function tipTapJsonToMarkdown(json: TipTapDocJson): string {
  const editor = new Editor({
    extensions: [StarterKit, Link, Markdown],
    content: json,
  });
  const markdown = editor.storage.markdown.getMarkdown();
  editor.destroy();
  return markdown;
}

export function markdownToTipTapJson(markdown: string): TipTapDocJson {
  const editor = new Editor({
    extensions: [StarterKit, Link, Markdown],
    content: markdown,
  });
  const json = editor.getJSON() as TipTapDocJson;
  editor.destroy();
  return json;
}
```

### 3. 번역 모듈 수정

**파일**: `src/ai/translateDocument.ts`

변경 사항:
- 입력: TipTap JSON → Markdown 변환
- API 호출: Markdown 텍스트로 전송 (`response_format` 불필요)
- 출력: Markdown 응답 → TipTap JSON 변환
- JSON 구조 설명 프롬프트 제거

### 4. 청킹 로직 단순화

**파일**: `src/ai/chunking/` 전체 재작성

복잡한 노드 기반 분할 → 간단한 Markdown 문자열 분할:

```typescript
// 단순한 청킹: heading 또는 빈 줄 기준 분할
function splitMarkdownIntoChunks(markdown: string, targetTokens: number): string[] {
  // 1. ## Heading 또는 빈 줄(\n\n)에서 분할 시도
  // 2. 토큰 목표에 맞게 청크 병합/분할
  // 3. 오버랩: 이전 청크 마지막 1-2문장 복사
}
```

### 5. Review 기능 적용

**파일**: `src/ai/tools/reviewTool.ts` (또는 관련 파일)

동일한 Markdown 변환 파이프라인 적용

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

## 주의사항

1. **attrs 손실**: 링크의 `target="_blank"` 같은 TipTap attrs는 Markdown에서 표현 불가
   - 번역에는 영향 없음 (텍스트 내용만 번역)
   
2. **헤드리스 에디터 성능**: 변환마다 에디터 인스턴스 생성/파괴
   - 필요시 싱글톤 패턴으로 최적화 가능

3. **기존 호환성**: 저장된 TipTap JSON 형식은 그대로 유지
   - 변환은 API 호출 시에만 발생

---

## 구현 순서

1. [ ] `tiptap-markdown` 패키지 설치
2. [ ] Markdown 변환 유틸리티 생성 (`src/utils/markdownConverter.ts`)
3. [ ] `translateDocument.ts`를 Markdown 파이프라인으로 수정
4. [ ] 청킹 로직을 Markdown 문자열 기반으로 단순화
5. [ ] Review 기능에 Markdown 변환 적용
6. [ ] `CHUNKING_STRATEGY_PLAN.md` 삭제 및 불필요 코드 정리
