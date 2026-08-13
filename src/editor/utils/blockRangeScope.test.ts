import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { NodeSelection } from '@tiptap/pm/state';
import { TranslationUnitId } from '@/editor/extensions/TranslationUnitId';
import { resolveTopLevelBlockRange } from './blockRangeScope';

describe('resolveTopLevelBlockRange', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  /**
   * TranslationUnitId는 onCreate에서 ID를 부여하는데 TipTap이 이 훅을 다음
   * 매크로태스크로 미룬다 — 생성 직후 동기적으로 읽으면 attrs가 아직 null이다.
   */
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

  /** 문서에서 정확히 일치하는 텍스트 노드의 위치를 찾는다. */
  function posOfText(ed: Editor, text: string): { from: number; to: number } {
    let from = -1;
    ed.state.doc.descendants((node, pos) => {
      if (from === -1 && node.isText && node.text === text) from = pos;
    });
    if (from === -1) throw new Error(`text not found: ${text}`);
    return { from, to: from + text.length };
  }

  it('단일 문단 선택은 그 블록 하나를 구간으로 잡는다', async () => {
    const ed = await setup('<p>First</p><p>Second</p><p>Third</p>');
    ed.commands.setTextSelection(posOfText(ed, 'Second'));

    expect(resolveTopLevelBlockRange(ed)).toEqual({
      fromIndex: 1,
      toIndex: 1,
      unitCount: 1,
    });
  });

  it('여러 문단에 걸친 선택은 min/max 블록 인덱스를 잡는다', async () => {
    const ed = await setup('<p>First</p><p>Second</p><p>Third</p><p>Fourth</p>');
    ed.commands.setTextSelection({
      from: posOfText(ed, 'Second').from,
      to: posOfText(ed, 'Third').to,
    });

    const range = resolveTopLevelBlockRange(ed);

    expect(range?.fromIndex).toBe(1);
    expect(range?.toIndex).toBe(2);
    expect(range?.unitCount).toBe(2);
  });

  it('접힌 선택(커서만)은 null', async () => {
    const ed = await setup('<p>First</p><p>Second</p>');
    ed.commands.setTextSelection(3);

    expect(resolveTopLevelBlockRange(ed)).toBeNull();
  });

  /** 텍스트가 일치하는 첫 셀(또는 헤더) 노드의 문서 위치. setCellSelection용. */
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

  it('표 셀 안 선택은 표 블록 전체가 구간이 된다 (셀 단위로 자르지 않는다)', async () => {
    const ed = await setup(
      '<p>Intro</p>' +
        '<table><tbody><tr><td><p>Cell A</p></td><td><p>Cell B</p></td></tr></tbody></table>' +
        '<p>Outro</p>',
    );
    ed.commands.setTextSelection(posOfText(ed, 'Cell A'));

    const range = resolveTopLevelBlockRange(ed);

    // 표는 최상위 인덱스 1 — 구간은 표 하나다
    expect(range?.fromIndex).toBe(1);
    expect(range?.toIndex).toBe(1);
  });

  it('표에서 여러 셀을 드래그한 CellSelection도 표 블록 전체가 구간이 된다', async () => {
    const ed = await setup(
      '<p>Intro</p>' +
        '<table><tbody><tr><td><p>Cell A</p></td><td><p>Cell B</p></td><td><p>Cell C</p></td></tr></tbody></table>' +
        '<p>Outro</p>',
    );
    ed.commands.setCellSelection({
      anchorCell: cellPosOf(ed, 'Cell A'),
      headCell: cellPosOf(ed, 'Cell C'),
    });

    const range = resolveTopLevelBlockRange(ed);

    expect(range?.fromIndex).toBe(1);
    expect(range?.toIndex).toBe(1);
  });

  it('빈 셀이 head여도 다른 선택 셀이 있으면 표 구간을 잡는다', async () => {
    const ed = await setup(
      '<p>Intro</p>' +
        '<table><tbody><tr><td><p></p></td><td><p>Cell B</p></td></tr></tbody></table>' +
        '<p>Outro</p>',
    );
    ed.commands.setCellSelection({
      anchorCell: cellPosOf(ed, 'Cell B'),
      headCell: cellPosOf(ed, ''),
    });

    // head가 빈 셀이어도 ranges로 다른 셀을 읽으면 표 구간이 살아야 한다
    const range = resolveTopLevelBlockRange(ed);
    expect(range?.fromIndex).toBe(1);
    expect(range?.toIndex).toBe(1);
  });

  it('선택이 표와 바깥 문단에 걸치면 두 블록을 모두 덮는다', async () => {
    const ed = await setup(
      '<p>Intro</p>' +
        '<table><tbody><tr><td><p>Cell A</p></td></tr></tbody></table>' +
        '<p>Outro</p>',
    );
    ed.commands.setTextSelection({
      from: posOfText(ed, 'Intro').from,
      to: posOfText(ed, 'Cell A').to,
    });

    const range = resolveTopLevelBlockRange(ed);

    expect(range?.fromIndex).toBe(0);
    expect(range?.toIndex).toBe(1);
  });

  it('번역 유닛이 없는 선택은 null', async () => {
    const ed = await setup('<p>First</p><hr><p>Second</p>');
    let hrPos = -1;
    ed.state.doc.forEach((node, offset) => {
      if (node.type.name === 'horizontalRule') hrPos = offset;
    });
    const { state, view } = ed;
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, hrPos)));

    expect(ed.state.selection.empty).toBe(false);
    expect(resolveTopLevelBlockRange(ed)).toBeNull();
  });
});
