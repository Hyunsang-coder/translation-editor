/**
 * Atlassian Document Format (ADF) 파싱 유틸리티
 *
 * Confluence 단어 카운팅을 위한 ADF 문서 파싱 기능을 제공합니다.
 * - 재귀적 노드 순회로 중첩 구조 지원
 * - 섹션 추출 (heading 기준)
 * - 콘텐츠 타입별 필터링 (table, list, paragraph 등)
 *
 * @see https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 */

// ============================================================================
// Types
// ============================================================================

/**
 * ADF 노드 기본 구조
 */
export interface AdfNode {
  /** 노드 타입 (paragraph, heading, table, text 등) */
  type: string;
  /** 노드 속성 (heading level, link href 등) */
  attrs?: Record<string, unknown>;
  /** 자식 노드 배열 */
  content?: AdfNode[];
  /** 텍스트 노드의 내용 */
  text?: string;
  /** 텍스트 마크 (bold, italic, link 등) */
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

/**
 * ADF 문서 루트 구조
 */
export interface AdfDocument {
  /** 항상 'doc' */
  type: 'doc';
  /** ADF 버전 */
  version: number;
  /** 최상위 노드 배열 */
  content: AdfNode[];
}

/**
 * 콘텐츠 타입 필터
 */
export type ContentFilter = 'all' | 'table' | 'text' | 'list' | 'paragraph' | 'heading';

/**
 * 섹션 추출 결과
 */
export interface SectionResult {
  /** 추출된 노드 배열 */
  content: AdfNode[];
  /** 섹션 찾음 여부 */
  found: boolean;
}

/**
 * 텍스트 추출 옵션
 */
export interface ExtractTextOptions {
  /** 제외할 노드 타입 (예: ['codeBlock']) */
  excludeTypes?: string[];
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * 노드에서 heading 텍스트 추출 (내부 헬퍼)
 */
function getHeadingText(node: AdfNode): string {
  if (node.type !== 'heading') return '';
  return extractTextFromNode(node);
}

/**
 * 노드에서 heading 레벨 추출 (내부 헬퍼)
 */
function getHeadingLevel(node: AdfNode): number {
  if (node.type !== 'heading') return 0;
  return (node.attrs?.level as number) ?? 1;
}

/**
 * 단일 노드에서 텍스트 추출 (재귀)
 */
function extractTextFromNode(node: AdfNode, excludeTypes: string[] = []): string {
  // 제외 타입 체크
  if (excludeTypes.includes(node.type)) {
    return '';
  }

  // 텍스트 노드
  if (node.type === 'text' && node.text) {
    return node.text;
  }

  // hardBreak은 줄바꿈으로
  if (node.type === 'hardBreak') {
    return '\n';
  }

  // 자식 노드 재귀 처리
  if (node.content && node.content.length > 0) {
    const childTexts = node.content.map((child) => extractTextFromNode(child, excludeTypes));
    const joined = childTexts.join('');

    // 블록 요소는 줄바꿈 추가
    const blockTypes = ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'tableCell', 'tableHeader', 'tableRow', 'blockquote'];
    if (blockTypes.includes(node.type)) {
      return joined + '\n';
    }

    return joined;
  }

