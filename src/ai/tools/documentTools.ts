import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore, type ReviewIssue, type IssueType, type IssueSeverity } from '@/stores/reviewStore';
import { stripHtml } from '@/utils/hash';
import { buildSourceDocument } from '@/editor/sourceDocument';
import { buildTargetDocument } from '@/editor/targetDocument';
import { tipTapJsonToMarkdownForTranslation, type TipTapDocJson } from '@/utils/markdownConverter';

/**
 * Source 문서를 Markdown 형식으로 반환
 * - TipTap JSON이 있으면 Markdown으로 변환 (서식 보존)
 * - 없으면 plain text fallback
 *
 * Issue #10 Fix: null 안전성 검사 및 의미 있는 에러 메시지
 */
function resolveSourceDocumentMarkdown(): string {
  const state = useProjectStore.getState();
  const { sourceDocJson, project, sourceDocument } = state;

  // Issue #10 Fix: 프로젝트가 로드되지 않은 경우 명확한 에러 메시지
  if (!project) {
    console.warn('[resolveSourceDocumentMarkdown] No project loaded');
    return '';
  }

  // TipTap JSON이 있으면 Markdown으로 변환
  if (sourceDocJson != null && typeof sourceDocJson === 'object' && sourceDocJson.type === 'doc') {
    try {
      return tipTapJsonToMarkdownForTranslation(sourceDocJson as TipTapDocJson);
    } catch (e) {
      console.warn('[resolveSourceDocumentMarkdown] Markdown conversion failed, falling back to plain text:', e);
    }
  }

  // Fallback: plain text
  const raw = sourceDocument?.trim() ? sourceDocument : buildSourceDocument(project).text;
  return raw ? stripHtml(raw) : '';
}

/**
 * Target 문서를 Markdown 형식으로 반환
 * - TipTap JSON이 있으면 Markdown으로 변환 (서식 보존)
 * - 없으면 plain text fallback
 *
 * Issue #10 Fix: null 안전성 검사 및 의미 있는 에러 메시지
 */
function resolveTargetDocumentMarkdown(): string {
  const state = useProjectStore.getState();
  const { targetDocJson, project, targetDocument } = state;

  // Issue #10 Fix: 프로젝트가 로드되지 않은 경우 명확한 에러 메시지
  if (!project) {
    console.warn('[resolveTargetDocumentMarkdown] No project loaded');
    return '';
  }

  // TipTap JSON이 있으면 Markdown으로 변환
  if (targetDocJson != null && typeof targetDocJson === 'object' && targetDocJson.type === 'doc') {
    try {
      return tipTapJsonToMarkdownForTranslation(targetDocJson as TipTapDocJson);
    } catch (e) {
      console.warn('[resolveTargetDocumentMarkdown] Markdown conversion failed, falling back to plain text:', e);
    }
  }

  // Fallback: plain text
  const raw = targetDocument?.trim() ? targetDocument : buildTargetDocument(project).text;
  return raw ? stripHtml(raw) : '';
}

// 큰 문서(토큰 폭발 위험)에서만 자동으로 잘라서 반환하는 옵션
// - 기본 호출({})은 "짧으면 전체, 길면 truncate" (auto)
// - query는 문서가 아주 길 때만 주변 발췌에 사용합니다.
const DocumentToolArgsSchema = z.object({
  query: z.string().optional().describe('문서가 매우 길 때, 이 구절 주변만 발췌하고 싶으면 사용'),
  maxChars: z.number().int().min(1000).max(20000).optional().describe('문서가 길 때 반환할 최대 문자 수 (기본 8000)'),
  aroundChars: z.number().int().min(200).max(4000).optional().describe('query 주변 발췌 범위(문자) (기본 900)'),
});

type DocumentToolArgs = z.infer<typeof DocumentToolArgsSchema>;

