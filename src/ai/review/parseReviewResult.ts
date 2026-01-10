import type { ReviewIssue, IssueType } from '@/stores/reviewStore';

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
 * AI 응답에서 마크다운 테이블을 파싱하여 ReviewIssue 배열로 변환
 *
 * 예상 테이블 형식:
 * | 세그먼트 | 원문 구절 | 문제 유형 | 설명 |
 * |----------|----------|----------|------|
 * | #0 | Some source text... | 오역 | Description |
 */
export function parseReviewResult(aiResponse: string): ReviewIssue[] {
  if (!aiResponse || typeof aiResponse !== 'string') {
    return [];
  }

  // "오역이나 누락이 발견되지 않았습니다" 체크
  if (aiResponse.includes('오역이나 누락이 발견되지 않았습니다') ||
      aiResponse.includes('발견되지 않았습니다')) {
    return [];
  }

  const issues: ReviewIssue[] = [];

  // 마크다운 테이블 행 추출 (|로 시작하는 줄)
  const lines = aiResponse.split('\n');
  let inTable = false;
  let headerPassed = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 테이블 시작 감지
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      inTable = true;

      // 구분선(---|---|...)은 스킵
      if (trimmed.includes('---') || trimmed.includes(':-')) {
        headerPassed = true;
        continue;
      }

      // 헤더 행 스킵 (세그먼트, 원문 등의 헤더)
      if (!headerPassed) {
        if (trimmed.includes('세그먼트') || trimmed.includes('원문') ||
            trimmed.includes('Segment') || trimmed.includes('Source')) {
          continue;
        }
      }

      // 데이터 행 파싱
      const cells = trimmed
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cells.length >= 4) {
        // 4열 형식: 세그먼트 | 원문 구절 | 문제 유형 | 설명
        const segmentOrder = extractSegmentOrder(cells[0] ?? '');
        const sourceExcerpt = cells[1] ?? '';
        const issueType = categorizeIssueType(cells[2] ?? '');
        const description = cells[3] ?? '';

        issues.push({
          segmentOrder,
          sourceExcerpt,
          type: issueType,
          description,
        });
      } else if (cells.length >= 2) {
        // 2열 형식 (구버전 호환): 누락된 원문 | 오역/누락 여부
        const sourceExcerpt = cells[0] ?? '';
        const description = cells[1] ?? '';
        const issueType = categorizeIssueType(description);

        issues.push({
          segmentOrder: 0, // 구버전 형식에서는 세그먼트 번호 없음
          sourceExcerpt,
          type: issueType,
          description,
        });
      }
    } else if (inTable && trimmed.length === 0) {
      // 빈 줄이 나오면 테이블 종료
      inTable = false;
      headerPassed = false;
    }
  }

  return issues;
}

/**
 * 이슈 목록에서 중복 제거
 * - segmentOrder + sourceExcerpt 앞 20자를 키로 사용
 */
export function deduplicateIssues(issues: ReviewIssue[]): ReviewIssue[] {
  const seen = new Map<string, ReviewIssue>();

  for (const issue of issues) {
    const key = `${issue.segmentOrder}-${issue.sourceExcerpt.slice(0, 20)}`;
    if (!seen.has(key)) {
      seen.set(key, issue);
    }
  }

  return Array.from(seen.values());
}
