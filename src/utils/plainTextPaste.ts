/**
 * text/plain만 담긴 클립보드를 붙여넣을 때 마크다운 코드 표기를 살려주는 변환기.
 *
 * HTML이 함께 오는 클립보드는 `transformPastedHTML`(htmlNormalizer) 경로가 처리하므로
 * 이 모듈은 순수 텍스트 경로만 담당한다. 변환할 것이 없으면 null을 돌려주어
 * ProseMirror 기본 붙여넣기(줄마다 문단)에 그대로 위임한다.
 */

/** 체크박스 줄: 선택적 불릿 + 체크박스 표기 + 본문 */
const CHECKBOX_LINE_REGEX =
  /^([ \t]*)(?:[-*][ \t]+)?([☐☑☒□▢]|\[[ xX]?\])[ \t]*(.*)$/;

/** 코드 펜스 시작: 들여쓰기 + 백틱 3개 이상 + 언어 정보 */
const FENCE_OPEN_REGEX = /^([ \t]*)(`{3,})([^`]*)$/;

/** language- 클래스에 넣어도 안전한 문자 */
const LANGUAGE_ALLOWED_REGEX = /^[A-Za-z0-9#+._-]*/;

interface CodeSegment {
  kind: 'code';
  language: string;
  /** 펜스 사이 원문 줄. 들여쓰기·탭·빈 줄을 그대로 보존한다. */
  lines: string[];
}

interface TextSegment {
  kind: 'text';
  lines: string[];
}

type Segment = CodeSegment | TextSegment;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isCheckedChar(char: string): boolean {
  return char === '☑' || char === '☒' || char.toLowerCase() === '[x]';
}

/** 백틱 런 길이를 센다. */
function backtickRunLength(line: string, start: number): number {
  let length = 0;
  while (line[start + length] === '`') length += 1;
  return length;
}

/** 코드 펜스를 기준으로 입력을 코드/텍스트 구간으로 자른다. */
function splitSegments(lines: string[]): Segment[] {
  const segments: Segment[] = [];
  let textLines: string[] = [];

  const flushText = (): void => {
    if (textLines.length > 0) {
      segments.push({ kind: 'text', lines: textLines });
      textLines = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i]?.match(FENCE_OPEN_REGEX);
    if (!open) {
      textLines.push(lines[i] ?? '');
      continue;
    }

    const indent = open[1] ?? '';
    const fenceLength = (open[2] ?? '').length;
    const language = (open[3] ?? '').trimStart().match(LANGUAGE_ALLOWED_REGEX)?.[0] ?? '';

    // 닫는 펜스를 찾는다. 없으면 문서 끝까지가 코드다(CommonMark).
    const codeLines: string[] = [];
    let closed = false;
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j] ?? '';
      const closeMatch = line.match(/^[ \t]*(`{3,})[ \t]*$/);
      if (closeMatch && (closeMatch[1] ?? '').length >= fenceLength) {
        i = j;
        closed = true;
        break;
      }
      // 여는 펜스의 들여쓰기만큼만 벗겨낸다. 코드 자체 들여쓰기는 보존.
      codeLines.push(indent && line.startsWith(indent) ? line.slice(indent.length) : line);
    }
    if (!closed) i = lines.length;

    flushText();
    segments.push({ kind: 'code', language, lines: codeLines });
  }

  flushText();
  return segments;
}

/**
 * 한 줄의 인라인 백틱을 `<code>`로 바꾼다.
 * 여는 런과 같은 길이의 런에서만 닫으므로 ``a`b`` 안의 단일 백틱은 내용으로 남는다.
 * 짝이 없는 백틱은 리터럴로 둔다.
 */
function renderInline(line: string): { html: string; hasCode: boolean } {
  let html = '';
  let hasCode = false;
  let index = 0;

  while (index < line.length) {
    const char = line[index] ?? '';
    if (char !== '`') {
      html += escapeHtml(char);
      index += 1;
      continue;
    }

    const openLength = backtickRunLength(line, index);
    const contentStart = index + openLength;
    let cursor = contentStart;
    let closeStart = -1;

    while (cursor < line.length) {
      if (line[cursor] === '`') {
        const runLength = backtickRunLength(line, cursor);
        if (runLength === openLength) {
          closeStart = cursor;
          break;
        }
        cursor += runLength;
        continue;
      }
      cursor += 1;
    }

    if (closeStart === -1) {
      html += '`'.repeat(openLength);
      index = contentStart;
      continue;
    }

    html += `<code>${escapeHtml(line.slice(contentStart, closeStart))}</code>`;
    hasCode = true;
    index = closeStart + openLength;
  }

  return { html, hasCode };
}

function renderCodeSegment(segment: CodeSegment): string {
  const classAttr = segment.language ? ` class="language-${segment.language}"` : '';
  return `<pre><code${classAttr}>${escapeHtml(segment.lines.join('\n'))}</code></pre>`;
}

function renderTextSegment(segment: TextSegment): { html: string; converted: boolean } {
  let html = '';
  let converted = false;
  let inTaskList = false;

  const closeTaskList = (): void => {
    if (inTaskList) {
      html += '</ul>';
      inTaskList = false;
    }
  };

  for (const line of segment.lines) {
    if (line.trim().length === 0) continue;

    const checkbox = line.match(CHECKBOX_LINE_REGEX);
    if (checkbox) {
      if (!inTaskList) {
        html += '<ul data-type="taskList">';
        inTaskList = true;
      }
      const checked = isCheckedChar(checkbox[2] ?? '');
      const body = renderInline(checkbox[3] ?? '');
      html += `<li data-type="taskItem" data-checked="${checked ? 'true' : 'false'}"><p>${body.html}</p></li>`;
      converted = true;
      continue;
    }

    closeTaskList();
    const rendered = renderInline(line);
    if (rendered.hasCode) converted = true;
    html += `<p>${rendered.html}</p>`;
  }

  closeTaskList();
  return { html, converted };
}

/**
 * plain text를 붙여넣기용 HTML로 변환한다.
 * 코드 펜스·인라인 백틱·체크박스가 하나도 없으면 null(기본 붙여넣기에 위임).
 */
export function plainTextToPasteHtml(text: string): string | null {
  if (!text) return null;

  const segments = splitSegments(text.split(/\r\n?|\n/));
  let html = '';
  let converted = false;

  for (const segment of segments) {
    if (segment.kind === 'code') {
      html += renderCodeSegment(segment);
      converted = true;
      continue;
    }
    const rendered = renderTextSegment(segment);
    html += rendered.html;
    if (rendered.converted) converted = true;
  }

  if (!converted || html.length === 0) return null;
  return html;
}
