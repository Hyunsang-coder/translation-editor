import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { pickChatAttachmentFile } from '@/tauri/dialog';
import { isTauriRuntime } from '@/tauri/invoke';
import { confirm } from '@tauri-apps/plugin-dialog';
import { ChatMessageItem } from '@/components/chat/ChatMessageItem';
import { MODEL_PRESETS, type AiProvider } from '@/ai/config';
import { SkeletonParagraph } from '@/components/ui/Skeleton';
import { mcpClientManager, type McpConnectionStatus } from '@/ai/mcp/McpClientManager';
import { useConnectorStore } from '@/stores/connectorStore';
import type { ChatMessageMetadata } from '@/types';

/**
 * 채팅 콘텐츠 컴포넌트
 * 플로팅 패널 내부에 렌더링되는 채팅 기능
 */
export function ChatContent(): JSX.Element {
  const { t } = useTranslation();

  const { currentSession, sendMessage, isLoading } = useChatStore();
  const statusMessage = useChatStore((s) => s.statusMessage);
  const chatSessions = useChatStore((s) => s.sessions);
  const dismissSummarySuggestion = useChatStore((s) => s.dismissSummarySuggestion);
  const startNewSessionFromSuggestion = useChatStore((s) => s.startNewSessionFromSuggestion);
  
  // selector 버그 수정: 함수 호출 대신 직접 상태 구독
  const currentSessionIdForSuggestion = useChatStore((s) => s.currentSessionId);
  const messageCountForSuggestion = useChatStore((s) => s.currentSession?.messages.length ?? 0);
  const dismissedMap = useChatStore((s) => s.summarySuggestionDismissedBySessionId);
  const shouldShowSummarySuggestion = 
    currentSessionIdForSuggestion !== null &&
    !dismissedMap[currentSessionIdForSuggestion] &&
    messageCountForSuggestion >= 30;

  const composerText = useChatStore((s) => s.composerText);
  const setComposerText = useChatStore((s) => s.setComposerText);
  const focusNonce = useChatStore((s) => s.composerFocusNonce);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const provider = useAiConfigStore((s) => s.provider);
  const chatModel = useAiConfigStore((s) => s.chatModel);
  const setChatModel = useAiConfigStore((s) => s.setChatModel);
  const providerKey: Exclude<AiProvider, 'mock'> = provider === 'mock' ? 'openai' : provider;
  const chatPresets = MODEL_PRESETS[providerKey];

  useEffect(() => {
    if (!chatPresets.some((p) => p.value === chatModel)) {
      setChatModel(chatPresets[0].value);
    }
  }, [chatModel, provider, setChatModel, chatPresets]);

  const isHydrating = useChatStore((s) => s.isHydrating);
  const project = useProjectStore((s) => s.project);
  const hydrateForProject = useChatStore((s) => s.hydrateForProject);

  const editMessage = useChatStore((s) => s.editMessage);
  const replayMessage = useChatStore((s) => s.replayMessage);
  const appendToTranslationRules = useChatStore((s) => s.appendToTranslationRules);
  const appendToProjectContext = useChatStore((s) => s.appendToProjectContext);
  const deleteMessageFrom = useChatStore((s) => s.deleteMessageFrom);
  const createSession = useChatStore((s) => s.createSession);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const composerAttachments = useChatStore((s) => s.composerAttachments);
  const addComposerAttachment = useChatStore((s) => s.addComposerAttachment);
  const removeComposerAttachment = useChatStore((s) => s.removeComposerAttachment);
  const webSearchEnabled = useChatStore((s) => s.webSearchEnabled);
  const setWebSearchEnabled = useChatStore((s) => s.setWebSearchEnabled);
  const confluenceSearchEnabled = useChatStore((s) => s.currentSession?.confluenceSearchEnabled ?? false);
  const setConfluenceSearchEnabled = useChatStore((s) => s.setConfluenceSearchEnabled);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);

  const chatPanelOpen = useUIStore((s) => s.chatPanelOpen);

  const [mcpStatus, setMcpStatus] = useState<McpConnectionStatus>(mcpClientManager.getStatus());
  useEffect(() => mcpClientManager.subscribe(setMcpStatus), []);

  // Notion 상태 동기화
  useEffect(() => {
    const unsubscribe = mcpClientManager.subscribeNotion((status) => {
      useConnectorStore.getState().setTokenStatus('notion', status.hasStoredToken ?? false);
    });
    return unsubscribe;
  }, []);

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

  const streamingContent = useChatStore((s) => s.streamingContent);
  const streamingMetadata = useChatStore((s) => s.streamingMetadata);

  const streamingMessage = useMemo(() => {
    if (!streamingMessageId) return null;
    return currentSession?.messages.find((m) => m.id === streamingMessageId) ?? null;
  }, [currentSession?.messages, streamingMessageId]);

  const streamingBubbleExists = !!streamingMessage;

  const renderAssistantSkeleton = useCallback((toolsInProgress?: string[]): JSX.Element => {
    let statusText = statusMessage;

    if (!statusText && toolsInProgress && toolsInProgress.length > 0) {
      const tool = toolsInProgress[0];
      const name =
        (tool === 'web_search' || tool === 'web_search_preview') ? '웹 검색'
          : tool === 'brave_search' ? '웹 검색(Brave)'
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

  // 메모이제이션된 메시지 이벤트 핸들러
  const handleEditMessage = useCallback((messageId: string, content: string) => {
    editMessage(messageId, content);
  }, [editMessage]);

  const handleReplayMessage = useCallback((messageId: string) => {
    void replayMessage(messageId);
  }, [replayMessage]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    deleteMessageFrom(messageId);
  }, [deleteMessageFrom]);

  const handleAppendToRules = useCallback((content: string) => {
    appendToTranslationRules(content);
  }, [appendToTranslationRules]);

  const handleAppendToContext = useCallback((content: string) => {
    appendToProjectContext(content);
  }, [appendToProjectContext]);

  const handleUpdateMessageMetadata = useCallback((messageId: string, metadata: Partial<ChatMessageMetadata>) => {
    updateMessage(messageId, { metadata });
  }, [updateMessage]);

  // 프로젝트 전환 시 채팅 세션 복원
  const lastHydratedId = useRef<string | null>(null);
  useEffect(() => {
    const projectId = project?.id ?? null;
    if (projectId === lastHydratedId.current) return;

    lastHydratedId.current = projectId;
    void hydrateForProject(projectId);
  }, [project?.id, hydrateForProject]);

  // focusNonce 변경 시 Chat 패널 열기 + 포커스
  useEffect(() => {
    if (focusNonce === 0) return;

    // Chat 패널이 닫혀있다면 열기
    const { chatPanelOpen, setChatPanelOpen } = useUIStore.getState();
    if (!chatPanelOpen) setChatPanelOpen(true);

    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  }, [focusNonce]);

  // 기본 채팅 세션 1개는 자동 생성
  useEffect(() => {
    if (!project?.id) return;
    if (isHydrating) return;
    if (chatSessions.length > 0) return;
    createSession('Chat');
  }, [project?.id, isHydrating, chatSessions.length, createSession]);

  const sendCurrent = useCallback(async (): Promise<void> => {
    if (!composerText.trim() || isLoading) return;

    const message = composerText.trim();
    setComposerText('');
    await sendMessage(message);
  }, [composerText, isLoading, sendMessage, setComposerText]);

  // Chat 패널 열릴 때 포커스
  useEffect(() => {
    if (!chatPanelOpen) return;
    inputRef.current?.focus();
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, [chatPanelOpen]);

  // 메시지 추가 시 자동 스크롤
  useEffect(() => {
    if (chatPanelOpen && currentSession?.messages.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentSession?.messages.length, chatPanelOpen]);

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
      {/* Session Tabs */}
      <div className="h-9 border-b border-editor-border flex items-center bg-editor-bg select-none shrink-0">
        <div className="flex-1 flex items-center overflow-x-auto no-scrollbar">
          {chatSessions.map((session) => (
            <div
              key={session.id}
              onClick={() => {
                useChatStore.getState().switchSession(session.id);
              }}
              className={`
                group relative h-9 px-3 flex items-center gap-2 text-xs font-medium cursor-pointer border-r border-editor-border min-w-[80px] max-w-[140px]
                ${currentSession?.id === session.id
                  ? 'bg-editor-surface text-primary-500 border-b-2 border-b-primary-500'
                  : 'text-editor-muted hover:bg-editor-surface hover:text-editor-text'
                }
              `}
              title={session.name}
            >
              <span className="truncate flex-1">{session.name}</span>
              {(chatSessions.length > 0) && (
                <button
                  className={`
                     opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-editor-border/50
                     ${currentSession?.id === session.id ? 'opacity-100' : ''}
                   `}
                  onClick={(e) => {
                    e.stopPropagation();
                    void (async () => {
                      const ok = await confirm(t('chat.deleteSessionConfirm'), { title: t('chat.deleteSessionTitle'), kind: 'warning' });
                      if (ok) {
                        useChatStore.getState().deleteSession(session.id);
                      }
                    })();
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          {chatSessions.length < 5 && (
            <button
              onClick={() => {
                const id = useChatStore.getState().createSession();
                if (id) {
                  useChatStore.getState().switchSession(id);
                }
              }}
              className="h-9 px-3 flex items-center justify-center text-editor-muted hover:text-primary-500 hover:bg-editor-surface transition-colors border-r border-editor-border"
              title={t('chat.newChat')}
            >
              +
            </button>
          )}
        </div>
      </div>

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
              onClick={startNewSessionFromSuggestion}
            >
              {t('chat.startNewSession')}
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded text-[11px] bg-editor-bg text-editor-muted hover:bg-editor-border"
              onClick={dismissSummarySuggestion}
            >
              {t('common.ignore')}
            </button>
          </div>
        </div>
      )}

      {/* 메시지 목록 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {currentSession?.messages.map((message) => (
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
            onUpdateMessageMetadata={handleUpdateMessageMetadata}
          />
        ))}

        {isLoading && (!streamingMessageId || !streamingBubbleExists) && (
          <div className="chat-message chat-message-ai">
            {showStreamingSkeleton && renderAssistantSkeleton()}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 입력창 */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-editor-border bg-editor-bg shrink-0">
        <div className="relative rounded-2xl border border-editor-border bg-editor-surface shadow-sm">
          <textarea
            ref={inputRef}
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            placeholder={t('chat.composerPlaceholder')}
            className="w-full min-h-[80px] px-4 pt-3 pb-10 rounded-2xl bg-transparent
                       text-editor-text placeholder-editor-muted text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            disabled={isLoading}
            data-ite-chat-composer
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendCurrent();
              }
            }}
          />

          {/* 하단 컨트롤 바 */}
          <div className="absolute inset-x-0 bottom-0 px-2 pb-2 flex items-end justify-between pointer-events-none">
            <div className="pointer-events-auto relative" data-ite-composer-menu-root>
              <button
                type="button"
                className="w-8 h-8 rounded-full border border-editor-border bg-editor-bg text-editor-muted text-sm
                           hover:bg-editor-border hover:text-editor-text transition-colors"
                title={t('chat.composerAttach')}
                aria-label={t('chat.composerAttachAriaLabel')}
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
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm text-editor-text hover:bg-editor-border/60 transition-colors"
                    onClick={() => {
                      setComposerMenuOpen(false);
                      void (async () => {
                        if (!isTauriRuntime()) return;
                        const path = await pickChatAttachmentFile();
                        if (path) {
                          await addComposerAttachment(path);
                        }
                      })();
                    }}
                  >
                    {t('chat.addFileOrImage')}
                  </button>
                  <div className="h-px bg-editor-border" />
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
                      onChange={(e) => setConfluenceSearchEnabled(e.target.checked)}
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

            <div className="pointer-events-auto flex items-center gap-2">
              <select
                className="h-8 px-2 text-[11px] rounded-full border border-editor-border bg-editor-bg text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
                aria-label={t('chat.chatModelAriaLabel')}
                title={t('chat.chatModelTitle')}
                disabled={isLoading}
              >
                {chatPresets.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={isLoading || !composerText.trim()}
                className="w-8 h-8 rounded-full bg-primary-500 text-white
                           hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors flex items-center justify-center"
                title={t('chat.send')}
                aria-label={t('chat.sendAriaLabel')}
              >
                <span className="text-sm leading-none">↑</span>
              </button>
            </div>
          </div>

          {composerAttachments.length > 0 && (
            <div className="px-3 pb-3 -mt-2 flex flex-wrap gap-2">
              {composerAttachments.map((a) => (
                <div
                  key={a.id}
                  className="inline-flex items-center gap-2 px-2 py-1 rounded-full border border-editor-border bg-editor-bg text-[11px] text-editor-text max-w-full"
                  title={a.filename}
                >
                  <span className="truncate max-w-[180px]">{a.filename}</span>
                  <button
                    type="button"
                    className="text-editor-muted hover:text-red-600"
                    aria-label={t('chat.removeAttachment')}
                    onClick={() => removeComposerAttachment(a.id)}
                    disabled={isLoading}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
