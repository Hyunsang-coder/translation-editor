import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';
import { getTranslationUnitIdsAtRange } from '@/editor/extensions/TranslationUnitId';
import { resolveTopLevelBlockRange, type TopLevelBlockRange } from './blockRangeScope';

/**
 * 선택을 **AI 범위 실행의 단위**로 분류한다 (폴리싱·재번역의 공통 진입점).
 *
 * `resolveTopLevelBlockRange`는 표 안 선택을 항상 표 블록 하나로 넓힌다 — 셀 몇 개만
 * 잘라 마크다운으로 보내면 열 수가 안 맞는 표가 모델에 들어가기 때문이다. 여기서는
 * 그 제약을 **유효한 사각형 서브테이블**로 우회한다: 고른 칸이 사각형이고 병합 셀이
 * 없으면 그 사각형만으로 온전한 표를 만들 수 있으므로 표 나머지를 건드리지 않는다.
 *
 * 사각형으로 해석할 수 없는 선택(병합 셀, 중첩 표, 표 바깥까지 걸친 선택)은 조용히
 * 넘어가지 않고 기존 `top-level-blocks`로 되돌린다 — 오늘과 같은 표 전체 실행이다.
 */

const CELL_TYPES = new Set(['tableCell', 'tableHeader']);

/** TableMap과 같은 격자 좌표. bottom/right는 exclusive. */
export interface TableRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface ScopedTableCell {
  /** 격자 행 (0-based) */
  row: number;
  /** 격자 열 (0-based) */
  col: number;
  /** 셀과 자손의 번역 유닛 ID. 호출부가 `dropAncestorUnits`로 조상을 버린다. */
  unitIds: string[];
  /** PM 문서에서 tableCell/tableHeader 노드의 위치 */
  cellPos: number;
  /** TipTap JSON에서 셀까지의 경로 [최상위 인덱스, 행, 행 안의 셀] */
  jsonPath: number[];
  /** 셀 전체 텍스트 — 빈 셀을 세지 않기 위한 라벨용 */
  text: string;
}

export type AiSelectionScope =
  | ({ kind: 'top-level-blocks' } & TopLevelBlockRange)
  | { kind: 'table-rect'; tableIndex: number; rect: TableRect; cells: ScopedTableCell[] }
  | {
      kind: 'in-cell';
      tableIndex: number;
      cell: ScopedTableCell;
      /** 셀 안에서 고른 textblock까지의 JSON 경로 (셀 경로 + 블록 인덱스) */
      blockPath: number[];
    };

export interface TableCellLocation {
  /** $pos 조상에서 셀이 있는 depth */
  depth: number;
  cellPos: number;
  tablePos: number;
  tableStart: number;
  /** 표의 최상위 content 인덱스 */
  tableIndex: number;
  table: ProseMirrorNode;
}

/**
 * 위치가 들어 있는 표 셀을 찾는다. 표가 최상위 블록이 아니면(중첩 표) null —
 * 병합이 최상위 인덱스 기준이라 중첩 표는 되돌려 놓을 좌표가 없다.
 */
export function resolveTableCellLocation($pos: ResolvedPos): TableCellLocation | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (!CELL_TYPES.has($pos.node(depth).type.name)) continue;
    // cell → row → table
    const tableDepth = depth - 2;
    if (tableDepth !== 1 || $pos.node(tableDepth).type.name !== 'table') return null;
    return {
      depth,
      cellPos: $pos.before(depth),
      tablePos: $pos.before(tableDepth),
      tableStart: $pos.start(tableDepth),
      tableIndex: $pos.index(0),
      table: $pos.node(tableDepth),
    };
  }
  return null;
}

export interface TableColumnHeader {
  /** 헤더 셀의 번역문 텍스트 */
  text: string;
  /** 헤더 셀과 자손의 번역 유닛 ID — 호출부가 원문 짝을 찾는 데 쓴다 */
  unitIds: string[];
}

/**
 * 위치가 든 셀과 **같은 열의 헤더 셀**을 찾는다.
 *
 * 표 셀은 짧은 명사구가 많아 어의가 열 제목에 달려 있다(`Damage`가 "피해량"인지
 * "손상"인지). 그런데 주변 유닛 문맥은 문서 순서(행 우선)라 "앞 2칸"이 이전 행의
 * 꼬리가 되어 대체로 무관하다 — 표에서는 열 헤더가 맞는 문맥이다.
 *
 * 첫 행이 `tableHeader`가 아니면 null이다. 헤더 없는 표의 첫 행을 제목이라고
 * 우기면 없는 정보를 지어내는 셈이다.
 */
export function resolveTableColumnHeader(
  doc: ProseMirrorNode,
  $pos: ResolvedPos,
): TableColumnHeader | null {
  const location = resolveTableCellLocation($pos);
  if (!location) return null;

  const map = TableMap.get(location.table);
  const cellRect = map.findCell(location.cellPos - location.tableStart);
  // 헤더 행 자신을 고른 경우엔 줄 문맥이 없다.
  if (cellRect.top === 0) return null;

  const headerRelativePos = map.map[cellRect.left];
  if (headerRelativePos === undefined) return null;
  const headerCell = location.table.nodeAt(headerRelativePos);
  if (!headerCell || headerCell.type.name !== 'tableHeader') return null;

  const text = headerCell.textContent.trim();
  if (!text) return null;

  const headerPos = location.tableStart + headerRelativePos;
  return {
    text,
    unitIds: getTranslationUnitIdsAtRange(doc, headerPos, headerPos + headerCell.nodeSize),
  };
}

