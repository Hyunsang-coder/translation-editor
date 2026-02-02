import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { ChatSession, ChatMessage, GlossaryEntry } from '@/types';
import { streamAssistantReply } from '@/ai/chat';
import { useConnectorStore } from '@/stores/connectorStore';
import { getAiConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';
import { useProjectStore } from '@/stores/projectStore';
import { searchGlossary } from '@/tauri/glossary';
import { isTauriRuntime } from '@/tauri/invoke';
import {
  loadChatProjectSettings,
  loadChatSessions,
  saveChatProjectSettings,
  saveChatSessions,
  type ChatProjectSettings,
} from '@/tauri/chat';
import {
  attachFile,
  deleteAttachment as deleteAttachmentApi,
  listAttachments,
  type AttachmentDto,
  previewAttachment,
  readImageAsDataUrl,
} from '@/tauri/attachments';
import {
  createGhostMaskSession,
  maskGhostChips,
  restoreGhostChips,
} from '@/utils/ghostMask';
import { cleanSuggestionContent } from '@/utils/cleanSuggestionContent';
import { resizeImageForApi, IMAGE_SIZE_LIMITS } from '@/utils/imageResize';
import { stripHtml } from '@/utils/hash';

const CHAT_PERSIST_DEBOUNCE_MS = 800;
let chatPersistTimer: number | null = null;
let chatPersistInFlight = false;
let chatPersistQueued = false;
let hydrateRequestId = 0;
// Issue #9 Fix: 타이머 스케줄 시점의 프로젝트 ID를 캡처하여 persist 시 재검증
let scheduledPersistProjectId: string | null = null;

const DEFAULT_TRANSLATOR_PERSONA = '';

// 채팅 세션 관련 상수
const MAX_CHAT_SESSIONS = 5;
const MAX_MESSAGES_PER_SESSION = 1000;
const CHAT_LENGTH_THRESHOLD = 30;

function tryExtractWebSearchQuery(raw: string): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  // 명시적 트리거(Non-Intrusive): 사용자가 /web 또는 웹검색: 형태로 입력했을 때만 실행
  const slash = t.match(/^\/(web|search)\s+([\s\S]+)$/i);
  if (slash?.[2]) return slash[2].trim();
  const colon = t.match(/^(웹검색|웹 검색|web)\s*:\s*([\s\S]+)$/i);
  if (colon?.[2]) return colon[2].trim();
  return null;
}

function extractTextFromAiMessage(ai: unknown): string {
  const content = (ai as any)?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object' && 'text' in c) return String((c as any).text ?? '');
        return '';
      })
      .join('');
  }
  return content ? String(content) : '';
}


function inferSuggestionFromAssistantText(text: string): { suggestedRule?: string; suggestedContext?: string } | null {
  const t = (text ?? '').trim();
  if (!t) return null;

  // 사용자가 클릭해야 반영되는 버튼 안내 문구가 있을 때만 "보수적으로" suggestion을 추론합니다.
  // (오탐 방지: 단순 설명/대화에는 버튼을 띄우지 않음)
  // 패턴 확장: [Add to Rules], [Add to Context] 같은 명시적 버튼 멘트도 허용
  const ruleTrigger = /(?:원하시면|필요하시면|저장하려면)\s*.*(?:버튼을|\[Add to Rules\]).*번역\s*규칙/i;
  const contextTrigger = /(?:원하시면|필요하시면|저장하려면)\s*.*(?:버튼을|\[Add to Context\]).*(?:project\s*context|컨텍스트|맥락)/i;

  const hasRule = ruleTrigger.test(t) || t.includes('[Add to Rules]');
  const hasContext = contextTrigger.test(t) || t.includes('[Add to Context]');

  if (!hasRule && !hasContext) return null;

  // AI가 붙이는 서두 문구 제거 (예: "프로젝트 컨텍스트 저장 제안을 올려두었습니다:")
  const preamblePatterns = [
    /^(?:프로젝트\s*)?컨텍스트\s*저장\s*제안을?\s*올려\s*두었습니다[:\s]*/i,
    /^번역\s*규칙\s*저장\s*제안을?\s*올려\s*두었습니다[:\s]*/i,
    /^(?:다음|아래)(?:와 같은|의)?\s*(?:번역\s*규칙|컨텍스트|맥락).*?(?:제안합니다|올려두었습니다)[:\s]*/i,
    /^(?:번역\s*규칙|컨텍스트|맥락)\s*제안[:\s]*/i,
  ];

  // 뒷부분 안내 문구 제거 (예: "원하시면 **", "필요하시면...")
  const suffixPatterns = [
    /(?:원하시면|필요하시면|저장하려면|추가하려면)\s*\**\s*$/i,
    /\s*\*+\s*$/,  // 잘린 마크다운 볼드
  ];

  const cleanContent = (raw: string): string => {
    let core = raw.trim();
    for (const pattern of preamblePatterns) {
      core = core.replace(pattern, '').trim();
    }
    for (const pattern of suffixPatterns) {
      core = core.replace(pattern, '').trim();
    }
    // 마크다운 포맷팅 제거 (**, *, `)
    core = core
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
    // 저장 필드 폭주 방지
    const maxLen = 3000;
    return core.length > maxLen ? `${core.slice(0, maxLen)}...` : core;
  };

  const content = cleanContent(t);
  if (!content) return null;

  const result: { suggestedRule?: string; suggestedContext?: string } = {};
  if (hasRule) result.suggestedRule = content;
  if (hasContext) result.suggestedContext = content;

  return result;
}

// ============================================
// Store State Interface
// ============================================

interface ChatState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  currentSession: ChatSession | null;
  isLoading: boolean;
  isHydrating: boolean;
  /** finalization 진행 중 여부 (Race Condition 방지) */
  isFinalizingStreaming: boolean;
  streamingMessageId: string | null;
  /** 스트리밍 중인 메시지 콘텐츠 (배열 갱신 없이 단일 필드만 업데이트) */
  streamingContent: string | null;
  /** 스트리밍 중인 메시지의 메타데이터 */
  streamingMetadata: ChatMessage['metadata'] | null;
  error: string | null;
  statusMessage: string | null;
  // 최근 요청에서 주입된 글로서리(디버깅/가시화)
  lastInjectedGlossary: GlossaryEntry[];
  // 대화 길이 알림: 세션별 dismiss 상태
  summarySuggestionDismissedBySessionId: Record<string, boolean>;
  // Chat composer
  composerText: string;
  composerFocusNonce: number;
  translatorPersona: string;
  translationRules: string;
  projectContext: string;
  /** 웹검색 사용 여부 (tool availability gate) */
  webSearchEnabled: boolean;
  /**
   * 문서 전체 번역(Preview→Apply) 컨텍스트로 사용할 채팅 탭
   * - null이면 현재 탭(currentSession)의 최신 메시지 10개를 사용
   */
  translationContextSessionId: string | null;
  /** 현재 로드된 프로젝트 ID (저장 시 검증용) */
  loadedProjectId: string | null;
  /** 첨부 파일 목록 (4.2) */
  attachments: AttachmentDto[];
  /** 채팅 컴포저 전용 첨부(일회성, 비영속) */
  composerAttachments: AttachmentDto[];
  /** 진행 중인 API 요청 취소용 AbortController */
  abortController: AbortController | null;
}

interface ChatActions {
  // 세션 관리
  createSession: (name?: string) => string;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => void;

  // 메시지 관리
  sendMessage: (content: string) => Promise<void>;
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => string | null;
  updateMessage: (
    messageId: string,
    patch: Partial<Omit<ChatMessage, 'id' | 'timestamp'>>,
  ) => void;
  /**
   * 메시지 수정: 해당 메시지 이후 대화는 truncate됩니다.
   */
  editMessage: (messageId: string, nextContent: string) => void;
  /**
   * 메시지 수정 후 같은 내용으로 다시 호출
   */
  replayMessage: (messageId: string) => Promise<void>;
  /**
   * 메시지 삭제: 해당 메시지(포함) 이후 대화는 truncate됩니다.
   */
  deleteMessageFrom: (messageId: string) => void;
  clearMessages: () => void;

