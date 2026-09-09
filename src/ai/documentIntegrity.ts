import {
  isValidTipTapDocJson,
  type TipTapDocJson,
} from '@/utils/markdownConverter';
import {
  collectTranslationUnits,
  type TranslationUnitDocument,
} from '@/editor/extensions/TranslationUnitId';

export type DocumentIntegrityIssueCode =
  | 'valid-document'
  | 'topology'
  | 'table-geometry'
  | 'image-integrity'
  | 'mark-integrity'
  | 'protected-literal'
  | 'translation-unit-id';

export interface DocumentIntegrityCheck {
  id: DocumentIntegrityIssueCode;
  passed: boolean;
  description: string;
}

export interface DocumentIntegrityIssue {
  code: DocumentIntegrityIssueCode;
  description: string;
  expected?: string;
  actual?: string;
}

export interface DocumentIntegrityReport {
  passed: boolean;
  checks: DocumentIntegrityCheck[];
  issues: DocumentIntegrityIssue[];
}

interface JsonNode {
  type?: unknown;
  attrs?: unknown;
  content?: unknown;
  text?: unknown;
  marks?: unknown;
}

interface StructureNode {
  type: string;
  attrs?: Record<string, unknown>;
  children?: StructureNode[];
}

const TRANSPARENT_MARKS = new Set(['comment', 'appliedChange']);

const CHECK_DESCRIPTIONS: Record<DocumentIntegrityIssueCode, string> = {
  'valid-document': '결과가 유효한 TipTap 문서다.',
  topology: '블록 종류·순서, 제목 단계, 목록 계층과 코드 블록 구조가 같다.',
  'table-geometry': '표의 순서, 행·열, 셀 종류·병합 속성과 셀 내부 블록 구조가 같다.',
  'image-integrity': '이미지 개수·위치·순서와 원본 속성이 같다.',
  'mark-integrity': '링크 URL과 bold/italic 등 인라인 마크가 보존됐다.',
  'protected-literal': '코드, URL, 숫자, 날짜, 버전, 변수와 키 조합이 보존됐다.',
  'translation-unit-id': '번역 단위 경로와 translationUnitId가 보존됐다.',
};

function asNode(value: unknown): JsonNode {
  return value && typeof value === 'object' ? value as JsonNode : {};
}

function childrenOf(node: JsonNode): JsonNode[] {
  return Array.isArray(node.content)
    ? node.content.filter((child): child is JsonNode => Boolean(child && typeof child === 'object'))
    : [];
}

function attrsOf(node: JsonNode): Record<string, unknown> {
  return node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs)
    ? node.attrs as Record<string, unknown>
    : {};
}

