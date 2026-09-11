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
  'label',
  'input',
  'div',
  'span',
];

const ALLOWED_ATTR = [
  'class',
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
  'start',
  'type',
  'checked',
  'role',
  'aria-checked',
  'data-type',
  'data-checked',
  'data-task-state',
  'data-task-local-id',
  'data-inline-tasks-content-id',
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

// 허용된 URL 프로토콜 (보안: javascript:, vbscript: 등 차단)
const ALLOWED_URL_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

// 허용된 data: URL 패턴 (이미지만 허용, text/html 등 위험한 MIME 타입 차단)
const ALLOWED_DATA_URL_PATTERN =
  /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml|bmp|ico)/i;

/**
 * URL이 안전한 프로토콜을 사용하는지 검증
 * @param url 검증할 URL
 * @returns 안전하면 true, 위험하면 false
 */
function isUrlSafe(url: string | null): boolean {
  if (!url) return true; // 빈 URL은 허용

  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();
  if (lower === '') return true;

  // 상대 경로는 허용
  if (
    lower.startsWith('/') ||
    lower.startsWith('#') ||
    lower.startsWith('.')
  ) {
    return true;
  }

  // 프로토콜이 없는 경우 허용 (상대 경로로 처리됨)
  if (!lower.includes(':')) {
    return true;
  }

  // data: URL은 이미지 MIME 타입만 허용 (보안: text/html, application/javascript 등 차단)
  if (lower.startsWith('data:')) {
    return ALLOWED_DATA_URL_PATTERN.test(trimmed);
  }

  // 허용된 프로토콜인지 확인
  return ALLOWED_URL_PROTOCOLS.some((protocol) => lower.startsWith(protocol));
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

/**
 * `<pre>` 없이 `<code>`만으로 블록 코드를 표현하는 출처를 `<pre><code>`로 승격한다.
 *
 * Confluence Cloud가 이렇게 복사한다: `<code class="language-" style="… white-space: pre …">`
 * 안에 줄마다 span row. 승격하지 않으면 개행을 담은 채 문단 속 인라인 code mark가 되어
 * 화면에서 한 줄로 접혀 보인다.
 *
 * DOMPurify가 style 속성을 제거하므로 반드시 sanitize 전에 호출해야 한다.
 */
function promoteBlockCode(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    if (!doc.body) return html;

    const codes = Array.from(doc.body.querySelectorAll('code'));
    for (const code of codes) {
      if (code.closest('pre')) continue;

      const whiteSpace = (code.getAttribute('style') || '').toLowerCase();
      const isPreformatted = /white-space:\s*pre(-wrap|-line)?\b/.test(whiteSpace);
      const hasCodeRows = code.querySelector('[data-ds--code--row]') !== null;
      if (!isPreformatted && !hasCodeRows) continue;

      // 언어 정보가 빈 값이면(`language-`) 클래스를 아예 버린다.
      const language = (code.getAttribute('class') || '')
        .split(/\s+/)
        .find((name) => name.startsWith('language-'))
        ?.slice('language-'.length);
      if (language) {
        code.setAttribute('class', `language-${language}`);
      } else {
        code.removeAttribute('class');
      }

      const parent = code.parentNode;
      if (!parent) continue;
      const pre = doc.createElement('pre');
      parent.replaceChild(pre, code);
      pre.appendChild(code);
    }

    return doc.body.innerHTML;
  } catch (error) {
    console.warn('Failed to promote block code:', error);
    return html;
  }
}

/**
 * Confluence 커스텀 태그를 표준 HTML로 변환
 * - ac:image → img placeholder
 * - ac:structured-macro (multimedia) → img placeholder (video)
 * - ac:emoticon → 이모지 텍스트
 * - ac:link → a 태그
 */
