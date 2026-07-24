import type {
  ChatMessage,
  ChatSelectionSnapshot,
  SelectionContext,
} from '@/types';

export function toChatSelectionSnapshot(
  selection: SelectionContext,
): ChatSelectionSnapshot {
  return {
    selectionId: selection.selectionId,
    selectionScopeId: selection.selectionScopeId,
    projectId: selection.projectId,
    panel: selection.panel,
    text: selection.text,
    translationUnitIds: [...selection.translationUnitIds],
    documentRevision: selection.documentRevision,
    anchorStatusAtSend: selection.status,
  };
}

export function filterMessagesForSelectionScope(
  messages: ChatMessage[],
  selectionScopeId: string,
  limit = 12,
): ChatMessage[] {
  return messages
    .filter((message) => message.metadata?.selectionScopeId === selectionScopeId)
    .slice(-Math.max(1, limit));
}