  // Composer
  setComposerText: (text: string) => void;
  appendComposerText: (text: string, opts?: { separator?: string }) => void;
  requestComposerFocus: () => void;

  // 컨텍스트 블록 관리
  setContextBlocks: (blockIds: string[]) => void;
  addContextBlock: (blockId: string) => void;
  removeContextBlock: (blockId: string) => void;

  // 대화 길이 알림
  shouldShowSummarySuggestion: () => boolean;
  dismissSummarySuggestion: () => void;
  startNewSessionFromSuggestion: () => void;

  // 세션 제한 헬퍼
  isSessionLimitReached: () => boolean;
  getOldestSession: () => ChatSession | null;

  // 유틸리티
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  setStatusMessage: (message: string | null) => void;
  setTranslatorPersona: (persona: string) => void;
  setTranslationRules: (rules: string) => void;
  appendToTranslationRules: (snippet: string) => void;
  setProjectContext: (memory: string) => void;
  appendToProjectContext: (snippet: string) => void;
  setWebSearchEnabled: (enabled: boolean) => void;
  setConfluenceSearchEnabled: (enabled: boolean) => void;
  setTranslationContextSessionId: (sessionId: string | null) => void;

  // 첨부 파일 관리 (4.2)
  attachFile: (path: string) => Promise<void>;
  deleteAttachment: (id: string) => Promise<void>;
  loadAttachments: () => Promise<void>;
  // 채팅 컴포저 전용 첨부(일회성)
  addComposerAttachment: (path: string) => Promise<void>;
  removeComposerAttachment: (id: string) => void;
  clearComposerAttachments: () => void;

  // Persistence (project-scoped)
  hydrateForProject: (projectId: string | null) => Promise<void>;

  // AI Interaction Feedback

  // Streaming 상태 관리 (성능 최적화: 배열 갱신 없이 단일 필드만 업데이트)
  setStreamingContent: (content: string) => void;
  setStreamingMetadata: (metadata: ChatMessage['metadata']) => void;
  finalizeStreaming: () => void;
}

type ChatStore = ChatState & ChatActions;

// ============================================
// Store Implementation
// ============================================

