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
 * JSON 형식의 AI 응답 파싱 시도
 */
function parseJsonResponse(aiResponse: string): ReviewIssue[] | null {
  // JSON 블록 추출 (```json ... ``` 또는 { "issues": [...] })
  const jsonMatch = aiResponse.match(/\{[\s\S]*"issues"[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { issues?: unknown[] };
    const rawIssues = parsed.issues ?? [];

    return rawIssues.map((issue: unknown) => {
      const i = issue as Record<string, unknown>;
      const segmentOrder = typeof i.segmentOrder === 'number' ? i.segmentOrder : 0;
      const segmentGroupId = typeof i.segmentGroupId === 'string' ? i.segmentGroupId : undefined;
      const sourceExcerpt = typeof i.sourceExcerpt === 'string' ? i.sourceExcerpt : '';
      const targetExcerpt = typeof i.targetExcerpt === 'string' ? i.targetExcerpt : '';
      const suggestedFix = typeof i.suggestedFix === 'string' ? i.suggestedFix : '';
      const typeStr = typeof i.type === 'string' ? i.type : '';
      const description = typeof i.description === 'string' ? i.description : '';

      return {
        id: generateIssueId(segmentOrder, typeStr, sourceExcerpt, targetExcerpt),
        segmentOrder,
        segmentGroupId,
        sourceExcerpt,
        targetExcerpt,
        suggestedFix,
        type: categorizeIssueType(typeStr),
        description,
        checked: false,
      };
    });
  } catch {
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
          checked: false,
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
          checked: false,
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
 * AI 응답을 파싱하여 ReviewIssue 배열로 변환
 * 1. JSON 파싱 시도
 * 2. 실패 시 마크다운 테이블 파싱 (폴백)
 */
export function parseReviewResult(aiResponse: string): ReviewIssue[] {
  if (!aiResponse || typeof aiResponse !== 'string') {
    return [];
  }

  // "오역이나 누락이 발견되지 않았습니다" 체크
  if (aiResponse.includes('오역이나 누락이 발견되지 않았습니다') ||
      aiResponse.includes('발견되지 않았습니다') ||
      aiResponse.includes('"issues": []') ||
      aiResponse.includes('"issues":[]')) {
    return [];
  }

  // 1. JSON 파싱 시도
  const jsonIssues = parseJsonResponse(aiResponse);
  if (jsonIssues !== null) {
    return jsonIssues;
  }

  // 2. 마크다운 테이블 파싱 (폴백)
  return parseMarkdownTable(aiResponse);
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
