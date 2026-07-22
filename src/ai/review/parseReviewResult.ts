import type { ReviewIssue, IssueType, IssueSeverity } from '@/stores/reviewStore';
import { generateIssueId } from '@/stores/reviewStore';
import { stripRichTextMarkup } from '@/utils/normalizeForSearch';

/**
 * 문제 유형을 분류 (Two-Pass Review 타입)
 */
function categorizeIssueType(typeText: string): IssueType {
  const normalized = typeText.toLowerCase().trim();

  if (normalized.includes('omission') || normalized.includes('누락') || normalized.includes('missing')) {
    return 'omission';
  }

  if (normalized.includes('addition') || normalized.includes('추가')) {
    return 'addition';
  }

  if (normalized.includes('mistranslation') || normalized.includes('오역') ||
    normalized.includes('error') || normalized.includes('왜곡') || normalized.includes('distortion') ||
    normalized.includes('nuance') || normalized.includes('뉘앙스') || normalized.includes('shift') ||
    normalized.includes('tone') || normalized.includes('톤') || normalized.includes('강조')) {
    return 'mistranslation';
  }

  if (normalized.includes('grammar') || normalized.includes('문법') ||
    normalized.includes('단복수') || normalized.includes('관사') || normalized.includes('시제')) {
    return 'grammar';
  }

  if (normalized.includes('awkward') || normalized.includes('직역') || normalized.includes('어색') ||
    normalized.includes('부자연') || normalized.includes('unnatural') ||
    normalized.includes('collocation') || normalized.includes('콜로케이션') ||
    normalized.includes('expression') || normalized.includes('표현') ||
    normalized.includes('sentence structure') || normalized.includes('문장 구조')) {
    return 'awkward';
  }

  if (normalized.includes('terminology') || normalized.includes('용어') ||
    normalized.includes('glossary') || normalized.includes('term')) {
    return 'terminology';
  }

  // 기본값
  return 'mistranslation';
}

/**
 * 심각도 분류
 * - 레이블(현재 형식): critical/major/minor 텍스트 그대로 매핑
 * - 숫자(레거시): 5→critical, 4→major, 1~3→minor
 */
function categorizeSeverity(severityText: string): IssueSeverity {
  const normalized = severityText.toLowerCase().trim();

  // 숫자 파싱 (레거시 형식: 1~5)
  const numMatch = normalized.match(/^(\d)/);
  if (numMatch) {
    const score = parseInt(numMatch[1]!, 10);
    if (score >= 5) return 'critical';
    if (score === 4) return 'major';
    return 'minor';
  }

  // 레이블 파싱 (현재 형식)
  if (normalized.includes('critical') || normalized.includes('심각')) return 'critical';
  if (normalized.includes('major') || normalized.includes('중요')) return 'major';
  if (normalized.includes('minor') || normalized.includes('경미') || normalized.includes('사소')) return 'minor';

  return 'major';
}

/**
 * 마커 기반 콘텐츠 추출
 * ---REVIEW_START--- 와 ---REVIEW_END--- 사이의 콘텐츠 추출
 */
function extractMarkedContent(text: string): string | null {
  const startMarker = '---REVIEW_START---';
  const endMarker = '---REVIEW_END---';
  const startIdx = text.indexOf(startMarker);
  const endIdx = text.lastIndexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return text.slice(startIdx + startMarker.length, endIdx).trim();
  }
  if (startIdx !== -1 || endIdx !== -1) {
    throw new Error('검수 응답이 완전하지 않습니다. 다시 시도해주세요.');
  }
  return null;
}

/**
 * Markdown 형식의 이슈 파싱 (새 출력 형식)
 * 
 * 예시:
 * ### Issue #1
 * - **Source**: "원문 텍스트"
 * - **Target**: "번역 텍스트"
 * - **Type**: Omission
 * - **Severity**: Critical
 * - **SegmentGroupId**: seg-001
 * - **Explanation**: 문제 설명
 * - **Suggestion**: 수정 제안
 */