function normalizeConfluenceTags(html: string): string {
  let result = html;

  // ac:image 태그를 img placeholder로 변환
  // <ac:image ...><ri:attachment ri:filename="file.png" /></ac:image>
  // <ac:image ...><ri:url ri:value="https://..." /></ac:image>
  result = result.replace(
    /<ac:image[^>]*>[\s\S]*?<\/ac:image>/gi,
    '<img src="" alt="[Image]" data-confluence-image="true" />',
  );

  // Self-closing ac:image 태그
  result = result.replace(
    /<ac:image[^>]*\/>/gi,
    '<img src="" alt="[Image]" data-confluence-image="true" />',
  );

  // ac:structured-macro (multimedia/video) 태그를 video placeholder로 변환
  result = result.replace(
    /<ac:structured-macro[^>]*ac:name="multimedia"[^>]*>[\s\S]*?<\/ac:structured-macro>/gi,
    '<img src="" alt="[Video]" data-confluence-video="true" />',
  );

  // ac:emoticon 태그를 빈 문자열로 변환 (이모지는 무시)
  result = result.replace(/<ac:emoticon[^>]*\/?>/gi, '');
  result = result.replace(/<\/ac:emoticon>/gi, '');

  // ac:link 내부의 텍스트만 추출 (복잡한 구조이므로 단순화)
  // 완벽한 변환은 어려우므로 링크 텍스트만 보존
  result = result.replace(
    /<ac:link[^>]*>[\s\S]*?<ac:link-body>([\s\S]*?)<\/ac:link-body>[\s\S]*?<\/ac:link>/gi,
    '$1',
  );

  // 나머지 ac: 태그는 내용만 보존 (태그 자체 제거)
  result = result.replace(/<ac:[^>]*>/gi, '');
  result = result.replace(/<\/ac:[^>]*>/gi, '');

  // ri: 태그도 제거
  result = result.replace(/<ri:[^>]*\/?>/gi, '');
  result = result.replace(/<\/ri:[^>]*>/gi, '');

  // 일반 HTML video 태그를 placeholder로 변환
  result = result.replace(
    /<video[^>]*>[\s\S]*?<\/video>/gi,
    '<img src="" alt="[Video]" data-video-placeholder="true" />',
  );
  result = result.replace(
    /<video[^>]*\/>/gi,
    '<img src="" alt="[Video]" data-video-placeholder="true" />',
  );

  // iframe (YouTube, Vimeo 등 embed) 도 placeholder로 변환
  result = result.replace(
    /<iframe[^>]*>[\s\S]*?<\/iframe>/gi,
    '<img src="" alt="[Embed]" data-embed-placeholder="true" />',
  );
  result = result.replace(
    /<iframe[^>]*\/>/gi,
    '<img src="" alt="[Embed]" data-embed-placeholder="true" />',
  );

  return result;
}

export function shouldNormalizePastedHtml(html: string): boolean {
  if (!html) return false;
  const lower = html.toLowerCase();
  return (
    lower.includes('<table') ||
    lower.includes('confluence') ||
    lower.includes('atlassian') ||
    lower.includes('ac:') ||
    lower.includes('data-table') ||
    lower.includes('<video') ||
    lower.includes('<iframe') ||
    lower.includes('<img') ||
    lower.includes('<input') ||        // 체크박스/폼 요소 정규화 필요
    lower.includes('task-list') ||     // 태스크 리스트 클래스 정규화 필요
    lower.includes('inline-task') ||   // Confluence 인라인 태스크
    lower.includes('ak-task') ||       // Confluence Fabric 태스크
    lower.includes('notion-to-do') ||  // Notion To-do
    lower.includes('data-task') ||     // Confluence task state
    lower.includes('taskitem') ||      // TipTap taskItem 속성
    lower.includes('tasklist') ||      // TipTap taskList 속성
    lower.includes('checkbox') ||      // 체크박스 관련 속성/클래스
    lower.includes('style=') ||        // 인라인 스타일 변환 필요
    lower.includes('javascript:') ||   // XSS 차단 필요
    lower.includes('data:text') ||     // 위험한 data URL 차단 필요
    lower.includes('data:application') || // 위험한 data URL 차단 필요
    /[\u2610\u2611\u2612\u25A1\u25A2]/.test(html) || // 유니코드 체크박스 문자
    /\[[ xX]?\]/.test(html)            // 대괄호 체크박스: [ ], [x], [X], []
  );
}

