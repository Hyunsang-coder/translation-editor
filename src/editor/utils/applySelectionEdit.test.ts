import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import {
  SelectionAnchor,
  createSelectionAnchor,
  resolveSelectionAnchor,
  splitSelectionAnchorRanges,
} from '@/editor/extensions/SelectionAnchor';
import { CommentMark } from '@/editor/extensions/CommentMark';
import {
  applySelectionEdit,
  applySelectionEdits,
  canApplySelectionEdits,
  selectionHasUniformFormatting,
} from './applySelectionEdit';

describe('applySelectionEdit', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function setup(): { editor: Editor; anchorId: string } {
    editor = new Editor({
      extensions: [StarterKit, SelectionAnchor],
      content: '<p>First target and target.</p>',
    });
    const text = editor.state.doc.textContent;
    const second = text.lastIndexOf('target') + 1;
    const anchorId = createSelectionAnchor(editor, {
      ranges: [{ from: second, to: second + 'target'.length }],
    });
    return { editor, anchorId };
  }

  it('중복 문구 중 anchor가 가리키는 정확한 범위만 한 transaction으로 바꾼다', () => {
    const { editor: ed, anchorId } = setup();
    const anchor = resolveSelectionAnchor(ed, anchorId)!;

    expect(applySelectionEdit(ed, anchor, 'replacement', { expectedText: 'target' }))
      .toBe('applied');
    expect(ed.state.doc.textContent).toBe('First target and replacement.');
    expect(resolveSelectionAnchor(ed, anchorId)).toBeNull();
    expect(ed.state.selection.from).toBe(anchor.ranges[0]!.from);
    expect(ed.state.selection.to).toBe(anchor.ranges[0]!.from + 'replacement'.length);
  });

  it('문단 전체 텍스트 anchor를 적용한다', () => {
    editor = new Editor({
      extensions: [StarterKit, SelectionAnchor],
      content: '<p>Whole paragraph</p>',
    });
    const anchorId = createSelectionAnchor(editor, {
      ranges: [{ from: 1, to: 1 + editor.state.doc.textContent.length }],
    });

    expect(
      applySelectionEdit(editor, resolveSelectionAnchor(editor, anchorId)!, 'Replacement', {
        expectedText: 'Whole paragraph',
      }),
    ).toBe('applied');
    expect(editor.state.doc.textContent).toBe('Replacement');
  });

  it('선택 내부가 바뀌어 expectedText 스냅샷과 다르면 적용하지 않는다', () => {
    // 앵커는 편집을 따라 재기준화되므로, 수정안이 만들어진 시점의 스냅샷은
    // 호출부가 expectedText로 넘겨야 TOCTOU 가드가 성립한다.
    const { editor: ed, anchorId } = setup();
    const anchor = resolveSelectionAnchor(ed, anchorId)!;
    ed.commands.insertContentAt(anchor.ranges[0]!.from + 1, 'X');

    expect(applySelectionEdit(ed, resolveSelectionAnchor(ed, anchorId)!, 'replacement', {
      expectedText: 'target',
    })).toBe('stale');
    expect(ed.state.doc.textContent).not.toContain('replacement');
  });

  it('편집 후 재기준화된 텍스트를 expectedText로 넘기면 적용한다', () => {
    const { editor: ed, anchorId } = setup();
    ed.commands.insertContentAt(
      resolveSelectionAnchor(ed, anchorId)!.ranges[0]!.from + 2,
      'X',
    );

    const anchor = resolveSelectionAnchor(ed, anchorId)!;
    expect(anchor.originalText).toBe('taXrget');
    expect(applySelectionEdit(ed, anchor, 'replacement', {
      expectedText: anchor.originalText,
    })).toBe('applied');
    expect(ed.state.doc.textContent).toBe('First target and replacement.');
  });

  it('다른 textblock을 가로지르는 범위는 거부한다', () => {
    editor = new Editor({
      extensions: [StarterKit, SelectionAnchor],
      content: '<p>One</p><p>Two</p>',
    });

    expect(applySelectionEdit(editor, {
      anchorId: 'invalid',
      ranges: [{ from: 2, to: editor.state.doc.content.size - 2 }],
      // 앵커 텍스트는 블록 구분자를 포함한다(readAnchorText 기준).
      // stale이 아니라 블록 경계 가드에서 걸러져야 한다.
      originalText: 'ne\nTw',
      status: 'active',
      createdAt: 1,
    }, 'replacement', { expectedText: 'ne\nTw' })).toBe('invalid');
  });

  it('선택 전체에 공통인 굵게 서식을 교체문에도 보존한다', () => {
    editor = new Editor({
      extensions: [StarterKit, SelectionAnchor],
      content: '<p><strong>Target text</strong></p>',
    });
    const anchorId = createSelectionAnchor(editor, {
      ranges: [{ from: 1, to: 1 + 'Target text'.length }],
    });

    expect(
      applySelectionEdit(editor, resolveSelectionAnchor(editor, anchorId)!, 'Replacement', {
        expectedText: 'Target text',
      }),
    ).toBe('applied');
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toEqual([
      { type: 'bold' },
    ]);
  });

  it('서로 다른 인라인 서식을 가로지르는 선택은 문서를 바꾸지 않고 거부한다', () => {
    editor = new Editor({
      extensions: [StarterKit, SelectionAnchor],
      content: '<p><strong>Bold</strong><em>Italic</em></p>',
    });
    const anchorId = createSelectionAnchor(editor, {
      ranges: [{ from: 1, to: 1 + 'BoldItalic'.length }],
    });
    const before = editor.getJSON();

    expect(
      applySelectionEdit(editor, resolveSelectionAnchor(editor, anchorId)!, 'Replacement', {
        expectedText: 'BoldItalic',
      }),
    ).toBe('formatting-conflict');
    expect(editor.getJSON()).toEqual(before);
  });

  it('flattenFormatting이면 섞인 서식을 공통 mark로 평탄화해 적용한다', () => {
    // 전체가 기울임이고 일부만 굵은 선택: 공통인 기울임만 남고 굵게는 사라진다.
    editor = new Editor({
      extensions: [StarterKit, SelectionAnchor],
      content: '<p><em>Plain <strong>bold</strong> tail</em></p>',
    });
    const anchorId = createSelectionAnchor(editor, {
      ranges: [{ from: 1, to: 1 + 'Plain bold tail'.length }],
    });

    expect(
      applySelectionEdit(
        editor,
        resolveSelectionAnchor(editor, anchorId)!,
        'Replacement',
        { expectedText: 'Plain bold tail', flattenFormatting: true },
      ),
    ).toBe('applied');
    expect(editor.getJSON().content?.[0]?.content).toEqual([
      { type: 'text', text: 'Replacement', marks: [{ type: 'italic' }] },
    ]);
  });

  it('flattenFormatting이라도 공통 mark가 없으면 평문으로 적용한다', () => {
    editor = new Editor({
      extensions: [StarterKit, SelectionAnchor],
      content: '<p><strong>Bold</strong><em>Italic</em></p>',
    });
    const anchorId = createSelectionAnchor(editor, {
      ranges: [{ from: 1, to: 1 + 'BoldItalic'.length }],
    });

    expect(
      applySelectionEdit(
        editor,
        resolveSelectionAnchor(editor, anchorId)!,
        'Replacement',
        { expectedText: 'BoldItalic', flattenFormatting: true },
      ),
    ).toBe('applied');
    expect(editor.getJSON().content?.[0]?.content).toEqual([
      { type: 'text', text: 'Replacement' },
    ]);
  });

  it('균일한 코멘트 마크를 교체문에도 유지한다', () => {
    editor = new Editor({
      extensions: [StarterKit, CommentMark, SelectionAnchor],
      content: '<p><span data-comment-id="comment-1">Target</span></p>',
    });
    const anchorId = createSelectionAnchor(editor, {
      ranges: [{ from: 1, to: 1 + 'Target'.length }],
    });

    expect(
      applySelectionEdit(editor, resolveSelectionAnchor(editor, anchorId)!, 'Replacement', {
        expectedText: 'Target',
      }),
    ).toBe('applied');
    expect(editor.getHTML()).toContain('data-comment-id="comment-1"');
    expect(editor.getHTML()).toContain('Replacement');
  });

  it('표 셀 안 한 문단의 선택만 교체하고 표 구조와 옆 셀은 그대로 둔다', () => {
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
        '<table><tbody><tr><td><p>Alpha target</p></td><td><p>Keep this</p></td></tr></tbody></table>',
    });
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (from === -1 && node.isText && node.text === 'Alpha target') from = pos;
    });
    const targetFrom = from + 'Alpha '.length;
    const anchorId = createSelectionAnchor(editor, {
      ranges: [{ from: targetFrom, to: targetFrom + 'target'.length }],
    });

    expect(
      applySelectionEdit(editor, resolveSelectionAnchor(editor, anchorId)!, 'replacement', {
        expectedText: 'target',
      }),
    ).toBe('applied');

    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('Alpha replacement');
    expect(json).toContain('Keep this');
    expect(json).toContain('"type":"table"');
    expect(json).not.toContain('Alpha target');
  });
});

