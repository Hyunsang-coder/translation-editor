import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import { CellSelection } from '@tiptap/pm/tables';
import { SourceTipTapEditor } from './TipTapEditor';

describe('TipTapEditor table copy', () => {
  it('routes Cmd+C cell selections through the supplied clipboard handler', async () => {
    const onEditorReady = vi.fn();
    const onCopySelection = vi.fn();
    const { container } = render(
      <SourceTipTapEditor
        content={'<table><tbody><tr><td><p>첫 셀</p></td><td><p>둘째 셀</p></td></tr></tbody></table>'}
        onEditorReady={onEditorReady}
        onCopySelection={onCopySelection}
      />,
    );

    await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
    const editor = onEditorReady.mock.calls[0]?.[0] as Editor;
    let cellPos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (cellPos !== null) return false;
      if (node.type.name !== 'tableCell') return true;
      cellPos = pos;
      return false;
    });
    const selectedCellPos = cellPos;
    if (selectedCellPos === null) throw new Error('표 셀을 찾지 못했습니다.');
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, selectedCellPos)));
    });

    const event = fireEvent.copy(container.querySelector('[contenteditable="true"]')!);

    expect(event).toBe(false);
    expect(onCopySelection).toHaveBeenCalledWith(editor);
  });
});
