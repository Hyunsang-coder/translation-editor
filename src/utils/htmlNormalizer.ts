import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'mark',
  'sub',
  'sup',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
];

const ALLOWED_ATTR = [
  'href',
  'src',
  'alt',
  'title',
  'target',
  'rel',
  'colspan',
  'rowspan',
  'align',
  'width',
  'height',
  'colwidth',
];

const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
]);

// 허용된 URL 프로토콜 (보안: javascript:, data:, vbscript: 등 차단)
const ALLOWED_URL_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * URL이 안전한 프로토콜을 사용하는지 검증
 * @param url 검증할 URL
 * @returns 안전하면 true, 위험하면 false
 */
function isUrlSafe(url: string | null): boolean {
  if (!url) return true; // 빈 URL은 허용

  const trimmed = url.trim().toLowerCase();
  if (trimmed === '') return true;

  // 상대 경로는 허용
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('.')) {
    return true;
  }

  // 프로토콜이 없는 경우 허용 (상대 경로로 처리됨)
  if (!trimmed.includes(':')) {
    return true;
  }

  // 허용된 프로토콜인지 확인
  return ALLOWED_URL_PROTOCOLS.some(protocol => trimmed.startsWith(protocol));
}

/**
 * DOM 내 위험한 URL 속성 제거 (href, src)
 */
function sanitizeUrls(root: ParentNode): void {
  // href 속성 검증
  const linksWithHref = Array.from(root.querySelectorAll('[href]'));
  for (const el of linksWithHref) {
    const href = el.getAttribute('href');
    if (!isUrlSafe(href)) {
      el.removeAttribute('href');
    }
  }

  // src 속성 검증
  const elementsWithSrc = Array.from(root.querySelectorAll('[src]'));
  for (const el of elementsWithSrc) {
    const src = el.getAttribute('src');
    if (!isUrlSafe(src)) {
      el.removeAttribute('src');
    }
  }
}

export function shouldNormalizePastedHtml(html: string): boolean {
  if (!html) return false;
  const lower = html.toLowerCase();
  return (
    lower.includes('<table') ||
    lower.includes('confluence') ||
    lower.includes('ac:') ||
    lower.includes('data-table')
  );
}

export function normalizePastedHtml(html: string): string {
  if (!shouldNormalizePastedHtml(html)) {
    return html;
  }

  try {
    const styledNormalized = convertInlineStyles(html);
    const sanitized = DOMPurify.sanitize(styledNormalized, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitized, 'text/html');
    if (!doc.body) return sanitized;

    unwrapSpans(doc.body);
    normalizeDivs(doc.body);
    removeEmptyParagraphs(doc.body);
    removeDuplicateTableHeaders(doc.body);
    sanitizeUrls(doc.body); // 보안: 위험한 URL 프로토콜 제거

    return doc.body.innerHTML;
  } catch (error) {
    console.warn('Failed to normalize pasted HTML:', error);
    return html;
  }
}

function convertInlineStyles(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    if (!doc.body) return html;

    const styledSpans = Array.from(doc.body.querySelectorAll('span[style]'));
    for (const span of styledSpans) {
      const style = (span.getAttribute('style') || '').toLowerCase();
      const wrappers: string[] = [];

      if (style.includes('font-weight: bold') || style.includes('font-weight: 700') || style.includes('font-weight: 600')) {
        wrappers.push('strong');
      }
      if (style.includes('font-style: italic')) {
        wrappers.push('em');
      }
      if (style.includes('text-decoration: underline')) {
        wrappers.push('u');
      }
      if (style.includes('text-decoration: line-through')) {
        wrappers.push('s');
      }

      if (wrappers.length === 0) {
        span.removeAttribute('style');
        continue;
      }

      const owner = span.ownerDocument;
      const parent = span.parentNode;
      if (!owner || !parent) continue;

      let rootWrapper: HTMLElement | null = null;
      let currentWrapper: HTMLElement | null = null;
      for (const tag of wrappers) {
        const el = owner.createElement(tag);
        if (!rootWrapper) {
          rootWrapper = el;
        } else if (currentWrapper) {
          currentWrapper.appendChild(el);
        }
        currentWrapper = el;
      }

      if (!currentWrapper || !rootWrapper) continue;
      while (span.firstChild) {
        currentWrapper.appendChild(span.firstChild);
      }
      parent.replaceChild(rootWrapper, span);
    }

    return doc.body.innerHTML;
  } catch (error) {
    console.warn('Failed to normalize inline styles:', error);
    return html;
  }
}

function unwrapSpans(root: ParentNode) {
  const spans = Array.from(root.querySelectorAll('span'));
  for (const span of spans) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
  }
}

function normalizeDivs(root: ParentNode) {
  const divs = Array.from(root.querySelectorAll('div'));
  for (const div of divs) {
    const parent = div.parentNode;
    if (!parent) continue;

    const hasBlockChild = Array.from(div.children).some((child) =>
      BLOCK_TAGS.has(child.tagName.toLowerCase()),
    );

    if (hasBlockChild) {
      while (div.firstChild) {
        parent.insertBefore(div.firstChild, div);
      }
      parent.removeChild(div);
      continue;
    }

    const p = div.ownerDocument.createElement('p');
    while (div.firstChild) {
      p.appendChild(div.firstChild);
    }
    parent.replaceChild(p, div);
  }
}

function removeEmptyParagraphs(root: ParentNode) {
  const paragraphs = Array.from(root.querySelectorAll('p'));
  for (const paragraph of paragraphs) {
    const text = paragraph.textContent?.replace(/\u00a0/g, ' ').trim();
    if (text) continue;
    if (paragraph.querySelector('img')) continue;
    paragraph.remove();
  }
}

function removeDuplicateTableHeaders(root: ParentNode) {
  const tables = Array.from(root.querySelectorAll('table'));
  for (const table of tables) {
    const headerText = extractTableHeaderText(table);
    if (!headerText) continue;

    const previousElement = findPreviousElementSibling(table);
    if (!previousElement) continue;
    if (!['p', 'div'].includes(previousElement.tagName.toLowerCase())) continue;
    if (previousElement.querySelector('table')) continue;

    const previousText = normalizeText(previousElement.textContent);
    if (!previousText || previousText !== headerText) continue;

    previousElement.remove();
  }
}

function extractTableHeaderText(table: HTMLTableElement): string | null {
  const theadRow = table.querySelector('thead tr') as HTMLTableRowElement | null;
  if (theadRow) {
    const text = extractRowText(theadRow);
    return text.length > 0 ? text : null;
  }

  const thRow = table.querySelector('tr th')?.closest('tr') as HTMLTableRowElement | null;
  if (thRow) {
    const text = extractRowText(thRow);
    return text.length > 0 ? text : null;
  }

  return null;
}

function extractRowText(row: HTMLTableRowElement): string {
  const cells = Array.from(row.querySelectorAll('th, td'));
  const raw = cells.map((cell) => normalizeText(cell.textContent)).filter(Boolean);
  return raw.length > 0 ? raw.join(' | ') : '';
}

function findPreviousElementSibling(node: Element): Element | null {
  let current: Node | null = node.previousSibling;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      return current as Element;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      const text = normalizeText(current.textContent);
      if (text.length > 0) {
        return null;
      }
    }
    current = current.previousSibling;
  }
  return null;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
