import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { isTauriRuntime } from '@/tauri/invoke';
import { useChatStore } from '@/stores/chatStore';
import {
  useChatComposerState,
  useChatSessionState,
  useChatSearchState,
  useChatMessageActions,
  useSummarySuggestionState,
  useSessionStreamingState,
} from '@/stores/chatStore.selectors';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { ChatMessageItem } from '@/components/chat/ChatMessageItem';
import { ChatComposerEditor } from '@/components/chat/ChatComposerEditor';
import { MODEL_PRESETS } from '@/ai/config';
import { SkeletonParagraph } from '@/components/ui/Skeleton';
import { Select, type SelectOptionGroup } from '@/components/ui/Select';
import { mcpClientManager, type McpConnectionStatus } from '@/ai/mcp/McpClientManager';
import { useConnectorStore } from '@/stores/connectorStore';
import { useChatDragDrop } from '@/components/chat/useChatDragDrop';
import { useChatScroll } from '@/components/chat/useChatScroll';
import { useChatComposerHandlers } from '@/components/chat/useChatComposerHandlers';
import type { ChatMessageMetadata, SidebarSide } from '@/types';
import { chatPanelId } from '@/types';
import type { Editor } from '@tiptap/react';

interface ChatContentProps {
  /** 어느 사이드바에 렌더링되는지 (없으면 legacy DockedChatPanel 모드) */
  side?: SidebarSide;
  /** 표시할 채팅 세션 ID (UnifiedSidebar에서 전달) */
  sessionId?: string;
}

/**
 * 채팅 콘텐츠 컴포넌트
 * UnifiedSidebar 또는 DockedChatPanel 내부에 렌더링되는 채팅 기능
 */
