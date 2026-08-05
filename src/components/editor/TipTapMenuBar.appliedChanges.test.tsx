import { fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { Editor as ReactEditor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AppliedChangeHighlight,
  hasAppliedChangeHighlights,
  markAppliedChanges,
} from '@/editor/extensions/AppliedChangeHighlight';
import { TipTapMenuBar } from './TipTapMenuBar';

describe('TipTapMenuBar 적용 표시', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('Target의 적용 표시를 사용자가 명시적으로 모두 해제한다', () => {
    editor = new Editor({
      extensions: [StarterKit, AppliedChangeHighlight],
      content: '<p>Polished text</p>',
    });
    markAppliedChanges(editor, [{ from: 1, to: 9 }]);

    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="target" />);
    fireEvent.click(screen.getByRole('button', { name: '적용 표시 지우기' }));

    expect(hasAppliedChangeHighlights(editor.state.doc)).toBe(false);
  });
});