function typeOf(node: JsonNode): string {
  return typeof node.type === 'string' ? node.type : '';
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function summarized(value: unknown, maxChars = 600): string {
  const text = stableStringify(value);
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function topologyAttrs(node: JsonNode): Record<string, unknown> | undefined {
  const type = typeOf(node);
  const attrs = attrsOf(node);
  switch (type) {
    case 'heading':
      return { level: attrs.level ?? 1 };
    case 'orderedList':
      return { start: attrs.start ?? attrs.order ?? 1 };
    case 'codeBlock':
      return { language: attrs.language ?? null };
    default:
      return undefined;
  }
}

/**
 * 번역 가능한 text 값과 translationUnitId를 제외한 문서 골격.
 * 표 기하·이미지 속성·인라인 마크는 오류 설명을 분리하기 위해 전용 fingerprint에서 본다.
 */
function structureOf(node: JsonNode): StructureNode | null {
  const type = typeOf(node);
  if (!type || type === 'text') return null;
  const children = childrenOf(node)
    .map(structureOf)
    .filter((child): child is StructureNode => child !== null);
  const attrs = topologyAttrs(node);
  return {
    type,
    ...(attrs ? { attrs } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function collectAtPaths<T>(
  root: JsonNode,
  collect: (node: JsonNode, path: number[]) => T | null,
): T[] {
  const values: T[] = [];
  const visit = (node: JsonNode, path: number[]): void => {
    const value = collect(node, path);
    if (value !== null) values.push(value);
    childrenOf(node).forEach((child, index) => visit(child, [...path, index]));
  };
  visit(root, []);
  return values;
}

function tableFingerprint(root: JsonNode): unknown[] {
  return collectAtPaths(root, (node, path) => {
    if (typeOf(node) !== 'table') return null;
    return {
      path,
      rows: childrenOf(node).map((row) => ({
        type: typeOf(row),
        cells: childrenOf(row).map((cell) => {
          const attrs = attrsOf(cell);
          return {
            type: typeOf(cell),
            colspan: attrs.colspan ?? 1,
            rowspan: attrs.rowspan ?? 1,
            colwidth: attrs.colwidth ?? null,
            blocks: childrenOf(cell)
              .map(structureOf)
              .filter((child): child is StructureNode => child !== null),
          };
        }),
      })),
    };
  });
}

function imageFingerprint(root: JsonNode): unknown[] {
  return collectAtPaths(root, (node, path) => {
    if (typeOf(node) !== 'image') return null;
    return {
      path,
      attrs: stableValue(attrsOf(node)),
    };
  });
}

function normalizedMarks(node: JsonNode): Array<Record<string, unknown>> {
  if (!Array.isArray(node.marks)) return [];
  return node.marks
    .filter((mark): mark is Record<string, unknown> => Boolean(mark && typeof mark === 'object'))
    .filter((mark) => typeof mark.type === 'string' && !TRANSPARENT_MARKS.has(mark.type))
    .map((mark) => {
      const type = String(mark.type);
      const attrs = mark.attrs && typeof mark.attrs === 'object'
        ? mark.attrs as Record<string, unknown>
        : {};
      if (type === 'link') {
        return {
          type,
          attrs: stableValue({
            href: attrs.href ?? null,
          }),
        };
      }
      if (type === 'highlight') {
        return {
          type,
          attrs: stableValue({ color: attrs.color ?? null }),
        };
      }
      return { type };
    })
    .sort((a, b) => String(a.type).localeCompare(String(b.type)));
}

/**
 * 모델·Markdown 파서가 같은 mark의 text 노드를 잘게 나눌 수 있으므로 text 노드 수를
 * 직접 비교하지 않는다. 부모 안에서 연속된 같은 mark는 한 run으로 합친 뒤 전역 다중집합을
 * 비교한다. plain text run은 번역 대상이라 제외한다.
 */
function markFingerprint(root: JsonNode): string[] {
  const runs: string[] = [];
  const visit = (node: JsonNode): void => {
    let previous = '';
    for (const child of childrenOf(node)) {
      if (typeOf(child) === 'text') {
        const marks = normalizedMarks(child);
        const signature = marks.length > 0 ? stableStringify(marks) : '';
        if (signature && signature !== previous) runs.push(signature);
        previous = signature;
      } else {
        previous = '';
        visit(child);
      }
    }
  };
  visit(root);
  return runs.sort();
}

const PROTECTED_PATTERNS = [
  /https?:\/\/[^\s)\]}>,"']+/g,
  /\$\{[^{}\n]+\}/g,
  /\{\{[^{}\n]+\}\}/g,
  /\{[A-Za-z_][A-Za-z0-9_.-]*\}/g,
  /%(?:\d+\$)?[sdif]/g,
  /\bODDEYES_IMAGE_[A-Za-z0-9_-]+\b/g,
  /\boddeyes-image-anchor:[A-Za-z0-9_-]+\b/g,
  /\b(?:Ctrl|Cmd|Command|Alt|Option|Shift)(?:\+[A-Za-z0-9_-]+)+\b/g,
  /\bv\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9_.-]+)?\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /<\/?[A-Za-z][^>\n]*>/g,
] as const;
const NUMBER_PATTERN =
  /([-+]?\d+(?:[.,]\d+)*(?:%|[A-Za-z]+)?)/g;

function addPatternMatches(text: string, tokens: string[]): void {
  const reservedRanges: Array<{ start: number; end: number }> = [];
  for (const pattern of PROTECTED_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    for (const match of text.matchAll(regex)) {
      const value = match[0];
      if (!value) continue;
      tokens.push(value);
      const start = match.index ?? 0;
      reservedRanges.push({ start, end: start + value.length });
    }
  }

  const numberRegex = new RegExp(NUMBER_PATTERN.source, NUMBER_PATTERN.flags);
  for (const match of text.matchAll(numberRegex)) {
    const value = match[1];
    if (!value) continue;
    const full = match[0];
    const fullStart = match.index ?? 0;
    const start = fullStart + full.indexOf(value);
    const end = start + value.length;
    const overlapsReserved = reservedRanges.some(
      (range) => start < range.end && end > range.start,
    );
    if (!overlapsReserved) tokens.push(value);
  }
}

function nodeText(node: JsonNode): string {
  if (typeOf(node) === 'text') return typeof node.text === 'string' ? node.text : '';
  return childrenOf(node).map(nodeText).join('');
}

function protectedLiteralFingerprint(root: JsonNode): string[] {
  const tokens: string[] = [];
  const visit = (node: JsonNode): void => {
    if (typeOf(node) === 'codeBlock') {
      tokens.push(`code:${nodeText(node)}`);
      // 코드 안의 숫자·변수도 그대로여야 하므로 아래 text 순회도 계속한다.
    }
    if (typeOf(node) === 'text' && typeof node.text === 'string') {
      addPatternMatches(node.text, tokens);
    }
    childrenOf(node).forEach(visit);
  };
  visit(root);
  return tokens.sort();
}

function translationUnitFingerprint(root: TipTapDocJson): unknown[] {
  const units = collectTranslationUnits(root as TranslationUnitDocument);
  const sourceHasIds = units.some((unit) => Boolean(unit.id));
  if (!sourceHasIds) return [];
  return units.map((unit) => ({
    path: unit.path,
    type: unit.type,
    id: unit.id ?? null,
  }));
}

function makeIssue(
  code: DocumentIntegrityIssueCode,
  expected?: unknown,
  actual?: unknown,
): DocumentIntegrityIssue {
  return {
    code,
    description: CHECK_DESCRIPTIONS[code],
    ...(expected !== undefined ? { expected: summarized(expected) } : {}),
    ...(actual !== undefined ? { actual: summarized(actual) } : {}),
  };
}

export function evaluateDocumentIntegrity(
  source: TipTapDocJson,
  target: TipTapDocJson,
): DocumentIntegrityReport {
  const issues: DocumentIntegrityIssue[] = [];
  const sourceValid = isValidTipTapDocJson(source);
  const targetValid = isValidTipTapDocJson(target);

  if (!sourceValid || !targetValid) {
    issues.push(makeIssue(
      'valid-document',
      { sourceValid: true, targetValid: true },
      { sourceValid, targetValid },
    ));
  }

  const sourceNode = asNode(source);
  const targetNode = asNode(target);

  const comparisons: Array<{
    code: Exclude<DocumentIntegrityIssueCode, 'valid-document'>;
    sourceValue: unknown;
    targetValue: unknown;
  }> = [
    {
      code: 'topology',
      sourceValue: structureOf(sourceNode),
      targetValue: structureOf(targetNode),
    },
    {
      code: 'table-geometry',
      sourceValue: tableFingerprint(sourceNode),
      targetValue: tableFingerprint(targetNode),
    },
    {
      code: 'image-integrity',
      sourceValue: imageFingerprint(sourceNode),
      targetValue: imageFingerprint(targetNode),
    },
    {
      code: 'mark-integrity',
      sourceValue: markFingerprint(sourceNode),
      targetValue: markFingerprint(targetNode),
    },
    {
      code: 'protected-literal',
      sourceValue: protectedLiteralFingerprint(sourceNode),
      targetValue: protectedLiteralFingerprint(targetNode),
    },
    {
      code: 'translation-unit-id',
      sourceValue: translationUnitFingerprint(source),
      targetValue: translationUnitFingerprint(target),
    },
  ];

  for (const comparison of comparisons) {
    if (stableStringify(comparison.sourceValue) !== stableStringify(comparison.targetValue)) {
      issues.push(makeIssue(
        comparison.code,
        comparison.sourceValue,
        comparison.targetValue,
      ));
    }
  }

  const failed = new Set(issues.map((issue) => issue.code));
  const checks = (Object.keys(CHECK_DESCRIPTIONS) as DocumentIntegrityIssueCode[])
    .map((id) => ({
      id,
      passed: !failed.has(id),
      description: CHECK_DESCRIPTIONS[id],
    }));

  return {
    passed: issues.length === 0,
    checks,
    issues,
  };
}

export class DocumentIntegrityError extends Error {
  readonly report: DocumentIntegrityReport;

  constructor(label: string, report: DocumentIntegrityReport) {
    const failed = report.issues.map((issue) => issue.code).join(', ');
    super(`${label}의 문서 무결성이 깨져 적용할 수 없습니다: ${failed}`);
    this.name = 'DocumentIntegrityError';
    this.report = report;
  }
}

export function assertDocumentIntegrity(
  source: TipTapDocJson,
  target: TipTapDocJson,
  label = 'AI 결과',
): DocumentIntegrityReport {
  const report = evaluateDocumentIntegrity(source, target);
  if (!report.passed) throw new DocumentIntegrityError(label, report);
  return report;
}
