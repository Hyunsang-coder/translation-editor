import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  SelectionAnchor,
  clearSelectionAnchors,
  createSelectionAnchor,
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
});
