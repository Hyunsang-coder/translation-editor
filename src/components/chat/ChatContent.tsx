import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
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
import { pickChatAttachmentFile } from '@/tauri/dialog';
import { isTauriRuntime } from '@/tauri/invoke';
import { saveTempImage } from '@/tauri/attachments';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { ChatMessageItem } from '@/components/chat/ChatMessageItem';
import { ChatComposerEditor } from '@/components/chat/ChatComposerEditor';
import { MODEL_PRESETS } from '@/ai/config';
import { SkeletonParagraph } from '@/components/ui/Skeleton';
import { Select, type SelectOptionGroup } from '@/components/ui/Select';
import { mcpClientManager, type McpConnectionStatus } from '@/ai/mcp/McpClientManager';
import { useConnectorStore } from '@/stores/connectorStore';
import { fileToBytes, isImageMimeType, isImageFile } from '@/utils/fileUtils';
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
  const { currentSession, sessions: chatSessions, isHydrating, hydrateForProject } = useChatSessionState();

  // sessionId prop이 있으면 해당 세션 직접 조회, 없으면 currentSession 사용
  const displaySession = useMemo(() => {
    if (sessionId) {
      return chatSessions.find((s) => s.id === sessionId) ?? null;
    }
    return currentSession;
  }, [sessionId, chatSessions, currentSession]);

  // 스트리밍 상태: sessionId prop이 있으면 해당 세션의 스트리밍만 표시
  const sessionStreamingState = sessionId ? useSessionStreamingState(sessionId) : useChatStore(useShallow((s) => ({
    isStreaming: s.streamingMessageId !== null,
    streamingMessageId: s.streamingMessageId,
    streamingContent: s.streamingContent,
    streamingMetadata: s.streamingMetadata,
    statusMessage: s.statusMessage,
    isLoading: s.isLoading,
  })));

  const { isLoading, streamingMessageId, streamingContent, streamingMetadata, statusMessage } = sessionStreamingState;
  const {
    composerText,
    setComposerText,
    composerAttachments,
    addComposerAttachment,
    removeComposerAttachment,
    focusNonce,
  } = useChatComposerState();
  const {
    webSearchEnabled,
    setWebSearchEnabled,
    confluenceSearchEnabled,
    setConfluenceSearchEnabled,
  } = useChatSearchState();
  const {
    sendMessage,
    editMessage,
    replayMessage,
    deleteMessageFrom,
    updateMessage,
    appendToTranslationRules,
    appendToProjectContext,
  } = useChatMessageActions();
  const {
    shouldShow: shouldShowSummarySuggestion,
    dismiss: dismissSummarySuggestion,
    startNewSession: startNewSessionFromSuggestion,
  } = useSummarySuggestionState();

  // 개별 선택자 (그룹에 포함되지 않는 것들)
  const createSession = useChatStore((s) => s.createSession);
  const editorRef = useRef<Editor | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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
  const [isDragging, setIsDragging] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  // side+sessionId가 있으면 해당 sidebar의 collapsed+activePanel로 판단
  const chatPanelOpen = useUIStore((s) => {
    if (side && sessionId) {
      const sb = side === 'left' ? s.leftSidebar : s.rightSidebar;
      const panelId = chatPanelId(sessionId);
      return !sb.collapsed && sb.activePanel === panelId;
    }
    return s.chatPanelOpen;
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

  // Tauri 드래그 앤 드롭 이벤트 리스너
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const setupListener = async () => {
      try {
        const webview = getCurrentWebview();
        const unlistenFn = await webview.onDragDropEvent(async (event) => {
          if (cancelled) return;

          if (event.payload.type === 'over') {
            setIsDragging(true);
          } else if (event.payload.type === 'drop') {
            setIsDragging(false);
            const paths = event.payload.paths;

            for (const path of paths) {
              try {
                await addComposerAttachment(path);
              } catch (error) {
                console.error('Failed to add dropped file:', error);
              }
            }
          } else {
            // cancelled
            setIsDragging(false);
          }
        });

        // cleanup이 이미 호출된 경우 즉시 unlisten
        if (cancelled) {
          unlistenFn();
        } else {
          unlisten = unlistenFn;
        }
      } catch (error) {
        console.error('Failed to setup drag drop listener:', error);
      }
    };

    void setupListener();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [addComposerAttachment]);

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

  const handleUpdateMessageMetadata = useCallback((messageId: string, metadata: Partial<ChatMessageMetadata>) => {
    updateMessage(messageId, { metadata });
  }, [updateMessage]);

  // 드래그 앤 드롭 핸들러 (HTML5 fallback - Tauri에서는 onDragDropEvent 사용)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && target.contains(related)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Tauri에서는 onDragDropEvent를 사용하므로 여기서는 처리하지 않음
    if (isTauriRuntime()) return;

    // 브라우저 환경 fallback (개발 모드 등)

    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;

      // 이미지 파일인 경우 직접 처리 (MIME 타입 + 확장자 모두 체크)
      if (isImageFile(file)) {
        try {
          const bytes = await fileToBytes(file);
          const path = await saveTempImage(bytes, file.name);
          await addComposerAttachment(path);
        } catch (error) {
          console.error('Failed to process dropped image:', error);
        }
      } else {
        // 이미지가 아닌 파일은 파일 다이얼로그로 안내
        const path = await pickChatAttachmentFile();
        if (path) {
          await addComposerAttachment(path);
        }
        break; // 다이얼로그는 한 번만 열기
      }
    }
  }, [addComposerAttachment]);

  // 클립보드 붙여넣기 핸들러 (이미지)
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;

    for (const item of items) {
      if (isImageMimeType(item.type)) {
        e.preventDefault();

        const blob = item.getAsFile();
        if (!blob) continue;

        // 파일명 생성 (클립보드 이미지는 이름이 없음)
        const ext = item.type.split('/')[1] || 'png';
        const filename = `clipboard-${Date.now()}.${ext}`;

        try {
          const bytes = await fileToBytes(blob);
          const path = await saveTempImage(bytes, filename);
          await addComposerAttachment(path);
        } catch (error) {
          console.error('Failed to process pasted image:', error);
        }
        return;
      }
    }
    // 텍스트 붙여넣기는 기본 동작 유지
  }, [addComposerAttachment]);

  // 파일 첨부 버튼 클릭 핸들러
  const handleAttachClick = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const path = await pickChatAttachmentFile();
    if (path) {
      await addComposerAttachment(path);
    }
  }, [addComposerAttachment]);

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

  // focusNonce 변경 시 Chat 패널 열기 + 포커스
  useEffect(() => {
    if (focusNonce === 0) return;

    // Chat 패널이 닫혀있다면 열기
    if (side && sessionId) {
      const { openPanelOnSide } = useUIStore.getState();
      openPanelOnSide(side, chatPanelId(sessionId));
    } else {
      const { openActiveChat } = useUIStore.getState();
      openActiveChat();
    }

    const timer = setTimeout(() => {
      editorRef.current?.commands.focus('end');
    }, 100);
    return () => clearTimeout(timer);
  }, [focusNonce, side, sessionId]);

  // 기본 채팅 세션 1개는 자동 생성 (side가 없을 때만, dual sidebar에서는 각 세션이 독립적)
  useEffect(() => {
    if (side) return; // dual sidebar면 스킵
    if (!project?.id) return;
    if (isHydrating) return;
    if (chatSessions.length > 0) return;
    createSession(t('chat.title'));
  }, [side, project?.id, isHydrating, chatSessions.length, createSession, t]);

  const sendCurrent = useCallback(async (): Promise<void> => {
    if (!composerText.trim() || isLoading || !displaySession?.id) return;

    const message = composerText.trim();
    setComposerText('');
    // TipTap 에디터 초기화
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editorRef.current as any)?.clearComposerContent?.();

    // sessionId prop이 있으면 현재 활성 세션으로 switchSession 후 전송
    // (sendMessage는 currentSessionId를 사용하므로)
    if (sessionId && sessionId !== useChatStore.getState().currentSessionId) {
      useChatStore.getState().switchSession(sessionId);
    }

    await sendMessage(message);
  }, [composerText, isLoading, displaySession?.id, sendMessage, setComposerText, sessionId]);

  // Chat 패널 열릴 때 포커스
  useEffect(() => {
    if (!chatPanelOpen) return;
    editorRef.current?.commands.focus('end');
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
    return () => clearTimeout(timer);
  }, [chatPanelOpen]);

  // 메시지 추가 시 자동 스크롤
  useEffect(() => {
    if (chatPanelOpen && displaySession?.messages.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [displaySession?.messages.length, chatPanelOpen]);

  // 스크롤 위치 감지 (맨 아래가 아니면 버튼 표시)
  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setShowScrollToBottom(!isAtBottom);
  }, []);

  // 최신 메시지로 스크롤
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

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
      <div className="relative flex-1 min-h-0">
        <div
          ref={messagesContainerRef}
          className="h-full overflow-y-auto p-4 space-y-4"
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

        {/* 최신 메시지로 스크롤 버튼 */}
        {showScrollToBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
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
            onPaste={handlePaste}
          >
            <ChatComposerEditor
              content={composerText}
              onChange={setComposerText}
              onSubmit={() => void sendCurrent()}
              disabled={isLoading}
              placeholder={isDragging ? t('chat.dropToAttach') : t('chat.composerPlaceholder')}
              onEditorReady={(editor) => {
                editorRef.current = editor;
              }}
            />
          </div>

          {/* 하단 컨트롤 바 */}
          <div className="absolute inset-x-0 bottom-0 px-3 pb-1.5 flex items-end justify-between pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-1.5">
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

              {/* 파일 첨부 버튼 */}
              <button
                type="button"
                className="w-7 h-7 rounded-full border border-editor-border bg-editor-bg text-editor-muted
                           hover:bg-editor-border hover:text-editor-text transition-colors flex items-center justify-center"
                title={t('chat.attachFile')}
                aria-label={t('chat.attachFileAriaLabel')}
                onClick={() => void handleAttachClick()}
                disabled={isLoading}
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                  />
                </svg>
              </button>
            </div>

            <div className="pointer-events-auto flex items-center gap-2">
              <Select
                value={chatModel}
                onChange={setChatModel}
                options={enabledChatPresets}
                disabled={isLoading}
                aria-label={t('chat.chatModelAriaLabel')}
                title={t('chat.chatModelTitle')}
                className="min-w-[100px]"
                anchor="top"
              />
              <button
                type="submit"
                disabled={isLoading || !composerText.trim()}
                className="w-7 h-7 rounded-full bg-primary-500 text-white
                           hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors flex items-center justify-center"
                title={t('chat.send')}
                aria-label={t('chat.sendAriaLabel')}
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
