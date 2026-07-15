import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createGlossary,
  createGlossaryEntry,
  importGlossaryCsv,
  listGlossaries,
  listGlossaryEntries,
  listProjectGlossaries,
  setProjectGlossaries,
} from '@/tauri/glossary';
import { pickGlossaryCsvFile } from '@/tauri/dialog';
import { useGlossaryStore } from '@/stores/glossaryStore';
import { GlossaryManagerModal } from './GlossaryManagerModal';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

vi.mock('@/tauri/dialog', () => ({
  pickGlossaryCsvFile: vi.fn(),
  pickGlossaryExcelFile: vi.fn(),
}));

vi.mock('@/tauri/glossary', async () => {
  const actual = await vi.importActual<typeof import('@/tauri/glossary')>('@/tauri/glossary');
  return {
    ...actual,
    listGlossaries: vi.fn(),
    listProjectGlossaries: vi.fn(),
    listGlossaryEntries: vi.fn(),
    createGlossary: vi.fn(),
    updateGlossary: vi.fn(),
    deleteGlossary: vi.fn(),
    createGlossaryEntry: vi.fn(),
    updateGlossaryEntry: vi.fn(),
    deleteGlossaryEntry: vi.fn(),
    setProjectGlossaries: vi.fn(),
    importGlossaryCsv: vi.fn(),
    importGlossaryExcel: vi.fn(),
  };
});

const glossary = {
  id: 'g-1',
  name: 'PUBG 공통',
  description: null,
  entryCount: 0,
  createdAt: 1,
  updatedAt: 1,
};

describe('GlossaryManagerModal', () => {
  beforeEach(() => {
    useGlossaryStore.getState().reset();
    vi.clearAllMocks();
    vi.mocked(listGlossaries).mockResolvedValue([glossary]);
    vi.mocked(listProjectGlossaries).mockResolvedValue([{ ...glossary, priority: 0 }]);
    vi.mocked(listGlossaryEntries).mockResolvedValue([]);
  });

  it('creates a glossary without auto-linking it to the project', async () => {
    const user = userEvent.setup();
    const created = {
      id: 'g-new',
      name: 'Library only',
      description: null,
      entryCount: 0,
      createdAt: 3,
      updatedAt: 3,
    };
    vi.mocked(createGlossary).mockResolvedValue(created);

    render(
      <GlossaryManagerModal
        open
        projectId="project-1"
        onClose={vi.fn()}
      />,
    );

    await screen.findAllByText('PUBG 공통');
    await user.click(screen.getByRole('button', { name: 'glossaryManager.newGlossary' }));
    await user.type(screen.getByLabelText('glossaryManager.glossaryName'), 'Library only');
    await user.click(screen.getByRole('button', { name: 'common.confirm' }));

    await waitFor(() => {
      expect(createGlossary).toHaveBeenCalledWith({
        name: 'Library only',
        description: null,
      });
    });
    expect(setProjectGlossaries).not.toHaveBeenCalled();
    expect(useGlossaryStore.getState().projectGlossaries.map((item) => item.id)).toEqual(['g-1']);
    expect(useGlossaryStore.getState().glossaries.some((item) => item.id === 'g-new')).toBe(true);
  });

  it('shows saved glossaries and adds a manual term', async () => {
    const user = userEvent.setup();
    vi.mocked(createGlossaryEntry).mockResolvedValue({
      id: 'e-1',
      glossaryId: 'g-1',
      source: 'Care Package',
      target: '보급 상자',
      notes: null,
      domain: null,
      caseSensitive: false,
      createdAt: 2,
      updatedAt: 2,
    });

    render(
      <GlossaryManagerModal
        open
        projectId="project-1"
        onClose={vi.fn()}
      />,
    );

    expect((await screen.findAllByText('PUBG 공통')).length).toBeGreaterThan(0);
    expect(screen.getByRole('checkbox', { name: 'glossaryManager.useInProject' })).toBeChecked();

    await user.type(screen.getByLabelText('glossaryManager.source'), 'Care Package');
    await user.type(screen.getByLabelText('glossaryManager.target'), '보급 상자');
    await user.click(screen.getByRole('button', { name: 'glossaryManager.addTerm' }));

    await waitFor(() => {
      expect(createGlossaryEntry).toHaveBeenCalledWith(expect.objectContaining({
        glossaryId: 'g-1',
        source: 'Care Package',
        target: '보급 상자',
      }));
    });
    expect(await screen.findByText('Care Package')).toBeInTheDocument();
    expect(screen.getByText('보급 상자')).toBeInTheDocument();
  });

  it('imports CSV terms into the selected glossary', async () => {
    const user = userEvent.setup();
    vi.mocked(pickGlossaryCsvFile).mockResolvedValue('/tmp/terms.csv');
    vi.mocked(importGlossaryCsv).mockResolvedValue({
      inserted: 2,
      updated: 0,
      skipped: 0,
      warnings: [],
    });
    vi.mocked(listGlossaries).mockResolvedValue([{ ...glossary, entryCount: 2 }]);
    vi.mocked(listGlossaryEntries).mockResolvedValue([
      {
        id: 'e-1',
        glossaryId: 'g-1',
        source: 'Care Package',
        target: '보급 상자',
        notes: null,
        domain: null,
        caseSensitive: false,
        createdAt: 2,
        updatedAt: 2,
      },
    ]);

    render(
      <GlossaryManagerModal
        open
        projectId="project-1"
        onClose={vi.fn()}
      />,
    );

    await screen.findAllByText('PUBG 공통');
    await user.click(screen.getByRole('button', { name: 'settings.glossaryImportCsv' }));

    await waitFor(() => {
      expect(importGlossaryCsv).toHaveBeenCalledWith({
        glossaryId: 'g-1',
        path: '/tmp/terms.csv',
        replaceEntries: false,
      });
    });
    expect(await screen.findByText('Care Package')).toBeInTheDocument();
  });
});
