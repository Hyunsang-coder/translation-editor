import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type Content } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  AppliedChangeHighlight,
  hasAppliedChangeHighlights,
  markAppliedChanges,
} from './AppliedChangeHighlight';

describe('AppliedChangeHighlight', () => {
  let editor: Editor | null = null;

  function createEditor(content: Content = '<p>Hello world.</p>'): Editor {
    editor = new Editor({
      extensions: [StarterKit, AppliedChangeHighlight],
      content,
    });
    return editor;
  }

  function textRange(realEditor: Editor, text: string): { from: number; to: number } {
    const offset = realEditor.getText().indexOf(text);
    if (offset < 0) throw new Error(`텍스트를 찾지 못했습니다: ${text}`);
    return { from: offset + 1, to: offset + text.length + 1 };
  }

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('적용된 텍스트를 문서 마크로 저장한다', () => {
    const realEditor = createEditor();

    markAppliedChanges(realEditor, [textRange(realEditor, 'world')]);

    const highlight = realEditor.view.dom.querySelector('[data-applied-change]');
    expect(highlight?.textContent).toBe('world');
    expect(highlight).toHaveClass('applied-change-highlight');
    expect(JSON.stringify(realEditor.getJSON())).toContain('appliedChange');
  });

  it('저장된 JSON과 HTML을 다시 열어도 강조가 유지된다', () => {
    const firstEditor = createEditor();
    markAppliedChanges(firstEditor, [textRange(firstEditor, 'world')]);
    const json = firstEditor.getJSON();
    const html = firstEditor.getHTML();
    expect(html).toContain('data-applied-change-id');
    firstEditor.destroy();

    const fromJson = createEditor(json);
    expect(fromJson.view.dom.querySelector('[data-applied-change]')?.textContent).toBe('world');
    fromJson.destroy();

    const fromHtml = createEditor(html);
    expect(fromHtml.view.dom.querySelector('[data-applied-change]')?.textContent).toBe('world');
  });

  it('표시가 있는 문장을 수정하면 그 문장의 표시 전체가 사라진다', () => {
    const realEditor = createEditor('<p>First changed phrase. Second marked phrase.</p>');
    markAppliedChanges(realEditor, [
      textRange(realEditor, 'changed'),
      textRange(realEditor, 'marked'),
    ]);

    // 강조 단어가 아닌 같은 문장의 앞부분을 수정해도 첫 문장 표시를 해제한다.
    realEditor.commands.insertContentAt(2, 'X');

    const highlighted = Array.from(
      realEditor.view.dom.querySelectorAll('[data-applied-change]'),
    ).map((element) => element.textContent);
    expect(highlighted).toEqual(['marked']);
  });

  it('다른 문장을 수정하면 기존 적용 표시는 유지한다', () => {
    const realEditor = createEditor('<p>Changed phrase. Untouched sentence.</p>');
    markAppliedChanges(realEditor, [textRange(realEditor, 'Changed')]);

    realEditor.commands.insertContentAt(textRange(realEditor, 'Untouched').from, 'Still ');

    expect(realEditor.view.dom.querySelector('[data-applied-change]')?.textContent).toBe('Changed');
  });

  it('같은 문장에 새 제안을 적용하면 이전 표시를 새 표시로 교체한다', () => {
    const realEditor = createEditor('<p>First changed phrase.</p>');
    markAppliedChanges(realEditor, [textRange(realEditor, 'First')]);

    markAppliedChanges(realEditor, [textRange(realEditor, 'changed')]);

    const highlighted = Array.from(
      realEditor.view.dom.querySelectorAll('[data-applied-change]'),
    ).map((element) => element.textContent);
    expect(highlighted).toEqual(['changed']);
  });

  it('명시적으로 모든 적용 표시를 해제할 수 있다', () => {
    const realEditor = createEditor();
    markAppliedChanges(realEditor, [textRange(realEditor, 'world')]);
    expect(hasAppliedChangeHighlights(realEditor.state.doc)).toBe(true);

    realEditor.commands.clearAppliedChangeHighlights();

    expect(hasAppliedChangeHighlights(realEditor.state.doc)).toBe(false);
    expect(realEditor.getText()).toBe('Hello world.');
  });
});
