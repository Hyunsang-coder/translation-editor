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
 * Heading 위치 정보 (재귀 탐색용)
 */
interface HeadingLocation {
  /** heading 노드 */
  node: AdfNode;
  /** heading 레벨 (1-6) */
  level: number;
  /** heading 텍스트 */
  text: string;
  /** 원본 문서에서의 경로 (부모 노드들의 인덱스) */
  path: number[];
  /** 최상위 노드 인덱스 */
  topLevelIndex: number;
}

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
 * 모든 heading을 재귀적으로 찾아 위치 정보와 함께 반환
 * layoutSection, panel, expand 등 중첩 구조 지원
 */
function findAllHeadingsRecursive(
  nodes: AdfNode[],
  currentPath: number[] = [],
  topLevelIndex: number = -1
): HeadingLocation[] {
  const results: HeadingLocation[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;

    const path = [...currentPath, i];
    // 최상위 레벨이면 topLevelIndex 갱신
    const effectiveTopIndex = currentPath.length === 0 ? i : topLevelIndex;

    if (node.type === 'heading') {
      const fullText = getHeadingText(node).trim();
      results.push({
        node,
        level: getHeadingLevel(node),
        text: fullText,
        path,
        topLevelIndex: effectiveTopIndex,
      });
    }

    // 자식 노드 재귀 탐색
    if (node.content && node.content.length > 0) {
      results.push(...findAllHeadingsRecursive(node.content, path, effectiveTopIndex));
    }
  }

  return results;
}

/**
 * Heading 텍스트 매칭 (부분 매칭 지원)
 * 우선순위: 1. 정확히 일치 > 2. 첫 줄 일치 > 3. 포함 매칭 (번호/접미사 제거 후)
 */
function matchesHeading(headingText: string, target: string): boolean {
  const normalized = headingText.toLowerCase().trim();
  const normalizedTarget = target.toLowerCase().trim();

  // 1. 정확히 일치
  if (normalized === normalizedTarget) return true;

  // 2. 첫 줄 일치 (다국어 페이지 "Title\n번역")
  const firstLine = normalized.split('\n')[0]?.trim() ?? '';
  if (firstLine === normalizedTarget) return true;

  // 3. 포함 매칭 (번호/접미사 제거 후)
  //    "1. Overview" → "overview" 포함 체크
  //    "1.1 Details" → "details" 포함 체크
  //    "Overview (v2)" → "overview" 포함 체크
  const cleanedHeading = normalized
    .replace(/^[\d.]+\s*/, '')       // 선행 번호 제거 (1. 또는 1.1 등)
    .replace(/\s*\([^)]*\)\s*$/, '') // 후행 괄호 제거
    .trim();
  if (cleanedHeading === normalizedTarget) return true;

  return false;
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
 * 재귀 탐색으로 layoutSection, panel, expand 등 중첩 구조 내 heading도 지원.
 *
 * @param doc ADF 문서
 * @param headingText 찾을 heading 텍스트 (대소문자 무시, 부분 매칭 지원)
 * @returns 섹션 내용과 찾음 여부
 *
 * @example
 * ```typescript
 * const { content, found } = extractSection(doc, 'Introduction');
 * if (found) {
 *   const sectionDoc = wrapAsDocument(content);
 *   const text = extractText(sectionDoc);
 * }
 * // 부분 매칭: "1. Overview"를 "Overview"로 찾기
 * const { content, found } = extractSection(doc, 'Overview');
 * ```
 */
export function extractSection(doc: AdfDocument, headingText: string): SectionResult {
  if (!doc.content || doc.content.length === 0) {
    return { content: [], found: false };
  }

  // 모든 heading을 재귀적으로 찾기
  const allHeadings = findAllHeadingsRecursive(doc.content);

  // 타겟 heading 찾기 (부분 매칭 지원)
  let targetIdx = -1;
  for (let i = 0; i < allHeadings.length; i++) {
    const h = allHeadings[i];
    if (h && matchesHeading(h.text, headingText)) {
      targetIdx = i;
      break;
    }
  }

  if (targetIdx === -1) {
    return { content: [], found: false };
  }

  const targetHeading = allHeadings[targetIdx]!;
  const targetLevel = targetHeading.level;
  const startTopIndex = targetHeading.topLevelIndex;

  // 다음 동급/상위 heading 찾기
  let endTopIndex: number | null = null;
  for (let i = targetIdx + 1; i < allHeadings.length; i++) {
    const h = allHeadings[i];
    if (h && h.level <= targetLevel) {
      endTopIndex = h.topLevelIndex;
      break;
    }
  }

  // heading 다음 노드부터 다음 동급/상위 heading 전까지 추출
  const content = doc.content.slice(startTopIndex + 1, endTopIndex ?? undefined);
  return { content, found: true };
}

/**
 * 처음부터 특정 섹션 전까지 추출
 *
 * 문서 시작부터 지정된 heading 직전까지의 내용을 반환합니다.
 * 재귀 탐색으로 layoutSection, panel, expand 등 중첩 구조 내 heading도 지원.
 *
 * @param doc ADF 문서
 * @param headingText 종료할 heading 텍스트 (대소문자 무시, 부분 매칭 지원)
 * @returns 추출된 내용과 찾음 여부
 *
 * @example
 * ```typescript
 * const { content, found } = extractUntilSection(doc, 'Appendix');
 * if (found) {
 *   const introDoc = wrapAsDocument(content);
 *   // introDoc에는 'Appendix' 섹션 이전의 모든 노드가 포함됨
 * }
 * // 부분 매칭: "1. Appendix"를 "Appendix"로 찾기
 * const { content, found } = extractUntilSection(doc, 'Appendix');
 * ```
 */
