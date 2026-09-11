import type { Node as PMNode } from '@tiptap/pm/model';
/**
 * 교체문 인라인 마크 파서 — 부분 폴리싱/재번역이 bold·italic·code를 살리는 용도.
 *
 * 모델은 교체문 안에 `**굵게**`, `*기울임*`, `` `코드` ``를 그대로 살려 보내고,
 * 적용 단계에서 이 파서가 텍스트+mark 스팬으로 나눈다. 순수 함수라 프리뷰·적용이
 * 같은 결과를 본다.
 *
 * 문법(의도적으로 작게):
 * - `**text**` → bold, `*text*` → italic, `` `text` `` → code
 * - 굵게↔기울임 한 단계 중첩 허용. 코드 스팬 안은 전부 리터럴.
 * - `_` 미지원(snake_case 오탐 방지), `***` 미지원(리터럴).
 * - 짝이 없거나 내용이 비면 리터럴 — `****`가 빈 교체를 만들어 원문을 지우는
 *   사고를 막는다.
 */
export type InlineMarkKind = 'bold' | 'italic' | 'code';

/** 직렬화 방출 순서 — 바깥(bold)부터. 파서가 읽을 수 있는 중첩만 만든다. */
const EMIT_ORDER: InlineMarkKind[] = ['bold', 'italic'];

/** 여는 기호. code는 스팬 단위로 따로 처리한다. */
function openerFor(kind: InlineMarkKind): string {
  return kind === 'bold' ? '**' : kind === 'italic' ? '*' : '`';
}

export interface InlineSpan {
  text: string;
  marks: InlineMarkKind[];
}

interface ParseResult {
  spans: InlineSpan[];
  /** 닫는 기호를 만나 끝났으면 true — false면 연 기호는 리터럴로 되돌린다. */
  closed: boolean;
}

function mergeAdjacent(spans: InlineSpan[]): InlineSpan[] {
  const merged: InlineSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.marks.length === span.marks.length &&
      last.marks.every((mark, index) => mark === span.marks[index])
    ) {
      last.text += span.text;
    } else {
      merged.push({ text: span.text, marks: [...span.marks] });
    }
  }
  return merged;
}

/**
 * stopCloser를 만날 때까지 파싱한다. stopCloser가 null이면 최상위(끝까지)다.
 * closer 후보(`**`, `` ` ``, `*`)를 만나면:
 * - stopCloser와 같으면 closed:true로 복귀(열기 쪽이 스팬 확정).
 * - 다르면 중첩(Color) 시작으로 재귀 — 닫히지 않으면 리터럴로 흘린다.
 */
function parseUntil(
  input: string,
  pos: number,
  stopCloser: '**' | '*' | '`' | null,
  activeMarks: InlineMarkKind[],
): { result: ParseResult; pos: number } {
  const spans: InlineSpan[] = [];
  let literal = '';

  const flush = (): void => {
    if (literal) {
      spans.push({ text: literal, marks: [...activeMarks] });
      literal = '';
    }
  };

  while (pos < input.length) {
    const char = input[pos]!;
    if (char === '`' || char === '*') {
      const isBacktick = char === '`';
      const isDoubleStar =
        !isBacktick && input[pos + 1] === '*' && input[pos + 2] !== '*';
      const isTripleStar =
        !isBacktick && input[pos + 1] === '*' && input[pos + 2] === '*';
      const closer: '**' | '*' | '`' = isBacktick ? '`' : isDoubleStar ? '**' : '*';

      if (isTripleStar && stopCloser === '*') {
        // `*…***` — 첫 별로 italic을 닫고 `**`는 상위에서 처리한다.
        // (`**굵은 *기울임***`의 끝처럼 기울임이 굵게 닫기 직전에 끝날 때)
        flush();
        return { result: { spans, closed: true }, pos: pos + 1 };
      }
      if (isTripleStar && stopCloser !== '**') {
        // `***`는 지원 밖 — 리터럴 3자로 흘린다.
        // 단, bold 안에서 만난 `***…`(`****` 닫기+열기 경계 포함)는
        // 앞 2자로 닫고 나머지를 계속 파싱한다.
        literal += '***';
        pos += 3;
        continue;
      }
      if (stopCloser === '**' && input[pos + 1] === '*') {
        flush();
        return { result: { spans, closed: true }, pos: pos + 2 };
      }
      // 단일 `*` 뒤에 `*`가 오는 경우는 위에서 걸리므로 여기 오면 안 된다.
      // (방어: 그대로 리터럴)
      if (!isBacktick && !isDoubleStar && input[pos + 1] === '*') {
        literal += char;
        pos += 1;
        continue;
      }

      if (stopCloser !== null && closer === stopCloser) {
        flush();
        return { result: { spans, closed: true }, pos: pos + closer.length };
      }

      if (isBacktick) {
        const end = input.indexOf('`', pos + 1);
        if (end === -1) {
          literal += '`';
          pos += 1;
        } else if (end === pos + 1) {
          literal += '``';
          pos += 2;
        } else {
          flush();
          spans.push({ text: input.slice(pos + 1, end), marks: [...activeMarks, 'code'] });
          pos = end + 1;
        }
        continue;
      }

      // `**`/`*` 열기 시도 — 안 닫히면 리터럴.
      const mark: InlineMarkKind = closer === '**' ? 'bold' : 'italic';
      const inner = parseUntil(input, pos + closer.length, closer, [...activeMarks, mark]);
      if (inner.result.closed && inner.result.spans.length > 0) {
        flush();
        spans.push(...inner.result.spans);
        pos = inner.pos;
      } else {
        literal += closer;
        pos += closer.length;
      }
      continue;
    }
    literal += char;
    pos += 1;
  }

  flush();
  return { result: { spans, closed: stopCloser === null }, pos };
}

