import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITEProject } from '@/types';
import { useProjectStore } from '@/stores/projectStore';
import { listRecentProjects } from '@/tauri/storage';
import {
  duplicateProject,
  loadProject as tauriLoadProject,
  saveProject as tauriSaveProject,
} from '@/tauri/project';
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
});
