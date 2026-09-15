import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';

const INVISIBLE_SPACING = /[\u200B-\u200D\u2060\uFEFF]/g;

function normalizedText(value: string): string {
  return value
    .replace(INVISIBLE_SPACING, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEmptyParagraph(node: ProseMirrorNode): boolean {
  if (node.type.name !== 'paragraph') return false;
  if (normalizedText(node.textContent).length > 0) return false;

  let hasMeaningfulLeaf = false;
  node.descendants((child) => {
    if (!child.isText && child.isLeaf && child.type.name !== 'hardBreak') {
      hasMeaningfulLeaf = true;
    }
    return !hasMeaningfulLeaf;
  });
  return !hasMeaningfulLeaf;
}

function tableHeaderSignature(table: ProseMirrorNode): string | null {
  if (table.type.name !== 'table') return null;
  const firstRow = table.firstChild;
  if (!firstRow || firstRow.type.name !== 'tableRow') return null;

  const cells: string[] = [];
  firstRow.forEach((cell) => cells.push(normalizedText(cell.textContent)));
  return cells.length > 0 && cells.some(Boolean) ? cells.join('\u001F') : null;
}

function isHeaderOnlyTable(table: ProseMirrorNode): boolean {
  if (table.type.name !== 'table' || table.childCount !== 1) return false;
  const row = table.firstChild;
  if (!row || row.type.name !== 'tableRow' || row.childCount === 0) return false;

  let allHeaders = true;
  row.forEach((cell) => {
    if (cell.type.name !== 'tableHeader') allHeaders = false;
  });
  return allHeaders;
}

/**
 * Confluence HTML이 ProseMirror Slice로 파싱된 뒤 생기는 구조적 찌꺼기를 제거한다.
 * HTML 정규화 이후에도 브라우저 파서가 확정한 빈 paragraph와 sticky header clone은
 * 이 단계에서만 안정적으로 식별할 수 있다.
 */
export function normalizeConfluencePastedSlice(slice: Slice): Slice {
  const compacted: ProseMirrorNode[] = [];
  slice.content.forEach((node) => {
    if (!isEmptyParagraph(node)) compacted.push(node);
  });

  const deduplicated: ProseMirrorNode[] = [];
  for (let index = 0; index < compacted.length; index += 1) {
    const node = compacted[index];
    const next = compacted[index + 1];
    if (
      node &&
      next &&
      isHeaderOnlyTable(node) &&
      next.type.name === 'table' &&
      tableHeaderSignature(node) === tableHeaderSignature(next)
    ) {
      continue;
    }
    if (node) deduplicated.push(node);
  }

  if (deduplicated.length === compacted.length && compacted.length === slice.content.childCount) {
    return slice;
  }

  return new Slice(Fragment.fromArray(deduplicated), slice.openStart, slice.openEnd);
}
