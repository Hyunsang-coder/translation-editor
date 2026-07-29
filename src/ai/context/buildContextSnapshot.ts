import type {
  ContextSnapshot,
  ForbiddenTerm,
  GlossaryEntry,
  ProjectMemoryItem,
} from '@/types';

export interface BuildContextSnapshotInput {
  revision: number;
  projectMemoryItems: ProjectMemoryItem[];
  /** 구조화 메모리 migration 전/실패 시 기존 Project Context를 보존하는 fallback. */
  legacyProjectContext?: string;
  translationRules: string;
  forbiddenTerms: ForbiddenTerm[];
  glossaryEntries: Array<Pick<GlossaryEntry, 'id' | 'source' | 'target'>>;
  createdAt?: number;
}

export function buildContextSnapshot(
  input: BuildContextSnapshotInput,
): ContextSnapshot {
  const activeProjectMemoryItems = input.projectMemoryItems
    .filter((item) => item.status === 'active')
    .map(({ id, category, content, source }) => ({ id, category, content, source }));
  const legacyProjectContext = input.legacyProjectContext?.trim();
  if (activeProjectMemoryItems.length === 0 && legacyProjectContext) {
    activeProjectMemoryItems.push({
      id: 'legacy-project-context',
      category: 'general',
      content: legacyProjectContext,
      source: 'legacy',
    });
  }

  return {
    revision: input.revision,
    projectMemoryItems: activeProjectMemoryItems,
    translationRules: input.translationRules,
    forbiddenTerms: input.forbiddenTerms
      .filter((term) => term.enabled)
      .map(({ id, term, replacement, note }) => ({
        id,
        term,
        ...(replacement ? { replacement } : {}),
        ...(note ? { note } : {}),
      })),
    glossaryEntries: input.glossaryEntries
      .map(({ id, source, target }) => ({ id, source, target })),
    createdAt: input.createdAt ?? Date.now(),
  };
}
