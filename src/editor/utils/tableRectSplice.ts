import type { TipTapDocJson } from '@/utils/markdownConverter';
import type { TableRect } from './tableRangeScope';

/**
 * 표의 **일부 사각형**만 떼어 모델에 보내고, 결과를 원래 칸에 되돌려 놓는다 (순수 함수).
 *
 * `topLevelBlockSplice`와 같은 원칙이다 — 에디터에 부분 트랜잭션을 넣지 않고, 요청
 * 시점 스냅샷 JSON에 결과를 병합한 완성본을 기존 전체 교체 경로로 넣는다. 인덱스가
 * 밀지 않는 근거도 같다(호출부의 L2 리비전 가드).
 *
 * 병합 키는 translationUnitId가 아니라 **표 기하**다. 모델은 셀 ID를 자주 버리는데,
 * 그때도 칸 위치로는 되돌려 놓을 수 있다. 그래서 결과에서 가져오는 것은 셀의
 * **내용뿐**이고 셀 자체(타입·attrs·translationUnitId·colwidth)는 원본을 재사용한다.
 *
 * 차원이 어긋나면(모델이 행·열을 늘리거나 줄임) 던진다 — 어긋난 채로 끼워 넣으면
 * 표가 조용히 뭉개진다. 검증 불가는 차단이 원칙이다.
 */

interface JsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  [key: string]: unknown;
}

/** 표 구조가 기대와 달라 결과를 되돌려 놓을 수 없을 때. 호출부가 안내 문구를 고른다. */
export class TableStructureMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableStructureMismatchError';
  }
}

function childrenOf(node: JsonNode | undefined): JsonNode[] {
  return Array.isArray(node?.content) ? node.content : [];
}

function nodeAtPath(root: JsonNode, path: number[]): JsonNode | null {
  let current: JsonNode | undefined = root;
  for (const index of path) {
    current = childrenOf(current)[index];
    if (!current) return null;
  }
  return current ?? null;
}

/** path가 가리키는 노드만 바꾼 새 문서. 건드리지 않은 형제는 객체 정체성을 유지한다. */
function mapAtPath(
  root: JsonNode,
  path: number[],
  transform: (target: JsonNode) => JsonNode,
): JsonNode {
  if (path.length === 0) return transform(root);
  const [index, ...rest] = path;
  const children = childrenOf(root);
  if (index === undefined || !children[index]) {
    throw new Error(`tableRectSplice: 경로가 문서 밖입니다 (${path.join('.')}).`);
  }
  return {
    ...root,
    content: children.map((child, childIndex) =>
      childIndex === index ? mapAtPath(child, rest, transform) : child,
    ),
  };
}

function resolveTable(full: TipTapDocJson, tableIndex: number): JsonNode {
  const table = childrenOf(full as JsonNode)[tableIndex];
  if (!table || table.type !== 'table') {
    throw new Error(`tableRectSplice: ${tableIndex}번 최상위 블록이 표가 아닙니다.`);
  }
  return table;
}

/**
 * 병합 없는 평평한 격자이고 rect가 그 안에 들어오는지 확인한다.
 * (병합이 있으면 격자 좌표와 JSON 인덱스가 어긋난다 — tableRangeScope가 애초에
 * 이런 표를 table-rect로 분류하지 않지만, 순수 함수도 자기 전제를 검증한다.)
 */
function assertPlainGrid(table: JsonNode, rect: TableRect): JsonNode[] {
  const rows = childrenOf(table);
  const width = childrenOf(rows[0]).length;
  if (
    rows.length === 0 ||
    width === 0 ||
    rect.top < 0 ||
    rect.left < 0 ||
    rect.bottom <= rect.top ||
    rect.right <= rect.left ||
    rect.bottom > rows.length ||
    rect.right > width
  ) {
    throw new Error(
      `tableRectSplice: 사각형이 표 밖입니다 (rect=${JSON.stringify(rect)}, rows=${rows.length}, width=${width}).`,
    );
  }
  for (const row of rows) {
    const cells = childrenOf(row);
    if (row.type !== 'tableRow' || cells.length !== width) {
      throw new Error('tableRectSplice: 행마다 셀 수가 달라 사각형을 잘라낼 수 없습니다.');
    }
    for (const cell of cells) {
      if ((cell.attrs?.colspan ?? 1) !== 1 || (cell.attrs?.rowspan ?? 1) !== 1) {
        throw new Error('tableRectSplice: 병합 셀이 있는 표는 사각형으로 자를 수 없습니다.');
      }
    }
  }
  return rows;
}

