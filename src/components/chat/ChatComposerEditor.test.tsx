import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  options: null as null | {
    onUpdate?: (payload: { editor: unknown; transaction: unknown }) => void;
  },
  editor: null as unknown,
  setContent: vi.fn(),
}));

vi.mock('@tiptap/react', async () => {
  const dom = document.createElement('div');
  const editor = {
    storage: { markdown: { getMarkdown: () => '' } },
    view: { dom },
    commands: {
      setContent: mocks.setContent,
      clearContent: vi.fn(),
    },
    isEmpty: true,
    setEditable: vi.fn(),
  };
  mocks.editor = editor;

  return {
    Editor: class {},
    EditorContent: () => <div data-testid="mock-editor-content" />,
    useEditor: (options: typeof mocks.options) => {
      mocks.options = options;
      return editor;
    },
  };
});

import { ChatComposerEditor } from './ChatComposerEditor';

describe('ChatComposerEditor external content sync', () => {
  it('마운트 중 발생한 빈 update가 외부에서 전달된 텍스트를 덮어쓰지 않는다', async () => {
    const onChange = vi.fn();

    render(
      <ChatComposerEditor
        content="선택한 텍스트"
        onChange={onChange}
        onSubmit={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mocks.setContent).toHaveBeenCalledWith('선택한 텍스트');
    });

    mocks.options?.onUpdate?.({
      editor: mocks.editor,
      transaction: {
        docChanged: false,
        getMeta: () => undefined,
        steps: [],
      },
    });

    expect(onChange).not.toHaveBeenCalledWith('');
  });
});
