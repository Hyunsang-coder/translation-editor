import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { AppliedChangeHighlight } from '@/editor/extensions/AppliedChangeHighlight';
import { markAppliedChanges } from '@/editor/extensions/AppliedChangeHighlight';
import {
  findAppliedChangeRanges,
  replaceDocumentWithAppliedChanges,
} from './applyDocumentWithHighlight';

describe('applyDocumentWithHighlight', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('교체된 문서에서 새로 들어온 텍스트 범위를 찾는다', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>Hello world.</p>' });
    const before = editor.state.doc;
    editor.commands.setContent('<p>Hello beautiful world.</p>');

    const ranges = findAppliedChangeRanges(before, editor.state.doc);

    expect(ranges).toHaveLength(1);
    expect(editor.state.doc.textBetween(ranges[0]!.from, ranges[0]!.to)).toBe('beautiful');
  });

  it('폴리싱 문서를 적용하면서 실제 변경 문구만 강조한다', () => {
    editor = new Editor({
      extensions: [StarterKit, AppliedChangeHighlight],
      content: '<p>The wording is awkward.</p><p>Keep this sentence.</p>',
    });

    replaceDocumentWithAppliedChanges(editor, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'The wording is natural.' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Keep this sentence.' }],
        },
      ],
    });

    const highlightedText = Array.from(
      editor.view.dom.querySelectorAll('[data-applied-change]'),
    ).map((element) => element.textContent).join('');
    expect(highlightedText).toContain('natural');
    expect(highlightedText).not.toContain('Keep this sentence');
    expect(JSON.stringify(editor.getJSON())).toContain('appliedChange');
  });

  it('문서 적용과 저장 마크가 하나의 undo/redo 단위로 동작한다', () => {
    editor = new Editor({
      extensions: [StarterKit, AppliedChangeHighlight],
      content: '<p>Original sentence.</p>',
    });

    replaceDocumentWithAppliedChanges(editor, '<p>Polished sentence.</p>');
    expect(editor.getText()).toBe('Polished sentence.');
    expect(editor.view.dom.querySelector('[data-applied-change]')).not.toBeNull();

    editor.commands.undo();
    expect(editor.getText()).toBe('Original sentence.');
    expect(editor.view.dom.querySelector('[data-applied-change]')).toBeNull();

    editor.commands.redo();
    expect(editor.getText()).toBe('Polished sentence.');
    expect(editor.view.dom.querySelector('[data-applied-change]')).not.toBeNull();
  });

  it('다음 폴리싱에서 수정되지 않은 이전 문장의 적용 표시를 유지한다', () => {
    editor = new Editor({
      extensions: [StarterKit, AppliedChangeHighlight],
      content: '<p>Previously polished sentence. Another old sentence.</p>',
    });
    markAppliedChanges(editor, [{ from: 12, to: 20 }]); // "polished"

    replaceDocumentWithAppliedChanges(
      editor,
      '<p>Previously polished sentence. Another improved sentence.</p>',
    );

    const highlighted = Array.from(
      editor.view.dom.querySelectorAll('[data-applied-change]'),
    ).map((element) => element.textContent);
    expect(highlighted).toContain('polished');
    expect(highlighted.join('')).toContain('improved');
  });
});
