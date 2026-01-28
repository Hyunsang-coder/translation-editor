/**
 * HTML 콘텐츠 추출 유틸리티
 *
 * Confluence HTML에서 콘텐츠 타입별 텍스트 추출 및 섹션 필터링.
 * DOMParser 기반으로 복잡한 HTML 구조를 안정적으로 처리.
 *
 * TRD 참조: docs/trd/09-specialized.md, docs/plans/confluence-word-count-v2.md
 */

/**
 * 콘텐츠 타입
 */
export type ContentType = 'all' | 'tables' | 'lists' | 'paragraphs' | 'headings';

/**
 * 섹션 필터 모드
 */
export type SectionMode = 'include' | 'exclude';

/**
 * 섹션 필터 결과
 */
export interface SectionFilterResult {
  /** 필터링된 HTML */
  html: string;
  /** 에러 (섹션 못 찾음 등) */
  error?: string;
  /** 사용 가능한 섹션 목록 (에러 시 제공) */
  availableSections?: string[];
}

/**
 * DOMParser 인스턴스 생성 (브라우저/jsdom 호환)
 */
function createDomParser(): DOMParser {
  return new DOMParser();
}

/**
 * HTML 문자열을 DOM Document로 파싱
 */
function parseHtml(html: string): Document {
  const parser = createDomParser();
  return parser.parseFromString(html, 'text/html');
}

/**
 * 콘텐츠 타입별 텍스트 추출
 *
 * @param html HTML 문자열
 * @param type 콘텐츠 타입
 * @returns 추출된 텍스트
 */
export function extractContentByType(html: string, type: ContentType): string {
  if (!html || html.trim().length === 0) return '';
  if (type === 'all') return html;

  const doc = parseHtml(html);

  const selectorMap: Record<Exclude<ContentType, 'all'>, string> = {
    tables: 'table',
    lists: 'ul, ol',
    paragraphs: 'p',
    headings: 'h1, h2, h3, h4, h5, h6',
  };

  const selector = selectorMap[type];
  const elements = doc.querySelectorAll(selector);

  if (elements.length === 0) return '';

  const texts: string[] = [];
  elements.forEach((el) => {
    const text = el.textContent?.trim();
    if (text) texts.push(text);
  });

  return texts.join('\n');
}

/**
 * Heading 레벨 추출 (h1=1, h2=2, ... h6=6)
 */
function getHeadingLevel(tagName: string): number {
  const match = tagName.toLowerCase().match(/^h([1-6])$/);
  return match && match[1] ? parseInt(match[1], 10) : 0;
}

/**
 * HTML Heading 기반 단일 섹션 추출
 *
 * <h1>~<h6> 매칭 → 동급/상위 heading에서 종료
 *
 * @param html HTML 문자열
 * @param headingText 찾을 Heading 텍스트 (대소문자 무시)
 * @returns 해당 섹션의 HTML 또는 null (못 찾은 경우)
 */
export function extractSectionFromHtml(html: string, headingText: string): string | null {
  if (!html || !headingText) return null;

  const doc = parseHtml(html);
  const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const normalizedTarget = headingText.toLowerCase().trim();

  let targetHeading: Element | null = null;
  let targetLevel = 0;

  // 타겟 Heading 찾기
  for (const heading of headings) {
    const text = heading.textContent?.toLowerCase().trim();
    if (text === normalizedTarget) {
      targetHeading = heading;
      targetLevel = getHeadingLevel(heading.tagName);
      break;
    }
  }

  if (!targetHeading) return null;

  // 섹션 내용 수집 (다음 동급/상위 heading까지)
  const sectionParts: string[] = [];
  let currentNode: Element | null = targetHeading.nextElementSibling;

  while (currentNode) {
    const level = getHeadingLevel(currentNode.tagName);
    // 동급 또는 상위 heading을 만나면 종료
    if (level > 0 && level <= targetLevel) {
      break;
    }
    sectionParts.push(currentNode.outerHTML);
    currentNode = currentNode.nextElementSibling;
  }

  return sectionParts.join('\n');
}

/**
 * 다중 섹션 include/exclude 필터링
 *
 * @param html HTML 문자열
 * @param sections 섹션 제목 배열
 * @param mode 'include' = 지정 섹션만, 'exclude' = 지정 섹션 제외
 * @returns 필터링 결과
 */
export function filterSections(
  html: string,
  sections: string[],
  mode: SectionMode
): SectionFilterResult {
  if (!html || sections.length === 0) {
    return { html };
  }

  const availableSections = listAvailableSections(html);
  const normalizedSections = sections.map((s) => s.toLowerCase().trim());

  // 존재하지 않는 섹션 체크
  const missingIncludes: string[] = [];
  for (let i = 0; i < normalizedSections.length; i++) {
    const section = normalizedSections[i];
    if (section === undefined) continue;
    const found = availableSections.some(
      (avail) => avail.toLowerCase().trim() === section
    );
    if (!found) {
      missingIncludes.push(section);
    }
  }

  if (mode === 'include') {
    // include 모드: 지정된 섹션들의 HTML만 합쳐서 반환
    const includedParts: string[] = [];

    for (const section of sections) {
      const sectionHtml = extractSectionFromHtml(html, section);
      if (sectionHtml) {
        includedParts.push(sectionHtml);
      }
    }

    if (includedParts.length === 0) {
      return {
        html: '',
        error: `섹션을 찾을 수 없습니다: ${sections.join(', ')}`,
        availableSections,
      };
    }

    if (missingIncludes.length > 0) {
      return {
        html: includedParts.join('\n'),
        error: `일부 섹션을 찾을 수 없습니다: ${missingIncludes.join(', ')}`,
        availableSections,
      };
    }

    return { html: includedParts.join('\n') };
  }

  // exclude 모드: 지정된 섹션들을 제거한 나머지 HTML 반환
  const doc = parseHtml(html);
  const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');

  // 제외할 요소들 표시
  const elementsToRemove: Element[] = [];

  for (const heading of headings) {
    const text = heading.textContent?.toLowerCase().trim();
    if (text && normalizedSections.includes(text)) {
      // 해당 heading과 그 섹션 내용 모두 제거 대상
      elementsToRemove.push(heading);
      const level = getHeadingLevel(heading.tagName);

      let nextSibling: Element | null = heading.nextElementSibling;
      while (nextSibling) {
        const siblingLevel = getHeadingLevel(nextSibling.tagName);
        if (siblingLevel > 0 && siblingLevel <= level) {
          break;
        }
        elementsToRemove.push(nextSibling);
        nextSibling = nextSibling.nextElementSibling;
      }
    }
  }

  // 요소 제거
  for (const el of elementsToRemove) {
    el.remove();
  }

  const resultHtml = doc.body.innerHTML;

  // exclude 모드에서 못 찾은 섹션은 경고만 (에러 아님)
  if (missingIncludes.length > 0) {
    return {
      html: resultHtml,
      error: `일부 섹션을 찾을 수 없습니다: ${missingIncludes.join(', ')}`,
      availableSections,
    };
  }

  return { html: resultHtml };
}

/**
 * 사용 가능한 섹션 목록 반환
 *
 * @param html HTML 문자열
 * @returns 헤딩 텍스트 배열
 */
export function listAvailableSections(html: string): string[] {
  if (!html) return [];

  const doc = parseHtml(html);
  const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');

  const sections: string[] = [];
  headings.forEach((heading) => {
    const text = heading.textContent?.trim();
    if (text && !sections.includes(text)) {
      sections.push(text);
    }
  });

  return sections;
}