function parseMarkdownIssues(content: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];

  // 이슈 블록 분리 (### Issue #N 패턴)
  const issueBlocks = content.split(/###\s*Issue\s*#?\d*/i).filter(block => block.trim());

  for (const block of issueBlocks) {
    const lines = block.split('\n');

    let sourceExcerpt = '';
    let targetExcerpt = '';
    let typeStr = '';
    let severityStr = '';
    let segmentGroupId: string | undefined;
    let explanation = '';
    let suggestion = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // **Source**: "텍스트" 또는 - **Source**: "텍스트"
      // 직선 따옴표는 regex의 옵셔널 "?로 벗겨지지만, 곡선/CJK 따옴표는 콘텐츠일 수
      // 있으므로 원본 그대로 보존한다(감싸기 판단은 apply 시점에서 문서 기준으로 수행).
      const sourceMatch = trimmed.match(/\*\*Source\*\*:\s*"?(.*?)"?\s*$/i);
      if (sourceMatch) {
        sourceExcerpt = sourceMatch[1]?.trim() || '';
        continue;
      }

      // **Target**: "텍스트" 또는 (missing)
      const targetMatch = trimmed.match(/\*\*Target\*\*:\s*"?(.*?)"?\s*$/i);
      if (targetMatch) {
        const val = targetMatch[1]?.trim() || '';
        targetExcerpt = val === '(missing)' ? '' : val;
        continue;
      }

      // **Type**: Omission
      const typeMatch = trimmed.match(/\*\*Type\*\*:\s*(.+)/i);
      if (typeMatch) {
        typeStr = typeMatch[1]?.trim() || '';
        continue;
      }

      // **Severity**: Critical
      const severityMatch = trimmed.match(/\*\*Severity\*\*:\s*(.+)/i);
      if (severityMatch) {
        severityStr = severityMatch[1]?.trim() || '';
        continue;
      }

      // **SegmentGroupId**: seg-001
      const segmentMatch = trimmed.match(/\*\*SegmentGroupId\*\*:\s*(.+)/i);
      if (segmentMatch) {
        segmentGroupId = segmentMatch[1]?.trim();
        continue;
      }

      // **Explanation**: 설명
      const explanationMatch = trimmed.match(/\*\*Explanation\*\*:\s*(.+)/i);
      if (explanationMatch) {
        explanation = explanationMatch[1]?.trim() || '';
        continue;
      }

      // **Suggestion**: 제안
      const suggestionMatch = trimmed.match(/\*\*Suggestion\*\*:\s*(.+)/i);
      if (suggestionMatch) {
        suggestion = suggestionMatch[1]?.trim() || '';
        continue;
      }
    }

    // 유효한 이슈인지 확인 (최소한 타입과 source/target 중 하나는 있어야 함)
    const cleanSourceExcerpt = stripRichTextMarkup(sourceExcerpt);
    const cleanTargetExcerpt = stripRichTextMarkup(targetExcerpt);
    const cleanSuggestion = stripRichTextMarkup(suggestion);
    const cleanExplanation = stripRichTextMarkup(explanation);

    if (typeStr && (cleanSourceExcerpt || cleanTargetExcerpt)) {
      const type = categorizeIssueType(typeStr);
      const severity = categorizeSeverity(severityStr);

      issues.push({
        // Known limitation: segmentOrder always 0 — AI output doesn't include order;
        // deduplication relies on segmentGroupId + type + excerpt instead.
        id: generateIssueId(0, typeStr, cleanSourceExcerpt, cleanTargetExcerpt),
        segmentOrder: 0,
        segmentGroupId,
        sourceExcerpt: cleanSourceExcerpt,
        targetExcerpt: cleanTargetExcerpt,
        suggestedFix: cleanSuggestion,
        type,
        severity,
        description: cleanExplanation,
        checked: true,
      });
    }
  }

  return issues;
}

/**
 * JSON 형식 이슈 파싱 (레거시 호환)
 */
