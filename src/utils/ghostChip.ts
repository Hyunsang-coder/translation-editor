/**
 * Ghost Chip 유틸리티
 * 변수 및 태그 감지 및 처리
 */

export interface GhostChipMatch {
  value: string;
  type: 'variable' | 'tag' | 'newline';
  start: number;
  end: number;
}

export interface GhostChipFindOptions {
  /**
   * 실제 개행 문자('\n')까지 newline으로 감지할지 여부.
   * - 기본값 false: 문서 편집(Monaco)에서 구조적 줄바꿈까지 보호하면 UX가 깨질 수 있어,
   *   기존처럼 "\\n" (리터럴) 및 "<br>" 계열만 보호합니다.
   */
  includeActualNewlines?: boolean;
}

/**
 * 변수 패턴 정규식
 * {user}, {name}, {count} 등의 패턴 매칭
 */
// 숫자 플레이스홀더({0}) / dotted({user.name}) / hyphen({user-name})도 허용
const VARIABLE_PATTERN = /\{([a-zA-Z0-9_.-]+)\}/g;

/**
 * HTML 태그 패턴 정규식
 * <br>, <b>, </b> 등의 패턴 매칭
 */
// 속성 있는 태그(<b class="x">), 하이픈 태그(<custom-tag>) 지원
// NOTE: '>'가 속성 값 안에 포함되는 극단 케이스는 제외(일반 번역 문자열에서 드묾)
const TAG_PATTERN = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^<>]*?)?\s*\/?>/g;

/**
 * 줄바꿈 패턴 정규식
 */
const NEWLINE_PATTERN_LITERAL = /\\n|<br\s*\/?>/gi;
const NEWLINE_PATTERN_WITH_ACTUAL = /\\n|\n|<br\s*\/?>/gi;

/**
 * 텍스트에서 Ghost Chip 대상 요소 추출
 * @param text - 검사할 텍스트
 * @returns Ghost Chip 매칭 배열
 */
export function findGhostChips(text: string): GhostChipMatch[] {
  return findGhostChipsWithOptions(text);
}

export function findGhostChipsWithOptions(
  text: string,
  opts: GhostChipFindOptions = {},
): GhostChipMatch[] {
  const matches: GhostChipMatch[] = [];
  const newlinePattern = opts.includeActualNewlines
    ? NEWLINE_PATTERN_WITH_ACTUAL
    : NEWLINE_PATTERN_LITERAL;

  // 변수 찾기
  let match: RegExpExecArray | null;
  while ((match = VARIABLE_PATTERN.exec(text)) !== null) {
    matches.push({
      value: match[0],
      type: 'variable',
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // 태그 찾기
  VARIABLE_PATTERN.lastIndex = 0; // 정규식 인덱스 리셋
  while ((match = TAG_PATTERN.exec(text)) !== null) {
    // 줄바꿈 태그는 별도 처리
    if (!/<br\s*\/?>/i.test(match[0])) {
      matches.push({
        value: match[0],
        type: 'tag',
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  // 줄바꿈 찾기
  TAG_PATTERN.lastIndex = 0;
  while ((match = newlinePattern.exec(text)) !== null) {
    matches.push({
      value: match[0],
      type: 'newline',
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // 위치순 정렬
  return matches.sort((a, b) => a.start - b.start);
}

/**
 * Ghost Chip을 HTML로 변환
 * @param match - Ghost Chip 매칭 객체
 * @returns HTML 문자열
 */
export function ghostChipToHtml(match: GhostChipMatch): string {
  const typeClass = `ghost-chip ghost-chip-${match.type}`;
  return `<span class="${typeClass}" data-ghost-chip data-value="${escapeAttr(match.value)}" data-chip-type="${match.type}" contenteditable="false">${escapeHtml(match.value)}</span>`;
}

/**
 * 텍스트 내의 Ghost Chip 대상을 HTML로 변환
 * @param text - 원본 텍스트
 * @returns Ghost Chip이 적용된 HTML
 */
export function processGhostChips(text: string): string {
  const matches = findGhostChips(text);

  if (matches.length === 0) {
    return text;
  }

  let result = '';
  let lastEnd = 0;

  for (const match of matches) {
    // 이전 텍스트 추가
    result += text.slice(lastEnd, match.start);
    // Ghost Chip 추가
    result += ghostChipToHtml(match);
    lastEnd = match.end;
  }

  // 남은 텍스트 추가
  result += text.slice(lastEnd);

  return result;
}

/**
 * HTML 속성 이스케이프
 */
function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * HTML 이스케이프
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Ghost Chip HTML을 원본 텍스트로 복원
 * @param html - Ghost Chip이 포함된 HTML
 * @returns 원본 텍스트
 */
export function extractPlainText(html: string): string {
  // Ghost Chip span에서 data-value 추출
  return html.replace(
    /<span[^>]*data-ghost-chip[^>]*data-value="([^"]*)"[^>]*>[^<]*<\/span>/g,
    '$1'
  );
}