export const useChatStore = create<ChatStore>((set, get) => {
  const buildChatSettings = (): ChatProjectSettings => ({
    translatorPersona: get().translatorPersona,
    translationRules: get().translationRules,
    projectContext: get().projectContext,
    composerText: get().composerText,
    webSearchEnabled: get().webSearchEnabled,
    translationContextSessionId: get().translationContextSessionId,
  });

  const persistNow = async (): Promise<void> => {
    if (!isTauriRuntime()) return;
    if (get().isHydrating) return; // 로드 중에는 저장하지 않음 (데이터 유실 방지)

    // getActiveProjectId() 대신 현재 스토어에 로드된 ID 사용
    const projectId = get().loadedProjectId;
    if (!projectId) return;

    const session = get().currentSession;
    const settings = buildChatSettings();

    // 세션은 최대 5개만 저장
    // - 저장은 전체 sessions를 대상으로 하되, 백엔드에서도 최종적으로 5개로 clamp됩니다.
    const sessions = get().sessions.slice(0, MAX_CHAT_SESSIONS);
    if (sessions.length > 0) {
      await saveChatSessions({ projectId, sessions });
    } else if (session) {
      // 안전장치: sessions가 비어있지만 currentSession이 있으면 1개만 저장
      await saveChatSessions({ projectId, sessions: [session] });
    }
    await saveChatProjectSettings({ projectId, settings });
  };

  const schedulePersist = (): void => {
    if (!isTauriRuntime()) return;
    if (chatPersistTimer !== null) {
      window.clearTimeout(chatPersistTimer);
      chatPersistTimer = null;
    }
    // Issue #9 Fix: 스케줄 시점의 프로젝트 ID 캡처
    scheduledPersistProjectId = get().loadedProjectId;
    chatPersistTimer = window.setTimeout(() => {
      // Issue #9 Fix: persist 실행 전 프로젝트 ID 재검증
      const currentProjectId = get().loadedProjectId;
      if (scheduledPersistProjectId !== currentProjectId) {
        console.warn(`[chatStore] schedulePersist skipped: project changed from ${scheduledPersistProjectId} to ${currentProjectId}`);
        scheduledPersistProjectId = null;
        return;
      }
      if (chatPersistInFlight) {
        chatPersistQueued = true;
        return;
      }
      chatPersistInFlight = true;
      void persistNow()
        .catch(() => {
          // chat persistence는 UX 방해 최소화: 실패는 조용히 처리
        })
        .finally(() => {
          chatPersistInFlight = false;
          scheduledPersistProjectId = null;
          if (chatPersistQueued) {
            chatPersistQueued = false;
            schedulePersist();
          }
        });
    }, CHAT_PERSIST_DEBOUNCE_MS);
  };

  return {
    // Initial State
    sessions: [],
    currentSessionId: null,
    currentSession: null,
    isLoading: false,
    isFinalizingStreaming: false,
    streamingMessageId: null,
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
    translatorPersona: DEFAULT_TRANSLATOR_PERSONA,
    translationRules: '',
    projectContext: '',
    webSearchEnabled: true,
    translationContextSessionId: null,
    loadedProjectId: null,
    attachments: [],
    composerAttachments: [],

    hydrateForProject: async (projectId: string | null): Promise<void> => {
      const requestId = ++hydrateRequestId;
      // 프로젝트 전환 시, 저장되지 않은 변경사항이 있으면 즉시 저장 (Flush)
      // 1. 현재와 같은 프로젝트고 이미 로드된 상태면 스킵 (불필요한 리로드 및 상태 초기화 방지)
      const currentLoadedId = get().loadedProjectId;
      if (projectId === currentLoadedId && !get().isHydrating && projectId !== null) {
        return;
      }

      console.log(`[chatStore] hydrateForProject starting for: ${projectId} (current: ${currentLoadedId})`);

      // Issue #3 수정: 프로젝트 전환 시 진행 중인 API 요청 취소
      const prevAbortController = get().abortController;
      if (prevAbortController) {
        prevAbortController.abort();
        set({ abortController: null });
      }

      // 2. 프로젝트 전환 시, 저장되지 않은 변경사항이 있으면 즉시 저장 (Flush)
      if (chatPersistTimer !== null) {
        window.clearTimeout(chatPersistTimer);
        chatPersistTimer = null;
        // Issue #9 Fix: 타이머 취소 시 캡처된 프로젝트 ID도 정리
        scheduledPersistProjectId = null;
      }
      if (currentLoadedId && !get().isHydrating) {
        try {
          await persistNow();
        } catch (e) {
          // 에러 객체 전체 로깅 시 민감 정보 노출 위험 방지
          const message = e instanceof Error ? e.message : String(e);
          console.warn('[chatStore] persistNow failed during project switch:', message);
        }
      }

      // 프로젝트 전환 시, 기존 채팅 상태를 프로젝트 스코프로 재구성
      if (!projectId) {
        set({
          sessions: [],
          currentSessionId: null,
          currentSession: null,
          lastInjectedGlossary: [],
          summarySuggestionDismissedBySessionId: {},
          isHydrating: false,
          isFinalizingStreaming: false,
          loadedProjectId: null,
          composerText: '',
          translatorPersona: DEFAULT_TRANSLATOR_PERSONA,
          translationRules: '',
          projectContext: '',
          webSearchEnabled: true,
          translationContextSessionId: null,
          composerAttachments: [],
          attachments: [],
          streamingMessageId: null,
          streamingContent: null,
          streamingMetadata: null,
          isLoading: false,
        });
        return;
      }

      set({
        sessions: [],
        currentSessionId: null,
        currentSession: null,
        lastInjectedGlossary: [],
        summarySuggestionDismissedBySessionId: {},
        composerText: '',
        translatorPersona: DEFAULT_TRANSLATOR_PERSONA,
        translationRules: '',
        projectContext: '',
        webSearchEnabled: true,
        translationContextSessionId: null,
        attachments: [],
        composerAttachments: [],
        streamingMessageId: null,
        streamingContent: null,
        streamingMetadata: null,
        isLoading: false,
        isHydrating: true,
        isFinalizingStreaming: false,
        error: null,
        loadedProjectId: null,
      });

      try {
        if (!isTauriRuntime()) {
          set({ isHydrating: false });
          return;
        }

        const [sessionsRes, settingsRes, attachmentsRes] = await Promise.all([
          loadChatSessions(projectId),
          loadChatProjectSettings(projectId),
          listAttachments(projectId),
        ]);

        const atts = attachmentsRes ?? [];

        // Issue #3 수정: 프로젝트 ID 재검증 강화
        // 비동기 로드 중 프로젝트가 전환되었으면 이 결과를 무시
        const activeProjectId = useProjectStore.getState().project?.id ?? null;
        if (requestId !== hydrateRequestId) {
          console.log(`[chatStore] hydrateForProject aborted: newer request exists (current: ${hydrateRequestId}, this: ${requestId})`);
          return;
        }
        if (activeProjectId !== projectId) {
          console.log(`[chatStore] hydrateForProject aborted: project changed during load (expected: ${projectId}, active: ${activeProjectId})`);
          set({ isHydrating: false });
          return;
        }

        // Migration: confluenceSearchEnabled 기본값 true로 설정 (기존 세션 호환)
        const migratedSessions = (sessionsRes ?? []).slice(0, MAX_CHAT_SESSIONS).map((session) => ({
          ...session,
          confluenceSearchEnabled: session.confluenceSearchEnabled ?? true,
        }));

        const nextState: Partial<ChatStore> = {
          isHydrating: false,
          loadedProjectId: projectId, // 로드 성공 후에만 ID 설정 (저장 허용)
          sessions: migratedSessions,
          currentSessionId: migratedSessions.length > 0 ? migratedSessions[0]!.id : null,
          currentSession: migratedSessions.length > 0 ? migratedSessions[0]! : null,
          attachments: atts,
          composerAttachments: [],
        };

        if (settingsRes) {
          // Migration: systemPromptOverlay -> translatorPersona
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const legacy = (settingsRes as any).systemPromptOverlay;

          nextState.translatorPersona = settingsRes.translatorPersona?.trim()
            ? settingsRes.translatorPersona
            : (legacy || DEFAULT_TRANSLATOR_PERSONA);

          nextState.translationRules = settingsRes.translationRules ?? '';
          nextState.projectContext = settingsRes.projectContext ?? '';
          nextState.composerText = settingsRes.composerText ?? '';
          nextState.webSearchEnabled = settingsRes.webSearchEnabled ?? false;
          nextState.translationContextSessionId = settingsRes.translationContextSessionId ?? null;
        } else {
          // 설정이 없으면 기본값 유지
          nextState.translatorPersona = DEFAULT_TRANSLATOR_PERSONA;
          nextState.translationRules = '';
          nextState.projectContext = '';
          nextState.composerText = '';
          nextState.webSearchEnabled = true;
          nextState.translationContextSessionId = null;
        }

        set(nextState);
      } catch (e) {
        if (requestId !== hydrateRequestId) {
          return;
        }
        set({
          isHydrating: false,
          error: e instanceof Error ? e.message : '채팅 상태 로드 실패',
        });
      }
    },

    // 세션 생성
    createSession: (name?: string): string => {
      // 최대 5개 제한: 초과 생성은 조용히 무시
      const existing = get().sessions;
      if (existing.length >= MAX_CHAT_SESSIONS) {
        // 현재 세션이 null이면 첫 번째 세션으로 전환
        const { currentSessionId, currentSession } = get();
        if (currentSessionId && currentSession) {
          return currentSessionId;
        }
        // currentSession이 null인 경우 첫 번째 세션으로 전환
        const firstSession = existing[0];
        if (firstSession) {
          set({ currentSessionId: firstSession.id, currentSession: firstSession });
          return firstSession.id;
        }
        return '';
      }

      const sessionId = uuidv4();
      const now = Date.now();

      const newSession: ChatSession = {
        id: sessionId,
        name: name ?? `Chat ${get().sessions.length + 1}`,
        createdAt: now,
        messages: [],
        contextBlockIds: [],
        confluenceSearchEnabled: true,
      };

      set((state) => ({
        sessions: [...state.sessions, newSession],
        currentSessionId: sessionId,
        currentSession: newSession,
      }));

      schedulePersist();

      return sessionId;
    },

    // 세션 전환
    switchSession: (sessionId: string): void => {
      const session = get().sessions.find((s) => s.id === sessionId);
      if (session) {
        set({ currentSessionId: sessionId, currentSession: session });
        schedulePersist();
      }
    },

    // 세션 삭제
    deleteSession: (sessionId: string): void => {
      const { sessions, currentSessionId } = get();
      const newSessions = sessions.filter((s) => s.id !== sessionId);

      let newCurrentSessionId = currentSessionId;
      let newCurrentSession = get().currentSession;

      if (currentSessionId === sessionId) {
        const firstSession = newSessions[0];
        newCurrentSessionId = firstSession?.id ?? null;
        newCurrentSession = firstSession ?? null;
      }

      set((state) => {
        const nextDismissMap = { ...state.summarySuggestionDismissedBySessionId };
        delete nextDismissMap[sessionId];
        return {
          sessions: newSessions,
          currentSessionId: newCurrentSessionId,
          currentSession: newCurrentSession,
          summarySuggestionDismissedBySessionId: nextDismissMap,
        };
      });

      schedulePersist();
    },

    // 세션 이름 변경
    renameSession: (sessionId: string, name: string): void => {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, name } : s
        ),
        currentSession:
          state.currentSession?.id === sessionId
            ? { ...state.currentSession, name }
            : state.currentSession,
      }));
      schedulePersist();
    },

    // 메시지 전송
    sendMessage: async (content: string): Promise<void> => {
      // Race Condition 방지: finalization 진행 중이면 완료 대기
      if (get().isFinalizingStreaming) {
        // 최대 1초 대기 (100ms 간격으로 체크)
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (!get().isFinalizingStreaming) break;
        }
        // 여전히 진행 중이면 강제 완료
        if (get().isFinalizingStreaming) {
          set({ isFinalizingStreaming: false, streamingMessageId: null, streamingContent: null, streamingMetadata: null });
        }
      }

      const { currentSession, createSession, addMessage, updateMessage } = get();

      // 세션이 없으면 생성
      if (!currentSession) {
        createSession();
      }

      // 최근 채팅 히스토리를 모델 컨텍스트에 포함
      const maxRecent = getAiConfig().maxRecentMessages;
      const priorMessages = (get().currentSession?.messages ?? []).slice(-maxRecent);

      // request 단위 Ghost mask (무결성 보호)
      const maskSession = createGhostMaskSession();
      const maskedUserContent = maskGhostChips(content, maskSession);

      // 전송 시작 시점에 첨부 파일 캡처 후 즉시 초기화 (입력창 썸네일 즉시 제거)
      const capturedAttachments = get().composerAttachments;
      set({ composerAttachments: [] });

      // 사용자 메시지에 이미지 정보 포함 (채팅 UI 표시용)
      const imageAttachmentsForMessage = capturedAttachments
        .filter((a) => ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(a.fileType.toLowerCase()) && a.thumbnailDataUrl)
        .map((a) => ({ filename: a.filename, thumbnailDataUrl: a.thumbnailDataUrl! }));

      addMessage({
        role: 'user',
        content,
        ...(imageAttachmentsForMessage.length > 0
          ? { metadata: { imageAttachments: imageAttachmentsForMessage } }
          : {}),
      });

      // [Auto-Title] 첫 메시지인 경우 세션 이름 자동 변경
      const updatedSession = get().currentSession;
      if (updatedSession && updatedSession.messages.length === 1) {
        // 간단한 규칙: 첫 20자 + ...
        const newTitle = content.trim().slice(0, 20) + (content.length > 20 ? '...' : '');
        get().renameSession(updatedSession.id, newTitle);
      }

      // 명시적 웹검색 트리거: /web 명령어로 내장 웹검색을 직접 실행
      const webQuery = tryExtractWebSearchQuery(content);
      if (webQuery) {
        // 기존 진행 중인 요청이 있으면 abort
        const prevAbortController = get().abortController;
        if (prevAbortController) {
          prevAbortController.abort();
          set({ abortController: null });
        }

        if (!get().webSearchEnabled) {
          addMessage({
            role: 'assistant',
            content: '웹 검색이 꺼져 있어 실행하지 않았습니다. 채팅 입력창의 + 메뉴에서 "웹 검색"을 켜면 사용할 수 있어요.',
          });
          set({ isLoading: false, streamingMessageId: null, error: null });
          schedulePersist();
          return;
        }

        set({ isLoading: true, error: null, statusMessage: '웹 검색 준비 중...' });

        const cfg = getAiConfig();
        // 모든 provider가 내장 웹검색 사용 (OpenAI: web_search_preview, Anthropic: web_search)
        const initialToolsInProgress = cfg.provider === 'openai' ? ['web_search_preview'] : ['web_search'];

        const assistantId = addMessage({
          role: 'assistant',
          content: '',
          metadata: { model: 'web_search', toolCallsInProgress: initialToolsInProgress, toolsUsed: [] },
        });

        try {
          let text = '';
          const toolsUsed: string[] = [];

          // 내장 웹검색 사용 (OpenAI: web_search_preview, Anthropic: web_search_20250305)
          const modelAny = createChatModel(undefined, { useFor: 'chat' }) as any;

          if (cfg.provider === 'openai') {
            set({ statusMessage: 'OpenAI 웹 검색 중...' });
            const modelWithSearch =
              typeof modelAny.bindTools === 'function'
                ? modelAny.bindTools([{ type: 'web_search_preview' }])
                : modelAny;

            const ai = await modelWithSearch.invoke(
              [
                '웹 검색을 수행한 뒤, 아래 형식으로 간결하게 정리해 주세요.',
                '',
                `- 질문: ${webQuery}`,
                '- 출력:',
                '  1) 요약(3~6줄)',
                '  2) 근거 링크 3~8개 (가능하면 제목 + 링크)',
              ].join('\n'),
            );
            text = extractTextFromAiMessage(ai);
            if (text.trim()) toolsUsed.push('web_search_preview');
          } else if (cfg.provider === 'anthropic') {
            set({ statusMessage: 'Anthropic 웹 검색 중...' });
            const modelWithSearch =
              typeof modelAny.bindTools === 'function'
                ? modelAny.bindTools([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }])
                : modelAny;

            const ai = await modelWithSearch.invoke(
              [
                '웹 검색을 수행한 뒤, 아래 형식으로 간결하게 정리해 주세요.',
                '',
                `- 질문: ${webQuery}`,
                '- 출력:',
                '  1) 요약(3~6줄)',
                '  2) 근거 링크 3~8개 (가능하면 제목 + 링크)',
              ].join('\n'),
            );
            text = extractTextFromAiMessage(ai);
            if (text.trim()) toolsUsed.push('web_search');
          }

          if (assistantId) {
            updateMessage(assistantId, { content: text, metadata: { toolCallsInProgress: [], toolsUsed } });
          } else {
            addMessage({ role: 'assistant', content: text });
          }
          set({ isLoading: false, streamingMessageId: null, error: null, statusMessage: null });
          schedulePersist();
        } catch (e) {
          const errText = e instanceof Error ? e.message : '웹 검색 실패';
          if (assistantId) {
            updateMessage(assistantId, { content: `⚠️ ${errText}`, metadata: { toolCallsInProgress: [] } });
          } else {
            addMessage({ role: 'assistant', content: `⚠️ ${errText}` });
          }
          set({ isLoading: false, streamingMessageId: null, error: errText, statusMessage: null });
        }
        return;
      }

      set({ isLoading: true, error: null, statusMessage: '요청 분석 및 컨텍스트 확인 중...' });

      try {
        const cfg = getAiConfig();
        const session = get().currentSession;
        const project = useProjectStore.getState().project;
        const translatorPersona = get().translatorPersona;
        const webSearchEnabled = get().webSearchEnabled;

        const contextBlockIds = session?.contextBlockIds ?? [];
        const contextBlocks =
          project
            ? contextBlockIds
              .map((id) => project.blocks[id])
              .filter((b): b is NonNullable<typeof b> => b !== undefined)
            : [];
        const translationRulesRaw = get().translationRules;
        const projectContextRaw = get().projectContext;
        // 채팅(Question): 문서는 기본적으로 payload에 인라인 포함하지 않고, 필요 시 Tool로 on-demand 조회합니다.

        const translationRules = translationRulesRaw
          ? maskGhostChips(translationRulesRaw, maskSession)
          : '';
        const projectContext = projectContextRaw ? maskGhostChips(projectContextRaw, maskSession) : '';

        // 로컬 글로서리 주입(on-demand: 모델 호출 시에만)
        let glossaryInjected = '';
        try {
          if (project?.id) {
            const plainContext = contextBlocks
              .map((b) => stripHtml(b.content))
              .join('\n')
              .slice(0, 1200);
            const q = [content, plainContext].filter(Boolean).join('\n').slice(0, 2000);
            const hits = q.trim().length
              ? await searchGlossary({
                projectId: project.id,
                query: q,
                domain: project.metadata.domain,
                limit: 12,
              })
              : [];
            set({ lastInjectedGlossary: hits });
            if (hits.length > 0) {
              const raw = hits
                .map((e) => `- ${e.source} = ${e.target}${e.notes ? ` (${e.notes})` : ''}`)
                .join('\n');
              glossaryInjected = maskGhostChips(raw, maskSession);
            }
          } else {
            set({ lastInjectedGlossary: [] });
          }
        } catch {
          // 글로서리 검색 실패는 조용히 무시(모델 호출 UX 방해 최소화)
          set({ lastInjectedGlossary: [] });
        }

        // 질문(question) 모드: 최근 히스토리(최대 10개) 포함
        const recent: ChatMessage[] = priorMessages;

        // Issue #2 Fix: 이전 요청이 있으면 취소 (race condition 방지를 위해 새 컨트롤러를 먼저 생성)
        const prevAbortController = get().abortController;
        const abortController = new AbortController();

        // 이전 요청 취소
        if (prevAbortController) {
          prevAbortController.abort();
        }

        // 새 컨트롤러를 원자적으로 설정 (null 갭 없음)
        set({ abortController, isLoading: true, error: null, streamingMessageId: null, statusMessage: '요청 분석 및 컨텍스트 확인 중...' });

        const assistantId = addMessage({
          role: 'assistant',
          content: '',
          metadata: { model: cfg.model, toolCallsInProgress: [] },
        });
        if (assistantId) {
          set({ streamingMessageId: assistantId });
        }

        const replyMasked = await streamAssistantReply(
          {
            project,
            contextBlocks,
            recentMessages: recent,
            userMessage: maskedUserContent,
            translatorPersona,
            translationRules,
            ...(glossaryInjected ? { glossaryInjected } : {}),
            projectContext,
            // 채팅은 항상 "question"으로 호출 (자동 번역 모드 진입 방지)
            requestType: 'question',
            abortSignal: abortController.signal,
            // 채팅 컴포저 전용 첨부만 payload에 포함 (캡처된 값 사용)
            attachments: capturedAttachments
              .filter((a) => a.extractedText)
              .map((a) => ({ filename: a.filename, text: a.extractedText! })),
            imageAttachments: capturedAttachments
              .filter((a) => !!a.filePath && ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(String(a.fileType).toLowerCase()))
              .map((a) => ({ filename: a.filename, fileType: a.fileType, filePath: a.filePath! })),
            webSearchEnabled,
            confluenceSearchEnabled: get().currentSession?.confluenceSearchEnabled ?? false,
            // Notion 커넥터 활성화 여부 (connectorStore에서 확인)
            notionSearchEnabled: (() => {
              const { enabledMap, tokenMap } = useConnectorStore.getState();
              return (enabledMap['notion'] ?? false) && (tokenMap['notion'] ?? false);
            })(),
          },
          {
            onToken: (full) => {
              if (get().statusMessage !== '답변 생성 중...') {
                set({ statusMessage: '답변 생성 중...' });
              }
              // 성능 최적화: 배열 갱신 없이 단일 필드만 업데이트
              set({ streamingContent: restoreGhostChips(full, maskSession) });
            },
            onToolCall: (evt) => {
              if (!assistantId) return;
              // 성능 최적화: 스트리밍 메타데이터 사용 (배열 갱신 없음)
              const currentMetadata = get().streamingMetadata ?? {};

              if (evt.phase === 'start') {
                const toolNameMap: Record<string, string> = {
                  'web_search': '웹 검색',
                  'web_search_preview': '웹 검색',
                                    'get_source_document': '원문 문서 조회',
                  'get_target_document': '번역문 문서 조회',
                  'suggest_translation_rule': '번역 규칙 생성',
                  'suggest_project_context': '프로젝트 맥락 분석',
                  'notion_search': 'Notion 검색',
                  'notion_get_page': 'Notion 페이지 조회',
                  'notion_query_database': 'Notion 데이터베이스 조회',
                };
                const friendlyName = toolNameMap[evt.toolName] || evt.toolName;
                set({ statusMessage: `${friendlyName} 진행 중...` });
              } else {
                set({ statusMessage: '결과 처리 및 답변 생성 중...' });
              }

              // 1. Tool Call Badge (Running state)
              const prev = currentMetadata.toolCallsInProgress ?? [];
              const next =
                evt.phase === 'start'
                  ? prev.includes(evt.toolName) ? prev : [...prev, evt.toolName]
                  : prev.filter((n) => n !== evt.toolName);

              // 2. Suggestion Handling (Smart Buttons)
              let nextMetadata = { ...currentMetadata };

              // suggest_* 툴이 호출되면 해당 내용을 메타데이터에 기록 (분리 필드로 누적)
              if (evt.phase === 'start' && evt.args) {
                if (evt.toolName === 'suggest_translation_rule' && evt.args.rule) {
                  const prev = nextMetadata.suggestedRule ?? '';
                  const cleaned = cleanSuggestionContent(evt.args.rule);
                  nextMetadata = {
                    ...nextMetadata,
                    suggestedRule: prev ? `${prev}; ${cleaned}` : cleaned,
                  };
                } else if (evt.toolName === 'suggest_project_context' && evt.args.context) {
                  const prev = nextMetadata.suggestedContext ?? '';
                  const cleaned = cleanSuggestionContent(evt.args.context);
                  nextMetadata = {
                    ...nextMetadata,
                    suggestedContext: prev ? `${prev}; ${cleaned}` : cleaned,
                  };
                }
              }

              // 성능 최적화: 스트리밍 메타데이터만 업데이트 (배열 갱신 없음)
              set({
                streamingMetadata: {
                  ...nextMetadata,
                  toolCallsInProgress: next,
                },
              });
            },
            onToolsUsed: (toolsUsed) => {
              // 성능 최적화: 스트리밍 메타데이터만 업데이트
              const currentMetadata = get().streamingMetadata ?? {};
              set({
                streamingMetadata: { ...currentMetadata, toolsUsed },
              });
            },
          },
        );
        // composerAttachments는 sendMessage 시작 시 이미 초기화됨

        if (assistantId) {
          const restored = restoreGhostChips(replyMasked, maskSession);

          // Tool-call이 누락되더라도, "버튼으로 추가" 안내가 포함된 응답이면 버튼을 띄울 수 있게 폴백 처리
          const currentMetadata = get().streamingMetadata ?? {};
          // Tool-call이 누락되더라도, "버튼으로 추가" 안내가 포함된 응답이면 버튼을 띄울 수 있게 폴백 처리
          if (!currentMetadata.suggestedRule && !currentMetadata.suggestedContext) {
            const inferred = inferSuggestionFromAssistantText(restored);
            if (inferred) {
              set({ streamingMetadata: { ...currentMetadata, ...inferred } });
            }
          }

          // 최종 콘텐츠 설정 후 한 번에 messages 배열에 반영
          set({ streamingContent: restored });
          get().finalizeStreaming();
        }

        set({ abortController: null });
      } catch (error) {
        // AbortError는 정상적인 취소이므로 에러로 표시하지 않음
        if (error instanceof Error && error.name === 'AbortError') {
          set({
            isLoading: false,
            streamingMessageId: null,
            streamingContent: null,
            streamingMetadata: null,
            statusMessage: null,
            abortController: null,
            isFinalizingStreaming: false,
          });
          return;
        }

        const assistantId = get().streamingMessageId;
        const errText = error instanceof Error ? error.message : 'AI 응답 생성 실패';
        if (assistantId) {
          // 사용자가 "왜 안 되는지" 바로 알 수 있도록 버블에 에러를 표시합니다.
          get().updateMessage(assistantId, {
            content: `⚠️ ${errText}`,
            metadata: { toolCallsInProgress: [] },
          });
        } else {
          // assistant 버블이 생성되기 전에 실패한 경우(매우 드묾)에도 에러를 남깁니다.
          get().addMessage({ role: 'assistant', content: `⚠️ ${errText}` });
        }
        // Issue #7 수정: 에러 시에도 모든 상태를 완전히 정리 (statusMessage 포함)
        // composerAttachments는 sendMessage 시작 시 이미 초기화됨
        set({
          error: errText,
          isLoading: false,
          streamingMessageId: null,
          streamingContent: null,
          streamingMetadata: null,
          statusMessage: null,
          abortController: null,
          isFinalizingStreaming: false,
        });
      }
    },

    setComposerText: (text: string): void => {
      set({ composerText: text });
      schedulePersist();
    },

    appendComposerText: (text: string, opts?: { separator?: string }): void => {
      const incoming = text.trim();
      if (!incoming) return;
      const sep = opts?.separator ?? '\n\n';
      set((state) => {
        const next = state.composerText.trim().length > 0 ? `${state.composerText}${sep}${incoming}` : incoming;
        return {
          composerText: next,
          composerFocusNonce: state.composerFocusNonce + 1,
        };
      });
      schedulePersist();
    },

    requestComposerFocus: (): void => {
      set((state) => ({ composerFocusNonce: state.composerFocusNonce + 1 }));
    },

    // 대화 길이 알림: 30개 이상 + dismiss 안 됨
    shouldShowSummarySuggestion: (): boolean => {
      const session = get().currentSession;
      if (!session) return false;
      if (get().summarySuggestionDismissedBySessionId[session.id]) return false;
      return session.messages.length >= CHAT_LENGTH_THRESHOLD;
    },

    dismissSummarySuggestion: (): void => {
      const session = get().currentSession;
      if (!session) return;
      set((state) => ({
        summarySuggestionDismissedBySessionId: {
          ...state.summarySuggestionDismissedBySessionId,
          [session.id]: true,
        },
      }));
    },

    startNewSessionFromSuggestion: (): void => {
      // 현재 세션 dismiss 후 새 세션 생성
      get().dismissSummarySuggestion();
      get().createSession();
    },

    // 세션 제한 헬퍼: 세션 개수가 MAX_CHAT_SESSIONS 이상인지 확인
    isSessionLimitReached: (): boolean => {
      return get().sessions.length >= MAX_CHAT_SESSIONS;
    },

    // 가장 오래된 세션 반환 (createdAt 기준)
    getOldestSession: (): ChatSession | null => {
      const sessions = get().sessions;
      if (sessions.length === 0) return null;
      return sessions.reduce((oldest, s) => (s.createdAt < oldest.createdAt ? s : oldest), sessions[0]!);
    },

    // 메시지 추가
    addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>): string | null => {
      const { currentSession, currentSessionId } = get();
      if (!currentSession || !currentSessionId) return null;

      const { metadata, ...rest } = message;
      const newMessage: ChatMessage = {
        ...rest,
        ...(metadata ? { metadata } : {}),
        id: uuidv4(),
        timestamp: Date.now(),
      } as ChatMessage;

      // 메시지 제한 초과 시 오래된 메시지 삭제
      let existingMessages = currentSession.messages;
      if (existingMessages.length >= MAX_MESSAGES_PER_SESSION) {
        // 오래된 메시지 1개 삭제 (FIFO)
        existingMessages = existingMessages.slice(1);
      }

      const updatedSession: ChatSession = {
        ...currentSession,
        messages: [...existingMessages, newMessage],
      };

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === currentSessionId ? updatedSession : s
        ),
        currentSession: updatedSession,
      }));
      schedulePersist();
      return newMessage.id;
    },

    updateMessage: (
      messageId: string,
      patch: Partial<Omit<ChatMessage, 'id' | 'timestamp'>>,
    ): void => {
      const { currentSession, currentSessionId } = get();
      if (!currentSession || !currentSessionId) return;

      const updatedMessages = currentSession.messages.map((m) => {
        if (m.id !== messageId) return m;
        const { metadata, ...rest } = patch;
        return {
          ...m,
          ...rest,
          ...(metadata ? { metadata: { ...m.metadata, ...metadata } } : {}),
        };
      });

      const updatedSession: ChatSession = { ...currentSession, messages: updatedMessages };

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === currentSessionId ? updatedSession : s
        ),
        currentSession: updatedSession,
      }));
      schedulePersist();
    },

    editMessage: (messageId: string, nextContent: string): void => {
      const { currentSession, currentSessionId } = get();
      if (!currentSession || !currentSessionId) return;

      const idx = currentSession.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;

      const target = currentSession.messages[idx];
      if (!target) return;

      const trimmed = nextContent.trim();
      if (!trimmed) return;

      const updatedMessages = currentSession.messages.slice(0, idx + 1).map((m) => {
        if (m.id !== messageId) return m;
        return {
          ...m,
          content: trimmed,
          metadata: {
            ...m.metadata,
            ...(m.metadata?.originalContent ? {} : { originalContent: m.content }),
            editedAt: Date.now(),
          },
        };
      });

      const updatedSession: ChatSession = { ...currentSession, messages: updatedMessages };
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === currentSessionId ? updatedSession : s)),
        currentSession: updatedSession,
        streamingMessageId: null,
        isLoading: false,
      }));
      schedulePersist();
    },

    replayMessage: async (messageId: string): Promise<void> => {
      const session = get().currentSession;
      if (!session) return;

      const targetMessage = session.messages.find((m) => m.id === messageId);
      if (!targetMessage || targetMessage.role !== 'user') return;

      const content = targetMessage.content?.trim();
      if (!content) return;

      // 해당 메시지 "이전"까지의 히스토리 포함
      const maxRecent = getAiConfig().maxRecentMessages;
      const idx = session.messages.findIndex((m) => m.id === messageId);
      const priorMessages = idx > 0 ? session.messages.slice(Math.max(0, idx - maxRecent), idx) : [];

      // 재전송 시 해당 메시지 이후의 응답 삭제 (편집 후 저장과 동일한 동작)
      const currentSessionId = get().currentSessionId;
      if (currentSessionId && idx >= 0) {
        const truncatedMessages = session.messages.slice(0, idx + 1);
        const updatedSession: ChatSession = { ...session, messages: truncatedMessages };
        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === currentSessionId ? updatedSession : s)),
          currentSession: updatedSession,
          streamingMessageId: null,
        }));
      }

      // request 단위 Ghost mask (무결성 보호)
      const maskSession = createGhostMaskSession();
      const maskedUserContent = maskGhostChips(content, maskSession);

      // 전송 시작 시점에 첨부 파일 캡처 후 즉시 초기화 (입력창 썸네일 즉시 제거)
      const capturedAttachments = get().composerAttachments;
      set({ composerAttachments: [] });

      // Issue #2 Fix: 이전 요청이 있으면 취소 (race condition 방지를 위해 새 컨트롤러를 먼저 생성)
      const prevAbortController = get().abortController;
      const abortController = new AbortController();

      // 이전 요청 취소
      if (prevAbortController) {
        prevAbortController.abort();
      }

      // 새 컨트롤러를 원자적으로 설정 (null 갭 없음)
      set({ abortController, isLoading: true, error: null, streamingMessageId: null, statusMessage: '요청 분석 및 컨텍스트 확인 중...' });

      try {
        const cfg = getAiConfig();
        const project = useProjectStore.getState().project;
        const translatorPersona = get().translatorPersona;

        const contextBlockIds = session.contextBlockIds ?? [];
        const contextBlocks =
          project
            ? contextBlockIds
              .map((id) => project.blocks[id])
              .filter((b): b is NonNullable<typeof b> => b !== undefined)
            : [];
        const translationRulesRaw = get().translationRules;
        const projectContextRaw = get().projectContext;
        // 채팅(Question): 문서는 기본적으로 payload에 인라인 포함하지 않고, 필요 시 Tool로 on-demand 조회합니다.

        const translationRules = translationRulesRaw
          ? maskGhostChips(translationRulesRaw, maskSession)
          : '';
        const projectContext = projectContextRaw ? maskGhostChips(projectContextRaw, maskSession) : '';

        // 로컬 글로서리 주입(on-demand: 모델 호출 시에만)
        let glossaryInjected = '';
        try {
          if (project?.id) {
            const plainContext = contextBlocks
              .map((b) => stripHtml(b.content))
              .join('\n')
              .slice(0, 1200);
            const q = [content, plainContext].filter(Boolean).join('\n').slice(0, 2000);
            const hits = q.trim().length
              ? await searchGlossary({
                projectId: project.id,
                query: q,
                domain: project.metadata.domain,
                limit: 12,
              })
              : [];
            set({ lastInjectedGlossary: hits });
            if (hits.length > 0) {
              const raw = hits
                .map((e) => `- ${e.source} = ${e.target}${e.notes ? ` (${e.notes})` : ''}`)
                .join('\n');
              glossaryInjected = maskGhostChips(raw, maskSession);
            }
          } else {
            set({ lastInjectedGlossary: [] });
          }
        } catch {
          set({ lastInjectedGlossary: [] });
        }

        // 질문(question) 모드: 최근 히스토리(최대 10개) 포함
        const recent: ChatMessage[] = priorMessages;

        const assistantId = get().addMessage({
          role: 'assistant',
          content: '',
          metadata: { model: cfg.model, toolCallsInProgress: [] },
        });
        if (assistantId) {
          set({ streamingMessageId: assistantId });
        }

        const replyMasked = await streamAssistantReply(
          {
            project,
            contextBlocks,
            recentMessages: recent,
            userMessage: maskedUserContent,
            translatorPersona,
            translationRules,
            ...(glossaryInjected ? { glossaryInjected } : {}),
            projectContext,
            requestType: 'question',
            abortSignal: abortController.signal,
            // 채팅 컴포저 전용 첨부만 payload에 포함 (캡처된 값 사용)
            attachments: capturedAttachments
              .filter((a) => a.extractedText)
              .map((a) => ({ filename: a.filename, text: a.extractedText! })),
            imageAttachments: capturedAttachments
              .filter((a) => !!a.filePath && ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(String(a.fileType).toLowerCase()))
              .map((a) => ({ filename: a.filename, fileType: a.fileType, filePath: a.filePath! })),
            webSearchEnabled: get().webSearchEnabled,
            confluenceSearchEnabled: get().currentSession?.confluenceSearchEnabled ?? false,
            // Notion 커넥터 활성화 여부 (connectorStore에서 확인)
            notionSearchEnabled: (() => {
              const { enabledMap, tokenMap } = useConnectorStore.getState();
              return (enabledMap['notion'] ?? false) && (tokenMap['notion'] ?? false);
            })(),
          },
          {
            onToken: (full) => {
              if (get().statusMessage !== '답변 생성 중...') {
                set({ statusMessage: '답변 생성 중...' });
              }
              // 성능 최적화: 배열 갱신 없이 단일 필드만 업데이트
              set({ streamingContent: restoreGhostChips(full, maskSession) });
            },
            onToolCall: (evt) => {
              if (!assistantId) return;
              // 성능 최적화: 스트리밍 메타데이터 사용 (배열 갱신 없음)
              const currentMetadata = get().streamingMetadata ?? {};

              if (evt.phase === 'start') {
                const toolNameMap: Record<string, string> = {
                  'web_search': '웹 검색',
                  'web_search_preview': '웹 검색',
                                    'get_source_document': '원문 문서 조회',
                  'get_target_document': '번역문 문서 조회',
                  'suggest_translation_rule': '번역 규칙 생성',
                  'suggest_project_context': '프로젝트 맥락 분석',
                  'notion_search': 'Notion 검색',
                  'notion_get_page': 'Notion 페이지 조회',
                  'notion_query_database': 'Notion 데이터베이스 조회',
                };
                const friendlyName = toolNameMap[evt.toolName] || evt.toolName;
                set({ statusMessage: `${friendlyName} 진행 중...` });
              } else {
                set({ statusMessage: '결과 처리 및 답변 생성 중...' });
              }

              // 1) Tool Call Badge
              const prev = currentMetadata.toolCallsInProgress ?? [];
              const next =
                evt.phase === 'start'
                  ? prev.includes(evt.toolName) ? prev : [...prev, evt.toolName]
                  : prev.filter((n) => n !== evt.toolName);

              // 2) Suggestion Handling (Smart Buttons)
              let nextMetadata = { ...currentMetadata };
              if (evt.phase === 'start' && evt.args) {
                if (evt.toolName === 'suggest_translation_rule' && evt.args.rule) {
                  const prevRule = nextMetadata.suggestedRule ?? '';
                  const cleaned = cleanSuggestionContent(evt.args.rule);
                  nextMetadata = {
                    ...nextMetadata,
                    suggestedRule: prevRule ? `${prevRule}; ${cleaned}` : cleaned,
                  };
                } else if (evt.toolName === 'suggest_project_context' && evt.args.context) {
                  const prevCtx = nextMetadata.suggestedContext ?? '';
                  const cleaned = cleanSuggestionContent(evt.args.context);
                  nextMetadata = {
                    ...nextMetadata,
                    suggestedContext: prevCtx ? `${prevCtx}; ${cleaned}` : cleaned,
                  };
                }
              }

              // 성능 최적화: 스트리밍 메타데이터만 업데이트 (배열 갱신 없음)
              set({
                streamingMetadata: {
                  ...nextMetadata,
                  toolCallsInProgress: next,
                },
              });
            },
            onModelRun: (step) => {
              if (step > 0) {
                set({ statusMessage: '결과 처리 및 답변 생성 중...' });
              } else {
                // 초기 단계: 웹 검색 활성화 여부에 따라 메시지 차별화
                const isWeb = get().webSearchEnabled;
                set({ statusMessage: isWeb ? '답변 생성 및 웹 검색 확인 중...' : '답변 생성 및 도구 확인 중...' });
              }
            },
            onToolsUsed: (toolsUsed) => {
              // 성능 최적화: 스트리밍 메타데이터만 업데이트
              const currentMetadata = get().streamingMetadata ?? {};
              set({
                streamingMetadata: { ...currentMetadata, toolsUsed },
              });
            },
          },
        );
        // composerAttachments는 replayMessage 시작 시 이미 초기화됨

        if (assistantId) {
          const restored = restoreGhostChips(replyMasked, maskSession);

          // Tool-call이 누락되더라도, "버튼으로 추가" 안내가 포함된 응답이면 버튼을 띄울 수 있게 폴백 처리
          const currentMetadata = get().streamingMetadata ?? {};
          if (!currentMetadata.suggestedRule && !currentMetadata.suggestedContext) {
            const inferred = inferSuggestionFromAssistantText(restored);
            if (inferred) {
              set({ streamingMetadata: { ...currentMetadata, ...inferred } });
            }
          }

          // 최종 콘텐츠 설정 후 한 번에 messages 배열에 반영
          set({ streamingContent: restored });
          get().finalizeStreaming();
        }

        set({ abortController: null });
        schedulePersist();
      } catch (error) {
        // AbortError는 정상적인 취소이므로 에러로 표시하지 않음
        if (error instanceof Error && error.name === 'AbortError') {
          set({
            isLoading: false,
            streamingMessageId: null,
            streamingContent: null,
            streamingMetadata: null,
            statusMessage: null,
            abortController: null,
            isFinalizingStreaming: false,
          });
          return;
        }

        const assistantId = get().streamingMessageId;
        const errText = error instanceof Error ? error.message : 'AI 응답 생성 실패';
        if (assistantId) {
          get().updateMessage(assistantId, {
            content: `⚠️ ${errText}`,
            metadata: { toolCallsInProgress: [] },
          });
        } else {
          get().addMessage({ role: 'assistant', content: `⚠️ ${errText}` });
        }
        // Issue #7 수정: 에러 시에도 모든 상태를 완전히 정리 (statusMessage 포함)
        // composerAttachments는 replayMessage 시작 시 이미 초기화됨
        set({
          error: errText,
          isLoading: false,
          streamingMessageId: null,
          streamingContent: null,
          streamingMetadata: null,
          statusMessage: null,
          abortController: null,
          isFinalizingStreaming: false,
        });
      }
    },

    deleteMessageFrom: (messageId: string): void => {
      const { currentSession, currentSessionId } = get();
      if (!currentSession || !currentSessionId) return;

      // 진행 중인 API 요청 취소
      const abortController = get().abortController;
      if (abortController) {
        abortController.abort();
      }

      const idx = currentSession.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;

      const updatedMessages = currentSession.messages.slice(0, idx);
      const updatedSession: ChatSession = { ...currentSession, messages: updatedMessages };
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === currentSessionId ? updatedSession : s)),
        currentSession: updatedSession,
        streamingMessageId: null,
        isLoading: false,
        abortController: null,
      }));
      schedulePersist();
    },

    // 메시지 초기화
    clearMessages: (): void => {
      const { currentSession, currentSessionId } = get();
      if (!currentSession || !currentSessionId) return;

      const updatedSession: ChatSession = {
        ...currentSession,
        messages: [],
      };

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === currentSessionId ? updatedSession : s
        ),
        currentSession: updatedSession,
      }));
      schedulePersist();
    },

    // 컨텍스트 블록 설정
    setContextBlocks: (blockIds: string[]): void => {
      const { currentSession, currentSessionId } = get();
      if (!currentSession || !currentSessionId) return;

      const updatedSession: ChatSession = {
        ...currentSession,
        contextBlockIds: blockIds,
      };

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === currentSessionId ? updatedSession : s
        ),
        currentSession: updatedSession,
      }));
      schedulePersist();
    },

    // 컨텍스트 블록 추가
    addContextBlock: (blockId: string): void => {
      const { currentSession } = get();
      if (!currentSession) return;

      if (!currentSession.contextBlockIds.includes(blockId)) {
        get().setContextBlocks([...currentSession.contextBlockIds, blockId]);
      }
    },

    // 컨텍스트 블록 제거
    removeContextBlock: (blockId: string): void => {
      const { currentSession } = get();
      if (!currentSession) return;

      get().setContextBlocks(
        currentSession.contextBlockIds.filter((id) => id !== blockId)
      );
    },

    // 로딩 상태 설정
    setLoading: (isLoading: boolean): void => {
      set({ isLoading });
    },

    // 에러 설정
    setError: (error: string | null): void => {
      set({ error });
    },

    setStatusMessage: (message: string | null): void => {
      set({ statusMessage: message });
    },

    setTranslatorPersona: (persona: string): void => {
      set({ translatorPersona: persona });
      schedulePersist();
    },

    setTranslationRules: (rules: string): void => {
      set({ translationRules: rules });
      schedulePersist();
    },

    appendToTranslationRules: (snippet: string): void => {
      const incoming = snippet.trim();
      if (!incoming) return;
      // 세미콜론 구분자를 불릿 포인트로 변환
      const formatted = incoming
        .split(';')
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => `- ${r}`)
        .join('\n');
      const current = get().translationRules.trim();
      const next = current.length > 0 ? `${current}\n\n${formatted}` : formatted;
      set({ translationRules: next });
      schedulePersist();
    },

    setProjectContext: (memory: string): void => {
      set({ projectContext: memory });
      schedulePersist();
    },

    appendToProjectContext: (snippet: string): void => {
      const incoming = snippet.trim();
      if (!incoming) return;
      // 세미콜론 구분자를 불릿 포인트로 변환
      const formatted = incoming
        .split(';')
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => `- ${r}`)
        .join('\n');
      const current = get().projectContext.trim();
      const next = current.length > 0 ? `${current}\n\n${formatted}` : formatted;
      set({ projectContext: next });
      schedulePersist();
    },

    setWebSearchEnabled: (enabled: boolean): void => {
      set({ webSearchEnabled: enabled });
      schedulePersist();
    },

    setConfluenceSearchEnabled: (enabled: boolean): void => {
      const { currentSession, sessions } = get();
      if (!currentSession) return;

      const updated = { ...currentSession, confluenceSearchEnabled: enabled };
      set({
        currentSession: updated,
        sessions: sessions.map((s) => (s.id === currentSession.id ? updated : s)),
      });
      schedulePersist();
    },

    setTranslationContextSessionId: (sessionId: string | null): void => {
      set({ translationContextSessionId: sessionId });
      schedulePersist();
    },

    // 첨부 파일 관리
    attachFile: async (path: string): Promise<void> => {
      const projectId = get().loadedProjectId;
      if (!projectId) return;

      set({ isLoading: true });
      try {
        const newAtt = await attachFile(projectId, path);
        set((state) => ({
          attachments: [...state.attachments, newAtt],
          isLoading: false,
        }));
      } catch (e) {
        set({
          isLoading: false,
          error: e instanceof Error ? e.message : '첨부 파일 추가 실패',
        });
      }
    },

    deleteAttachment: async (id: string): Promise<void> => {
      set({ isLoading: true });
      try {
        await deleteAttachmentApi(id);
        set((state) => ({
          attachments: state.attachments.filter((a) => a.id !== id),
          isLoading: false,
        }));
      } catch (e) {
        set({
          isLoading: false,
          error: e instanceof Error ? e.message : '첨부 파일 삭제 실패',
        });
      }
    },

    addComposerAttachment: async (path: string): Promise<void> => {
      // 채팅 컴포저 첨부는 프로젝트(Settings) 첨부와 분리: DB에 저장하지 않고, 모델 호출 payload에만 사용
      if (!get().loadedProjectId) return;

      // Note: isLoading을 사용하지 않음 - AI 응답 생성용 플래그이므로 첨부 시 스켈레톤이 표시되는 문제 방지
      try {
        const tmp = await previewAttachment(path);

        // 이미지 파일인 경우 썸네일 data URL 생성 + API 제한에 맞게 리사이즈
        const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
        if (imageExtensions.includes(tmp.fileType.toLowerCase()) && tmp.filePath) {
          const rawDataUrl = await readImageAsDataUrl(tmp.filePath, tmp.fileType);
          if (rawDataUrl) {
            // API 제한(Anthropic 5MB)에 맞게 자동 리사이즈
            const resizedDataUrl = await resizeImageForApi(rawDataUrl, IMAGE_SIZE_LIMITS.anthropic);
            tmp.thumbnailDataUrl = resizedDataUrl;
          }
        }

        set((state) => ({
          composerAttachments: [...state.composerAttachments, tmp],
        }));
      } catch (e) {
        set({
          error: e instanceof Error ? e.message : '첨부 파일 추가 실패',
        });
      }
    },

    removeComposerAttachment: (id: string): void => {
      set((state) => ({
        composerAttachments: state.composerAttachments.filter((a) => a.id !== id),
      }));
    },

    clearComposerAttachments: (): void => {
      set({ composerAttachments: [] });
    },

    loadAttachments: async (): Promise<void> => {
      const projectId = get().loadedProjectId;
      if (!projectId) return;

      try {
        const atts = await listAttachments(projectId);
        set({ attachments: atts });
      } catch (e) {
        // 에러 객체 전체 로깅 시 민감 정보 노출 위험 방지
        const message = e instanceof Error ? e.message : String(e);
        console.error('Failed to load attachments:', message);
      }
    },

    // ============================================
    // Streaming 상태 관리 (성능 최적화)
    // ============================================
    // 배열 갱신 없이 단일 필드만 업데이트하여 리렌더링 최소화

    setStreamingContent: (content: string): void => {
      set({ streamingContent: content });
    },

    setStreamingMetadata: (metadata: ChatMessage['metadata']): void => {
      set({ streamingMetadata: metadata });
    },

    finalizeStreaming: (): void => {
      const { streamingMessageId, streamingContent, streamingMetadata, isFinalizingStreaming } = get();
      if (!streamingMessageId) return;

      // Race Condition 방지: 이미 finalization 진행 중이면 스킵
      if (isFinalizingStreaming) return;

      // finalization 시작
      set({ isFinalizingStreaming: true });

      try {
        // 스트리밍 완료 후 한 번만 messages 배열에 반영
        if (streamingContent !== null) {
          // Issue #11 수정: toolCallsInProgress만 초기화하고 나머지 메타데이터는 보존
          const { toolCallsInProgress: _, ...preservedMetadata } = streamingMetadata ?? {};
          get().updateMessage(streamingMessageId, {
            content: streamingContent,
            metadata: { ...preservedMetadata, toolCallsInProgress: [] },
          });
        }
      } finally {
        // 스트리밍 상태 초기화 (항상 실행 보장)
        set({
          streamingContent: null,
          streamingMetadata: null,
          streamingMessageId: null,
          isLoading: false,
          statusMessage: null,
          isFinalizingStreaming: false,
        });
      }
    },
  };
});
