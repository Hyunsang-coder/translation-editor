import { fireEvent, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchBar } from './SearchBar';

function createEditorMock(): Editor {
  const commands = {
    setSearchTerm: vi.fn(),
    setCaseSensitive: vi.fn(),
    clearSearch: vi.fn(),
    nextMatch: vi.fn(),
    prevMatch: vi.fn(),
    replaceMatch: vi.fn(),
    replaceAll: vi.fn(),
    focus: vi.fn(),
  };

  return {
    commands,
    storage: {
      searchHighlight: {
        searchTerm: '',
        currentIndex: -1,
        matches: [],
        caseSensitive: false,
      },
    },
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Editor;
}

describe('SearchBar shortcuts', () => {
  let editor: Editor;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    editor = createEditorMock();
    onClose = vi.fn();
  });

  it('closes from the search input when Cmd+F is pressed', () => {
    render(
      <SearchBar
        editor={editor}
        panelType="source"
        isOpen
        onClose={onClose}
      />,
    );

    const input = screen.getByPlaceholderText('검색어 입력...');
    fireEvent.keyDown(input, { key: 'f', metaKey: true });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(editor.commands.focus).toHaveBeenCalledTimes(1);
  });

  it('closes from the replace input when Ctrl+F is pressed', () => {
    render(
      <SearchBar
        editor={editor}
        panelType="target"
        isOpen
        onClose={onClose}
        initialReplaceMode
      />,
    );

    const input = screen.getByPlaceholderText('치환어 입력...');
    fireEvent.keyDown(input, { key: 'f', ctrlKey: true });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(editor.commands.focus).toHaveBeenCalledTimes(1);
  });
});