export function extractUntilSection(doc: AdfDocument, headingText: string): SectionResult {
  if (!doc.content || doc.content.length === 0) {
    return { content: [], found: false };
  }

  // 모든 heading을 재귀적으로 찾기
  const allHeadings = findAllHeadingsRecursive(doc.content);

  // 타겟 heading 찾기 (부분 매칭 지원)
  for (const heading of allHeadings) {
    if (matchesHeading(heading.text, headingText)) {
      return {
        content: doc.content.slice(0, heading.topLevelIndex),
        found: true,
      };
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

  // 재귀적으로 모든 heading 노드 찾기 (layoutSection 등 중첩 구조 지원)
  function findHeadingsRecursive(nodes: AdfNode[], result: SectionInfo[]): void {
    for (const node of nodes) {
      if (node.type === 'heading') {
        const fullText = getHeadingText(node).trim();
        // 다국어 페이지에서 첫 줄만 섹션명으로 사용 (검색 시 첫 줄로 매칭)
        const text = fullText.split('\n')[0]?.trim() ?? fullText;
        if (text) {
          result.push({
            text,
            level: getHeadingLevel(node),
          });
        }
      }
      // 자식 노드 재귀 탐색 (layoutSection, layoutColumn, panel 등)
      if (node.content && node.content.length > 0) {
        findHeadingsRecursive(node.content, result);
      }
    }
  }

  const sections: SectionInfo[] = [];
  findHeadingsRecursive(doc.content, sections);

  if (includeLevel) {
    return sections;
  }

  return sections.map((s) => s.text);
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
 * 특정 컬럼의 콘텐츠만 추출
 *
 * layoutSection 내의 특정 인덱스 컬럼만 추출합니다.
 * Confluence 2-column 레이아웃에서 좌/우 컬럼 구분에 사용합니다.
 * layoutSection 외부 노드는 포함되지 않습니다.
 *
 * @param doc ADF 문서
 * @param columnIndex 컬럼 번호 (1-based, 1=첫번째/좌측, 2=두번째/우측)
 * @returns 해당 컬럼 내용만 포함한 ADF 문서
 *
 * @example
 * ```typescript
 * // 2-column 레이아웃에서 좌측 컬럼만 추출
 * const leftDoc = extractByColumn(doc, 1);
 * // 우측 컬럼만 추출
 * const rightDoc = extractByColumn(doc, 2);
 * ```
 */
export function extractByColumn(doc: AdfDocument, columnIndex: number): AdfDocument {
  if (!doc.content || columnIndex < 1) {
    return wrapAsDocument([]);
  }

  const result: AdfNode[] = [];
  const idx = columnIndex - 1; // 0-based 인덱스로 변환

  for (const node of doc.content) {
    if (node.type === 'layoutSection' && node.content) {
      const column = node.content[idx];
      if (column?.type === 'layoutColumn' && column.content) {
        result.push(...column.content);
      }
    }
  }

  return wrapAsDocument(result);
}

/**
 * 문서 내 모든 섹션 목록 반환 (컬럼 정보 포함)
 *
 * 문서에 포함된 모든 heading의 텍스트를 순서대로 반환합니다.
 * layoutSection 내 중복 섹션의 경우 컬럼 번호를 표시합니다.
 *
 * @param doc ADF 문서
 * @returns 섹션명 배열 (중복 시 "[col N]" 접미사 포함)
 *
 * @example
 * ```typescript
 * const sections = listAvailableSectionsWithColumns(doc);
 * // ["Meeting log [col 1]", "PBB [col 1]", "Meeting log [col 2]", "CTU [col 2]"]
 * ```
 */
export function listAvailableSectionsWithColumns(doc: AdfDocument): string[] {
  if (!doc.content || doc.content.length === 0) {
    return [];
  }

  interface HeadingWithColumn {
    text: string;
    columnIndex: number | null; // null = layoutSection 외부
  }

  const headings: HeadingWithColumn[] = [];

  // 재귀적으로 heading 찾기 (컬럼 정보 포함)
  function findHeadingsInNode(node: AdfNode, columnIndex: number | null): void {
    if (node.type === 'heading') {
      const fullText = getHeadingText(node).trim();
      const text = fullText.split('\n')[0]?.trim() ?? fullText;
      if (text) {
        headings.push({ text, columnIndex });
      }
    }

    if (node.content && node.content.length > 0) {
      for (const child of node.content) {
        findHeadingsInNode(child, columnIndex);
      }
    }
  }

  // 문서 순회
  for (const node of doc.content) {
    if (node.type === 'layoutSection' && node.content) {
      // layoutSection 내 각 컬럼 처리
      for (let colIdx = 0; colIdx < node.content.length; colIdx++) {
        const column = node.content[colIdx];
        if (column?.type === 'layoutColumn' && column.content) {
          for (const child of column.content) {
            findHeadingsInNode(child, colIdx + 1); // 1-based
          }
        }
      }
    } else {
      // layoutSection 외부
      findHeadingsInNode(node, null);
    }
  }

  // 중복 섹션명 찾기
  const textCounts = new Map<string, number>();
  for (const h of headings) {
    textCounts.set(h.text, (textCounts.get(h.text) || 0) + 1);
  }

  // 결과 생성 (중복 시 컬럼 정보 추가)
  return headings.map((h) => {
    const isDuplicate = (textCounts.get(h.text) || 0) > 1;
    if (isDuplicate && h.columnIndex !== null) {
      return `${h.text} [col ${h.columnIndex}]`;
    }
    return h.text;
  });
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