function parseJsonIssues(content: string): ReviewIssue[] | null {
  // JSON 객체 추출 시도
  const jsonMatch = content.match(/\{[\s\S]*"issues"[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { issues?: unknown[] };
    const rawIssues = parsed.issues ?? [];

    return rawIssues.map((issue: unknown) => {
      const i = issue as Record<string, unknown>;

      const segmentOrder = typeof i.segmentOrder === 'number'
        ? i.segmentOrder
        : typeof i.segmentOrder === 'string'
          ? parseInt(i.segmentOrder, 10) || 0
          : 0;
      const segmentGroupId = typeof i.segmentGroupId === 'string' ? i.segmentGroupId : undefined;
      const sourceExcerpt = stripRichTextMarkup(typeof i.sourceExcerpt === 'string' ? i.sourceExcerpt : '');
      const targetExcerpt = stripRichTextMarkup(typeof i.targetExcerpt === 'string' ? i.targetExcerpt : '');
      // suggestedFix 또는 suggestion 키 모두 처리 (프롬프트 호환성)
      const rawSuggestedFix = typeof i.suggestedFix === 'string' ? i.suggestedFix
        : typeof i.suggestion === 'string' ? i.suggestion
          : typeof i.Suggestion === 'string' ? i.Suggestion
            : '';
      const suggestedFix = stripRichTextMarkup(rawSuggestedFix);
      const typeStr = typeof i.type === 'string' ? i.type : '';
      const severityStr = typeof i.severity === 'string' ? i.severity : '';

      // problem, reason 필드를 합쳐서 description 생성
      const problem = typeof i.problem === 'string' ? i.problem : '';
      const reason = typeof i.reason === 'string' ? i.reason : '';
      const explanation = typeof i.explanation === 'string' ? i.explanation : '';
      const legacyDescription = typeof i.description === 'string' ? i.description : '';

      const description = stripRichTextMarkup(explanation || (problem
        ? [problem, reason].filter(Boolean).join(' | ')
        : legacyDescription));

      return {
        id: generateIssueId(segmentOrder, typeStr, sourceExcerpt, targetExcerpt),
        segmentOrder,
        segmentGroupId,
        sourceExcerpt,
        targetExcerpt,
        suggestedFix,
        type: categorizeIssueType(typeStr),
        severity: categorizeSeverity(severityStr),
        description,
        checked: true,
      };
    });
  } catch (e) {
    console.warn('[parseReviewResult] JSON parsing failed:', e);
    return null;
  }
}

/**
 * AI 오류 메시지 패턴 감지
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
 * 
 * 파싱 순서:
 * 1. 마커 기반 콘텐츠 추출 (---REVIEW_START/END---)
 * 2. Markdown 형식 파싱 (새 형식)
 * 3. JSON 형식 파싱 (레거시 호환)
 *
 * @throws Error AI 오류 메시지가 감지될 경우
 */
export function parseReviewResult(aiResponse: string): ReviewIssue[] {
  if (typeof aiResponse !== 'string' || !aiResponse.trim()) {
    throw new Error('검수 응답이 비어 있습니다. 다시 시도해주세요.');
  }

  // 마커 기반 콘텐츠 추출 (에러 감지보다 우선)
  const markedContent = extractMarkedContent(aiResponse);

  // AI 오류 메시지 감지 — 마커가 있으면 정상 응답으로 간주하고 스킵
  if (markedContent === null && detectAiErrorResponse(aiResponse)) {
    console.error('[parseReviewResult] AI error response detected:', aiResponse.slice(0, 300));
    throw new Error('AI 응답에서 오류가 감지되었습니다. 다시 시도해주세요.');
  }

  const contentToParse = markedContent ?? aiResponse;

  const explicitNoIssues = /(?:^|\n)\s*NO_ISSUES\s*(?:\n|$)/i.test(contentToParse)
    || /(?:^|\n)\s*(?:Review complete\.\s*)?No issues found\.?\s*(?:\n|$)/i.test(contentToParse)
    || /(?:^|\n)\s*(?:-\s*)?Issues detected:\s*0\s*(?:\n|$)/i.test(contentToParse)
    || /(?:^|\n)\s*이슈 없음\s*(?:\n|$)/.test(contentToParse);
  if (explicitNoIssues) {
    return [];
  }

  // 1차: Markdown 형식 파싱 (새 형식)
  const markdownIssues = parseMarkdownIssues(contentToParse);
  if (markdownIssues.length > 0) {
    return markdownIssues;
  }

  // 2차: JSON 형식 파싱 (레거시 호환)
  const jsonIssues = parseJsonIssues(contentToParse);
  if (jsonIssues !== null) {
    return jsonIssues;
  }

  console.warn(
    '[parseReviewResult] Parsing failed, response may be malformed:',
    aiResponse.slice(0, 300),
  );
  throw new Error('검수 응답 형식을 확인할 수 없습니다. 다시 시도해주세요.');
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