export function parseInlineMarks(input: string): InlineSpan[] {
  if (!input) return [];
  return mergeAdjacent(parseUntil(input, 0, null, []).result.spans);
}

/** 마크만 벗긴 평문 — 프리뷰 diff·길이 계산이 적용 결과와 같은 텍스트를 보게 한다. */
export function stripInlineMarks(input: string): string {
  return parseInlineMarks(input)
    .map((span) => span.text)
    .join('');
}

/**
 * 문서 범위를 인라인 마크 포함 텍스트로 직렬화한다 — 파서의 역함수.
 * 모델 입력에 넣어 원문 서식을 보이게 하는 용도다.
 *
 * - 텍스트 노드의 bold/italic/code만 본다. 다른 mark(주석·변경 표시 등)는
 *   모델 입력에 섞지 않는다.
 * - bold+italic 겹침 run은 bold만 살린다. `***`를 뱉으면 파서가 리터럴로
 *   읽어 서식이 도로 사라지므로, 텍스트 보존을 택한다.
 * - code run 안에 백틱이 있으면 mark 없이 평문으로 둔다(깨진 스팬 방지).
 * - mark 없는 본문의 `*`/백틱은 raw — 왕복 시 파서가 mark로 읽을 수 있는
 *   기지 한계다(번역 prose에 드묾).
 */
export function serializeInlineMarks(
  doc: { nodesBetween: PMNode['nodesBetween'] },
  from: number,
  to: number,
): string {
  if (to <= from) return '';
  const runs: InlineSpan[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) return;
    const start = Math.max(pos, from);
    const end = Math.min(pos + node.nodeSize, to);
    if (end <= start) return;
    const text = node.text.slice(start - pos, end - pos);
    const has = (kind: InlineMarkKind): boolean =>
      node.marks.some((mark) => mark.type.name === kind);
    // code가 있으면 code만. bold+italic 겹침은 bold만(`***`를 뱉으면 파서가
    // 리터럴로 읽어 서식이 도로 사라진다). 나머지는 방출 순서대로.
    const marks: InlineMarkKind[] = has('code')
      ? ['code']
      : has('bold') && has('italic')
        ? ['bold']
        : EMIT_ORDER.filter((kind) => has(kind));
    const last = runs[runs.length - 1];
    if (
      last &&
      last.marks.length === marks.length &&
      last.marks.every((mark, index) => mark === marks[index])
    ) {
      last.text += text;
    } else {
      runs.push({ text, marks });
    }
  });

  let out = '';
  let open: InlineMarkKind[] = [];
  const closeTo = (keep: number): void => {
    while (open.length > keep) {
      const kind = open.pop()!;
      // code는 스팬 단위로 열고 닫아 스택에 남지 않는다.
      if (kind !== 'code') out += openerFor(kind);
    }
  };
  for (const run of runs) {
    if (run.marks.length === 1 && run.marks[0] === 'code') {
      closeTo(0);
      open = [];
      // 백틱 포함이면 평문으로 — 깨진 스팬보다 mark 탈락이 낫다.
      out += run.text.includes('`') ? run.text : `\`${run.text}\``;
      continue;
    }
    let keep = 0;
    while (
      keep < open.length &&
      keep < run.marks.length &&
      open[keep] === run.marks[keep]
    ) {
      keep += 1;
    }
    closeTo(keep);
    for (const kind of run.marks.slice(keep)) {
      out += openerFor(kind);
      open.push(kind);
    }
    out += run.text;
  }
  closeTo(0);
  return out;
}
