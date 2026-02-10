/**
 * chatStore - 메인 컴포지션 + 내보내기
 *
 * 7개 슬라이스를 조합하여 단일 Zustand 스토어를 생성합니다.
 * 개별 슬라이스는 chatStore.*.ts 파일에 정의되어 있습니다.
 *
 * @see chatStore.types.ts    - 타입, 인터페이스, 상수
 * @see chatStore.helpers.ts  - 순수 헬퍼 함수
 * @see chatStore.persist.ts  - 영속성 로직
 * @see chatStore.session.ts  - 세션/메시지 CRUD + hydration
 * @see chatStore.ai.ts       - AI 상호작용 (executeAiReply, sendMessage, replayMessage, streaming)
 * @see chatStore.settings.ts - 설정, 첨부, 컴포저, 컨텍스트 블록, 유틸리티
 */
import { create } from 'zustand';
import type { ChatStore } from './chatStore.types';
import { DEFAULT_TRANSLATOR_PERSONA } from './chatStore.types';
import { createPersistHelpers } from './chatStore.persist';
import { createSessionActions, createMessageActions } from './chatStore.session';
import { createAiActions, createStreamingActions } from './chatStore.ai';
import {
  createComposerActions,
  createSettingsActions,
  createContextBlockActions,
  createAttachmentActions,
  createUtilityActions,
} from './chatStore.settings';

export const useChatStore = create<ChatStore>((set, get) => {
  // 1. Persistence helpers (module-level debounce state)
  const { schedulePersist, persistNow } = createPersistHelpers(get);

  // 2. Action slices
  const sessionActions = createSessionActions(set, get, { schedulePersist, persistNow });
  const messageActions = createMessageActions(set, get, { schedulePersist });
  const aiActions = createAiActions(set, get, { schedulePersist, persistNow });
  const streamingActions = createStreamingActions(set, get);
  const composerActions = createComposerActions(set, get, { schedulePersist });
  const settingsActions = createSettingsActions(set, get, { schedulePersist });
  const contextBlockActions = createContextBlockActions(set, get, { schedulePersist });
  const attachmentActions = createAttachmentActions(set, get);
  const utilityActions = createUtilityActions(set);

  // 3. Compose store
  return {
    // ── Initial State ────────────────────────────────────────────────
    sessions: [],
    currentSessionId: null,
    currentSession: null,
    isLoading: false,
    isFinalizingStreaming: false,
    streamingMessageId: null,
    streamingSessionId: null,
    streamingContent: null,
    streamingMetadata: null,
    error: null,
    statusMessage: null,
    lastInjectedGlossary: [],
    isHydrating: false,
    abortController: null,
    summarySuggestionDismissedBySessionId: {},
    composerText: '',
    composerFocusNonce: 0,
    pendingComposerAppend: null,
    translatorPersona: DEFAULT_TRANSLATOR_PERSONA,
    translationRules: '',
    projectContext: '',
    webSearchEnabled: true,
    translationContextSessionId: null,
    loadedProjectId: null,
    attachments: [],
    composerAttachments: [],

    // ── Actions (spread all slices) ──────────────────────────────────
    ...sessionActions,
    ...messageActions,
    ...aiActions,
    ...streamingActions,
    ...composerActions,
    ...settingsActions,
    ...contextBlockActions,
    ...attachmentActions,
    ...utilityActions,
  };
});

// Re-export types for convenience
export type { ChatStore, ChatState, ChatActions } from './chatStore.types';
export {
  CHAT_PERSIST_DEBOUNCE_MS,
  MAX_CHAT_SESSIONS,
  MAX_MESSAGES_PER_SESSION,
  CHAT_LENGTH_THRESHOLD,
  DEFAULT_TRANSLATOR_PERSONA,
  TOOL_NAME_MAP,
} from './chatStore.types';
