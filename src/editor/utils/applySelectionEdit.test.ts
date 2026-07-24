import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  SelectionAnchor,
  createSelectionAnchor,
  resolveSelectionAnchor,
} from '@/editor/extensions/SelectionAnchor';
import { applySelectionEdit } from './applySelectionEdit';

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
      from: second,
      to: second + 'target'.length,
    });
    return { editor, anchorId };
  }

  it('중복 문구 중 anchor가 가리키는 정확한 범위만 한 transaction으로 바꾼다', () => {
    const { editor: ed, anchorId } = setup();
    const anchor = resolveSelectionAnchor(ed, anchorId)!;

    expect(applySelectionEdit(ed, anchor, 'replacement')).toBe('applied');
    expect(ed.state.doc.textContent).toBe('First target and replacement.');
    expect(resolveSelectionAnchor(ed, anchorId)).toBeNull();
    expect(ed.state.selection.from).toBe(anchor.from);
    expect(ed.state.selection.to).toBe(anchor.from + 'replacement'.length);
  });

  it('문단 전체 텍스트 anchor를 적용한다', () => {
    editor = new Editor({
      extensions: [StarterKit, SelectionAnchor],
      content: '<p>Whole paragraph</p>',
    });
    const anchorId = createSelectionAnchor(editor, {
      from: 1,
      to: 1 + editor.state.doc.textContent.length,
    });

    expect(
      applySelectionEdit(editor, resolveSelectionAnchor(editor, anchorId)!, 'Replacement'),
    ).toBe('applied');
    expect(editor.state.doc.textContent).toBe('Replacement');
  });

  it('선택 내부가 바뀐 stale anchor는 적용하지 않는다', () => {
    const { editor: ed, anchorId } = setup();
    const anchor = resolveSelectionAnchor(ed, anchorId)!;
    ed.commands.insertContentAt(anchor.from + 1, 'X');

    expect(applySelectionEdit(ed, resolveSelectionAnchor(ed, anchorId)!, 'replacement'))
      .toBe('stale');
    expect(ed.state.doc.textContent).not.toContain('replacement');
  });

  it('다른 textblock을 가로지르는 범위는 거부한다', () => {
    editor = new Editor({
      extensions: [StarterKit, SelectionAnchor],
      content: '<p>One</p><p>Two</p>',
    });

    expect(applySelectionEdit(editor, {
      anchorId: 'invalid',
      from: 2,
      to: editor.state.doc.content.size - 2,
      originalText: 'neTw',
      status: 'active',
      createdAt: 1,
    }, 'replacement')).toBe('invalid');
  });
});
