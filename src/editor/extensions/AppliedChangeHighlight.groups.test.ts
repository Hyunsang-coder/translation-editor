import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type Content } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  AppliedChangeHighlight,
  countAppliedChangeGroups,
  getAppliedChangeGroups,
  getAppliedChangeIdAtSelection,
  markAppliedChanges,
} from './AppliedChangeHighlight';

describe('AppliedChangeHighlight 개별 확인', () => {
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

  it('문장별 changeId 개수를 세고 문서 순서대로 그룹을 반환한다', () => {
    const realEditor = createEditor('<p>First changed phrase. Second marked phrase.</p>');
    markAppliedChanges(realEditor, [
      textRange(realEditor, 'changed'),
      textRange(realEditor, 'marked'),
    ]);

    expect(countAppliedChangeGroups(realEditor.state.doc)).toBe(2);
    const groups = getAppliedChangeGroups(realEditor.state.doc);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.from).toBeLessThan(groups[1]!.from);
    expect(groups[0]!.id).not.toBe(groups[1]!.id);
  });

  it('selection 위치의 changeId를 찾고 표시 밖에서는 null을 반환한다', () => {
    const realEditor = createEditor('<p>First changed phrase. Second marked phrase.</p>');
    markAppliedChanges(realEditor, [
      textRange(realEditor, 'changed'),
      textRange(realEditor, 'marked'),
    ]);
    const groups = getAppliedChangeGroups(realEditor.state.doc);

    // 표시 안 캐럿 → 해당 문장 id
    const changed = textRange(realEditor, 'changed');
    realEditor.commands.setTextSelection(changed.from + 1);
    expect(getAppliedChangeIdAtSelection(realEditor.state)).toBe(groups[0]!.id);

    // 범위 선택 → 첫 적중 id
    realEditor.commands.setTextSelection({ from: changed.from, to: changed.to });
    expect(getAppliedChangeIdAtSelection(realEditor.state)).toBe(groups[0]!.id);

    // 표시 밖 캐럿('First' 앞부분은 마크 없음) → null
    realEditor.commands.setTextSelection(1);
    expect(getAppliedChangeIdAtSelection(realEditor.state)).toBeNull();
  });

  it('clearAppliedChangeById는 해당 문장만 지우고 텍스트는 유지한다', () => {
    const realEditor = createEditor('<p>First changed phrase. Second marked phrase.</p>');
    markAppliedChanges(realEditor, [
      textRange(realEditor, 'changed'),
      textRange(realEditor, 'marked'),
    ]);
    const before = getAppliedChangeGroups(realEditor.state.doc);
    expect(before).toHaveLength(2);

    expect(realEditor.commands.clearAppliedChangeById(before[0]!.id)).toBe(true);
    const after = getAppliedChangeGroups(realEditor.state.doc);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[1]!.id);
    expect(realEditor.getText()).toBe('First changed phrase. Second marked phrase.');

    // 모르는 id는 false, 문서 불변
    expect(realEditor.commands.clearAppliedChangeById('no-such-id')).toBe(false);
    expect(getAppliedChangeGroups(realEditor.state.doc)).toHaveLength(1);
  });

  it('개별 확인은 undo 가능하다(bulk와 동일한 history 취급)', () => {
    const realEditor = createEditor('<p>First changed phrase. Second marked phrase.</p>');
    markAppliedChanges(realEditor, [
      textRange(realEditor, 'changed'),
      textRange(realEditor, 'marked'),
    ]);
    const before = getAppliedChangeGroups(realEditor.state.doc);

    realEditor.commands.clearAppliedChangeById(before[0]!.id);
    expect(getAppliedChangeGroups(realEditor.state.doc)).toHaveLength(1);

    realEditor.commands.undo();
    expect(getAppliedChangeGroups(realEditor.state.doc)).toHaveLength(2);
  });
});