function buildScopedCell(
  doc: ProseMirrorNode,
  location: Pick<TableCellLocation, 'table' | 'tableStart'>,
  relativeCellPos: number,
  map: TableMap,
): ScopedTableCell | null {
  const cell = location.table.nodeAt(relativeCellPos);
  if (!cell) return null;

  const cellPos = location.tableStart + relativeCellPos;
  const gridCell = map.findCell(relativeCellPos);
  const $cell = doc.resolve(cellPos);
  return {
    row: gridCell.top,
    col: gridCell.left,
    unitIds: getTranslationUnitIdsAtRange(doc, cellPos, cellPos + cell.nodeSize),
    cellPos,
    jsonPath: [$cell.index(0), $cell.index(1), $cell.index(2)],
    text: cell.textContent,
  };
}

/**
 * 표가 병합 없는 평평한 격자인지 — 이때만 격자 좌표(row/col)가 JSON 인덱스와 같아
 * 사각형을 잘라 붙이는 병합(`tableRectSplice`)이 성립한다.
 *
 * 사각형 **안**만 보면 부족하다. rect 왼쪽/위쪽의 colspan·rowspan이 뒤 칸의 JSON
 * 인덱스를 밀어 엉뚱한 셀에 결과가 들어간다. 병합이 하나라도 있으면 표 전체 실행으로
 * 되돌린다 (1차 fail-closed — 병합 표 지원은 별도 픽스처가 생긴 뒤에).
 */
function isPlainGrid(table: ProseMirrorNode, map: TableMap): boolean {
  if (table.childCount !== map.height) return false;
  let plain = true;
  table.forEach((row) => {
    if (row.type.name !== 'tableRow' || row.childCount !== map.width) {
      plain = false;
      return;
    }
    row.forEach((cell) => {
      if ((cell.attrs.colspan ?? 1) !== 1 || (cell.attrs.rowspan ?? 1) !== 1) plain = false;
    });
  });
  return plain;
}

export function resolveAiSelectionScope(editor: Editor): AiSelectionScope | null {
  if (editor.isDestroyed) return null;

  const topLevelFallback = (): AiSelectionScope | null => {
    const range = resolveTopLevelBlockRange(editor);
    return range ? { kind: 'top-level-blocks', ...range } : null;
  };

  // 표에서 여러 셀을 드래그하면 CellSelection이고 셀마다 range가 하나씩 생긴다.
  // `selection.from/to`는 head 셀만 가리키므로(문서 순서도 아님) ranges를 쓴다.
  const { doc } = editor.state;
  const ranges = editor.state.selection.ranges
    .filter((range) => range.$to.pos > range.$from.pos)
    .sort((a, b) => a.$from.pos - b.$from.pos);
  if (ranges.length === 0) return null;

  const locations: TableCellLocation[] = [];
  for (const range of ranges) {
    const start = resolveTableCellLocation(range.$from);
    const end = resolveTableCellLocation(range.$to);
    // 범위 하나가 셀 하나 안에 온전히 들어와야 한다. 표 바깥까지 걸치거나 셀 경계를
    // 넘는 텍스트 범위는 셀 단위로 해석하지 않는다(D3 — 혼합 선택은 최상위 블록 스냅).
    if (!start || !end || start.cellPos !== end.cellPos) return topLevelFallback();
    locations.push(start);
  }

  const first = locations[0]!;
  const last = locations[locations.length - 1]!;
  if (locations.some((location) => location.tablePos !== first.tablePos)) {
    return topLevelFallback();
  }
  if (new Set(locations.map((location) => location.cellPos)).size !== locations.length) {
    return topLevelFallback();
  }

  const map = TableMap.get(first.table);

  // 셀 하나 안의 한 문단만 고른 경우 — 표가 아니라 그 문단만 다듬는다.
  // (경로가 JSON 인덱스라 격자 좌표를 쓰지 않는다 → 병합 표에서도 안전하다.)
  const single = ranges.length === 1 ? ranges[0]! : null;
  if (
    single &&
    single.$from.sameParent(single.$to) &&
    single.$from.parent.isTextblock &&
    // 문단이 셀의 직계 자식일 때만. 리스트 안 문단이면 블록 경로가 리스트를 가리켜
    // 고르지 않은 항목까지 바뀐다.
    single.$from.depth === first.depth + 1
  ) {
    const cell = buildScopedCell(doc, first, first.cellPos - first.tableStart, map);
    if (!cell) return topLevelFallback();
    return {
      kind: 'in-cell',
      tableIndex: first.tableIndex,
      cell,
      blockPath: [...cell.jsonPath, single.$from.index(first.depth)],
    };
  }

  // 사각형 병합은 격자 좌표 = JSON 인덱스를 전제한다 (isPlainGrid 주석 참고).
  if (!isPlainGrid(first.table, map)) return topLevelFallback();

  const rect = map.rectBetween(
    first.cellPos - first.tableStart,
    last.cellPos - last.tableStart,
  );
  const cells: ScopedTableCell[] = [];
  for (const relativePos of map.cellsInRect(rect)) {
    const cell = buildScopedCell(doc, first, relativePos, map);
    if (!cell) return topLevelFallback();
    cells.push(cell);
  }

  return { kind: 'table-rect', tableIndex: first.tableIndex, rect, cells };
}

/** 라벨·프롬프트가 세는 "실제로 실행될 칸" 수 — 빈 셀은 보낼 것이 없어 제외한다. */
export function countScopedCells(scope: AiSelectionScope): number {
  if (scope.kind === 'top-level-blocks') return scope.toIndex - scope.fromIndex + 1;
  if (scope.kind === 'in-cell') return 1;
  return scope.cells.filter((cell) => cell.text.trim().length > 0).length;
}
