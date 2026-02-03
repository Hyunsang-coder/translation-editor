import type { ReviewIssue, IssueType } from '@/stores/reviewStore';
import { generateIssueId } from '@/stores/reviewStore';

/**
 * 문제 유형을 분류
 */
function categorizeIssueType(typeText: string): IssueType {
  const normalized = typeText.toLowerCase().trim();

  if (normalized.includes('오역') || normalized.includes('error') || normalized.includes('mistranslation')) {
    return 'error';
  }

  if (normalized.includes('누락') || normalized.includes('omission') || normalized.includes('missing')) {
    return 'omission';
  }

  if (normalized.includes('왜곡') || normalized.includes('distortion') || normalized.includes('강도') || normalized.includes('정도')) {
    return 'distortion';
  }

  if (normalized.includes('일관성') || normalized.includes('consistency') ||
      normalized.includes('용어') || normalized.includes('glossary') || normalized.includes('term')) {
    return 'consistency';
  }

  // 기타 경우 기본값
  return 'error';
}

/**
 * 세그먼트 번호 추출
 */
function extractSegmentOrder(text: string): number {
  // #N, #0, #1 등의 형태에서 숫자 추출
  const match = text.match(/#?(\d+)/);
  return match && match[1] ? parseInt(match[1], 10) : 0;
}

/**
 * 마커 기반 JSON 추출 (Phase 3)
 * ---REVIEW_START--- 와 ---REVIEW_END--- 사이의 JSON 추출
 */
function extractMarkedJson(text: string): string | null {
  const startMarker = '---REVIEW_START---';
  const endMarker = '---REVIEW_END---';
  const startIdx = text.indexOf(startMarker);
  const endIdx = text.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return text.slice(startIdx + startMarker.length, endIdx).trim();
  }
  return null;
}

/**
 * 균형 잡힌 중괄호로 JSON 객체 추출
 * greedy 정규식 대신 중괄호 카운팅으로 정확한 JSON 범위 찾기
 */
function extractJsonObject(text: string): string | null {
  // "issues" 키워드가 포함된 첫 번째 { 찾기
  const issuesIndex = text.indexOf('"issues"');
  if (issuesIndex === -1) return null;

  // "issues" 앞의 가장 가까운 { 찾기
  let startIndex = -1;
  for (let i = issuesIndex - 1; i >= 0; i--) {
    if (text[i] === '{') {
      startIndex = i;
      break;
    }
  }
  if (startIndex === -1) return null;

  // 중괄호 카운팅으로 매칭되는 } 찾기
  let depth = 0;
  for (let i = startIndex; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }
  return null;
}

/**
 * JSON 형식의 AI 응답 파싱 시도
 */
function parseJsonResponse(aiResponse: string): ReviewIssue[] | null {
  // JSON 블록 추출 (균형 잡힌 중괄호 매칭)
  const jsonStr = extractJsonObject(aiResponse);
  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr) as { issues?: unknown[] };
    const rawIssues = parsed.issues ?? [];

    return rawIssues.map((issue: unknown) => {
      const i = issue as Record<string, unknown>;
      // segmentOrder가 문자열("1")인 경우에도 숫자로 변환
      const segmentOrder = typeof i.segmentOrder === 'number'
        ? i.segmentOrder
        : typeof i.segmentOrder === 'string'
          ? parseInt(i.segmentOrder, 10) || 0
          : 0;
      const segmentGroupId = typeof i.segmentGroupId === 'string' ? i.segmentGroupId : undefined;
      const sourceExcerpt = typeof i.sourceExcerpt === 'string' ? i.sourceExcerpt : '';
      const targetExcerpt = typeof i.targetExcerpt === 'string' ? i.targetExcerpt : '';
      const suggestedFix = typeof i.suggestedFix === 'string' ? i.suggestedFix : '';
      const typeStr = typeof i.type === 'string' ? i.type : '';

      // problem, reason, impact 필드를 합쳐서 description 생성
      const problem = typeof i.problem === 'string' ? i.problem : '';
      const reason = typeof i.reason === 'string' ? i.reason : '';
      const impact = typeof i.impact === 'string' ? i.impact : '';
      const legacyDescription = typeof i.description === 'string' ? i.description : '';

      // 새 형식(problem/reason/impact) 우선, 없으면 기존 description 사용
      const description = problem
        ? [problem, reason, impact].filter(Boolean).join(' | ')
        : legacyDescription;

      return {
        id: generateIssueId(segmentOrder, typeStr, sourceExcerpt, targetExcerpt),
        segmentOrder,
        segmentGroupId,
        sourceExcerpt,
        targetExcerpt,
        suggestedFix,
        type: categorizeIssueType(typeStr),
        description,
        checked: true,
      };
    });
  } catch (e) {
    console.warn('[parseReviewResult] JSON parsing failed:', e, 'input:', jsonStr.slice(0, 200));
    return null; // JSON 파싱 실패 → 마크다운 폴백
  }
}

