import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  SelectionAnchor,
  clearSelectionAnchors,
  createSelectionAnchor,
  normalizeSelectionAnchorRange,
  resolveSelectionAnchor,
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
    const anchorId = createSelectionAnchor(ed, range);

    ed.commands.insertContentAt(1, 'New ');

    const anchor = resolveSelectionAnchor(ed, anchorId);
    expect(anchor?.status).toBe('active');
    expect(anchor?.from).toBe(range.from + 4);
    expect(ed.state.doc.textBetween(anchor!.from, anchor!.to)).toBe('target');
  });

  it('문단의 첫 글자부터 마지막 글자까지 선택한 범위도 anchor로 만든다', () => {
    const ed = createEditor('<p>Whole paragraph</p>');

    const anchorId = createSelectionAnchor(ed, {
      from: 1,
      to: 1 + ed.state.doc.textContent.length,
    });

    expect(resolveSelectionAnchor(ed, anchorId)?.originalText).toBe('Whole paragraph');
  });

  it('텍스트 블록이 하나뿐인 문서의 전체 선택은 블록 내부 범위로 정규화한다', () => {
    const ed = createEditor('<p>Whole paragraph</p>');

    const anchorId = createSelectionAnchor(ed, {
      from: 0,
      to: ed.state.doc.content.size,
    });

    expect(resolveSelectionAnchor(ed, anchorId)).toMatchObject({
      from: 1,
      to: ed.state.doc.content.size - 1,
      originalText: 'Whole paragraph',
    });
  });

  it('뒤에서 입력하면 위치와 active 상태를 유지한다', () => {
    const ed = createEditor();
    const range = targetRange(ed);
    const anchorId = createSelectionAnchor(ed, range);

    ed.commands.insertContentAt(ed.state.doc.content.size - 1, ' Later');

    expect(resolveSelectionAnchor(ed, anchorId)).toMatchObject({
      from: range.from,
      to: range.to,
      status: 'active',
    });
  });

  it('선택 범위 내부가 수정되면 stale로 전환한다', () => {
    const ed = createEditor();
    const range = targetRange(ed);
    const anchorId = createSelectionAnchor(ed, range);

    ed.commands.insertContentAt(range.from + 2, 'X');

    expect(resolveSelectionAnchor(ed, anchorId)?.status).toBe('stale');
  });

  it('동일 문구가 여러 번 있어도 두 번째 원래 위치를 유지한다', () => {
    const ed = createEditor();
    const range = targetRange(ed, 1);
    const anchorId = createSelectionAnchor(ed, range);

    ed.commands.insertContentAt(1, 'target ');

    const anchor = resolveSelectionAnchor(ed, anchorId);
    expect(anchor?.status).toBe('active');
    expect(anchor?.from).toBe(range.from + 7);
  });

  it('문서 전체 교체 시 anchor를 clear한다', () => {
    const ed = createEditor();
    const anchorId = createSelectionAnchor(ed, targetRange(ed));

    replaceDocContent(ed, '<p>Replacement document</p>', { addToHistory: false });

    expect(resolveSelectionAnchor(ed, anchorId)).toBeNull();
  });

  it('명시적으로 모든 anchor를 해제할 수 있다', () => {
    const ed = createEditor();
    const anchorId = createSelectionAnchor(ed, targetRange(ed));

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

      const anchorId = createSelectionAnchor(ed, range);

      expect(range.blockCount).toBe(3);
      expect(resolveSelectionAnchor(ed, anchorId)).toMatchObject({
        from: range.from,
        to: range.to,
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

      const anchorId = createSelectionAnchor(ed, range);

      expect(resolveSelectionAnchor(ed, anchorId)?.originalText).toBe('One\nTwo\nThree');
    });

    it('문단 병합은 stale로 잡는다', () => {
      const ed = createEditor(multiDoc);
      const anchorId = createSelectionAnchor(ed, normalizeSelectionAnchorRange(ed, {
        from: 0,
        to: ed.state.doc.content.size,
      })!);

      // 두 번째 문단의 시작 경계를 지워 첫 문단과 합친다.
      // 구분자가 없으면 텍스트가 'OneTwoThree'로 동일해 변경을 놓친다.
      const twoPos = findTextPos(ed, 'Two');
      ed.view.dispatch(ed.state.tr.delete(twoPos - 2, twoPos));

      expect(resolveSelectionAnchor(ed, anchorId)?.status).toBe('stale');
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
});
