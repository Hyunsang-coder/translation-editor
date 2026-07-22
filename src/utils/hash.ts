/**
 * 컨텐츠 해시 유틸리티
 * 블록 변경 감지를 위한 해시 생성
 */

/**
 * 간단한 문자열 해시 생성
 * @param content - 해시할 콘텐츠
 * @returns 해시 문자열
 */
export function hashContent(content: string): string {
  let hash = 0;

  if (content.length === 0) {
    return hash.toString(36);
  }

  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return Math.abs(hash).toString(36);
}

/**
 * HTML 태그를 제거하고 텍스트만 추출
 * - 블록 태그(p, div, h1-6, li 등) 뒤에는 줄바꿈을 추가하여 텍스트 구조 유지
 * - 테이블 셀(td, th) 뒤에는 공백을 추가하여 단어 분리 유지
 * - HTML 엔티티(&nbsp;, &lt; 등)를 일반 문자로 변환
 * @param html - HTML 문자열
 * @returns 순수 텍스트
 */
export function stripHtml(html: string): string {
  if (!html) return '';

  // AI 응답은 HTML 태그를 &lt;...&gt; 또는 &amp;lt;...&amp;gt;처럼
  // 한두 번 인코딩해 반환할 수 있다. 태그 제거 후 디코딩하면 태그가 다시 노출되므로,
  // 제한된 횟수만큼 먼저 디코딩한 뒤 태그를 제거한다.
  const decodedHtml = decodeHtmlEntities(html);
  const text = decodedHtml
    .replace(/<\/p>|<\/div>|<\/h[1-6]>|<\/li>|<\/blockquote>|<\/pre>|<\/tr>/gi, '\n')
    .replace(/<\/td>|<\/th>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '');

  return text
    .replace(/\n\s*\n/g, '\n\n') // 중복 줄바꿈 정리
    .trim();
}

const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  copy: '©',
  reg: '®',
};

function decodeHtmlEntitiesOnce(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);/gi, (entity, token: string) => {
    const normalized = token.toLowerCase();
    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return HTML_ENTITIES[normalized] ?? entity;
  });
}

function isValidCodePoint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0x10FFFF;
}

function decodeHtmlEntities(text: string): string {
  let decoded = text;
  // 일반 HTML + 이중 인코딩까지 처리하되, 사용자 텍스트를 과도하게 변환하지 않는다.
  for (let i = 0; i < 2; i++) {
    const next = decodeHtmlEntitiesOnce(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

/**
 * HTML을 구조화된 텍스트로 변환 (diff 비교용)
 * - DOM 파싱으로 중첩 구조를 정확히 처리
 * - 리스트 마커(1. / - ), 제목, 인용 등 구조를 보존
 */
export function htmlToStructuredText(html: string): string {
  if (!html) return '';

  const container = document.createElement('div');
  container.innerHTML = html;

  const lines: string[] = [];
  walkNode(container, lines, { olIndex: 0, indent: '' });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

interface WalkContext {
  olIndex: number;
  indent: string;
}

function walkNode(node: Node, lines: string[], ctx: WalkContext): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text.trim()) {
        lines.push(ctx.indent + text);
      }
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === 'br') {
      lines.push('');
      continue;
    }

    if (tag === 'ol') {
      walkNode(el, lines, { ...ctx, olIndex: 1 });
      continue;
    }

    if (tag === 'ul') {
      walkNode(el, lines, { ...ctx, olIndex: 0 });
      continue;
    }

    if (tag === 'li') {
      const prefix = ctx.olIndex > 0 ? `${ctx.olIndex}. ` : '- ';
      const childLines: string[] = [];
      walkNode(el, childLines, { olIndex: 0, indent: '' });
      const content = childLines.join(' ').trim();
      lines.push(ctx.indent + prefix + content);
      if (ctx.olIndex > 0) ctx.olIndex++;
      continue;
    }

    if (/^h[1-6]$/.test(tag)) {
      const childLines: string[] = [];
      walkNode(el, childLines, { olIndex: 0, indent: '' });
      lines.push(childLines.join(' ').trim());
      lines.push('');
      continue;
    }

    if (tag === 'blockquote') {
      const childLines: string[] = [];
      walkNode(el, childLines, { olIndex: 0, indent: '' });
      for (const line of childLines) {
        lines.push(ctx.indent + '> ' + line);
      }
      continue;
    }

    if (tag === 'td' || tag === 'th') {
      const childLines: string[] = [];
      walkNode(el, childLines, { olIndex: 0, indent: '' });
      lines.push(childLines.join(' ').trim() + ' | ');
      continue;
    }

    if (tag === 'tr') {
      const cellLines: string[] = [];
      walkNode(el, cellLines, ctx);
      lines.push('| ' + cellLines.join('').trim());
      continue;
    }

    if (tag === 'p' || tag === 'div') {
      const childLines: string[] = [];
      walkNode(el, childLines, { olIndex: 0, indent: ctx.indent });
      lines.push(...childLines);
      lines.push('');
      continue;
    }

    // Inline tags (strong, em, a, span, code, etc.) — extract text only
    walkNode(el, lines, ctx);
  }
}

/**
 * 두 콘텐츠가 동일한지 비교
 * @param content1 - 첫 번째 콘텐츠
 * @param content2 - 두 번째 콘텐츠
 * @returns 동일 여부
 */
export function isContentEqual(content1: string, content2: string): boolean {
  return hashContent(content1) === hashContent(content2);
}