export function ChatContent({ side, sessionId }: ChatContentProps = {}): JSX.Element {
  const { t } = useTranslation();

  // 그룹화된 선택자로 리렌더링 최적화
  const { currentSession, currentSessionId, sessions: chatSessions, isHydrating, hydrateForProject } = useChatSessionState();

  // sessionId prop이 있으면 해당 세션 직접 조회, 없으면 currentSession 사용
  const effectiveSessionId = sessionId ?? currentSessionId ?? '';
  const displaySession = useMemo(() => {
    if (sessionId) {
      return chatSessions.find((s) => s.id === sessionId) ?? null;
    }
    return currentSession;
  }, [sessionId, chatSessions, currentSession]);

  // 스트리밍 상태: 항상 useSessionStreamingState를 호출 (Rules of Hooks 준수)
  const { isLoading, streamingMessageId, streamingContent, streamingMetadata, statusMessage } = useSessionStreamingState(effectiveSessionId);
  const globalIsLoading = useChatStore((s) => s.isLoading);
  const addToast = useUIStore((s) => s.addToast);
  const {
    composerAttachments,
    addComposerAttachment,
    removeComposerAttachment,
  } = useChatComposerState();

  // 로컬 composerText — 듀얼 사이드바에서 각 인스턴스 독립
  const [localComposerText, setLocalComposerText] = useState(
    () => useChatStore.getState().composerText,
  );
  const localTextRef = useRef(localComposerText);
  localTextRef.current = localComposerText;

  // 외부 append 이벤트 subscribe (Cmd+L, DOM 선택 등)
  useEffect(() => {
    let lastNonce = useChatStore.getState().pendingComposerAppend?.nonce ?? 0;
    return useChatStore.subscribe((state) => {
      const pending = state.pendingComposerAppend;
      if (!pending || pending.nonce === lastNonce) return;
      lastNonce = pending.nonce;
      if (pending.targetSessionId && pending.targetSessionId !== effectiveSessionId) return;
      setLocalComposerText((prev) => {
        if (!pending.text) return prev;
        return prev.trim().length > 0
          ? `${prev}${pending.separator}${pending.text}`
          : pending.text;
      });
    });
  }, [effectiveSessionId]);

  // 디바운스 persistence sync (500ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      useChatStore.getState().setComposerText(localComposerText);
    }, 500);
    return () => clearTimeout(timer);
  }, [localComposerText]);

  // 언마운트 시 즉시 flush
  useEffect(() => {
    return () => {
      useChatStore.getState().setComposerText(localTextRef.current);
    };
  }, []);
  const {
    webSearchEnabled,
    setWebSearchEnabled,
    confluenceSearchEnabled,
    setConfluenceSearchEnabled,
  } = useChatSearchState(effectiveSessionId);
  const {
    sendMessage,
    editMessage,
    replayMessage,
    deleteMessageFrom,
    updateMessage,
    appendToTranslationRules,
    appendToProjectContext,
    appendToTranslatorPersona,
  } = useChatMessageActions();
  const {
    shouldShow: shouldShowSummarySuggestion,
    dismiss: dismissSummarySuggestion,
    startNewSession: startNewSessionFromSuggestion,
  } = useSummarySuggestionState(effectiveSessionId);

  // 개별 선택자 (그룹에 포함되지 않는 것들)
  const createSession = useChatStore((s) => s.createSession);
  const editorRef = useRef<Editor | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);

  const openaiEnabled = useAiConfigStore((s) => s.openaiEnabled);
  const anthropicEnabled = useAiConfigStore((s) => s.anthropicEnabled);
  const chatModel = useAiConfigStore((s) => s.chatModel);
  const setChatModel = useAiConfigStore((s) => s.setChatModel);

  // 활성화된 프로바이더의 모델만 표시
  const enabledChatPresets = useMemo((): SelectOptionGroup[] => {
    const presets: SelectOptionGroup[] = [];
    if (anthropicEnabled) {
      presets.push({
        label: 'Anthropic',
        options: MODEL_PRESETS.anthropic.map((m) => ({ value: m.value, label: m.label })),
      });
    }
    if (openaiEnabled) {
      presets.push({
        label: 'OpenAI',
        options: MODEL_PRESETS.openai.map((m) => ({ value: m.value, label: m.label })),
      });
    }
    return presets;
  }, [anthropicEnabled, openaiEnabled]);

  // 모든 모델 플랫 리스트 (유효성 검사용)
  const allChatModels = useMemo(() => {
    return enabledChatPresets.flatMap((g) => g.options);
  }, [enabledChatPresets]);

  // 선택된 모델이 비활성화된 프로바이더면 첫 번째 활성 모델로 변경
  useEffect(() => {
    if (allChatModels.length === 0) return;
    const firstModel = allChatModels[0];
    if (!firstModel) return;
    if (!allChatModels.some((m) => m.value === chatModel)) {
      setChatModel(firstModel.value);
    }
  }, [chatModel, allChatModels, setChatModel]);

  const project = useProjectStore((s) => s.project);

  const [composerMenuOpen, setComposerMenuOpen] = useState(false);

  // side+sessionId가 있으면 해당 sidebar의 collapsed+activePanel로 판단
  const chatPanelOpen = useUIStore((s) => {
    if (side && sessionId) {
      const sb = side === 'left' ? s.leftSidebar : s.rightSidebar;
      const panelId = chatPanelId(sessionId);
      return !sb.collapsed && sb.activePanel === panelId;
    }
    return true;
  });

  const [mcpStatus, setMcpStatus] = useState<McpConnectionStatus>(mcpClientManager.getStatus());

  // MCP 및 Notion 상태 구독 (통합)
  useEffect(() => {
    const unsubMcp = mcpClientManager.subscribe(setMcpStatus);
    const unsubNotion = mcpClientManager.subscribeNotion((status) => {
      useConnectorStore.getState().setTokenStatus('notion', status.hasStoredToken ?? false);
    });
    return () => {
      unsubMcp();
      unsubNotion();
    };
  }, []);

  // 드래그 앤 드롭 (Tauri + HTML5 fallback)
  const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useChatDragDrop(addComposerAttachment, {
    enabled: chatPanelOpen,
    dropZoneRef: composerFormRef,
  });

  const notionEnabled = useConnectorStore((s) => s.enabledMap['notion'] ?? false);
  const notionHasToken = useConnectorStore((s) => s.tokenMap['notion'] ?? false);
  const setNotionEnabled = useConnectorStore((s) => s.setEnabled);

  const [showStreamingSkeleton, setShowStreamingSkeleton] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowStreamingSkeleton(false);
      return;
    }
    setShowStreamingSkeleton(false);
    const timer = window.setTimeout(() => setShowStreamingSkeleton(true), 200);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  const streamingMessage = useMemo(() => {
    if (!streamingMessageId) return null;
    return displaySession?.messages.find((m) => m.id === streamingMessageId) ?? null;
  }, [displaySession?.messages, streamingMessageId]);

  const streamingBubbleExists = !!streamingMessage;

  const renderAssistantSkeleton = useCallback((toolsInProgress?: string[]): JSX.Element => {
    let statusText = statusMessage;

    if (!statusText && toolsInProgress && toolsInProgress.length > 0) {
      const tool = toolsInProgress[0];
      const name =
        (tool === 'web_search' || tool === 'web_search_preview') ? '웹 검색'
          : tool === 'get_source_document' ? '원문 분석'
            : tool === 'get_target_document' ? '번역문 분석'
              : tool === 'suggest_translation_rule' ? '번역 규칙 확인'
                : tool === 'suggest_project_context' ? '프로젝트 맥락 확인'
                  : tool;
      statusText = `${name} 진행 중...`;
    }

    if (!statusText) {
      statusText = '답변 생성 중...';
    }

    return (
      <div>
        <SkeletonParagraph seed={0} lines={3} />
        <div className="mt-2.5 flex items-center gap-2 px-1">
          <span className="text-[11px] font-medium shimmer-text">
            {statusText}
          </span>
        </div>
        <span className="sr-only" aria-live="polite">
          {statusText}
        </span>
      </div>
    );
  }, [statusMessage]);

  // 메모이제이션된 메시지 이벤트 핸들러 (sessionId 전달)
  const handleEditMessage = useCallback((messageId: string, content: string) => {
    editMessage(messageId, content, sessionId);
  }, [editMessage, sessionId]);

  const handleReplayMessage = useCallback((messageId: string) => {
    void replayMessage(messageId, sessionId);
  }, [replayMessage, sessionId]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    deleteMessageFrom(messageId, sessionId);
  }, [deleteMessageFrom, sessionId]);

  const handleAppendToRules = useCallback((content: string) => {
    appendToTranslationRules(content);
  }, [appendToTranslationRules]);

  const handleAppendToContext = useCallback((content: string) => {
    appendToProjectContext(content);
  }, [appendToProjectContext]);

  const handleAppendToPersona = useCallback((content: string) => {
    appendToTranslatorPersona(content);
  }, [appendToTranslatorPersona]);

  const handleUpdateMessageMetadata = useCallback((messageId: string, metadata: Partial<ChatMessageMetadata>) => {
    updateMessage(messageId, { metadata }, sessionId);
  }, [updateMessage, sessionId]);

  // 붙여넣기/첨부 핸들러
  const { handleComposerPaste, handleAttachClick } = useChatComposerHandlers(addComposerAttachment);

  // sessionId prop이 변경되면 해당 세션으로 전환
  useEffect(() => {
    if (!sessionId) return;
    const { currentSessionId, switchSession } = useChatStore.getState();
    if (currentSessionId !== sessionId) {
      switchSession(sessionId);
    }
  }, [sessionId]);

  // 프로젝트 전환 시 채팅 세션 복원
  const lastHydratedId = useRef<string | null>(null);
  useEffect(() => {
    const projectId = project?.id ?? null;
    if (projectId === lastHydratedId.current) return;

    lastHydratedId.current = projectId;
    void hydrateForProject(projectId);
  }, [project?.id, hydrateForProject]);

  // 외부 focus 이벤트 subscribe (Cmd+L 등)
  useEffect(() => {
    let lastNonce = useChatStore.getState().pendingComposerFocus?.nonce ?? 0;
    return useChatStore.subscribe((state) => {
      const pending = state.pendingComposerFocus;
      if (!pending || pending.nonce === lastNonce) return;
      lastNonce = pending.nonce;
      if (pending.targetSessionId && pending.targetSessionId !== effectiveSessionId) return;

      if (side && sessionId) {
        const { openPanelOnSide } = useUIStore.getState();
        openPanelOnSide(side, chatPanelId(sessionId));
      } else {
        const { openActiveChat } = useUIStore.getState();
        openActiveChat();
      }

      window.setTimeout(() => {
        editorRef.current?.commands.focus('end');
      }, 100);
    });
  }, [effectiveSessionId, side, sessionId]);

  // 기본 채팅 세션 1개는 자동 생성 (side가 없을 때만, dual sidebar에서는 각 세션이 독립적)
  useEffect(() => {
    if (side) return; // dual sidebar면 스킵
    if (!project?.id) return;
    if (isHydrating) return;
    if (chatSessions.length > 0) return;
    createSession(t('chat.title'));
  }, [side, project?.id, isHydrating, chatSessions.length, createSession, t]);

  const sendCurrent = useCallback(async (): Promise<void> => {
    if (!localComposerText.trim() || !displaySession?.id) return;
    if (globalIsLoading) {
      if (!isLoading) {
        addToast({
          type: 'info',
          message: t('chat.busyElsewhere', '다른 채팅 세션에서 응답 생성 중입니다. 완료 후 다시 시도해주세요.'),
        });
      }
      return;
    }

    const message = localComposerText.trim();
    setLocalComposerText('');
    useChatStore.getState().setComposerText(''); // persistence 즉시 반영
    // TipTap 에디터 초기화
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editorRef.current as any)?.clearComposerContent?.();

    await sendMessage(message, sessionId);
  }, [localComposerText, globalIsLoading, isLoading, displaySession?.id, sendMessage, sessionId, addToast, t]);

  // 스크롤 관리
  const { messagesContainerRef, showScrollToBottom, handleMessagesScroll, scrollToBottom } =
    useChatScroll(chatPanelOpen, displaySession?.messages.length, streamingContent?.length ?? 0);

  // Chat 패널 열릴 때 포커스
  useEffect(() => {
    if (!chatPanelOpen) return;
    editorRef.current?.commands.focus('end');
  }, [chatPanelOpen]);

  const handleSubmit = useCallback(async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    await sendCurrent();
  }, [sendCurrent]);

  useEffect(() => {
    if (!composerMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setComposerMenuOpen(false);
    };
    const onPointerDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest('[data-ite-composer-menu-root]')) {
        setComposerMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [composerMenuOpen]);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* 대화 길이 알림 */}
      {shouldShowSummarySuggestion && (
        <div className="border-b border-editor-border bg-editor-surface/60 px-4 py-2 flex items-start justify-between gap-2 shrink-0">
          <div className="text-[11px] text-editor-muted leading-relaxed">
            {t('chat.longConversationNotice')}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="px-2 py-1 rounded text-[11px] bg-primary-500 text-white hover:bg-primary-600"
              onClick={() => startNewSessionFromSuggestion(effectiveSessionId)}
            >
              {t('chat.startNewSession')}
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded text-[11px] bg-editor-bg text-editor-muted hover:bg-editor-border"
              onClick={() => dismissSummarySuggestion(effectiveSessionId)}
            >
              {t('common.ignore')}
            </button>
          </div>
        </div>
      )}

      {/* 메시지 목록 */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={messagesContainerRef}
          className="h-full overflow-y-auto overscroll-contain p-4 space-y-4"
          onScroll={handleMessagesScroll}
        >
        {displaySession?.messages.map((message) => (
          <ChatMessageItem
            key={message.id}
            message={message}
            isStreaming={streamingMessageId === message.id}
            streamingContent={streamingContent}
            streamingMetadata={streamingMetadata}
            showStreamingSkeleton={showStreamingSkeleton}
            statusMessage={statusMessage}
            onEdit={handleEditMessage}
            onReplay={handleReplayMessage}
            onDelete={handleDeleteMessage}
            onAppendToRules={handleAppendToRules}
            onAppendToContext={handleAppendToContext}
            onAppendToPersona={handleAppendToPersona}
            onUpdateMessageMetadata={handleUpdateMessageMetadata}
          />
        ))}

        {isLoading && (!streamingMessageId || !streamingBubbleExists) && (
          <div className="chat-message chat-message-ai">
            {showStreamingSkeleton && renderAssistantSkeleton()}
          </div>
        )}
        </div>

        {/* 최신 메시지로 스크롤 버튼 */}
        {showScrollToBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10
                       w-8 h-8 rounded-full bg-editor-bg border border-editor-border shadow-md
                       flex items-center justify-center
                       text-editor-muted hover:text-editor-text hover:bg-editor-surface
                       transition-all duration-200"
            title={t('chat.scrollToBottom')}
            aria-label={t('chat.scrollToBottom')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        )}
      </div>

      {/* 입력창 */}
      <form
        ref={composerFormRef}
        onSubmit={handleSubmit}
        className="px-2 py-1 bg-editor-bg shrink-0"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className={`relative rounded-2xl border bg-editor-bg shadow-sm transition-colors ${
          isDragging ? 'border-primary-500 bg-primary-50' : 'border-editor-border'
        }`}>
          {/* 첨부 파일 미리보기 - textarea 위에 표시 */}
          {composerAttachments.length > 0 && (
            <div className="px-4 pt-4 pb-2 flex flex-wrap gap-3">
              {composerAttachments.map((a) => {
                const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(a.fileType.toLowerCase());

                return (
                  <div
                    key={a.id}
                    className="relative group"
                  >
                    {/* 닫기 버튼 - 왼쪽 상단 */}
                    <button
                      type="button"
                      className="absolute -left-2 -top-2 z-10 w-5 h-5 rounded-full bg-editor-bg border border-editor-border
                                 text-editor-muted hover:text-red-600 hover:border-red-300
                                 flex items-center justify-center text-xs shadow-sm"
                      aria-label={t('chat.removeAttachment')}
                      onClick={() => removeComposerAttachment(a.id)}
                      disabled={isLoading}
                    >
                      ✕
                    </button>

                    {isImage && a.thumbnailDataUrl ? (
                      <img
                        src={a.thumbnailDataUrl}
                        alt={a.filename}
                        className="w-20 h-20 object-cover rounded-lg border border-editor-border"
                      />
                    ) : (
                      <div
                        className="w-20 h-20 rounded-lg border border-editor-border bg-editor-bg
                                   flex flex-col items-center justify-center gap-1 p-2"
                        title={a.filename}
                      >
                        <span className="text-2xl">
                          {a.fileType === 'pdf' ? '📄' : a.fileType === 'docx' ? '📝' : a.fileType === 'pptx' ? '📊' : '📎'}
                        </span>
                        <span className="text-[10px] text-editor-muted truncate w-full text-center">
                          {a.filename}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div
            className="w-full max-h-[200px] px-3 pt-2.5 pb-10 bg-transparent overflow-y-auto"
            data-ite-chat-composer
            data-testid="chat-composer-container"
          >
            <ChatComposerEditor
              content={localComposerText}
              onChange={setLocalComposerText}
              onSubmit={() => void sendCurrent()}
              disabled={isLoading}
              placeholder={isDragging ? t('chat.dropToAttach') : t('chat.composerPlaceholder')}
              onImagePaste={handleComposerPaste}
              onEditorReady={(editor) => {
                editorRef.current = editor;
              }}
            />
          </div>

          {/* 하단 컨트롤 바 */}
          <div className="absolute inset-x-0 bottom-0 px-2 pb-1.5 flex items-end gap-1 pointer-events-none min-w-0">
            <div className="pointer-events-auto flex items-center gap-1 shrink-0">
              <div className="relative" data-ite-composer-menu-root>
                <button
                  type="button"
                  className="w-7 h-7 rounded-full border border-editor-border bg-editor-bg text-editor-muted text-xs
                             hover:bg-editor-border hover:text-editor-text transition-colors"
                  title={t('chat.composerOptions')}
                  aria-label={t('chat.composerOptionsAriaLabel')}
                  onClick={() => setComposerMenuOpen((v) => !v)}
                  disabled={isLoading}
                >
                  +
                </button>
                {composerMenuOpen && (
                  <div
                    data-ite-composer-menu
                    className="absolute bottom-10 left-0 w-52 rounded-xl border border-editor-border bg-editor-surface shadow-lg overflow-hidden z-50"
                  >
                    {isTauriRuntime() && (
                      <>
                        <button
                          type="button"
                          className="w-full px-3 py-2 flex items-center gap-2 text-sm text-editor-text hover:bg-editor-border/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => {
                            setComposerMenuOpen(false);
                            void handleAttachClick();
                          }}
                          disabled={isLoading}
                          data-testid="chat-attach-file"
                        >
                          <Paperclip size={16} className="text-editor-muted" />
                          <span className="flex-1 text-left">{t('chat.attachFile')}</span>
                        </button>
                        <div role="separator" className="h-px bg-editor-border" />
                      </>
                    )}
                    <label className="w-full px-3 py-2 flex items-center gap-2 text-sm text-editor-text hover:bg-editor-border/60 transition-colors cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="accent-primary-500"
                      checked={webSearchEnabled}
                      onChange={(e) => setWebSearchEnabled(e.target.checked)}
                      disabled={isLoading}
                    />
                    <span className="flex-1">{t('chat.webSearch')}</span>
                    <span className="text-[11px] text-editor-muted">{webSearchEnabled ? 'ON' : 'OFF'}</span>
                  </label>
                  <label className="w-full px-3 py-2 flex items-center gap-2 text-sm text-editor-text hover:bg-editor-border/60 transition-colors cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="accent-primary-500"
                      checked={confluenceSearchEnabled}
                      onChange={(e) => setConfluenceSearchEnabled(e.target.checked, effectiveSessionId)}
                      disabled={isLoading}
                    />
                    <span className="flex-1">{t('chat.confluenceSearch')}</span>
                    <span className="text-[11px] text-editor-muted">{confluenceSearchEnabled ? 'ON' : 'OFF'}</span>
                  </label>

                  {confluenceSearchEnabled && !mcpStatus.isConnected && (
                    <button
                      type="button"
                      className="w-full px-3 py-2 flex items-center gap-2 text-sm text-primary-500 hover:bg-editor-border/60 transition-colors"
                      onClick={() => {
                        setComposerMenuOpen(false);
                        mcpClientManager.connectAtlassian();
                      }}
                      disabled={mcpStatus.isConnecting}
                    >
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="flex-1 text-left">{mcpStatus.isConnecting ? '연결 중...' : 'Atlassian 연결하기'}</span>
                    </button>
                  )}

                  {/* Notion 검색 */}
                  <label className="w-full px-3 py-2 flex items-center gap-2 text-sm text-editor-text hover:bg-editor-border/60 transition-colors cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="accent-primary-500"
                      checked={notionEnabled && notionHasToken}
                      onChange={(e) => setNotionEnabled('notion', e.target.checked)}
                      disabled={isLoading || !notionHasToken}
                    />
                    <span className="flex-1">{t('chat.notionSearch')}</span>
                    <span className="text-[11px] text-editor-muted">{notionEnabled && notionHasToken ? 'ON' : 'OFF'}</span>
                  </label>

                  {notionEnabled && !notionHasToken && (
                    <button
                      type="button"
                      className="w-full px-3 py-2 flex items-center gap-2 text-sm text-primary-500 hover:bg-editor-border/60 transition-colors"
                      onClick={() => {
                        setComposerMenuOpen(false);
                        // TODO: Settings로 이동하여 Notion 연결 유도
                      }}
                    >
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="flex-1 text-left">Notion 연결하기 (설정)</span>
                    </button>
                  )}
                </div>
              )}
              </div>
            </div>

            <div className="pointer-events-auto ml-auto flex items-center gap-1 min-w-0">
              <Select
                value={chatModel}
                onChange={setChatModel}
                options={enabledChatPresets}
                disabled={isLoading}
                aria-label={t('chat.chatModelAriaLabel')}
                title={t('chat.chatModelTitle')}
                size="sm"
                className="min-w-0 max-w-[8.5rem] shrink"
                anchor="top"
                data-testid="chat-model-select"
              />
              <button
                type="submit"
                disabled={globalIsLoading || !localComposerText.trim()}
                className="shrink-0 w-7 h-7 rounded-full bg-primary-500 text-white
                           hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors flex items-center justify-center"
                title={t('chat.send')}
                aria-label={t('chat.sendAriaLabel')}
                data-testid="chat-send-button"
              >
                <span className="text-xs leading-none">↑</span>
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
