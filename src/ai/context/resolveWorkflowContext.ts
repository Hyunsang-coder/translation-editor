import type {
  ContextManifest,
  ContextReferenceOptions,
  ContextSnapshot,
  ResolvedWorkflowContext,
  WorkflowContextMode,
} from '@/types';
import { hashContent } from '@/utils/hash';
import { approxTokens } from '@/ai/chatContext/tokenBudget';
import { formatGlossaryForPrompt } from '@/utils/glossaryInject';
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

/**
 * 용어집 notes 항목당 상한.
 *
 * 워크플로우는 30~40개 항목을 한 번에 주입하므로 notes에 상한이 없으면 용어집만으로
 * 프롬프트가 불어난다. 판단 근거는 앞부분에 오므로 잘라도 쓸모가 남는다.
 */
const GLOSSARY_NOTE_MAX_CHARS = 100;

function truncateNote(note: string): string {
  const trimmed = note.trim();
  return trimmed.length > GLOSSARY_NOTE_MAX_CHARS
    ? `${trimmed.slice(0, GLOSSARY_NOTE_MAX_CHARS)}...`
    : trimmed;
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
  // 선택 영역 워크플로우(재번역·폴리싱)만 참조 범위를 사용자가 고른다. 문서 전체를
  // 다루는 mode는 includeAll이라 여기에 걸리지 않는다.
  const optionDriven = mode === 'selection-retranslate' || mode === 'selection-polish';
  const useTranslationRules =
    all || (optionDriven && options?.translationRules === true);
  const useForbiddenTerms =
    all || (optionDriven && options?.forbiddenTerms === true);
  const useGlossary =
    all || (optionDriven && options?.glossary === true);
  const useProjectMemory =
    all || (optionDriven && options?.projectMemory === true);

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
    // notes(동음이의 판단 근거)를 버리지 않는다 — 채팅 도구는 이미 넣고 있어서,
    // 버리면 같은 검수를 채팅으로 하느냐 패널로 하느냐에 따라 근거가 달라진다.
    rendered.glossary = formatGlossaryForPrompt(
      snapshot.glossaryEntries.map(({ source, target, notes }) => ({
        source,
        target,
        ...(notes ? { notes: truncateNote(notes) } : {}),
      })),
    );
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