export interface NormalizePasteOptions {
  removeImages?: boolean;
  removeLinks?: boolean;
}

export function normalizePastedHtml(html: string, options?: NormalizePasteOptions): string {
  if (!shouldNormalizePastedHtml(html)) {
    // 옵션이 있으면 간단한 후처리라도 수행
    if (options?.removeImages || options?.removeLinks) {
      return applyPasteOptions(html, options);
    }
    return html;
  }

  try {
    // Confluence 커스텀 태그를 표준 HTML로 변환 (DOMPurify 전에 처리)
    const confluenceNormalized = normalizeConfluenceTags(html);
    // pre 승격은 style 속성을 읽으므로 DOMPurify(style 제거)보다 먼저 수행한다.
    const blockCodeNormalized = promoteBlockCode(confluenceNormalized);
    const styledNormalized = convertInlineStyles(blockCodeNormalized);
    const sanitized = DOMPurify.sanitize(styledNormalized, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitized, 'text/html');
    if (!doc.body) return sanitized;

    normalizeTaskListsInHtml(doc.body);
    unwrapSpans(doc.body);
    normalizeDivs(doc.body);
    removeEmptyParagraphs(doc.body);
    removeDuplicateTableHeaders(doc.body);
    sanitizeUrls(doc.body); // 보안: 위험한 URL 프로토콜 제거

    // 붙여넣기 옵션 적용
    if (options?.removeImages) {
      removeAllImages(doc.body);
    }
    if (options?.removeLinks) {
      unwrapAllLinks(doc.body);
    }

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

    // <li> 안의 이미지만 포함한 div는 unwrap (이미지가 같은 줄에 표시되도록)
    const parentTag = (parent as Element).tagName?.toLowerCase();
    const hasOnlyImage =
      div.children.length === 1 &&
      div.children[0]?.tagName.toLowerCase() === 'img';

    if (parentTag === 'li' && hasOnlyImage) {
      while (div.firstChild) {
        parent.insertBefore(div.firstChild, div);
      }
      parent.removeChild(div);
      continue;
    }

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

    const prevTag = previousElement.tagName.toLowerCase();

    // 기존: 앞 요소가 p/div이고 텍스트가 헤더와 같으면 제거
    if (['p', 'div'].includes(prevTag) && !previousElement.querySelector('table')) {
      const previousText = normalizeText(previousElement.textContent);
      if (previousText && previousText === headerText) {
        previousElement.remove();
      }
      continue;
    }

    // 앞 요소가 table이고 sticky header 패턴이면 제거
    // sticky header = thead만 있거나, 브라우저가 tbody의 단일 헤더 행으로 복사한 클론 표
    if (prevTag === 'table') {
      const previousTable = previousElement as HTMLTableElement;
      const prevHeaderText = extractTableHeaderText(previousTable) ?? extractFirstRowText(previousTable);
      if (prevHeaderText !== headerText) continue;
      if (isStickyHeaderOnlyTable(previousTable, headerText)) {
        previousElement.remove();
      }
    }
  }
}

/**
 * 실제 데이터 행이 없는 헤더 전용 표인지 판별
 * (sticky header 복사 시 생성되는 클론 표 감지용)
 */
function isStickyHeaderOnlyTable(table: HTMLTableElement, expectedHeaderText: string): boolean {
  const tbodyRows = Array.from(table.querySelectorAll('tbody tr'));
  if (tbodyRows.length === 0) return true;

  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length === 0) return false;

  return rows.every((row) => {
    const rowText = extractRowText(row as HTMLTableRowElement);
    if (rowText !== expectedHeaderText) return false;
    return row.querySelector('th') !== null || rows.length === 1;
  });
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