describe('applySelectionEdits (표 여러 셀)', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  const TABLE_EXTENSIONS = [
    StarterKit,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    SelectionAnchor,
  ];

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

  /** 실제 제스처와 같은 경로: CellSelection → selection.ranges → 앵커 */
  function setupCells(anchorText: string, headText: string): { editor: Editor; anchorId: string } {
    editor = new Editor({
      extensions: TABLE_EXTENSIONS,
      content:
        '<table><tbody><tr>' +
        '<td><p>Alpha cell</p></td><td><p>Beta cell</p></td><td><p>Gamma cell</p></td>' +
        '</tr></tbody></table>',
    });
    editor.commands.setCellSelection({
      anchorCell: cellPosOf(editor, anchorText),
      headCell: cellPosOf(editor, headText),
    });
    const anchorId = createSelectionAnchor(editor, {
      ranges: editor.state.selection.ranges.map((range) => ({
        from: range.$from.pos,
        to: range.$to.pos,
      })),
    });
    return { editor, anchorId };
  }

  it('두 셀을 한 트랜잭션으로 교체하고 고르지 않은 셀·표 구조는 그대로 둔다', () => {
    const { editor: ed, anchorId } = setupCells('Alpha cell', 'Beta cell');
    const before = ed.state.doc.textContent;

    expect(
      applySelectionEdits(
        ed,
        resolveSelectionAnchor(ed, anchorId)!,
        ['알파 셀 재번역', '베타'],
        { expectedTexts: ['Alpha cell', 'Beta cell'] },
      ),
    ).toBe('applied');

    const json = JSON.stringify(ed.getJSON());
    expect(json).toContain('알파 셀 재번역');
    expect(json).toContain('베타');
    expect(json).toContain('Gamma cell');
    expect(json).not.toContain('Alpha cell');
    expect(json).not.toContain('Beta cell');
    expect(json).toContain('"type":"table"');
    expect(resolveSelectionAnchor(ed, anchorId)).toBeNull();

    // 한 트랜잭션 = Undo 한 단계로 원복
    ed.commands.undo();
    expect(ed.state.doc.textContent).toBe(before);
  });

  it('한쪽 expectedText만 어긋나도 전체를 적용하지 않는다', () => {
    const { editor: ed, anchorId } = setupCells('Alpha cell', 'Beta cell');
    const before = JSON.stringify(ed.getJSON());

    expect(
      applySelectionEdits(
        ed,
        resolveSelectionAnchor(ed, anchorId)!,
        ['알파', '베타'],
        { expectedTexts: ['Alpha cell', 'CHANGED'] },
      ),
    ).toBe('stale');
    expect(JSON.stringify(ed.getJSON())).toBe(before);
  });

  it('교체 수가 범위 수와 다르면 적용하지 않는다', () => {
    const { editor: ed, anchorId } = setupCells('Alpha cell', 'Beta cell');
    const before = JSON.stringify(ed.getJSON());

    expect(
      applySelectionEdits(ed, resolveSelectionAnchor(ed, anchorId)!, ['알파'], {
        expectedTexts: ['Alpha cell'],
      }),
    ).toBe('invalid');
    expect(JSON.stringify(ed.getJSON())).toBe(before);
  });

  it('쪼개지 않은 멀티블록 범위 하나는 거부한다 (한 덩어리로 뭉개지므로)', () => {
    editor = new Editor({
      extensions: TABLE_EXTENSIONS,
      content: '<p>First para</p><p>Second para</p>',
    });
    const anchorId = createSelectionAnchor(editor, {
      ranges: [{ from: 1, to: editor.state.doc.content.size - 1 }],
    });
    const anchor = resolveSelectionAnchor(editor, anchorId)!;
    const before = JSON.stringify(editor.getJSON());

    expect(canApplySelectionEdits(editor, anchor)).toBe(false);
    expect(
      applySelectionEdits(editor, anchor, ['bogus'], {
        expectedTexts: [anchor.originalText],
      }),
    ).toBe('invalid');
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  });

  it('표 밖 문단 하나짜리 선택도 유효한 모양이다 (N=1)', () => {
    editor = new Editor({
      extensions: TABLE_EXTENSIONS,
      content: '<p>Plain paragraph</p>',
    });
    const anchorId = createSelectionAnchor(editor, {
      ranges: [{ from: 1, to: 1 + 'Plain'.length }],
    });

    expect(canApplySelectionEdits(editor, resolveSelectionAnchor(editor, anchorId)!)).toBe(true);
  });

  it('같은 블록 안의 두 범위는 거부한다 (앞 치환이 뒤 범위를 민다)', () => {
    editor = new Editor({
      extensions: TABLE_EXTENSIONS,
      content: '<p>alpha beta gamma</p>',
    });
    const anchorId = createSelectionAnchor(editor, {
      ranges: [
        { from: 1, to: 1 + 'alpha'.length },
        { from: 1 + 'alpha beta '.length, to: 1 + 'alpha beta gamma'.length },
      ],
    });

    expect(canApplySelectionEdits(editor, resolveSelectionAnchor(editor, anchorId)!)).toBe(false);
  });

  it('문단 두 개를 textblock 단위로 쪼개면 각각 독립 교체된다', () => {
    editor = new Editor({
      extensions: TABLE_EXTENSIONS,
      content: '<p>First para here</p><p>Second para here</p><p>Third</p>',
    });
    // 1문단 중간 ~ 2문단 중간을 가로지르는 드래그
    const split = splitSelectionAnchorRanges(editor, [{ from: 7, to: 26 }])!;
    expect(split.ranges).toHaveLength(2);
    const anchorId = createSelectionAnchor(editor, { ranges: split.ranges });
    const anchor = resolveSelectionAnchor(editor, anchorId)!;

    expect(canApplySelectionEdits(editor, anchor)).toBe(true);
    expect(
      applySelectionEdits(editor, anchor, ['조각하나', '두번째조'], {
        expectedTexts: ['para here', 'Second p'],
      }),
    ).toBe('applied');

    // 블록 경계로 반올림하지 않는다 — 문단 앞뒤의 안 고른 부분은 그대로다
    expect(editor.state.doc.textContent).toBe('First 조각하나두번째조ara hereThird');
  });

  it('셀마다 서식이 달라도 각 셀의 서식을 지킨다', () => {
    editor = new Editor({
      extensions: TABLE_EXTENSIONS,
      content:
        '<table><tbody><tr>' +
        '<td><p><strong>Bold cell</strong></p></td><td><p>Plain cell</p></td>' +
        '</tr></tbody></table>',
    });
    editor.commands.setCellSelection({
      anchorCell: cellPosOf(editor, 'Bold cell'),
      headCell: cellPosOf(editor, 'Plain cell'),
    });
    const anchorId = createSelectionAnchor(editor, {
      ranges: editor.state.selection.ranges.map((range) => ({
        from: range.$from.pos,
        to: range.$to.pos,
      })),
    });
    const anchor = resolveSelectionAnchor(editor, anchorId)!;

    // 셀마다 내부는 균일하므로 평탄화 확인이 필요 없다
    expect(selectionHasUniformFormatting(editor, anchor)).toBe(true);
    expect(
      applySelectionEdits(editor, anchor, ['굵은 셀', '평범한 셀'], {
        expectedTexts: ['Bold cell', 'Plain cell'],
      }),
    ).toBe('applied');

    const html = editor.getHTML();
    expect(html).toContain('<strong>굵은 셀</strong>');
    expect(html).toContain('평범한 셀');
    expect(html).not.toContain('<strong>평범한 셀</strong>');
  });
});