/**
 * 마크다운 테이블 형식의 AI 응답 파싱 (폴백)
 */
function parseMarkdownTable(aiResponse: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];

  const lines = aiResponse.split('\n');
  let inTable = false;
  let headerPassed = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      inTable = true;

      if (trimmed.includes('---') || trimmed.includes(':-')) {
        headerPassed = true;
        continue;
      }

      if (!headerPassed) {
        if (trimmed.includes('세그먼트') || trimmed.includes('원문') ||
            trimmed.includes('Segment') || trimmed.includes('Source')) {
          continue;
        }
      }

      const cells = trimmed
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cells.length >= 4) {
        const segmentOrder = extractSegmentOrder(cells[0] ?? '');
        const sourceExcerpt = cells[1] ?? '';
        const issueType = categorizeIssueType(cells[2] ?? '');
        const description = cells[3] ?? '';

        issues.push({
          id: generateIssueId(segmentOrder, cells[2] ?? '', sourceExcerpt, ''),
          segmentOrder,
          segmentGroupId: undefined, // 마크다운 테이블에서는 없음
          sourceExcerpt,
          targetExcerpt: '', // 마크다운 테이블에서는 없음
          suggestedFix: '',  // 마크다운 테이블에서는 없음
          type: issueType,
          description,
          checked: true,
        });
      } else if (cells.length >= 2) {
        const sourceExcerpt = cells[0] ?? '';
        const description = cells[1] ?? '';
        const issueType = categorizeIssueType(description);

        issues.push({
          id: generateIssueId(0, description, sourceExcerpt, ''),
          segmentOrder: 0,
          segmentGroupId: undefined,
          sourceExcerpt,
          targetExcerpt: '',
          suggestedFix: '',
          type: issueType,
          description,
          checked: true,
        });
      }
    } else if (inTable && trimmed.length === 0) {
      inTable = false;
      headerPassed = false;
    }
  }

  return issues;
}

/**
 * AI 오류 메시지 패턴 감지
 * AI가 실제 검수 대신 오류 메시지만 반환하는 경우 감지
 */
function detectAiErrorResponse(text: string): boolean {
  const errorPatterns = [
    /cannot\s+(review|analyze|process)/i,
    /unable\s+to\s+(review|analyze|process)/i,
    /error\s*:\s*/i,
    /api\s+(limit|error|quota)/i,
    /rate\s+limit/i,
    /token\s+limit/i,
    /context\s+(length|limit)/i,
  ];
  return errorPatterns.some((pattern) => pattern.test(text));
}

/**
 * AI 응답을 파싱하여 ReviewIssue 배열로 변환
 * Phase 3: 마커 기반 추출 우선
 * 1. 마커 기반 JSON 추출 (---REVIEW_START/END---)
 * 2. brace counting 기반 JSON 추출 (기존)
 * 3. 마크다운 테이블 파싱 (fallback)
 *
 * @throws Error AI 오류 메시지가 감지되거나 파싱 완전 실패 시
 */
export function parseReviewResult(aiResponse: string): ReviewIssue[] {
  if (!aiResponse || typeof aiResponse !== 'string') {
    return [];
  }

  // AI 오류 메시지 감지 (false positive 방지)
  if (detectAiErrorResponse(aiResponse)) {
    console.error('[parseReviewResult] AI error response detected:', aiResponse.slice(0, 300));
    throw new Error('AI 응답에서 오류가 감지되었습니다. 다시 시도해주세요.');
  }

  // 1차: 마커 기반 추출 (Phase 3 신규)
  const markedJson = extractMarkedJson(aiResponse);
  if (markedJson) {
    const issues = parseJsonResponse(markedJson);
    if (issues !== null) return issues;
  }

  // 2차: brace counting (기존)
  const jsonIssues = parseJsonResponse(aiResponse);
  if (jsonIssues !== null) {
    return jsonIssues;
  }

  // 3차: 마크다운 테이블 (fallback)
  const markdownIssues = parseMarkdownTable(aiResponse);

  // 파싱 완전 실패: JSON도 마크다운도 찾지 못했고, 응답이 의미있는 길이인 경우
  // (짧은 응답은 "문제 없음" 또는 빈 결과일 수 있음)
  if (markdownIssues.length === 0 && aiResponse.trim().length > 100) {
    console.warn(
      '[parseReviewResult] Complete parsing failure, response may be malformed:',
      aiResponse.slice(0, 300),
    );
  }

  return markdownIssues;
}

/**
 * 이슈 목록에서 중복 제거
 * - id 기반 (결정적 ID)
 */
export function deduplicateIssues(issues: ReviewIssue[]): ReviewIssue[] {
  const seen = new Map<string, ReviewIssue>();

  for (const issue of issues) {
    if (!seen.has(issue.id)) {
      seen.set(issue.id, issue);
    }
  }

  return Array.from(seen.values());
}
