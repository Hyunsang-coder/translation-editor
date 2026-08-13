import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { TranslationUnitId } from '@/editor/extensions/TranslationUnitId';
import {
  countScopedCells,
  resolveAiSelectionScope,
  resolveTableColumnHeader,
} from './tableRangeScope';

describe('resolveAiSelectionScope', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  /** TranslationUnitId는 onCreate를 다음 매크로태스크로 미룬다 — ID 부여를 기다린다. */
  async function setup(content: string): Promise<Editor> {
    editor = new Editor({
      extensions: [
        StarterKit,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        TranslationUnitId,
      ],
      content,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return editor;
  }

  function posOfText(ed: Editor, text: string): { from: number; to: number } {
    let from = -1;
    ed.state.doc.descendants((node, pos) => {
      if (from === -1 && node.isText && node.text === text) from = pos;
    });
    if (from === -1) throw new Error(`text not found: ${text}`);
    return { from, to: from + text.length };
  }

  function cellPosOf(ed: Editor, text: string): number {
    let pos = -1;
    ed.state.doc.descendants((node, nodePos) => {
      if (
        pos === -1 &&
        (node.type.name === 'tableCell' || node.type.name === 'tableHeader') &&
        node.textContent === text
      ) {
        pos = nodePos;
      }
    });
    if (pos === -1) throw new Error(`cell not found: ${text}`);
    return pos;
  }

  const THREE_COLUMN_TABLE =
    '<p>Intro</p>' +
    '<table><tbody>' +
    '<tr><td><p>A1</p></td><td><p>B1</p></td><td><p>C1</p></td></tr>' +
    '<tr><td><p>A2</p></td><td><p>B2</p></td><td><p>C2</p></td></tr>' +
    '</tbody></table>' +
    '<p>Outro</p>';

  it('문단 선택은 최상위 블록 구간이 된다', async () => {
    const ed = await setup('<p>First</p><p>Second</p><p>Third</p>');
    ed.commands.setTextSelection(posOfText(ed, 'Second'));

    expect(resolveAiSelectionScope(ed)).toEqual({
      kind: 'top-level-blocks',
      fromIndex: 1,
      toIndex: 1,
      unitCount: 1,
    });
  });

  it('셀 안 텍스트 선택은 그 문단만 가리키는 in-cell 이다', async () => {
    const ed = await setup(THREE_COLUMN_TABLE);
    ed.commands.setTextSelection(posOfText(ed, 'B2'));

    const scope = resolveAiSelectionScope(ed);

    expect(scope?.kind).toBe('in-cell');
    if (scope?.kind !== 'in-cell') throw new Error('expected in-cell');
    expect(scope.tableIndex).toBe(1);
    expect(scope.cell.row).toBe(1);
    expect(scope.cell.col).toBe(1);
    // [표, 행, 셀, 셀 안 문단]
    expect(scope.blockPath).toEqual([1, 1, 1, 0]);
    expect(scope.cell.text).toBe('B2');
  });

  it('3열 중 1–2열 CellSelection은 그 열만 담은 table-rect가 된다', async () => {
    const ed = await setup(THREE_COLUMN_TABLE);
    ed.commands.setCellSelection({
      anchorCell: cellPosOf(ed, 'A1'),
      headCell: cellPosOf(ed, 'B2'),
    });

    const scope = resolveAiSelectionScope(ed);

    expect(scope?.kind).toBe('table-rect');
    if (scope?.kind !== 'table-rect') throw new Error('expected table-rect');
    expect(scope.tableIndex).toBe(1);
    expect(scope.rect).toEqual({ top: 0, left: 0, bottom: 2, right: 2 });
    expect(scope.cells.map((cell) => cell.text)).toEqual(['A1', 'B1', 'A2', 'B2']);
    expect(scope.cells.map((cell) => cell.jsonPath)).toEqual([
      [1, 0, 0],
      [1, 0, 1],
      [1, 1, 0],
      [1, 1, 1],
    ]);
    expect(countScopedCells(scope)).toBe(4);
  });

  it('빈 셀이 head여도 이웃 셀을 포함한 table-rect가 된다', async () => {
    const ed = await setup(
      '<p>Intro</p>' +
        '<table><tbody><tr><td><p></p></td><td><p>Cell B</p></td></tr></tbody></table>',
    );
    ed.commands.setCellSelection({
      anchorCell: cellPosOf(ed, 'Cell B'),
      headCell: cellPosOf(ed, ''),
    });

    const scope = resolveAiSelectionScope(ed);

    expect(scope?.kind).toBe('table-rect');
    if (scope?.kind !== 'table-rect') throw new Error('expected table-rect');
    expect(scope.rect).toEqual({ top: 0, left: 0, bottom: 1, right: 2 });
    expect(scope.cells.map((cell) => cell.text)).toEqual(['', 'Cell B']);
    // 빈 셀은 보낼 것이 없으므로 라벨에서 세지 않는다
    expect(countScopedCells(scope)).toBe(1);
  });

  it('셀 하나만 고른 CellSelection은 1×1 table-rect가 된다', async () => {
    const ed = await setup(THREE_COLUMN_TABLE);
    ed.commands.setCellSelection({
      anchorCell: cellPosOf(ed, 'C1'),
      headCell: cellPosOf(ed, 'C1'),
    });

    const scope = resolveAiSelectionScope(ed);

    expect(scope?.kind).toBe('table-rect');
    if (scope?.kind !== 'table-rect') throw new Error('expected table-rect');
    expect(scope.rect).toEqual({ top: 0, left: 2, bottom: 1, right: 3 });
    expect(scope.cells).toHaveLength(1);
  });

  it('표와 바깥 문단에 걸친 선택은 최상위 블록 구간으로 남는다', async () => {
    const ed = await setup(THREE_COLUMN_TABLE);
    ed.commands.setTextSelection({
      from: posOfText(ed, 'Intro').from,
      to: posOfText(ed, 'A1').to,
    });

    const scope = resolveAiSelectionScope(ed);

    expect(scope?.kind).toBe('top-level-blocks');
    if (scope?.kind !== 'top-level-blocks') throw new Error('expected top-level-blocks');
    expect(scope.fromIndex).toBe(0);
    expect(scope.toIndex).toBe(1);
  });

  it('병합 셀이 걸린 선택은 표 전체(최상위 블록)로 되돌린다', async () => {
    const ed = await setup(
      '<p>Intro</p>' +
        '<table><tbody>' +
        '<tr><td colspan="2"><p>Merged</p></td><td><p>C1</p></td></tr>' +
        '<tr><td><p>A2</p></td><td><p>B2</p></td><td><p>C2</p></td></tr>' +
        '</tbody></table>',
    );
    ed.commands.setCellSelection({
      anchorCell: cellPosOf(ed, 'Merged'),
      headCell: cellPosOf(ed, 'B2'),
    });

    const scope = resolveAiSelectionScope(ed);

    expect(scope?.kind).toBe('top-level-blocks');
    if (scope?.kind !== 'top-level-blocks') throw new Error('expected top-level-blocks');
    expect(scope.fromIndex).toBe(1);
    expect(scope.toIndex).toBe(1);
  });

  it('병합 표라도 셀 안 문단 선택은 in-cell로 남는다 (경로가 JSON 인덱스라 안전)', async () => {
    const ed = await setup(
      '<p>Intro</p>' +
        '<table><tbody>' +
        '<tr><td colspan="2"><p>Merged</p></td><td><p>C1</p></td></tr>' +
        '<tr><td><p>A2</p></td><td><p>B2</p></td><td><p>C2</p></td></tr>' +
        '</tbody></table>',
    );
    ed.commands.setTextSelection(posOfText(ed, 'C2'));

    const scope = resolveAiSelectionScope(ed);

    expect(scope?.kind).toBe('in-cell');
    if (scope?.kind !== 'in-cell') throw new Error('expected in-cell');
    // 2행 3번째 셀 — 병합이 있어도 JSON 인덱스는 행 안의 순번 그대로다
    expect(scope.blockPath).toEqual([1, 1, 2, 0]);
  });

  it('접힌 선택은 null', async () => {
    const ed = await setup(THREE_COLUMN_TABLE);
    ed.commands.setTextSelection(posOfText(ed, 'A1').from);

    expect(resolveAiSelectionScope(ed)).toBeNull();
  });

  it('헤더 행 CellSelection도 셀 타입과 무관하게 table-rect가 된다', async () => {
    const ed = await setup(
      '<table><tbody>' +
        '<tr><th><p>H1</p></th><th><p>H2</p></th></tr>' +
        '<tr><td><p>A1</p></td><td><p>B1</p></td></tr>' +
        '</tbody></table>',
    );
    ed.commands.setCellSelection({
      anchorCell: cellPosOf(ed, 'H1'),
      headCell: cellPosOf(ed, 'H2'),
    });

    const scope = resolveAiSelectionScope(ed);

    expect(scope?.kind).toBe('table-rect');
    if (scope?.kind !== 'table-rect') throw new Error('expected table-rect');
    expect(scope.tableIndex).toBe(0);
    expect(scope.rect).toEqual({ top: 0, left: 0, bottom: 1, right: 2 });
  });
});

describe('resolveTableColumnHeader', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  async function setup(content: string): Promise<Editor> {
    editor = new Editor({
      extensions: [
        StarterKit,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        TranslationUnitId,
      ],
      content,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return editor;
  }

  function posOfText(ed: Editor, text: string): number {
    let from = -1;
    ed.state.doc.descendants((node, pos) => {
      if (from === -1 && node.isText && node.text === text) from = pos;
    });
    if (from === -1) throw new Error(`text not found: ${text}`);
    return from;
  }

  const HEADED_TABLE =
    '<table><tbody>' +
    '<tr><th><p>Stat</p></th><th><p>Description</p></th></tr>' +
    '<tr><td><p>Damage</p></td><td><p>Base damage</p></td></tr>' +
    '</tbody></table>';

  it('데이터 셀은 같은 열의 헤더를 돌려준다', async () => {
    const ed = await setup(HEADED_TABLE);
    const header = resolveTableColumnHeader(
      ed.state.doc,
      ed.state.doc.resolve(posOfText(ed, 'Base damage')),
    );

    expect(header?.text).toBe('Description');
    expect(header?.unitIds.length).toBeGreaterThan(0);
  });

  it('1열 데이터 셀은 1열 헤더를 돌려준다', async () => {
    const ed = await setup(HEADED_TABLE);

    expect(
      resolveTableColumnHeader(ed.state.doc, ed.state.doc.resolve(posOfText(ed, 'Damage')))?.text,
    ).toBe('Stat');
  });

  it('헤더 행 자신은 null', async () => {
    const ed = await setup(HEADED_TABLE);

    expect(
      resolveTableColumnHeader(ed.state.doc, ed.state.doc.resolve(posOfText(ed, 'Stat'))),
    ).toBeNull();
  });

  it('첫 행이 헤더가 아니면 null (없는 제목을 지어내지 않는다)', async () => {
    const ed = await setup(
      '<table><tbody>' +
        '<tr><td><p>A1</p></td><td><p>B1</p></td></tr>' +
        '<tr><td><p>A2</p></td><td><p>B2</p></td></tr>' +
        '</tbody></table>',
    );

    expect(
      resolveTableColumnHeader(ed.state.doc, ed.state.doc.resolve(posOfText(ed, 'B2'))),
    ).toBeNull();
  });

  it('헤더가 비어 있으면 null', async () => {
    const ed = await setup(
      '<table><tbody>' +
        '<tr><th><p></p></th><th><p>Description</p></th></tr>' +
        '<tr><td><p>Damage</p></td><td><p>Base damage</p></td></tr>' +
        '</tbody></table>',
    );

    expect(
      resolveTableColumnHeader(ed.state.doc, ed.state.doc.resolve(posOfText(ed, 'Damage'))),
    ).toBeNull();
  });

  it('표 밖 문단은 null', async () => {
    const ed = await setup('<p>Outside</p>' + HEADED_TABLE);

    expect(
      resolveTableColumnHeader(ed.state.doc, ed.state.doc.resolve(posOfText(ed, 'Outside'))),
    ).toBeNull();
  });
});
