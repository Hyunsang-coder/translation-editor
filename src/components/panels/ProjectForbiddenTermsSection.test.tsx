import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectForbiddenTermsSection } from './ProjectForbiddenTermsSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/stores/projectMemoryStore', () => ({
  useProjectMemoryStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    forbiddenTerms: [],
    saving: false,
    saveForbiddenTerm: vi.fn(),
    removeForbiddenTerm: vi.fn(),
  }),
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    addToast: vi.fn(),
  }),
}));

describe('ProjectForbiddenTermsSection', () => {
  it('설명에 설정 패널의 공통 글자 크기를 사용한다', () => {
    render(<ProjectForbiddenTermsSection />);

    expect(screen.getByText('memory.forbiddenTermsDescription')).toHaveClass('text-[11px]');
  });
});
