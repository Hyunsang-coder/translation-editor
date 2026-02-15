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
export type ExportFormat = 'markdown' | 'html' | 'pdf' | 'docx';

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
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

function escapeMdCell(str: string): string {
  return str.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

// ── PDF / DOCX Export ──

/** IIFE 브라우저 빌드를 script 태그로 on-demand 로드 (15초 타임아웃) */
function loadHtmlToDocx(): Promise<(html: string, header?: string | null, opts?: Record<string, unknown>) => Promise<Blob>> {
  type HtmlToDocxFn = (html: string, header?: string | null, opts?: Record<string, unknown>) => Promise<Blob>;
  const w = window as unknown as { HTMLToDOCX?: HtmlToDocxFn };
  if (w.HTMLToDOCX) return Promise.resolve(w.HTMLToDOCX);

  return new Promise((resolve, reject) => {
    const scriptUrl = `${import.meta.env.BASE_URL}lib/html-to-docx.browser.js`;
    const script = document.createElement('script');
    script.src = scriptUrl;

    const timeout = setTimeout(() => {
      reject(new Error(`html-to-docx 로드 타임아웃 (15초 초과, url: ${scriptUrl})`));
    }, 15_000);

    script.onload = () => {
      clearTimeout(timeout);
      if (w.HTMLToDOCX) resolve(w.HTMLToDOCX);
      else reject(new Error(`html-to-docx 스크립트 로드 성공했으나 HTMLToDOCX 전역 함수를 찾을 수 없음 (url: ${scriptUrl})`));
    };
    script.onerror = (event) => {
      clearTimeout(timeout);
      const detail = event instanceof ErrorEvent ? event.message : 'network/CORS error';
      reject(new Error(`html-to-docx 로드 실패: ${detail} (url: ${scriptUrl})`));
    };
    document.head.appendChild(script);
  });
}

/**
 * DOCX 내보내기: HTML 생성 → html-to-docx 변환 → Uint8Array 반환
 */
export async function exportToDocx(
  input: ExportInput,
  options: Omit<ExportOptions, 'format'>,
): Promise<Uint8Array> {
  const htmlContent = exportDocument(input, { ...options, format: 'html' });
  const HtmlToDocx = await loadHtmlToDocx();
  const blob = await HtmlToDocx(htmlContent, undefined, {
    title: options.projectTitle,
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 캔버스에서 페이지 경계 근처의 안전한 분할 지점(행간 빈 줄)을 탐색.
 * targetY 기준 위아래 searchRange 범위에서 가장 "흰색"에 가까운 행을 반환한다.
 */
function findSafeBreakY(
  canvas: HTMLCanvasElement,
  targetY: number,
  searchRange: number,
): number {
  const ctx = canvas.getContext('2d')!;
  const width = canvas.width;
  // 위쪽을 더 넓게 탐색 (일찍 끊는 것이 넘치는 것보다 안전)
  const minY = Math.max(0, Math.floor(targetY - searchRange));
  const maxY = Math.min(canvas.height - 1, Math.ceil(targetY + searchRange * 0.3));

  let bestY = Math.round(targetY);
  let bestScore = -1;

  // 매 행마다 전체 폭을 읽는 대신 12px 간격으로 샘플링 (성능)
  const sampleStep = 12;
  const samplesPerRow = Math.ceil(width / sampleStep);

  for (let y = minY; y <= maxY; y++) {
    const rowData = ctx.getImageData(0, y, width, 1).data;
    let whiteCount = 0;
    for (let sx = 0; sx < width; sx += sampleStep) {
      const off = sx * 4;
      const r = rowData[off] ?? 0;
      const g = rowData[off + 1] ?? 0;
      const b = rowData[off + 2] ?? 0;
      if (r > 240 && g > 240 && b > 240) whiteCount++;
    }
    const score = whiteCount / samplesPerRow;
    if (score > bestScore) {
      bestScore = score;
      bestY = y;
    }
    // 거의 완전히 흰 행 발견 → 즉시 채택
    if (score > 0.97) break;
  }

  return bestY;
}

/** 캔버스 메모리를 명시적으로 해제 (GC 대기 없이 즉시 VRAM/RAM 반환) */
function releaseCanvas(c: HTMLCanvasElement): void {
  c.width = 0;
  c.height = 0;
}

/** PDF 렌더링용 컨테이너의 최대 허용 높이 (px). 이를 초과하면 OOM 방지를 위해 중단. */
const MAX_CONTAINER_HEIGHT_PX = 40_000;

/**
 * PDF 내보내기: html2canvas + jsPDF로 직접 PDF 파일 생성.
 * 페이지 경계에서 텍스트가 잘리지 않도록 행간 빈 줄을 탐색하여 분할한다.
 */
export async function exportToPdf(
  input: ExportInput,
  options: Omit<ExportOptions, 'format'>,
): Promise<Uint8Array> {
  const htmlContent = exportDocument(input, { ...options, format: 'html' });

  const [html2canvasMod, jspdfMod] = await Promise.all([
    import('html2canvas').catch(() => { throw new Error('html2canvas 라이브러리 로드 실패'); }),
    import('jspdf').catch(() => { throw new Error('jsPDF 라이브러리 로드 실패'); }),
  ]);
  const html2canvas = html2canvasMod.default;
  const { jsPDF } = jspdfMod;

  // Hidden container로 렌더링
  const container = document.createElement('div');
  container.innerHTML = htmlContent;
  Object.assign(container.style, {
    position: 'absolute',
    left: '-9999px',
    top: '0',
    width: '800px',
  });
  document.body.appendChild(container);

  // C3: 대형 문서 OOM 방지 — 컨테이너 높이 기준 사전 검사
  const containerHeight = container.scrollHeight;
  if (containerHeight > MAX_CONTAINER_HEIGHT_PX) {
    document.body.removeChild(container);
    const approxPages = Math.ceil(containerHeight / 1100);
    throw new Error(
      `문서가 너무 커서 PDF로 변환할 수 없습니다 (약 ${approxPages}페이지). HTML 또는 DOCX 형식을 이용해 주세요.`,
    );
  }

  let mainCanvas: HTMLCanvasElement | null = null;

  try {
    mainCanvas = await html2canvas(container, { scale: 2, useCORS: true });

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - 2 * margin;
    const pageContentHeight = pageHeight - 2 * margin;

    // 캔버스 px ↔ PDF mm 변환 비율
    const pxPerMm = mainCanvas.width / contentWidth;
    const pageContentHeightPx = pageContentHeight * pxPerMm;
    // 텍스트 행간 높이의 ~2배 범위 내에서 안전한 분할점 탐색
    const breakSearchRange = Math.round(80 * (mainCanvas.width / 800));

    let currentY = 0;
    let pageIndex = 0;

    while (currentY < mainCanvas.height) {
      if (pageIndex > 0) pdf.addPage();

      let nextBreakY = currentY + pageContentHeightPx;

      if (nextBreakY < mainCanvas.height) {
        // 페이지 경계 근처에서 텍스트가 없는 안전한 행 탐색
        nextBreakY = findSafeBreakY(mainCanvas, nextBreakY, breakSearchRange);
      } else {
        nextBreakY = mainCanvas.height;
      }

      const srcH = nextBreakY - currentY;

      const slice = document.createElement('canvas');
      slice.width = mainCanvas.width;
      slice.height = Math.ceil(srcH);
      const ctx = slice.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D 컨텍스트를 생성할 수 없습니다 (메모리 부족 가능)');
      ctx.drawImage(mainCanvas, 0, currentY, mainCanvas.width, srcH, 0, 0, mainCanvas.width, Math.ceil(srcH));

      const sliceHeightMm = srcH / pxPerMm;
      pdf.addImage(
        slice.toDataURL('image/jpeg', 0.92),
        'JPEG', margin, margin, contentWidth, sliceHeightMm,
      );

      // C1: 슬라이스 캔버스 즉시 해제
      releaseCanvas(slice);

      currentY = nextBreakY;
      pageIndex++;
    }

    return new Uint8Array(pdf.output('arraybuffer'));
  } finally {
    document.body.removeChild(container);
    // C1: 메인 캔버스 메모리 해제
    if (mainCanvas) releaseCanvas(mainCanvas);
  }
}