function autoSliceLargeDocument(text: string, args: DocumentToolArgs): string {
  const t = text ?? '';
  const maxChars = args.maxChars ?? 8000;
  if (t.length <= maxChars) return t;

  const query = args.query?.trim();
  const around = args.aroundChars ?? 900;

  // 아주 큰 문서일 때만 query 주변 발췌를 시도
  if (query) {
    const idx = t.indexOf(query);
    if (idx >= 0) {
      const start = Math.max(0, idx - around);
      const end = Math.min(t.length, idx + query.length + around);
      const chunk = t.slice(start, end);
      return chunk.length <= maxChars ? chunk : chunk.slice(0, maxChars);
    }
  }

  // query가 없거나 못 찾으면: head+tail (문서 앞/뒤 맥락 모두 조금 확보)
  const marker = '\n...\n';
  const budget = Math.max(0, maxChars - marker.length);
  const headLen = Math.floor(budget * 0.62);
  const tailLen = Math.max(0, budget - headLen);
  const head = t.slice(0, headLen);
  const tail = tailLen > 0 ? t.slice(Math.max(0, t.length - tailLen)) : '';
  return `${head}${marker}${tail}`;
}

export const getSourceDocumentTool = tool(
  async (rawArgs) => {
    const args = DocumentToolArgsSchema.safeParse(rawArgs ?? {});
    const parsed = args.success ? args.data : {};
    const markdown = resolveSourceDocumentMarkdown();
    // Issue #10 Fix: 더 의미 있는 에러 메시지
    if (!markdown || markdown.trim().length === 0) {
      const { project } = useProjectStore.getState();
      if (!project) {
        throw new Error('프로젝트가 로드되지 않았습니다. 프로젝트를 먼저 열어주세요.');
      }
      throw new Error('원문 문서가 비어있습니다. Source 패널에 내용을 입력해주세요.');
    }
    return autoSliceLargeDocument(markdown, parsed);
  },
  {
    name: 'get_source_document',
    description:
      '원문(Source) 문서를 Markdown 형식으로 가져옵니다. 사용자가 문서 내용, 번역 품질, 표현에 대해 질문하면 먼저 이 도구를 호출하세요. 문서가 길면 자동으로 일부만 반환됩니다. 서식(헤딩, 리스트, 볼드 등)이 Markdown으로 표현됩니다.',
    schema: DocumentToolArgsSchema,
  },
);

export const getTargetDocumentTool = tool(
  async (rawArgs) => {
    const args = DocumentToolArgsSchema.safeParse(rawArgs ?? {});
    const parsed = args.success ? args.data : {};
    const markdown = resolveTargetDocumentMarkdown();
    // Issue #10 Fix: 더 의미 있는 에러 메시지
    if (!markdown || markdown.trim().length === 0) {
      const { project } = useProjectStore.getState();
      if (!project) {
        throw new Error('프로젝트가 로드되지 않았습니다. 프로젝트를 먼저 열어주세요.');
      }
      throw new Error('번역문 문서가 비어있습니다. 먼저 번역을 실행하거나 Target 패널에 내용을 입력해주세요.');
    }
    return autoSliceLargeDocument(markdown, parsed);
  },
  {
    name: 'get_target_document',
    description:
      '번역문(Target) 문서를 Markdown 형식으로 가져옵니다. 사용자가 번역 결과, 표현 자연스러움, 오역 여부에 대해 질문하면 먼저 이 도구를 호출하세요. 문서가 길면 자동으로 일부만 반환됩니다. 서식(헤딩, 리스트, 볼드 등)이 Markdown으로 표현됩니다.',
    schema: DocumentToolArgsSchema,
  },
);

// ============================================
// Review Results Tool
// ============================================

const ReviewResultsArgsSchema = z.object({
  severityFilter: z.enum(['all', 'critical', 'major', 'minor']).optional()
    .describe('심각도 필터 (기본: all)'),
  typeFilter: z.enum(['all', 'omission', 'addition', 'nuance_shift', 'terminology', 'mistranslation']).optional()
    .describe('이슈 유형 필터 (기본: all)'),
  uncheckedOnly: z.boolean().optional()
    .describe('체크되지 않은 이슈만 (기본: false)'),
});

type ReviewResultsArgs = z.infer<typeof ReviewResultsArgsSchema>;

const SEVERITY_LABELS: Record<IssueSeverity, string> = {
  critical: '심각',
  major: '주요',
  minor: '경미',
};

const TYPE_LABELS: Record<IssueType, string> = {
  omission: '누락',
  addition: '추가',
  nuance_shift: '뉘앙스 변형',
  terminology: '용어 불일치',
  mistranslation: '오역',
};

