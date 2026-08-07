import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  SelectionAnchor,
  createSelectionAnchor,
  resolveSelectionAnchor,
} from '@/editor/extensions/SelectionAnchor';
import { CommentMark } from '@/editor/extensions/CommentMark';
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
});