function extractFirstRowText(table: HTMLTableElement): string | null {
  const firstRow = table.querySelector('tr') as HTMLTableRowElement | null;
  if (!firstRow) return null;
  const text = extractRowText(firstRow);
  return text.length > 0 ? text : null;
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

const CHECKBOX_PREFIX_REGEX = /^([ \t]*)([\u2610\u2611\u2612\u25A1\u25A2]|\[[ xX]?\])[ \t]*/;

function isCheckedChar(char: string): boolean {
  return char === '\u2611' || char === '\u2612' || char.toLowerCase() === '[x]';
}

function findFirstTextNode(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE) {
    if (node.textContent && node.textContent.trim().length > 0) {
      return node as Text;
    }
    return null;
  }
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child) {
      const found = findFirstTextNode(child);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 체크박스 및 태스크 리스트 HTML 정규화
 * - Confluence Cloud / Fabric / Server 태스크 리스트 정규화
 * - Notion To-do 블록 정규화
 * - 유니코드 체크박스 문자(☐, ☑, ☒, □, ▢) 및 [ ], [x] 문단/리스트 정규화
 * - 체크박스가 아닌 input 태그 제거 (보안)
 */
function normalizeTaskListsInHtml(root: HTMLElement): void {
  // 1. input 태그 중 checkbox가 아닌 것은 제거 (보안)
  const inputs = Array.from(root.querySelectorAll('input'));
  for (const input of inputs) {
    if (input.getAttribute('type') !== 'checkbox') {
      input.remove();
    }
  }

  // 2. Confluence Fabric: table.ak-tasks-table 정규화
  const akTables = Array.from(root.querySelectorAll('table.ak-tasks-table'));
  for (const table of akTables) {
    const ul = table.ownerDocument.createElement('ul');
    ul.setAttribute('data-type', 'taskList');
    const trs = Array.from(table.querySelectorAll('tr'));
    for (const tr of trs) {
      const checkbox = tr.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      const isChecked = checkbox?.checked || checkbox?.hasAttribute('checked') || false;
      const descCell = tr.querySelector('.ak-task-description') || tr.querySelector('td:last-child');
      const li = table.ownerDocument.createElement('li');
      li.setAttribute('data-type', 'taskItem');
      li.setAttribute('data-checked', isChecked ? 'true' : 'false');
      if (descCell) {
        while (descCell.firstChild) {
          li.appendChild(descCell.firstChild);
        }
      }
      ul.appendChild(li);
    }
    table.replaceWith(ul);
  }

  // 2-1. Confluence Cloud 최신 Action Item (div[data-task-list-local-id] 및 div[data-task-local-id]) 정규화
  const confluenceTaskContainers = Array.from(
    root.querySelectorAll('div[data-task-list-local-id], div[role="group"][aria-label="Action Item List"]'),
  );
  for (const container of confluenceTaskContainers) {
    const ul = container.ownerDocument.createElement('ul');
    ul.setAttribute('data-type', 'taskList');
    const taskItems = Array.from(container.querySelectorAll('div[data-task-local-id]'));
    for (const item of taskItems) {
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      const isChecked = checkbox?.checked || checkbox?.hasAttribute('checked') || false;
      const contentEl = item.querySelector('div[data-component="content"]') || item.querySelector('div:last-child');

      const li = container.ownerDocument.createElement('li');
      li.setAttribute('data-type', 'taskItem');
      li.setAttribute('data-checked', isChecked ? 'true' : 'false');

      const p = container.ownerDocument.createElement('p');
      if (contentEl) {
        while (contentEl.firstChild) {
          p.appendChild(contentEl.firstChild);
        }
      } else {
        // 체크박스 제외 텍스트
        const clone = item.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('input, svg, button, span[contenteditable="false"]').forEach((el) => el.remove());
        p.textContent = clone.textContent?.trim() || '';
      }
      li.appendChild(p);
      ul.appendChild(li);
    }
    container.replaceWith(ul);
  }

  // 2-2. 컨테이너 없이 복사된 독립 div[data-task-local-id] 정규화
  const orphanTaskItems = Array.from(root.querySelectorAll('div[data-task-local-id]'));
  for (const item of orphanTaskItems) {
    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    const isChecked = checkbox?.checked || checkbox?.hasAttribute('checked') || false;
    const contentEl = item.querySelector('div[data-component="content"]') || item.querySelector('div:last-child');

    const li = item.ownerDocument.createElement('li');
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', isChecked ? 'true' : 'false');

    const p = item.ownerDocument.createElement('p');
    if (contentEl) {
      while (contentEl.firstChild) {
        p.appendChild(contentEl.firstChild);
      }
    } else {
      const clone = item.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('input, svg, button, span[contenteditable="false"]').forEach((el) => el.remove());
      p.textContent = clone.textContent?.trim() || '';
    }
    li.appendChild(p);

    const prev = item.previousElementSibling;
    if (prev && prev.tagName === 'UL' && prev.getAttribute('data-type') === 'taskList') {
      prev.appendChild(li);
      item.remove();
    } else {
      const ul = item.ownerDocument.createElement('ul');
      ul.setAttribute('data-type', 'taskList');
      ul.appendChild(li);
      item.replaceWith(ul);
    }
  }

  // 3. Confluence Cloud: ul.inline-task-list / ul[data-inline-tasks-content-id] 정규화
  const inlineTaskUls = Array.from(root.querySelectorAll('ul.inline-task-list, ul[data-inline-tasks-content-id]'));
  for (const ul of inlineTaskUls) {
    ul.setAttribute('data-type', 'taskList');
  }

  // 4. Notion: div.notion-to-do-block 정규화
  const notionBlocks = Array.from(root.querySelectorAll('div.notion-to-do-block'));
  for (const block of notionBlocks) {
    const checkboxEl = block.querySelector('[role="checkbox"]');
    const isChecked = checkboxEl?.getAttribute('aria-checked') === 'true';
    checkboxEl?.remove();

    const li = block.ownerDocument.createElement('li');
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', isChecked ? 'true' : 'false');

    while (block.firstChild) {
      li.appendChild(block.firstChild);
    }

    const prev = block.previousElementSibling;
    if (prev && prev.tagName === 'UL' && prev.getAttribute('data-type') === 'taskList') {
      prev.appendChild(li);
      block.remove();
    } else {
      const ul = block.ownerDocument.createElement('ul');
      ul.setAttribute('data-type', 'taskList');
      ul.appendChild(li);
      block.replaceWith(ul);
    }
  }

  // 5. li 항목들 정규화 (Confluence inline-task-item, GitHub task-list-item, input[type=checkbox], 유니코드 체크박스 기호)
  const lis = Array.from(root.querySelectorAll('li'));
  for (const li of lis) {
    const checkbox = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    const isConfluenceTask = li.classList.contains('inline-task-item') || li.hasAttribute('data-task-state');
    const isGithubTask = li.classList.contains('task-list-item');
    const hasCheckboxInput = checkbox !== null;
    const hasDataType = li.getAttribute('data-type') === 'taskItem';

    let startsWithCheckboxPrefix = false;
    let prefixChecked = false;
    const firstTextNode = findFirstTextNode(li);
    if (firstTextNode && firstTextNode.textContent) {
      const match = firstTextNode.textContent.match(CHECKBOX_PREFIX_REGEX);
      if (match) {
        startsWithCheckboxPrefix = true;
        prefixChecked = isCheckedChar(match[2] ?? '');
        firstTextNode.textContent = firstTextNode.textContent.slice(match[0].length);
      }
    }

    if (isConfluenceTask || isGithubTask || hasCheckboxInput || hasDataType || startsWithCheckboxPrefix) {
      li.setAttribute('data-type', 'taskItem');
      let isChecked = false;
      if (startsWithCheckboxPrefix) {
        isChecked = prefixChecked;
      } else if (isConfluenceTask) {
        isChecked = li.getAttribute('data-task-state') === 'completed' || li.classList.contains('checked');
      } else if (checkbox) {
        isChecked = checkbox.checked || checkbox.hasAttribute('checked');
      } else {
        isChecked = li.getAttribute('data-checked') === 'true' || li.classList.contains('checked');
      }
      li.setAttribute('data-checked', isChecked ? 'true' : 'false');

      // Confluence의 placeholder span(.placeholder-inline-tasks) 제거
      const placeholderSpan = li.querySelector('.placeholder-inline-tasks');
      if (placeholderSpan) {
        placeholderSpan.remove();
      }

      const parentUl = li.closest('ul');
      if (parentUl) {
        parentUl.setAttribute('data-type', 'taskList');
      }
    }
  }

  // 6. 문단(p, div) 수준에서 유니코드 체크박스 문자나 [ ]로 시작하는 경우:
  //    연속된 체크박스 블록들을 ul[data-type="taskList"] > li[data-type="taskItem"]로 변환
  const paragraphs = Array.from(root.querySelectorAll('p, div'));
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (!p || !p.parentNode || p.closest('li') || p.closest('ul[data-type="taskList"]')) continue;

    const firstText = findFirstTextNode(p);
    if (!firstText || !firstText.textContent) continue;

    const match = firstText.textContent.match(CHECKBOX_PREFIX_REGEX);
    if (!match) continue;

    // 연속된 체크박스 문단들을 수집
    const group: Array<{ el: HTMLElement; checked: boolean }> = [];
    let cur: Element | null = p;

    while (cur && (cur.tagName === 'P' || cur.tagName === 'DIV')) {
      const curFirstText = findFirstTextNode(cur as HTMLElement);
      if (!curFirstText || !curFirstText.textContent) break;
      const curMatch = curFirstText.textContent.match(CHECKBOX_PREFIX_REGEX);
      if (!curMatch) break;

      curFirstText.textContent = curFirstText.textContent.slice(curMatch[0].length);
      group.push({
        el: cur as HTMLElement,
        checked: isCheckedChar(curMatch[2] ?? ''),
      });
      cur = cur.nextElementSibling;
    }

    if (group.length > 0) {
      const ul = p.ownerDocument.createElement('ul');
      ul.setAttribute('data-type', 'taskList');
      p.parentNode.insertBefore(ul, p);

      for (const item of group) {
        const li = p.ownerDocument.createElement('li');
        li.setAttribute('data-type', 'taskItem');
        li.setAttribute('data-checked', item.checked ? 'true' : 'false');

        if (item.el.tagName === 'P') {
          li.appendChild(item.el);
        } else {
          const innerP = p.ownerDocument.createElement('p');
          while (item.el.firstChild) {
            innerP.appendChild(item.el.firstChild);
          }
          li.appendChild(innerP);
          item.el.remove();
        }
        ul.appendChild(li);
      }
    }
  }
}

/**
 * 모든 img 태그 제거
 */
function removeAllImages(root: ParentNode): void {
  const images = Array.from(root.querySelectorAll('img'));
  for (const img of images) {
    img.remove();
  }
}

/**
 * 모든 a 태그를 텍스트 콘텐츠로 교체 (링크 제거)
 */
function unwrapAllLinks(root: ParentNode): void {
  const links = Array.from(root.querySelectorAll('a'));
  for (const link of links) {
    const parent = link.parentNode;
    if (!parent) continue;
    while (link.firstChild) {
      parent.insertBefore(link.firstChild, link);
    }
    parent.removeChild(link);
  }
}

/**
 * shouldNormalizePastedHtml을 통과하지 못한 HTML에 대한 간단한 후처리
 */
function applyPasteOptions(html: string, options: NormalizePasteOptions): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    if (!doc.body) return html;

    if (options.removeImages) {
      removeAllImages(doc.body);
    }
    if (options.removeLinks) {
      unwrapAllLinks(doc.body);
    }

    return doc.body.innerHTML;
  } catch {
    return html;
  }
}