function formatReviewIssue(issue: ReviewIssue, index: number): string {
  const severityLabel = SEVERITY_LABELS[issue.severity] || issue.severity;
  const typeLabel = TYPE_LABELS[issue.type] || issue.type;
  const checkedMark = issue.checked ? '✓' : '○';

  const lines = [
    `${index + 1}. [${checkedMark}] [${severityLabel}] ${typeLabel}`,
    `   원문: "${issue.sourceExcerpt}"`,
    `   번역: "${issue.targetExcerpt}"`,
    `   설명: ${issue.description}`,
  ];

  if (issue.suggestedFix) {
    lines.push(`   제안: "${issue.suggestedFix}"`);
  }

  return lines.join('\n');
}

export const getReviewResultsTool = tool(
  async (rawArgs) => {
    const args = ReviewResultsArgsSchema.safeParse(rawArgs ?? {});
    const parsed: ReviewResultsArgs = args.success ? args.data : {};

    const reviewState = useReviewStore.getState();
    const { isReviewing, results, progress } = reviewState;

    // 검수 중인 경우
    if (isReviewing) {
      return `검수가 진행 중입니다. (${progress.completed}/${progress.total} 청크 완료)\n완료 후 다시 조회해주세요.`;
    }

    // 검수 결과가 없는 경우
    if (results.length === 0) {
      return '검수 결과가 없습니다. 검수 패널에서 검수를 먼저 실행해주세요.';
    }

    // 모든 이슈 가져오기
    let issues = reviewState.getAllIssues();

    // 필터 적용
    if (parsed.severityFilter && parsed.severityFilter !== 'all') {
      issues = issues.filter(i => i.severity === parsed.severityFilter);
    }
    if (parsed.typeFilter && parsed.typeFilter !== 'all') {
      issues = issues.filter(i => i.type === parsed.typeFilter);
    }
    if (parsed.uncheckedOnly) {
      issues = issues.filter(i => !i.checked);
    }

    // 결과 없음
    if (issues.length === 0) {
      const filterDesc = [];
      if (parsed.severityFilter && parsed.severityFilter !== 'all') {
        filterDesc.push(`심각도: ${SEVERITY_LABELS[parsed.severityFilter as IssueSeverity]}`);
      }
      if (parsed.typeFilter && parsed.typeFilter !== 'all') {
        filterDesc.push(`유형: ${TYPE_LABELS[parsed.typeFilter as IssueType]}`);
      }
      if (parsed.uncheckedOnly) {
        filterDesc.push('미체크만');
      }
      const filterText = filterDesc.length > 0 ? ` (필터: ${filterDesc.join(', ')})` : '';
      return `조건에 맞는 이슈가 없습니다${filterText}.`;
    }

    // 요약 통계
    const totalIssues = reviewState.getAllIssues();
    const checkedCount = totalIssues.filter(i => i.checked).length;
    const criticalCount = totalIssues.filter(i => i.severity === 'critical').length;
    const majorCount = totalIssues.filter(i => i.severity === 'major').length;
    const minorCount = totalIssues.filter(i => i.severity === 'minor').length;

    const summary = [
      `## 검수 결과 요약`,
      `- 총 이슈: ${totalIssues.length}개 (체크됨: ${checkedCount}개)`,
      `- 심각도별: 심각 ${criticalCount}개, 주요 ${majorCount}개, 경미 ${minorCount}개`,
      '',
    ];

    // 필터 적용 안내
    if (issues.length !== totalIssues.length) {
      summary.push(`(필터 적용: ${issues.length}개 표시 중)`);
      summary.push('');
    }

    // 이슈 목록
    summary.push('## 이슈 목록');
    summary.push('');

    const formattedIssues = issues.map((issue, idx) => formatReviewIssue(issue, idx));

    return summary.join('\n') + formattedIssues.join('\n\n');
  },
  {
    name: 'get_review_results',
    description:
      '번역 검수 결과를 조회합니다. 검수에서 발견된 이슈(누락, 오역, 용어 불일치 등) 목록을 반환합니다. 심각도나 유형별로 필터링할 수 있습니다. 사용자가 검수 결과, 이슈, 오류에 대해 물어볼 때 이 도구를 호출하세요.',
    schema: ReviewResultsArgsSchema,
  },
);


