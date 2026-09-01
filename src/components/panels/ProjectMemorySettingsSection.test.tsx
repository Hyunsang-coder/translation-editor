import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectMemoryItem } from '@/types';
import { ProjectMemorySettingsSection } from './ProjectMemorySettingsSection';

const memoryItem: ProjectMemoryItem = {
  id: 'memory-1',
  projectId: 'project-1',
  category: 'general',
  content: '프로젝트에서 계속 사용할 정보',
  normalizedHash: 'hash-1',
  status: 'active',
  source: 'user',
  createdAt: 1,
  updatedAt: 1,
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn() }));

vi.mock('@/components/panels/ProjectMemoryImportModal', () => ({
  ProjectMemoryImportModal: () => null,
}));

vi.mock('@/stores/projectMemoryStore', () => ({
  useProjectMemoryStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    items: [memoryItem],
    forbiddenTerms: [],
    saving: false,
    addItem: vi.fn(),
    replaceItem: vi.fn(),
    deleteItem: vi.fn(),
    saveForbiddenTerm: vi.fn(),
    removeForbiddenTerm: vi.fn(),
  }),
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    addToast: vi.fn(),
  }),
}));

describe('ProjectMemorySettingsSection', () => {
  it('채팅 전달 개수를 표시하지 않는다', () => {
    render(<ProjectMemorySettingsSection />);

    expect(screen.queryByText('memory.chatInjection')).not.toBeInTheDocument();
  });

  it('컨트롤에 설정 패널의 공통 글자 크기를 사용한다', () => {
    render(<ProjectMemorySettingsSection />);

    // 섹션 설명은 제거됐다 — 제목만으로 충분하고, 승인 절차가 없어 문구가 사실과 달랐다.
    expect(screen.queryByText('memory.settingsDescription')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'memory.import.open' })).toHaveClass('text-xs');
  });
});
