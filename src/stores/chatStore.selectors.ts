/**
 * ChatStore 그룹화된 선택자
 *
 * 14+ 개별 선택자를 논리적 그룹으로 통합하여:
 * - 불필요한 리렌더링 방지
 * - 코드 가독성 향상
 * - 선택자 재사용 촉진
 */
import { useShallow } from 'zustand/shallow';
import { useChatStore as useBaseStore } from './chatStore';

// Re-export for convenience
export { useChatStore } from './chatStore';

/**
 * Composer(입력창) 관련 상태 그룹
 */
export function useChatComposerState() {
  return useBaseStore(
    useShallow((s) => ({
      composerText: s.composerText,
      setComposerText: s.setComposerText,
      composerAttachments: s.composerAttachments,
      addComposerAttachment: s.addComposerAttachment,
      removeComposerAttachment: s.removeComposerAttachment,
      focusNonce: s.composerFocusNonce,
    }))
  );
}

/**
 * 세션 관련 상태 그룹
 */
export function useChatSessionState() {
  return useBaseStore(
    useShallow((s) => ({
      currentSession: s.currentSession,
      sessions: s.sessions,
      currentSessionId: s.currentSessionId,
      createSession: s.createSession,
      isHydrating: s.isHydrating,
      hydrateForProject: s.hydrateForProject,
    }))
  );
}

/**
 * 스트리밍 관련 상태 그룹
 */
export function useChatStreamingState() {
  return useBaseStore(
    useShallow((s) => ({
      isLoading: s.isLoading,
      streamingMessageId: s.streamingMessageId,
      streamingContent: s.streamingContent,
      streamingMetadata: s.streamingMetadata,
      statusMessage: s.statusMessage,
    }))
  );
}

/**
 * 검색(Web Search, Confluence) 관련 상태 그룹
 */
export function useChatSearchState() {
  return useBaseStore(
    useShallow((s) => ({
      webSearchEnabled: s.webSearchEnabled,
      setWebSearchEnabled: s.setWebSearchEnabled,
      confluenceSearchEnabled: s.currentSession?.confluenceSearchEnabled ?? false,
      setConfluenceSearchEnabled: s.setConfluenceSearchEnabled,
    }))
  );
}

/**
 * 메시지 액션 그룹
 */
export function useChatMessageActions() {
  return useBaseStore(
    useShallow((s) => ({
      sendMessage: s.sendMessage,
      editMessage: s.editMessage,
      replayMessage: s.replayMessage,
      deleteMessageFrom: s.deleteMessageFrom,
      updateMessage: s.updateMessage,
      appendToTranslationRules: s.appendToTranslationRules,
      appendToProjectContext: s.appendToProjectContext,
    }))
  );
}

/**
 * 요약 제안 관련 상태 그룹
 * 파생 상태(shouldShow)를 포함하여 컴포넌트 로직 간소화
 */
export function useSummarySuggestionState() {
  return useBaseStore(
    useShallow((s) => {
      const currentSessionId = s.currentSessionId;
      const messageCount = s.currentSession?.messages.length ?? 0;
      const dismissedMap = s.summarySuggestionDismissedBySessionId;
      const shouldShow =
        currentSessionId !== null &&
        !dismissedMap[currentSessionId] &&
        messageCount >= 30;

      return {
        shouldShow,
        dismiss: s.dismissSummarySuggestion,
        startNewSession: s.startNewSessionFromSuggestion,
      };
    })
  );
}

/**
 * 핵심 채팅 상태 (기존 패턴 호환용)
 */
export function useChatCoreState() {
  return useBaseStore(
    useShallow((s) => ({
      currentSession: s.currentSession,
      sendMessage: s.sendMessage,
      isLoading: s.isLoading,
    }))
  );
}