/** 고른 사각형만으로 **유효한 작은 표** 하나를 담은 문서를 만든다. */
export function extractTableRectDoc(
  full: TipTapDocJson,
  tableIndex: number,
  rect: TableRect,
): TipTapDocJson {
  const table = resolveTable(full, tableIndex);
  const rows = assertPlainGrid(table, rect);

  return {
    type: 'doc',
    content: [
      {
        ...table,
        content: rows.slice(rect.top, rect.bottom).map((row) => ({
          ...row,
          content: childrenOf(row).slice(rect.left, rect.right),
        })),
      },
    ],
  };
}

/**
 * `extractTableRectDoc`이 떼어낸 자리에 결과 표를 되돌려 놓는다.
 * replacement의 첫 블록이 rect와 같은 차원의 표가 아니면 던진다.
 */
export function replaceTableRect(
  full: TipTapDocJson,
  tableIndex: number,
  rect: TableRect,
  replacement: TipTapDocJson,
): TipTapDocJson {
  const table = resolveTable(full, tableIndex);
  const rows = assertPlainGrid(table, rect);

  const replacementTable = childrenOf(replacement as JsonNode)[0];
  if (!replacementTable || replacementTable.type !== 'table') {
    throw new TableStructureMismatchError('결과가 표가 아닙니다.');
  }
  const replacementRows = childrenOf(replacementTable);
  const height = rect.bottom - rect.top;
  const width = rect.right - rect.left;
  if (replacementRows.length !== height) {
    throw new TableStructureMismatchError(
      `결과 표의 행 수가 다릅니다 (기대 ${height}, 실제 ${replacementRows.length}).`,
    );
  }
  for (const replacementRow of replacementRows) {
    if (childrenOf(replacementRow).length !== width) {
      throw new TableStructureMismatchError(
        `결과 표의 열 수가 다릅니다 (기대 ${width}).`,
      );
    }
  }

  const nextRows = rows.map((row, rowIndex) => {
    if (rowIndex < rect.top || rowIndex >= rect.bottom) return row;
    const replacementCells = childrenOf(replacementRows[rowIndex - rect.top]);
    return {
      ...row,
      content: childrenOf(row).map((cell, colIndex) =>
        colIndex < rect.left || colIndex >= rect.right
          ? cell
          : { ...cell, content: childrenOf(replacementCells[colIndex - rect.left]) },
      ),
    };
  });

  return mapAtPath(full as JsonNode, [tableIndex], () => ({
    ...table,
    content: nextRows,
  })) as TipTapDocJson;
}

/** 셀 안 문단 하나만 담은 문서 — 표 HTML을 거치지 않는 in-cell 경로. */
export function extractBlockDoc(full: TipTapDocJson, path: number[]): TipTapDocJson {
  const block = nodeAtPath(full as JsonNode, path);
  if (!block) {
    throw new Error(`tableRectSplice: 경로가 문서 밖입니다 (${path.join('.')}).`);
  }
  return { type: 'doc', content: [block] };
}

/**
 * `extractBlockDoc`이 떼어낸 블록 자리에 결과를 되돌려 놓는다.
 * 블록이 하나가 아니면(모델이 문단을 쪼갬) 던진다 — 셀 구조가 바뀐다.
 */
export function replaceBlockAtPath(
  full: TipTapDocJson,
  path: number[],
  replacement: TipTapDocJson,
): TipTapDocJson {
  const blocks = childrenOf(replacement as JsonNode);
  if (blocks.length !== 1) {
    throw new TableStructureMismatchError(
      `결과 블록 수가 다릅니다 (기대 1, 실제 ${blocks.length}).`,
    );
  }
  return mapAtPath(full as JsonNode, path, (block) => ({
    ...block,
    content: childrenOf(blocks[0]),
  })) as TipTapDocJson;
}
