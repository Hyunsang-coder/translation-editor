/**
 * 문서 내보내기 유틸리티
 *
 * TipTap JSON → Markdown/HTML 변환 + 대역(Bilingual) 레이아웃 지원
 */

import { tipTapJsonToMarkdown, tipTapJsonToHtml, type TipTapDocJson } from './markdownConverter';
import type { ReviewIssue } from '@/stores/reviewStore';

// ── Types ──

export type ContentMode = 'source' | 'target' | 'bilingual';
export type BilingualLayout = 'table' | 'interleaved' | 'sequential';
export type ExportFormat = 'markdown' | 'html';

export interface ExportOptions {
  contentMode: ContentMode;
  bilingualLayout: BilingualLayout;
  format: ExportFormat;
  includeReview: boolean;
  projectTitle: string;
}

export interface ExportInput {
  sourceJson: TipTapDocJson | null;
  targetJson: TipTapDocJson | null;
  reviewIssues?: ReviewIssue[];
}

// ── Public API ──

/**
 * 문서를 지정된 형식으로 내보내기
 */
export function exportDocument(input: ExportInput, options: ExportOptions): string {
  const { contentMode, format } = options;

  let body: string;

  if (contentMode === 'source') {
    body = renderSingle(input.sourceJson, format);
  } else if (contentMode === 'target') {
    body = renderSingle(input.targetJson, format);
  } else {
    body = renderBilingual(input, options);
  }

  // 리뷰 이슈 첨부
  if (options.includeReview && input.reviewIssues && input.reviewIssues.length > 0) {
    body += renderReviewSection(input.reviewIssues, format);
  }

  if (format === 'html') {
    return wrapHtml(body, options.projectTitle);
  }

  return body;
}

/**
 * 클립보드에 복사 (HTML + plain text 동시)
 */
export async function copyToClipboard(input: ExportInput, options: ExportOptions): Promise<void> {
  const htmlContent = exportDocument(input, { ...options, format: 'html' });
  const textContent = exportDocument(input, { ...options, format: 'markdown' });

  const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
  const textBlob = new Blob([textContent], { type: 'text/plain' });

  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': htmlBlob,
      'text/plain': textBlob,
    }),
  ]);
}

// ── Internal Helpers ──

function renderSingle(json: TipTapDocJson | null, format: ExportFormat): string {
  if (!json) return '';
  return format === 'markdown' ? tipTapJsonToMarkdown(json) : tipTapJsonToHtml(json);
}

function renderBilingual(input: ExportInput, options: ExportOptions): string {
  const { format, bilingualLayout } = options;
  const sourceContent = input.sourceJson;
  const targetContent = input.targetJson;

  switch (bilingualLayout) {
    case 'table':
      return renderTable(sourceContent, targetContent, format);
    case 'interleaved':
      return renderInterleaved(sourceContent, targetContent, format);
    case 'sequential':
      return renderSequential(sourceContent, targetContent, format);
  }
}

function renderTable(
  source: TipTapDocJson | null,
  target: TipTapDocJson | null,
  format: ExportFormat,
): string {
  const sourceHtml = source ? tipTapJsonToHtml(source) : '';
  const targetHtml = target ? tipTapJsonToHtml(target) : '';

  if (format === 'html') {
    return `<table class="bilingual-table">
<thead><tr><th>Source</th><th>Target</th></tr></thead>
<tbody><tr>
<td>${sourceHtml}</td>
<td>${targetHtml}</td>
</tr></tbody>
</table>`;
  }

  // Markdown: table layout → fallback to sequential (complex table impractical)
  return renderSequential(source, target, 'markdown');
}

function renderInterleaved(
  source: TipTapDocJson | null,
  target: TipTapDocJson | null,
  format: ExportFormat,
): string {
  const sourceParts = splitDocByBlocks(source);
  const targetParts = splitDocByBlocks(target);
  const maxLen = Math.max(sourceParts.length, targetParts.length);

  const parts: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const sPart = sourceParts[i] ?? '';
    const tPart = targetParts[i] ?? '';

    if (format === 'html') {
      if (sPart) parts.push(`<blockquote class="source-block">${sPart}</blockquote>`);
      if (tPart) parts.push(`<div class="target-block">${tPart}</div>`);
    } else {
      if (sPart) parts.push(`> ${sPart.split('\n').join('\n> ')}`);
      if (tPart) parts.push(tPart);
      parts.push('');
    }
  }

  return parts.join('\n');
}

function renderSequential(
  source: TipTapDocJson | null,
  target: TipTapDocJson | null,
  format: ExportFormat,
): string {
  const sourceStr = source
    ? (format === 'markdown' ? tipTapJsonToMarkdown(source) : tipTapJsonToHtml(source))
    : '';
  const targetStr = target
    ? (format === 'markdown' ? tipTapJsonToMarkdown(target) : tipTapJsonToHtml(target))
    : '';

  if (format === 'html') {
    return `<section class="source-section">
<h2>Source</h2>
${sourceStr}
</section>
<hr />
<section class="target-section">
<h2>Target</h2>
${targetStr}
</section>`;
  }

  return `${sourceStr}\n\n---\n\n${targetStr}`;
}

/**
 * TipTap doc JSON의 content 배열을 블록별로 분리하여 각각 변환
 */
function splitDocByBlocks(json: TipTapDocJson | null): string[] {
  if (!json) return [];

  const content = json.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content) || content.length === 0) return [];

  return content.map((node) => {
    const miniDoc: TipTapDocJson = { type: 'doc', content: [node] };
    return tipTapJsonToHtml(miniDoc);
  });
}

function renderReviewSection(issues: ReviewIssue[], format: ExportFormat): string {
  if (format === 'html') {
    const rows = issues
      .map(
        (issue) => `<tr>
<td>${escapeHtml(issue.type)}</td>
<td>${escapeHtml(issue.severity)}</td>
<td>${escapeHtml(issue.sourceExcerpt)}</td>
<td>${escapeHtml(issue.targetExcerpt)}</td>
<td>${escapeHtml(issue.suggestedFix)}</td>
<td>${escapeHtml(issue.description)}</td>
</tr>`,
      )
      .join('\n');

    return `
<section class="review-section">
<h2>Review Issues</h2>
<table class="review-table">
<thead><tr>
<th>Type</th><th>Severity</th><th>Source</th><th>Current</th><th>Suggested</th><th>Description</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
</section>`;
  }

  // Markdown table
  const header = '| Type | Severity | Source | Current | Suggested | Description |';
  const divider = '|------|----------|--------|---------|-----------|-------------|';
  const rows = issues
    .map(
      (issue) =>
        `| ${issue.type} | ${issue.severity} | ${escapeMdCell(issue.sourceExcerpt)} | ${escapeMdCell(issue.targetExcerpt)} | ${escapeMdCell(issue.suggestedFix)} | ${escapeMdCell(issue.description)} |`,
    )
    .join('\n');

  return `\n\n## Review Issues\n\n${header}\n${divider}\n${rows}\n`;
}

function wrapHtml(body: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1a1a1a; }
  h1, h2, h3 { margin-top: 1.5em; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; font-weight: 600; }
  .bilingual-table td { width: 50%; }
  blockquote.source-block { border-left: 3px solid #ccc; padding-left: 1rem; margin: 0.5rem 0; color: #555; }
  .target-block { margin: 0.5rem 0; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }
  .review-table { font-size: 0.9rem; }
  @media print { body { max-width: none; margin: 0; } }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeMdCell(str: string): string {
  return str.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
