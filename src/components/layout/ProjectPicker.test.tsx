import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITEProject } from '@/types';
import { useProjectStore } from '@/stores/projectStore';
import { deleteProject, listRecentProjects } from '@/tauri/storage';
import {
  duplicateProject,
  loadProject as tauriLoadProject,
  saveProject as tauriSaveProject,
} from '@/tauri/project';
import { confirm } from '@tauri-apps/plugin-dialog';
import { ProjectPicker } from './ProjectPicker';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

vi.mock('@/components/settings/AppSettingsModal', () => ({
  AppSettingsModal: () => <div>app-settings</div>,
}));

vi.mock('@/tauri/storage', () => ({
  listRecentProjects: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock('@/tauri/project', () => ({
  createProject: vi.fn(),
  duplicateProject: vi.fn(),
  loadProject: vi.fn(),
  saveProject: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
  message: vi.fn(),
}));

vi.mock('@/utils/tauri', () => ({
  isTauriTestingBridgeActive: () => false,
}));

function makeProject(id: string, title: string): ITEProject {
  const now = 1_700_000_000_000;
  return {
    id,
    version: '1.0.0',
    metadata: {
      title,
      description: '',
      domain: 'general',
      createdAt: now,
      updatedAt: now,
      settings: {
        strictnessLevel: 0.5,
        autoSave: true,
        autoSaveInterval: 30_000,
        theme: 'system',
      },
    },
    segments: [],
    blocks: {},
  };
}

const currentProject = makeProject('project-1', 'Alpha');
const otherProject = makeProject('project-2', 'Beta');
const recentProjects = [
  { id: currentProject.id, title: currentProject.metadata.title, updatedAt: 1_700_000_000_000 },
  { id: otherProject.id, title: otherProject.metadata.title, updatedAt: 1_699_000_000_000 },
];

describe('ProjectPicker row actions', () => {
  const switchProjectById = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRecentProjects).mockResolvedValue(recentProjects);
    vi.mocked(tauriLoadProject).mockResolvedValue(otherProject);
    vi.mocked(tauriSaveProject).mockResolvedValue();
    vi.mocked(duplicateProject).mockResolvedValue(makeProject('project-copy', 'Alpha (copy)'));

    useProjectStore.setState({
      project: currentProject,
      error: null,
      lastSavedAt: 0,
      switchProjectById,
      loadProject: vi.fn(),
      saveProject: vi.fn().mockResolvedValue(undefined),
      initializeProject: vi.fn().mockResolvedValue(undefined),
    });
  });

  async function openPicker(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    render(<ProjectPicker />);

    await waitFor(() => expect(listRecentProjects).toHaveBeenCalled());
    await user.click(screen.getByTestId('project-picker-trigger'));
    await screen.findByTestId('project-picker-menu');
    await screen.findByText('Beta');
    return user;
  }

  it('opens actions for an unselected project without selecting it', async () => {
    const user = await openPicker();

    fireEvent.contextMenu(screen.getByTitle('Beta'));
    expect(screen.queryByTestId('project-action-menu')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('project-actions-project-2'));

    expect(screen.getByTestId('project-action-menu')).toBeInTheDocument();
    expect(switchProjectById).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('project-action-duplicate'));

    await waitFor(() => {
      expect(duplicateProject).toHaveBeenCalledWith('project-2');
    });
  });

  it('does not select a project when the pointer lands beside its ellipsis button', async () => {
    await openPicker();

    const actionButton = screen.getByTestId('project-actions-project-2');
    const row = actionButton.parentElement;
    expect(row).not.toBeNull();

    fireEvent.click(row!);

    expect(switchProjectById).not.toHaveBeenCalled();
  });

  it('keeps the picker open when pointerdown lands on the ellipsis SVG', async () => {
    await openPicker();

    const actionButton = screen.getByTestId('project-actions-project-2');
    const icon = actionButton.querySelector('svg');
    expect(icon).not.toBeNull();

    fireEvent.mouseDown(icon!);
    fireEvent.click(icon!);

    expect(screen.getByTestId('project-picker-menu')).toBeInTheDocument();
    expect(screen.getByTestId('project-action-menu')).toBeInTheDocument();
    expect(switchProjectById).not.toHaveBeenCalled();
  });

  it('renames a project from the ellipsis menu and persists the new title', async () => {
    const user = await openPicker();

    await user.click(screen.getByTestId('project-actions-project-2'));
    await user.click(screen.getByTestId('project-action-rename'));

    const input = screen.getByTestId('project-rename-input-project-2');
    expect(input).toHaveValue('Beta');
    await user.clear(input);
    await user.type(input, 'Beta Renamed{Enter}');

    await waitFor(() => {
      expect(tauriLoadProject).toHaveBeenCalledWith('project-2');
      expect(tauriSaveProject).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ title: 'Beta Renamed' }),
        }),
      );
    });
  });

  it('filters rows by title, ignoring case, and shows an empty state', async () => {
    const user = await openPicker();

    const search = screen.getByTestId('project-search-input');
    expect(search).toHaveFocus();

    await user.type(search, 'bET');
    expect(screen.getByTestId('project-row-project-2')).toBeInTheDocument();
    expect(screen.queryByTestId('project-row-project-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('project-search-empty')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'zzz');
    expect(screen.queryByTestId('project-row-project-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-search-empty')).toHaveTextContent('projectSidebar.noSearchResults');
  });

  it('clears the search query when the picker is reopened', async () => {
    const user = await openPicker();

    await user.type(screen.getByTestId('project-search-input'), 'beta');
    expect(screen.queryByTestId('project-row-project-1')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('project-picker-menu')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('project-picker-trigger'));
    expect(screen.getByTestId('project-search-input')).toHaveValue('');
    expect(screen.getByTestId('project-row-project-1')).toBeInTheDocument();
    expect(screen.getByTestId('project-row-project-2')).toBeInTheDocument();
  });

  it('closes a leftover new-project form on reopen so the search input keeps focus', async () => {
    const user = await openPicker();

    await user.click(screen.getByTestId('project-new-button'));
    expect(screen.getByTestId('project-title-input')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('project-picker-trigger'));

    expect(screen.queryByTestId('project-title-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-search-input')).toHaveFocus();
  });

  it('moves the highlight with arrow keys and opens the highlighted project with Enter', async () => {
    const user = await openPicker();
    const alphaRow = screen.getByTestId('project-row-project-1');
    const betaRow = screen.getByTestId('project-row-project-2');

    expect(alphaRow).toHaveAttribute('data-highlighted', 'true');

    // 목록 끝에서 멈춘다.
    await user.keyboard('{ArrowUp}');
    expect(alphaRow).toHaveAttribute('data-highlighted', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(betaRow).toHaveAttribute('data-highlighted', 'true');
    expect(alphaRow).not.toHaveAttribute('data-highlighted');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(switchProjectById).toHaveBeenCalledWith('project-2'));
    expect(screen.queryByTestId('project-picker-menu')).not.toBeInTheDocument();
  });

  it('resets the highlight to the first match when the query changes', async () => {
    const user = await openPicker();
    const search = screen.getByTestId('project-search-input');

    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('project-row-project-2')).toHaveAttribute('data-highlighted', 'true');

    // 'a'는 Alpha와 Beta 둘 다 남긴다. 강조는 맨 위로 돌아가야 한다.
    await user.type(search, 'a');
    expect(screen.getByTestId('project-row-project-1')).toHaveAttribute('data-highlighted', 'true');

    await user.clear(search);
    await user.type(search, 'bet{Enter}');
    await waitFor(() => expect(switchProjectById).toHaveBeenCalledWith('project-2'));
  });

  it('ignores arrow keys and Enter while IME composition is active', async () => {
    await openPicker();
    const search = screen.getByTestId('project-search-input');

    fireEvent.keyDown(search, { key: 'ArrowDown', isComposing: true });
    fireEvent.keyDown(search, { key: 'Enter', isComposing: true });
    // WKWebView: 조합을 끝내는 Enter가 isComposing=false, keyCode=229로 온다.
    fireEvent.keyDown(search, { key: 'Enter', keyCode: 229 });

    expect(screen.getByTestId('project-row-project-1')).toHaveAttribute('data-highlighted', 'true');
    expect(switchProjectById).not.toHaveBeenCalled();
    expect(screen.getByTestId('project-picker-menu')).toBeInTheDocument();
  });

  it('moves the highlight to the row under the mouse', async () => {
    await openPicker();

    fireEvent.mouseMove(screen.getByTestId('project-row-project-2'));

    expect(screen.getByTestId('project-row-project-2')).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('project-row-project-1')).not.toHaveAttribute('data-highlighted');
  });

  it('switches to the next project from the full list when deleting while filtered', async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(deleteProject).mockResolvedValue();
    const user = await openPicker();

    // 현재 프로젝트만 보이게 거른 뒤 삭제한다. 다음 프로젝트는 필터 밖의 Beta여야 한다.
    await user.type(screen.getByTestId('project-search-input'), 'alpha');
    expect(screen.queryByTestId('project-row-project-2')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('project-actions-project-1'));
    await user.click(screen.getByRole('menuitem', { name: 'projectSidebar.deleteProject' }));

    await waitFor(() => {
      expect(switchProjectById).toHaveBeenCalledWith('project-2');
      expect(deleteProject).toHaveBeenCalledWith('project-1');
    });
  });
});