  return '';
}

/**
 * 노드가 특정 콘텐츠 타입에 해당하는지 확인
 */
function matchesContentFilter(node: AdfNode, filter: ContentFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'table':
      return node.type === 'table';
    case 'text':
      // table, codeBlock 제외한 텍스트 콘텐츠
      return !['table', 'codeBlock'].includes(node.type);
    case 'list':
      return node.type === 'bulletList' || node.type === 'orderedList';
    case 'paragraph':
      return node.type === 'paragraph';
    case 'heading':
      return node.type === 'heading';
    default:
      return true;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * ADF 문서에서 텍스트 추출
 *
 * 모든 노드를 재귀적으로 순회하여 텍스트를 추출합니다.
 * 코드 블록 등 특정 노드 타입을 제외할 수 있습니다.
 *
 * @param doc ADF 문서
 * @param options 추출 옵션
 * @returns 추출된 텍스트
 *
 * @example
 * ```typescript
 * const text = extractText(doc);
 * const textWithoutCode = extractText(doc, { excludeTypes: ['codeBlock'] });
 * ```
 */
export function extractText(doc: AdfDocument, options: ExtractTextOptions = {}): string {
  const { excludeTypes = [] } = options;

  if (!doc.content || doc.content.length === 0) {
    return '';
  }

  const texts = doc.content.map((node) => extractTextFromNode(node, excludeTypes));
  return texts.join('').trim().replace(/\n{3,}/g, '\n\n');
}

/**
 * 특정 섹션 추출
 *
 * 지정된 heading 텍스트를 찾아 해당 섹션의 내용을 반환합니다.
 * 섹션은 다음 동급/상위 heading 또는 문서 끝까지입니다.
 *
 * @param doc ADF 문서
 * @param headingText 찾을 heading 텍스트 (대소문자 무시)
 * @returns 섹션 내용과 찾음 여부
 *
 * @example
 * ```typescript
 * const { content, found } = extractSection(doc, 'Introduction');
 * if (found) {
 *   const sectionDoc = wrapAsDocument(content);
 *   const text = extractText(sectionDoc);
 * }
 * ```
 */
export function extractSection(doc: AdfDocument, headingText: string): SectionResult {
  if (!doc.content || doc.content.length === 0) {
    return { content: [], found: false };
  }

  const normalizedTarget = headingText.toLowerCase().trim();
  let targetLevel: number | null = null;
  let startIndex: number | null = null;
  let endIndex: number | null = null;

  // 타겟 heading 찾기
  for (let i = 0; i < doc.content.length; i++) {
    const node = doc.content[i];
    if (!node) continue;

    if (node.type === 'heading') {
      const text = getHeadingText(node).toLowerCase().trim();
      const level = getHeadingLevel(node);

      if (startIndex === null) {
        // 타겟 heading 찾기 (정확히 일치 또는 첫 줄이 일치)
        // Confluence 다국어 페이지에서 "Title\n번역" 형태 지원
        const firstLine = text.split('\n')[0]?.trim() ?? '';
        if (text === normalizedTarget || firstLine === normalizedTarget) {
          targetLevel = level;
          startIndex = i + 1; // heading 다음부터
        }
      } else {
        // 다음 동급/상위 heading에서 종료
        if (level <= targetLevel!) {
          endIndex = i;
          break;
        }
      }
    }
  }

  if (startIndex === null) {
    return { content: [], found: false };
  }

  const content = doc.content.slice(startIndex, endIndex ?? undefined);
  return { content, found: true };
}

/**
 * 처음부터 특정 섹션 전까지 추출
 *
 * 문서 시작부터 지정된 heading 직전까지의 내용을 반환합니다.
 *
 * @param doc ADF 문서
 * @param headingText 종료할 heading 텍스트 (대소문자 무시)
 * @returns 추출된 내용과 찾음 여부
 *
 * @example
 * ```typescript
 * const { content, found } = extractUntilSection(doc, 'Appendix');
 * if (found) {
 *   const introDoc = wrapAsDocument(content);
 *   // introDoc에는 'Appendix' 섹션 이전의 모든 노드가 포함됨
 * }
 * ```
 */
export function extractUntilSection(doc: AdfDocument, headingText: string): SectionResult {
  if (!doc.content || doc.content.length === 0) {
    return { content: [], found: false };
  }

  const normalizedTarget = headingText.toLowerCase().trim();

  // 타겟 heading 찾기
  for (let i = 0; i < doc.content.length; i++) {
    const node = doc.content[i];
    if (!node) continue;

    if (node.type === 'heading') {
      const text = getHeadingText(node).toLowerCase().trim();
      // 정확히 일치 또는 첫 줄이 일치 (다국어 페이지 "Title\n번역" 형태 지원)
      const firstLine = text.split('\n')[0]?.trim() ?? '';
      if (text === normalizedTarget || firstLine === normalizedTarget) {
        return {
          content: doc.content.slice(0, i),
          found: true,
        };
      }
    }
  }

  // 해당 섹션을 찾지 못함
  return { content: [], found: false };
}

/**
 * 콘텐츠 타입별 노드 필터링
 *
 * 지정된 타입에 해당하는 최상위 노드만 반환합니다.
 *
 * @param doc ADF 문서
 * @param filter 콘텐츠 타입 필터
 * @returns 필터에 맞는 노드를 담은 ADF 문서
 *
 * @example
 * ```typescript
 * const tablesDoc = filterByContentType(doc, 'table');
 * const text = extractText(tablesDoc);
 * const listsDoc = filterByContentType(doc, 'list');
 * const paragraphsDoc = filterByContentType(doc, 'paragraph');
 * ```
 */
export function filterByContentType(doc: AdfDocument, filter: ContentFilter): AdfDocument {
  if (!doc.content || doc.content.length === 0) {
    return wrapAsDocument([]);
  }

  if (filter === 'all') {
    return doc;
  }

  const filteredNodes = doc.content.filter((node) => matchesContentFilter(node, filter));
  return wrapAsDocument(filteredNodes);
}

/**
 * 섹션 정보 (레벨 포함)
 */
export interface SectionInfo {
  /** heading 텍스트 */
  text: string;
  /** heading 레벨 (1-6) */
  level: number;
}

/**
 * listAvailableSections 옵션
 */
export interface ListSectionsOptions {
  /** 레벨 정보 포함 여부 */
  includeLevel?: boolean;
}

/**
 * 문서 내 모든 섹션(heading) 목록 반환
 *
 * 문서에 포함된 모든 heading의 텍스트를 순서대로 반환합니다.
 * includeLevel 옵션으로 레벨 정보를 포함할 수 있습니다.
 *
 * @param doc ADF 문서
 * @param options 옵션
 * @returns heading 텍스트 배열 또는 SectionInfo 배열
 *
 * @example
 * ```typescript
 * const sections = listAvailableSections(doc);
 * // ['Introduction', 'Features', 'Installation', 'API Reference', ...]
 *
 * const sectionsWithLevel = listAvailableSections(doc, { includeLevel: true });
 * // [{ text: 'Introduction', level: 1 }, { text: 'Features', level: 2 }, ...]
 * ```
 */
export function listAvailableSections(doc: AdfDocument, options?: ListSectionsOptions): string[] | SectionInfo[] {
  if (!doc.content || doc.content.length === 0) {
    return [];
  }

  const includeLevel = options?.includeLevel ?? false;

  if (includeLevel) {
    const sections: SectionInfo[] = [];
    for (const node of doc.content) {
      if (node.type === 'heading') {
        const fullText = getHeadingText(node).trim();
        // 다국어 페이지에서 첫 줄만 섹션명으로 사용 (검색 시 첫 줄로 매칭)
        const text = fullText.split('\n')[0]?.trim() ?? fullText;
        if (text) {
          sections.push({
            text,
            level: getHeadingLevel(node),
          });
        }
      }
    }
    return sections;
  }

  const sections: string[] = [];
  for (const node of doc.content) {
    if (node.type === 'heading') {
      const fullText = getHeadingText(node).trim();
      // 다국어 페이지에서 첫 줄만 섹션명으로 사용
      const text = fullText.split('\n')[0]?.trim() ?? fullText;
      if (text) {
        sections.push(text);
      }
    }
  }
  return sections;
}

/**
 * ADF 노드 배열을 ADF 문서로 래핑
 *
 * 섹션 추출 결과 등을 다시 문서 형태로 만들 때 사용합니다.
 *
 * @param content 노드 배열
 * @returns ADF 문서
 *
 * @example
 * ```typescript
 * const { content } = extractSection(doc, 'Features');
 * const sectionDoc = wrapAsDocument(content);
 * const text = extractText(sectionDoc);
 * ```
 */
export function wrapAsDocument(content: AdfNode[]): AdfDocument {
  return {
    type: 'doc',
    version: 1,
    content,
  };
}

/**
 * ADF 문서 유효성 검사
 *
 * 기본적인 ADF 문서 구조를 검사합니다.
 *
 * @param doc 검사할 객체
 * @returns 유효한 ADF 문서 여부
 *
 * @example
 * ```typescript
 * if (isValidAdfDocument(data)) {
 *   const text = extractText(data);
 * }
 * ```
 */
export function isValidAdfDocument(doc: unknown): doc is AdfDocument {
  if (!doc || typeof doc !== 'object') {
    return false;
  }

  const d = doc as Record<string, unknown>;

  return (
    d.type === 'doc' &&
    typeof d.version === 'number' &&
    Array.isArray(d.content)
  );
}
