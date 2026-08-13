import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import {
  SelectionAnchor,
  clearSelectionAnchors,
  createSelectionAnchor,
  getSingleAnchorRange,
  normalizeSelectionAnchorRange,
  normalizeSelectionAnchorRanges,
  readAnchorRangesText,
  resolveSelectionAnchor,
  splitSelectionAnchorRanges,
} from './SelectionAnchor';
import { replaceDocContent } from '@/editor/utils/replaceDocContent';

describe('SelectionAnchor', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function createEditor(content = '<p>Before target after target.</p>'): Editor {
    editor = new Editor({
      extensions: [StarterKit, SelectionAnchor],
      content,
    });
    return editor;
  }

  function findTextPos(ed: Editor, text: string): number {
    let pos = -1;
    ed.state.doc.descendants((node, nodePos) => {
      if (node.isText && node.text === text) pos = nodePos;
    });
    return pos;
  }

  function targetRange(ed: Editor, occurrence = 0): { from: number; to: number } {
    const text = ed.state.doc.textBetween(0, ed.state.doc.content.size, '\n');
    let index = -1;
    let offset = 0;
    for (let i = 0; i <= occurrence; i += 1) {
      index = text.indexOf('target', offset);
      offset = index + 1;
    }
    return { from: index + 1, to: index + 1 + 'target'.length };
  }

  it('앞에서 입력하면 원래 선택 위치를 mapping하고 active를 유지한다', () => {
    const ed = createEditor();
    const range = targetRange(ed);
    const anchorId = createSelectionAnchor(ed, { ranges: [range] });

    ed.commands.insertContentAt(1, 'New ');

    const anchor = resolveSelectionAnchor(ed, anchorId);
    expect(anchor?.status).toBe('active');
    expect(anchor?.ranges[0]?.from).toBe(range.from + 4);
    expect(ed.state.doc.textBetween(anchor!.ranges[0]!.from, anchor!.ranges[0]!.to)).toBe('target');
  });

  it('문단의 첫 글자부터 마지막 글자까지 선택한 범위도 anchor로 만든다', () => {
    const ed = createEditor('<p>Whole paragraph</p>');

    const anchorId = createSelectionAnchor(ed, {
      ranges: [{ from: 1, to: 1 + ed.state.doc.textContent.length }],
    });

    expect(resolveSelectionAnchor(ed, anchorId)?.originalText).toBe('Whole paragraph');
  });

  it('텍스트 블록이 하나뿐인 문서의 전체 선택은 블록 내부 범위로 정규화한다', () => {
    const ed = createEditor('<p>Whole paragraph</p>');

    const anchorId = createSelectionAnchor(ed, {
      ranges: [{ from: 0, to: ed.state.doc.content.size }],
    });

    expect(resolveSelectionAnchor(ed, anchorId)).toMatchObject({
      ranges: [{ from: 1, to: ed.state.doc.content.size - 1 }],
      originalText: 'Whole paragraph',
    });
  });

  it('뒤에서 입력하면 위치와 active 상태를 유지한다', () => {
    const ed = createEditor();
    const range = targetRange(ed);
    const anchorId = createSelectionAnchor(ed, { ranges: [range] });

    ed.commands.insertContentAt(ed.state.doc.content.size - 1, ' Later');

    expect(resolveSelectionAnchor(ed, anchorId)).toMatchObject({
      ranges: [{ from: range.from, to: range.to }],
      status: 'active',
    });
  });

  it('선택 범위 내부를 수정하면 현재 텍스트로 재기준화하고 active를 유지한다', () => {
    const ed = createEditor();
    const range = targetRange(ed);
    const anchorId = createSelectionAnchor(ed, { ranges: [range] });

    ed.commands.insertContentAt(range.from + 2, 'X');

    expect(resolveSelectionAnchor(ed, anchorId)).toMatchObject({
      status: 'active',
      originalText: 'taXrget',
    });
  });

  it('선택 범위를 통째로 지우면 죽은 앵커가 되고 하이라이트도 사라진다', () => {
    const ed = createEditor();
    const range = targetRange(ed);
    const anchorId = createSelectionAnchor(ed, { ranges: [range] });

    ed.view.dispatch(ed.state.tr.delete(range.from, range.to));

    expect(resolveSelectionAnchor(ed, anchorId)?.status).toBe('stale');
    expect(ed.view.dom.querySelectorAll('.selection-anchor')).toHaveLength(0);
  });

  it('죽은 앵커는 undo로 텍스트가 돌아와도 되살아나지 않는다', () => {
    const ed = createEditor();
    const range = targetRange(ed);
    const anchorId = createSelectionAnchor(ed, { ranges: [range] });

    ed.view.dispatch(ed.state.tr.delete(range.from, range.to));
    ed.commands.undo();

    expect(resolveSelectionAnchor(ed, anchorId)?.status).toBe('stale');
  });

  it('동일 문구가 여러 번 있어도 두 번째 원래 위치를 유지한다', () => {
    const ed = createEditor();
    const range = targetRange(ed, 1);
    const anchorId = createSelectionAnchor(ed, { ranges: [range] });

    ed.commands.insertContentAt(1, 'target ');

    const anchor = resolveSelectionAnchor(ed, anchorId);
    expect(anchor?.status).toBe('active');
    expect(anchor?.ranges[0]?.from).toBe(range.from + 7);
  });

  it('문서 전체 교체 시 anchor를 clear한다', () => {
    const ed = createEditor();
    const anchorId = createSelectionAnchor(ed, { ranges: [targetRange(ed)] });

    replaceDocContent(ed, '<p>Replacement document</p>', { addToHistory: false });

    expect(resolveSelectionAnchor(ed, anchorId)).toBeNull();
  });

  it('명시적으로 모든 anchor를 해제할 수 있다', () => {
    const ed = createEditor();
    const anchorId = createSelectionAnchor(ed, { ranges: [targetRange(ed)] });

    clearSelectionAnchors(ed);

    expect(resolveSelectionAnchor(ed, anchorId)).toBeNull();
  });

  describe('멀티블록 범위', () => {
    const multiDoc = '<p>One</p><p>Two</p><ul><li><p>Three</p></li></ul>';

    it('문단을 가로지르는 범위도 anchor로 만든다', () => {
      const ed = createEditor(multiDoc);
      const range = normalizeSelectionAnchorRange(ed, {
        from: 2,
        to: ed.state.doc.content.size - 2,
      })!;

      const anchorId = createSelectionAnchor(ed, { ranges: [range] });

      expect(range.blockCount).toBe(3);
      expect(resolveSelectionAnchor(ed, anchorId)).toMatchObject({
        ranges: [{ from: range.from, to: range.to }],
        status: 'active',
      });
    });

    it('Cmd+A(AllSelection)는 첫/마지막 textblock 내부로 좁힌다', () => {
      const ed = createEditor(multiDoc);
      ed.commands.selectAll();
      const { from, to } = ed.state.selection;

      const range = normalizeSelectionAnchorRange(ed, { from, to })!;

      // from=0은 doc 노드를 가리켜 그대로는 텍스트 범위가 아니다.
      expect(range).toMatchObject({ from: 1, blockCount: 3 });
      expect(ed.state.doc.textBetween(range.from, range.to, '\n')).toBe('One\nTwo\nThree');
    });

    it('앵커 텍스트는 블록 구분자를 포함한다', () => {
      const ed = createEditor(multiDoc);
      const range = normalizeSelectionAnchorRange(ed, {
        from: 0,
        to: ed.state.doc.content.size,
      })!;

      const anchorId = createSelectionAnchor(ed, { ranges: [range] });

      expect(resolveSelectionAnchor(ed, anchorId)?.originalText).toBe('One\nTwo\nThree');
    });

    it('문단 병합은 병합된 텍스트로 재기준화한다', () => {
      const ed = createEditor(multiDoc);
      const anchorId = createSelectionAnchor(ed, {
        ranges: [normalizeSelectionAnchorRange(ed, {
          from: 0,
          to: ed.state.doc.content.size,
        })!],
      });

      // 두 번째 문단의 시작 경계를 지워 첫 문단과 합친다.
      // 구분자를 포함해 읽으므로 재기준화된 텍스트에 병합이 드러난다.
      const twoPos = findTextPos(ed, 'Two');
      ed.view.dispatch(ed.state.tr.delete(twoPos - 2, twoPos));

      expect(resolveSelectionAnchor(ed, anchorId)).toMatchObject({
        status: 'active',
        originalText: 'OneTwo\nThree',
      });
    });

    it('트림으로 앞 블록의 기여분이 사라지면 blockCount에서 제외한다', () => {
      const ed = createEditor('<p>One</p><p>Two</p>');
      // HTML 파서가 후행 공백을 지우므로 직접 넣는다.
      ed.commands.insertContentAt(4, '  ');

      const range = normalizeSelectionAnchorRange(ed, {
        from: 4,
        to: ed.state.doc.content.size - 1,
      })!;

      expect(range.blockCount).toBe(1);
      expect(ed.state.doc.textBetween(range.from, range.to)).toBe('Two');
    });

    it('빈 문단만 걸친 범위는 거부한다', () => {
      const ed = createEditor('<p>One</p><p></p><p>Two</p>');
      // 빈 문단(size 2)을 통째로 덮는 범위 — 텍스트 기여분이 없다.
      const emptyStart = ed.state.doc.child(0).nodeSize;

      expect(normalizeSelectionAnchorRange(ed, {
        from: emptyStart,
        to: emptyStart + 2,
      })).toBeNull();
    });
  });

  // 표에서 여러 셀을 드래그하면 CellSelection이고 셀마다 range가 하나씩 생긴다.
  // 사이에 고르지 않은 셀이 낄 수 있어 하나의 span으로 합칠 수 없다.
  describe('다중 범위(표 셀 선택)', () => {
    const cellsDoc = '<p>Alpha</p><p>Beta</p><p>Gamma</p>';

    /** Alpha와 Gamma만 고른 상황 — Beta는 사이에 낀 미선택 셀이다 */
    function disjointRanges(ed: Editor): Array<{ from: number; to: number }> {
      const range = (word: string): { from: number; to: number } => {
        const from = findTextPos(ed, word);
        return { from, to: from + word.length };
      };
      return [range('Alpha'), range('Gamma')];
    }

    it('범위를 문서 순서로 이어 읽고 사이에 낀 블록은 넣지 않는다', () => {
      const ed = createEditor(cellsDoc);
      const ranges = disjointRanges(ed);

      // 입력 순서가 뒤집혀 있어도(CellSelection은 head 셀이 먼저 온다) 문서 순서로 정렬한다.
      const normalized = normalizeSelectionAnchorRanges(ed, [ranges[1]!, ranges[0]!])!;

      expect(normalized.ranges).toEqual(ranges);
      expect(normalized.blockCount).toBe(2);
      expect(readAnchorRangesText(ed.state.doc, normalized.ranges)).toBe('Alpha\nGamma');
    });

    it('범위마다 데코레이션을 그린다', () => {
      const ed = createEditor(cellsDoc);
      createSelectionAnchor(ed, { ranges: disjointRanges(ed) });

      expect(ed.view.dom.querySelectorAll('.selection-anchor')).toHaveLength(2);
    });

    it('선택하지 않은 사이 블록을 고쳐도 stale이 되지 않는다', () => {
      const ed = createEditor(cellsDoc);
      const anchorId = createSelectionAnchor(ed, { ranges: disjointRanges(ed) });

      ed.commands.insertContentAt(findTextPos(ed, 'Beta') + 2, 'X');

      expect(resolveSelectionAnchor(ed, anchorId)?.status).toBe('active');
    });

    it('고른 범위 안을 고치면 그 범위의 현재 텍스트로 재기준화한다', () => {
      const ed = createEditor(cellsDoc);
      const anchorId = createSelectionAnchor(ed, { ranges: disjointRanges(ed) });

      ed.commands.insertContentAt(findTextPos(ed, 'Gamma') + 2, 'X');

      expect(resolveSelectionAnchor(ed, anchorId)).toMatchObject({
        status: 'active',
        originalText: 'Alpha\nGaXmma',
      });
    });

    it('다중 범위 중 하나를 통째로 지우면 죽은 앵커가 된다', () => {
      const ed = createEditor(cellsDoc);
      const ranges = disjointRanges(ed);
      const anchorId = createSelectionAnchor(ed, { ranges });

      const gamma = ranges[1]!;
      ed.view.dispatch(ed.state.tr.delete(gamma.from, gamma.to));

      expect(resolveSelectionAnchor(ed, anchorId)?.status).toBe('stale');
    });

    it('단일 범위 앵커만 적용 경로에 넘긴다', () => {
      const ed = createEditor(cellsDoc);
      const multi = createSelectionAnchor(ed, { ranges: disjointRanges(ed) });
      const single = createSelectionAnchor(ed, {
        ranges: [disjointRanges(ed)[0]!],
      });

      expect(getSingleAnchorRange(resolveSelectionAnchor(ed, multi)!)).toBeNull();
      expect(getSingleAnchorRange(resolveSelectionAnchor(ed, single)!)).not.toBeNull();
    });
  });

  it('표 한 셀 CellSelection은 단일 블록이라 재번역 적용 경로에 넘길 수 있다', async () => {
    editor = new Editor({
      extensions: [
        StarterKit,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        SelectionAnchor,
      ],
      content:
        '<table><tbody><tr><td><p>Cell A</p></td><td><p>Cell B</p></td></tr></tbody></table>',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    let cellPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (cellPos === -1 && node.type.name === 'tableCell' && node.textContent === 'Cell A') {
        cellPos = pos;
      }
    });
    editor.commands.setCellSelection({ anchorCell: cellPos, headCell: cellPos });

    const ranges = editor.state.selection.ranges.map((range) => ({
      from: range.$from.pos,
      to: range.$to.pos,
    }));
    const normalized = normalizeSelectionAnchorRanges(editor, ranges)!;

    expect(normalized.blockCount).toBe(1);
    expect(getSingleAnchorRange({
      anchorId: 'x',
      ranges: normalized.ranges,
      originalText: 'Cell A',
      status: 'active',
      createdAt: 1,
    })).not.toBeNull();
  });

  it('표에서 여러 셀 CellSelection은 멀티블록이라 재번역 적용을 거부한다', async () => {
    editor = new Editor({
      extensions: [
        StarterKit,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        SelectionAnchor,
      ],
      content:
        '<table><tbody><tr><td><p>Cell A</p></td><td><p>Cell B</p></td></tr></tbody></table>',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cellPos = (text: string): number => {
      let pos = -1;
      editor!.state.doc.descendants((node, nodePos) => {
        if (pos === -1 && node.type.name === 'tableCell' && node.textContent === text) {
          pos = nodePos;
        }
      });
      return pos;
    };
    editor.commands.setCellSelection({
      anchorCell: cellPos('Cell A'),
      headCell: cellPos('Cell B'),
    });

    const ranges = editor.state.selection.ranges.map((range) => ({
      from: range.$from.pos,
      to: range.$to.pos,
    }));
    const normalized = normalizeSelectionAnchorRanges(editor, ranges)!;

    expect(normalized.blockCount).toBe(2);
    expect(getSingleAnchorRange({
      anchorId: 'x',
      ranges: normalized.ranges,
      originalText: 'Cell A\nCell B',
      status: 'active',
      createdAt: 1,
    })).toBeNull();
  });
});

describe('splitSelectionAnchorRanges', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function setup(content: string): Editor {
    editor = new Editor({
      extensions: [
        StarterKit,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        SelectionAnchor,
      ],
      content,
    });
    return editor;
  }

  it('한 range가 두 문단에 걸치면 블록마다 하나씩 쪼갠다', () => {
    const ed = setup('<p>First para here</p><p>Second para here</p>');

    const split = splitSelectionAnchorRanges(ed, [{ from: 7, to: 26 }]);

    expect(split?.ranges).toEqual([{ from: 7, to: 16 }, { from: 18, to: 26 }]);
    expect(split?.blockCount).toBe(2);
  });

  it('블록 경계로 반올림하지 않는다 (드래그 지점을 유지)', () => {
    const ed = setup('<p>First para here</p><p>Second para here</p>');

    const split = splitSelectionAnchorRanges(ed, [{ from: 7, to: 26 }])!;

    expect(ed.state.doc.textBetween(split.ranges[0]!.from, split.ranges[0]!.to)).toBe('para here');
    expect(ed.state.doc.textBetween(split.ranges[1]!.from, split.ranges[1]!.to)).toBe('Second p');
  });

  it('한 문단 안의 선택은 그대로 하나다', () => {
    const ed = setup('<p>Only one paragraph</p>');

    const split = splitSelectionAnchorRanges(ed, [{ from: 1, to: 5 }]);

    expect(split?.ranges).toEqual([{ from: 1, to: 5 }]);
    expect(split?.blockCount).toBe(1);
  });

  it('이미 셀마다 쪼개진 표 range는 그대로 유지한다', () => {
    const ed = setup(
      '<table><tbody><tr><td><p>Alpha</p></td><td><p>Beta</p></td></tr></tbody></table>',
    );
    // 셀 두 개를 각각 range로 넘긴다 (CellSelection과 같은 모양)
    const split = splitSelectionAnchorRanges(ed, [
      { from: 4, to: 9 },
      { from: 13, to: 17 },
    ]);

    expect(split?.ranges).toHaveLength(2);
    expect(ed.state.doc.textBetween(split!.ranges[0]!.from, split!.ranges[0]!.to)).toBe('Alpha');
    expect(ed.state.doc.textBetween(split!.ranges[1]!.from, split!.ranges[1]!.to)).toBe('Beta');
  });

  it('가운데 빈 문단은 범위에서 빠진다', () => {
    const ed = setup('<p>First</p><p></p><p>Third</p>');

    const split = splitSelectionAnchorRanges(ed, [
      { from: 1, to: ed.state.doc.content.size - 1 },
    ]);

    expect(split?.ranges).toHaveLength(2);
    expect(split?.blockCount).toBe(2);
  });

  it('가장자리 공백은 블록마다 따로 트림한다', () => {
    const ed = setup('<p>  padded  </p><p>  other  </p>');

    const split = splitSelectionAnchorRanges(ed, [
      { from: 1, to: ed.state.doc.content.size - 1 },
    ])!;

    expect(ed.state.doc.textBetween(split.ranges[0]!.from, split.ranges[0]!.to)).toBe('padded');
    expect(ed.state.doc.textBetween(split.ranges[1]!.from, split.ranges[1]!.to)).toBe('other');
  });

  it('텍스트가 없으면 null', () => {
    const ed = setup('<p></p>');

    expect(splitSelectionAnchorRanges(ed, [{ from: 1, to: 1 }])).toBeNull();
  });
});
