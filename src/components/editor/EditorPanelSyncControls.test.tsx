import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorPanelSyncControls } from './EditorPanelSyncControls';
import { useUIStore } from '@/stores/uiStore';

describe('EditorPanelSyncControls', () => {
  beforeEach(() => {
    useUIStore.setState({
      equalEditorPanelWidths: false,
      editorScrollSyncEnabled: false,
      editorSourcePanelPercent: 50,
    });
  });

  it('toggles equal widths and position synchronization independently', () => {
    render(<EditorPanelSyncControls available />);

    const equalWidths = screen.getByTestId('editor-equal-widths-checkbox');
    const scrollSync = screen.getByTestId('editor-scroll-sync-checkbox');

    fireEvent.click(equalWidths);
    expect(useUIStore.getState().equalEditorPanelWidths).toBe(true);
    expect(useUIStore.getState().editorScrollSyncEnabled).toBe(false);

    fireEvent.click(scrollSync);
    expect(useUIStore.getState().equalEditorPanelWidths).toBe(true);
    expect(useUIStore.getState().editorScrollSyncEnabled).toBe(true);
  });

  it('preserves stored preferences but disables controls when one panel is hidden', () => {
    useUIStore.setState({
      equalEditorPanelWidths: true,
      editorScrollSyncEnabled: true,
    });
    render(<EditorPanelSyncControls available={false} />);

    expect(screen.getByTestId('editor-equal-widths-checkbox')).toBeDisabled();
    expect(screen.getByTestId('editor-equal-widths-checkbox')).toBeChecked();
    expect(screen.getByTestId('editor-scroll-sync-checkbox')).toBeDisabled();
    expect(screen.getByTestId('editor-scroll-sync-checkbox')).toBeChecked();
  });
});
