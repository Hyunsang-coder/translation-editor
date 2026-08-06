import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectGlossarySection } from './ProjectGlossarySection';

const loadLibrary = vi.fn().mockResolvedValue(undefined);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('./GlossaryManagerModal', () => ({
  GlossaryManagerModal: () => null,
}));

vi.mock('@/stores/glossaryStore', () => ({
  useGlossaryStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    projectGlossaries: [],
    loading: false,
    error: null,
    loadLibrary,
    createEntry: vi.fn(),
    saveProjectSelection: vi.fn(),
    saving: false,
  }),
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    addToast: vi.fn(),
  }),
}));

describe('ProjectGlossarySection', () => {
  it('다른 설정 섹션과 같은 제목·설명·컨트롤 크기를 사용한다', () => {
    render(<ProjectGlossarySection projectId="project-1" />);

    expect(screen.getByText('settings.glossary')).toHaveClass('text-xs');
    expect(screen.getByText('settings.glossaryDescription')).toHaveClass('text-[11px]');
    expect(screen.getByRole('button', { name: 'glossaryManager.manage' })).toHaveClass('text-xs');
    expect(screen.getByRole('button', { name: 'glossaryManager.noActiveGlossaries' })).toHaveClass('text-xs');
  });
});
