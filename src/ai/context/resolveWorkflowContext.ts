import type {
  ContextManifest,
  ContextReferenceOptions,
  ContextSnapshot,
  ResolvedWorkflowContext,
  WorkflowContextMode,
} from '@/types';
import { hashContent } from '@/utils/hash';
import { approxTokens } from '@/ai/chatContext/tokenBudget';
import {
  formatForbiddenTermLine,
  renderSnapshotMemory,
} from './projectKnowledgeRender';
import { memoryItemLimit } from './projectMemoryPolicy';
export {
  buildContextSnapshot,
  type BuildContextSnapshotInput,
} from './buildContextSnapshot';

interface ResolveWorkflowContextFromSnapshotInput {
  mode: WorkflowContextMode;
  snapshot: ContextSnapshot;
  referenceOptions?: ContextReferenceOptions;
}

function includeAll(mode: WorkflowContextMode): boolean {
  return (
    mode === 'general-chat' ||
    mode === 'full-translate' ||
    mode === 'review' ||
    mode === 'polish'
  );
}

export function resolveWorkflowContextFromSnapshot(
  input: ResolveWorkflowContextFromSnapshotInput,
): ResolvedWorkflowContext {
  const { mode, snapshot } = input;
  const all = includeAll(mode);
  const options = input.referenceOptions;
  const useTranslationRules =
    all || (mode === 'selection-retranslate' && options?.translationRules === true);
  const useForbiddenTerms =
    all || (mode === 'selection-retranslate' && options?.forbiddenTerms === true);
  const useGlossary =
    all || (mode === 'selection-retranslate' && options?.glossary === true);
  const useProjectMemory =
    all || (mode === 'selection-retranslate' && options?.projectContext === true);

  const rendered: ResolvedWorkflowContext['rendered'] = {};
  const included: ContextManifest['included'] = [];

  // 무엇을 주입할지는 mode를 아는 resolver의 책임이다. snapshot은 "그 시점의 프로젝트
  // 지식 전체"라는 의미를 유지해야 하므로 상한을 여기서 적용한다.
  const memorySelection = useProjectMemory
    ? renderSnapshotMemory(snapshot.projectMemoryItems, memoryItemLimit(mode))
    : null;
  if (memorySelection?.text) {
    rendered.projectMemory = memorySelection.text;
    included.push('project-memory');
  }
  if (useTranslationRules && snapshot.translationRules.trim()) {
    rendered.translationRules = snapshot.translationRules.trim();
    included.push('translation-rules');
  }
  if (useForbiddenTerms && snapshot.forbiddenTerms.length > 0) {
    rendered.forbiddenTerms = snapshot.forbiddenTerms
      .map(formatForbiddenTermLine)
      .join('\n');
    included.push('forbidden-terms');
  }
  if (useGlossary && snapshot.glossaryEntries.length > 0) {
    rendered.glossary = snapshot.glossaryEntries
      .map((entry) => `${entry.source} = ${entry.target}`)
      .join('\n');
    included.push('glossary');
  }

  const renderedText = Object.values(rendered).filter(Boolean).join('\n\n');
  return {
    snapshot,
    manifest: {
      mode,
      revision: snapshot.revision,
      projectMemoryItemIds: memorySelection?.itemIds ?? [],
      ...(useTranslationRules && snapshot.translationRules.trim()
        ? { translationRulesHash: hashContent(snapshot.translationRules.trim()) }
        : {}),
      forbiddenTermIds: useForbiddenTerms
        ? snapshot.forbiddenTerms.map((term) => term.id)
        : [],
      glossaryEntryIds: useGlossary
        ? snapshot.glossaryEntries.map((entry) => entry.id)
        : [],
      included,
      estimatedInputTokens: approxTokens(renderedText),
    },
    rendered,
  };
}
