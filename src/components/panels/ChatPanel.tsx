import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { pickGlossaryCsvFile, pickGlossaryExcelFile, pickDocumentFile, pickChatAttachmentFile } from '@/tauri/dialog';
import { importGlossaryCsv, importGlossaryExcel } from '@/tauri/glossary';
import { isTauriRuntime } from '@/tauri/invoke';
import { saveTempImage } from '@/tauri/attachments';
import { confirm } from '@tauri-apps/plugin-dialog';
import { ChatMessageItem } from '@/components/chat/ChatMessageItem';
import { ChatComposerEditor } from '@/components/chat/ChatComposerEditor';
import { DebouncedTextarea } from '@/components/ui/DebouncedTextarea';
import { MODEL_PRESETS } from '@/ai/config';
import { SkeletonParagraph } from '@/components/ui/Skeleton';
import { mcpClientManager, type McpConnectionStatus } from '@/ai/mcp/McpClientManager';
import { useConnectorStore } from '@/stores/connectorStore';
import { ReviewPanel } from '@/components/review/ReviewPanel';
import { fileToBytes, isImageMimeType, isImageFile } from '@/utils/fileUtils';
import type { ChatMessageMetadata } from '@/types';
import type { Editor } from '@tiptap/react';


/**
 * AI 채팅 패널 컴포넌트
 * 멀티 세션 지원 채팅창
 */
export function ChatPanel(): JSX.Element {
  // 1. Hooks (Top-level)
  const { t } = useTranslation();
  const { sidebarCollapsed, toggleSidebar, togglePanelSwap, isPanelsSwapped } = useUIStore();
  
  // 채팅 세션 상수 (chatStore에서 사용하는 동일한 값)
  const MAX_CHAT_SESSIONS = 5;

  const { currentSession, sendMessage, isLoading } = useChatStore();
  const statusMessage = useChatStore((s) => s.statusMessage); // [복구] 상태 메시지 구독 (리렌더링 트리거용)
  const chatSessions = useChatStore((s) => s.sessions); // Hoisted selector
  const dismissSummarySuggestion = useChatStore((s) => s.dismissSummarySuggestion);
  
  // selector 버그 수정: 함수 호출 대신 직접 상태 구독
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const messageCount = useChatStore((s) => s.currentSession?.messages.length ?? 0);
  const dismissedMap = useChatStore((s) => s.summarySuggestionDismissedBySessionId);
  const shouldShowSummarySuggestion = 
    currentSessionId !== null &&
    !dismissedMap[currentSessionId] &&
    messageCount >= 30;
  const startNewSessionFromSuggestion = useChatStore((s) => s.startNewSessionFromSuggestion);
  const isSessionLimitReached = useChatStore((s) => s.isSessionLimitReached);
  const getOldestSession = useChatStore((s) => s.getOldestSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  const composerText = useChatStore((s) => s.composerText);
  const setComposerText = useChatStore((s) => s.setComposerText);
  const focusNonce = useChatStore((s) => s.composerFocusNonce);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const translatorPersona = useChatStore((s) => s.translatorPersona);
  const setTranslatorPersona = useChatStore((s) => s.setTranslatorPersona);
  const translationRules = useChatStore((s) => s.translationRules);
  const setTranslationRules = useChatStore((s) => s.setTranslationRules);
  const projectContext = useChatStore((s) => s.projectContext);
  const setProjectContext = useChatStore((s) => s.setProjectContext);
  const [activeTab, setActiveTab] = useState<'settings' | 'chat' | 'review'>('settings');
  const editorRef = useRef<Editor | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const openaiEnabled = useAiConfigStore((s) => s.openaiEnabled);
  const anthropicEnabled = useAiConfigStore((s) => s.anthropicEnabled);
  const chatModel = useAiConfigStore((s) => s.chatModel);
  const setChatModel = useAiConfigStore((s) => s.setChatModel);

  // 활성화된 프로바이더의 모델만 표시
  type ModelPreset = { value: string; label: string; description: string };
  const enabledChatPresets = useMemo(() => {
    const presets: Array<{ group: string; items: readonly ModelPreset[] }> = [];
    if (openaiEnabled) {
      presets.push({ group: 'OpenAI', items: MODEL_PRESETS.openai });
    }
    if (anthropicEnabled) {
      presets.push({ group: 'Anthropic', items: MODEL_PRESETS.anthropic });
    }
    return presets;
  }, [openaiEnabled, anthropicEnabled]);

  // 선택된 모델이 비활성화된 프로바이더면 첫 번째 활성 모델로 변경
  useEffect(() => {
    if (enabledChatPresets.length === 0) return;
    const allModels = enabledChatPresets.flatMap((p) => p.items);
    const firstModel = allModels[0];
    if (!firstModel) return;
    if (!allModels.some((m) => m.value === chatModel)) {
      setChatModel(firstModel.value);
    }
  }, [chatModel, enabledChatPresets, setChatModel]);

  const isHydrating = useChatStore((s) => s.isHydrating);
  const project = useProjectStore((s) => s.project);
  const settingsKey = project?.id ?? 'none';
  const addGlossaryPath = useProjectStore((s) => s.addGlossaryPath);
  const hydrateForProject = useChatStore((s) => s.hydrateForProject);

  const editMessage = useChatStore((s) => s.editMessage);
  const replayMessage = useChatStore((s) => s.replayMessage);
  const appendToTranslationRules = useChatStore((s) => s.appendToTranslationRules);
  const appendToProjectContext = useChatStore((s) => s.appendToProjectContext);
  const deleteMessageFrom = useChatStore((s) => s.deleteMessageFrom);
  const createSession = useChatStore((s) => s.createSession);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const attachments = useChatStore((s) => s.attachments);
  const attachFile = useChatStore((s) => s.attachFile);
  const deleteAttachment = useChatStore((s) => s.deleteAttachment);
  const composerAttachments = useChatStore((s) => s.composerAttachments);
  const addComposerAttachment = useChatStore((s) => s.addComposerAttachment);
  const removeComposerAttachment = useChatStore((s) => s.removeComposerAttachment);
  const webSearchEnabled = useChatStore((s) => s.webSearchEnabled);
  const setWebSearchEnabled = useChatStore((s) => s.setWebSearchEnabled);
  const confluenceSearchEnabled = useChatStore((s) => s.currentSession?.confluenceSearchEnabled ?? false);
  const setConfluenceSearchEnabled = useChatStore((s) => s.setConfluenceSearchEnabled);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [mcpStatus, setMcpStatus] = useState<McpConnectionStatus>(mcpClientManager.getStatus());
  useEffect(() => mcpClientManager.subscribe(setMcpStatus), []);
  
  // Notion 상태 동기화 (토큰 존재 여부 확인용)
  useEffect(() => {
    const unsubscribe = mcpClientManager.subscribeNotion((status) => {
      // 토큰 상태를 connectorStore에 동기화
      useConnectorStore.getState().setTokenStatus('notion', status.hasStoredToken ?? false);
    });
    return unsubscribe;
  }, []);

  // Notion 검색 활성화 상태 (connectorStore에서 관리)
  const notionEnabled = useConnectorStore((s) => s.enabledMap['notion'] ?? false);
  const notionHasToken = useConnectorStore((s) => s.tokenMap['notion'] ?? false);
  const setNotionEnabled = useConnectorStore((s) => s.setEnabled);

  const [showStreamingSkeleton, setShowStreamingSkeleton] = useState(false);

  // 스트리밍 시작 직후(아주 빠른 응답)에는 skeleton이 번쩍이지 않도록, 짧은 지연 후에만 skeleton을 표시합니다.
  useEffect(() => {
    if (!isLoading) {
      setShowStreamingSkeleton(false);
      return;
    }

    setShowStreamingSkeleton(false);
    const t = window.setTimeout(() => setShowStreamingSkeleton(true), 200);
    return () => window.clearTimeout(t);
  }, [isLoading]);

  // 성능 최적화: 스트리밍 콘텐츠 및 메타데이터 직접 구독
  const streamingContent = useChatStore((s) => s.streamingContent);
  const streamingMetadata = useChatStore((s) => s.streamingMetadata);

  const streamingMessage = useMemo(() => {
    if (!streamingMessageId) return null;
    return currentSession?.messages.find((m) => m.id === streamingMessageId) ?? null;
  }, [currentSession?.messages, streamingMessageId]);

  const streamingBubbleExists = !!streamingMessage;

  // statusMessage를 의존성에 추가하여 상태 변경 시 스켈레톤 텍스트가 업데이트되도록 함
  const renderAssistantSkeleton = useCallback((toolsInProgress?: string[]): JSX.Element => {
    // 1. Store의 상태 메시지를 최우선으로 사용
    const storeStatus = statusMessage;
    let statusText = storeStatus;

    // 2. Store 상태가 없는데(null) 도구 호출 정보가 남아있다면 추론 (하위 호환 및 엣지 케이스)
    if (!statusText && toolsInProgress && toolsInProgress.length > 0) {
      const t = toolsInProgress[0];
      const name =
          (t === 'web_search' || t === 'web_search_preview') ? '웹 검색'
        : t === 'get_source_document' ? '원문 분석'
        : t === 'get_target_document' ? '번역문 분석'
        : t === 'suggest_translation_rule' ? '번역 규칙 확인'
        : t === 'suggest_project_context' ? '프로젝트 맥락 확인'
        : t;
      statusText = `${name} 진행 중...`;
    }

    // 3. 기본값
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

  // 드래그 앤 드롭 핸들러
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // relatedTarget이 composer 영역 내부면 무시
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

  // 새 세션 시작 핸들러: 세션 제한 도달 시 확인 다이얼로그 표시
  const handleStartNewSession = useCallback(async () => {
    if (!isSessionLimitReached()) {
      // 세션 제한에 도달하지 않았으면 바로 새 세션 생성
      startNewSessionFromSuggestion();
      return;
    }

    // 세션 제한 도달: 가장 오래된 세션 삭제 확인
    const oldest = getOldestSession();
    if (!oldest) return;

    const ok = await confirm(
      t('chat.sessionLimitReachedConfirm', {
        sessionName: oldest.name,
        maxSessions: MAX_CHAT_SESSIONS,
        defaultValue: `세션이 최대 개수(${MAX_CHAT_SESSIONS}개)에 도달했습니다. 가장 오래된 세션 "${oldest.name}"을(를) 삭제하고 새 세션을 시작할까요?`,
      }),
      { title: t('chat.sessionLimitReachedTitle', '세션 제한'), kind: 'warning' }
    );

    if (ok) {
      deleteSession(oldest.id);
      startNewSessionFromSuggestion();
    }
  }, [isSessionLimitReached, getOldestSession, deleteSession, startNewSessionFromSuggestion, t]);

  // 프로젝트 전환 시: 채팅(현재 세션 1개) + ChatPanel 설정을 DB에서 복원 + 탭 초기화
  const lastHydratedId = useRef<string | null>(null);
  useEffect(() => {
    const projectId = project?.id ?? null;
    if (projectId === lastHydratedId.current) return;

    lastHydratedId.current = projectId;
    void hydrateForProject(projectId);
    setActiveTab('settings');
  }, [project?.id, hydrateForProject]);



  useEffect(() => {
    if (focusNonce === 0) return;

    // 이펙트가 실행될 때 사이드바가 닫혀있다면 강제로 열기
    const { sidebarCollapsed, toggleSidebar } = useUIStore.getState();
    if (sidebarCollapsed) toggleSidebar();

    setActiveTab('chat');
    // 사이드바가 열리는 시간을 고려하여 약간의 지연 후 포커스
    setTimeout(() => {
      editorRef.current?.commands.focus('end');
    }, 100);
  }, [focusNonce]);

  // 기본 채팅 세션 1개는 자동 생성
  useEffect(() => {
    if (!project?.id) return;
    if (isHydrating) return; // 로드 중에는 자동 생성 대기 (데이터 유실 방지)
    if (chatSessions.length > 0) return;
    createSession('Chat');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, isHydrating, chatSessions.length]);

  // 3. Handlers
  const sendCurrent = useCallback(async (): Promise<void> => {
    if (!composerText.trim() || isLoading) return;

    const message = composerText.trim();
    setComposerText('');
    // TipTap 에디터 초기화
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editorRef.current as any)?.clearComposerContent?.();
    await sendMessage(message);
  }, [composerText, isLoading, sendMessage, setComposerText]);

  useEffect(() => {
    if (activeTab !== 'chat') return;
    if (sidebarCollapsed) return;
    editorRef.current?.commands.focus('end');
    // 탭 전환 시 스크롤 하단 이동
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, [activeTab, sidebarCollapsed]);

  // 메시지 추가 시 자동 스크롤
  useEffect(() => {
    if (activeTab === 'chat' && currentSession?.messages.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentSession?.messages.length, activeTab]);

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
      // 메뉴 영역 밖 클릭이면 닫기
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

  // 4. Early Returns (Conditional Rendering)
  // 사이드바 축소 상태
  if (sidebarCollapsed) {
    return (
      <div className="h-full flex flex-col items-center py-4">
        <button
          type="button"
          onClick={toggleSidebar}
          className="p-2 rounded-md hover:bg-editor-border transition-colors"
          title="Open Chat"
        >
          💬
        </button>
      </div>
    );
  }

  const renderSettings = (): JSX.Element => (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6 bg-editor-bg">
      {/* Section 1: Translator Persona */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 group relative">
            <h3 className="text-xs font-semibold text-editor-text">1. {t('settings.translatorPersona')}</h3>
            <span className="cursor-help text-editor-muted text-[10px]">ⓘ</span>
            <div className="absolute left-0 top-full mt-2 hidden group-hover:block w-64 p-2 bg-editor-surface border border-editor-border rounded shadow-lg text-[10px] text-editor-text z-10 leading-relaxed whitespace-pre-line">
              {t('settings.translatorPersonaDescription')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs text-primary-500 hover:text-primary-600"
              onClick={() => setTranslatorPersona('')}
            >
              {t('common.clear')}
            </button>
          </div>
        </div>
        <DebouncedTextarea
          key={`translator-persona-${settingsKey}`}
          className="w-full min-h-[3.5rem] text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
          value={translatorPersona}
          onDebouncedChange={setTranslatorPersona}
          placeholder={t('settings.translatorPersonaPlaceholder')}
          rows={2}
        />
      </section>

      {/* Section 2: Translation Rules */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 group relative">
            <h3 className="text-xs font-semibold text-editor-text">2. {t('settings.translationRules')}</h3>
            <span className="cursor-help text-editor-muted text-[10px]">ⓘ</span>
            <div className="absolute left-0 top-full mt-2 hidden group-hover:block w-48 p-2 bg-editor-surface border border-editor-border rounded shadow-lg text-[10px] text-editor-text z-10 leading-relaxed">
              {t('settings.translationRulesDescription')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs text-primary-500 hover:text-primary-600"
              onClick={() => setTranslationRules('')}
            >
              {t('common.clear')}
            </button>
          </div>
        </div>
        <DebouncedTextarea
          key={`translation-rules-${settingsKey}`}
          className="w-full h-32 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
          value={translationRules}
          onDebouncedChange={setTranslationRules}
          placeholder={t('settings.translationRulesPlaceholder')}
        />
      </section>

      {/* Section 3: Project Context */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 group relative">
            <h3 className="text-xs font-semibold text-editor-text">3. {t('settings.projectContext')}</h3>
            <span className="cursor-help text-editor-muted text-[10px]">ⓘ</span>
            <div className="absolute left-0 top-full mt-2 hidden group-hover:block w-48 p-2 bg-editor-surface border border-editor-border rounded shadow-lg text-[10px] text-editor-text z-10 leading-relaxed">
              {t('settings.projectContextDescription')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs text-primary-500 hover:text-primary-600"
              onClick={() => setProjectContext('')}
            >
              {t('common.clear')}
            </button>
          </div>
        </div>
        <DebouncedTextarea
          key={`project-context-${settingsKey}`}
          className="w-full h-32 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
          value={projectContext}
          onDebouncedChange={setProjectContext}
          placeholder={t('settings.projectContextPlaceholder')}
        />
      </section>

      {/* Section 3: Glossary */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-editor-text">4. {t('settings.glossary')}</h3>
            <span className="text-[10px] text-editor-muted">
              {t('settings.glossaryColumns')}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-2 py-1 rounded text-xs bg-editor-surface border border-editor-border hover:bg-editor-border"
              onClick={() => {
                void (async () => {
                  if (!isTauriRuntime() || !project) return;
                  const path = await pickGlossaryCsvFile();
                  if (path) {
                    await importGlossaryCsv({ projectId: project.id, path, replaceProjectScope: false });
                    addGlossaryPath(path);
                  }
                })();
              }}
            >
              {t('settings.glossaryImportCsv')}
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded text-xs bg-editor-surface border border-editor-border hover:bg-editor-border"
              onClick={() => {
                void (async () => {
                  if (!isTauriRuntime() || !project) return;
                  const path = await pickGlossaryExcelFile();
                  if (path) {
                    await importGlossaryExcel({ projectId: project.id, path, replaceProjectScope: false });
                    addGlossaryPath(path);
                  }
                })();
              }}
            >
              {t('settings.glossaryImportExcel')}
            </button>
          </div>
        </div>

        {project?.metadata.glossaryPaths && project.metadata.glossaryPaths.length > 0 ? (
          <div className="p-2 rounded bg-editor-surface border border-editor-border">
            <div className="text-xs text-editor-muted">{t('settings.glossaryLinkedGlossaries')}</div>
            <ul className="mt-1 space-y-1">
              {project.metadata.glossaryPaths.map((p) => (
                <li key={p} className="text-xs text-editor-text truncate" title={p}>• {p}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="text-xs text-editor-muted italic p-2">{t('settings.glossaryNoFiles')}</div>
        )}
      </section>

      {/* Section 5: Attachments (4.2) */}
      <section className="space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-editor-text">5. {t('settings.attachments')}</h3>
            <span className="text-[10px] text-editor-muted whitespace-pre-line">
              {t('settings.attachmentsDescription')}
            </span>
          </div>
          <button
            type="button"
            className="px-2 py-1 rounded text-xs bg-primary-500 text-white hover:bg-primary-600 flex items-center gap-1 flex-shrink-0"
            onClick={() => {
              void (async () => {
                if (!isTauriRuntime() || !project) return;
                const path = await pickDocumentFile();
                if (path) {
                  await attachFile(path);
                }
              })();
            }}
          >
            <span>+</span>
            <span>{t('settings.attachmentsAttach')}</span>
          </button>
        </div>

        {attachments.length > 0 ? (
          <div className="space-y-1.5">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="group flex items-center justify-between p-2 rounded bg-editor-surface border border-editor-border hover:border-editor-text transition-colors"
                title={`${att.filename} (${att.fileType.toUpperCase()})`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs">
                    {att.fileType === 'pdf' ? '📄' : att.fileType === 'docx' ? '📝' : att.fileType === 'pptx' ? '📊' : '📄'}
                  </span>
                  <div className="min-w-0 flex flex-col">
                    <span className="text-[11px] text-editor-text font-medium truncate">
                      {att.filename}
                    </span>
                    {att.fileSize && (
                      <span className="text-[9px] text-editor-muted">
                        {(att.fileSize / 1024).toFixed(1)} KB
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-editor-muted hover:text-red-500 transition-opacity"
                  onClick={() => {
                    void (async () => {
                      const ok = await confirm(t('settings.attachmentsDeleteConfirm', { filename: att.filename }), {
                        title: t('settings.attachmentsDeleteTitle'),
                        kind: 'warning',
                      });
                      if (ok) {
                        await deleteAttachment(att.id);
                      }
                    })();
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-editor-muted italic p-2 border border-dashed border-editor-border rounded">
            {t('settings.attachmentsNoFiles')}
          </div>
        )}
      </section>
    </div>
  );

  // 5. Main Render
  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Session Tabs Header */}
      <div className="h-10 border-b border-editor-border flex items-center bg-editor-bg select-none">
        <div className="flex-1 flex items-center overflow-x-auto no-scrollbar">
          {/* Settings 탭은 항상 첫 번째 */}
          <div
            onClick={() => setActiveTab('settings')}
            className={`
              group relative h-10 px-3 flex items-center gap-2 text-xs font-medium cursor-pointer border-r border-editor-border min-w-[100px] max-w-[160px]
              ${activeTab === 'settings'
                ? 'bg-editor-surface text-primary-500 border-b-2 border-b-primary-500'
                : 'text-editor-muted hover:bg-editor-surface hover:text-editor-text'
              }
            `}
            title={t('chat.settings')}
          >
            <span className="truncate flex-1">{t('chat.settings')}</span>
          </div>

          {/* Review 탭 - 항상 표시 */}
          <div
            onClick={() => setActiveTab('review')}
            className={`
              group relative h-10 px-3 flex items-center gap-2 text-xs font-medium cursor-pointer border-r border-editor-border min-w-[80px] max-w-[120px]
              ${activeTab === 'review'
                ? 'bg-editor-surface text-primary-500 border-b-2 border-b-primary-500'
                : 'text-editor-muted hover:bg-editor-surface hover:text-editor-text'
              }
            `}
            title={t('review.title', '검수')}
          >
            <span className="truncate flex-1">{t('review.title', '검수')}</span>
          </div>

          {chatSessions.map((session) => (
            <div
              key={session.id}
              onClick={() => {
                useChatStore.getState().switchSession(session.id);
                setActiveTab('chat');
              }}
              className={`
                group relative h-10 px-3 flex items-center gap-2 text-xs font-medium cursor-pointer border-r border-editor-border min-w-[100px] max-w-[160px]
                ${activeTab === 'chat' && currentSession?.id === session.id
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

          {chatSessions.length < MAX_CHAT_SESSIONS && (
            <button
              onClick={() => {
                const id = useChatStore.getState().createSession();
                if (id) {
                  useChatStore.getState().switchSession(id);
                  setActiveTab('chat');
                }
              }}
              className="h-10 px-3 flex items-center justify-center text-editor-muted hover:text-primary-500 hover:bg-editor-surface transition-colors border-r border-editor-border"
              title={t('chat.newChat')}
            >
              +
            </button>
          )}
        </div>

        {/* Panel Controls */}
        <div className="flex items-center px-2 gap-1 border-l border-editor-border bg-editor-bg shrink-0">
          <button
            type="button"
            onClick={togglePanelSwap}
            className="p-1.5 rounded hover:bg-editor-border transition-colors text-editor-muted"
            title={isPanelsSwapped ? t('chat.moveToRight') : t('chat.moveToLeft')}
          >
            ⇄
          </button>
          <button
            type="button"
            onClick={toggleSidebar}
            className="p-1.5 rounded hover:bg-editor-border transition-colors text-editor-muted"
            title={t('chat.closePanel')}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 대화 길이 알림 */}
      {activeTab === 'chat' && shouldShowSummarySuggestion && (
        <div className="border-b border-editor-border bg-editor-surface/60 px-4 py-2 flex items-start justify-between gap-2 shrink-0">
          <div className="text-[11px] text-editor-muted leading-relaxed">
            {t('chat.longConversationNotice')}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="px-2 py-1 rounded text-[11px] bg-primary-500 text-white hover:bg-primary-600"
              onClick={() => void handleStartNewSession()}
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

      {activeTab === 'settings' ? (
        renderSettings()
      ) : activeTab === 'review' ? (
        <ReviewPanel />
      ) : (
        <>
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
          <form
            onSubmit={handleSubmit}
            className="p-4 border-t border-editor-border bg-editor-bg"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className={`relative rounded-2xl border bg-editor-surface shadow-sm transition-colors ${
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
                className="w-full min-h-[96px] max-h-[200px] px-4 pt-4 pb-12 rounded-2xl bg-transparent overflow-y-auto"
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

              {/* 하단 컨트롤 바: 좌측 +, 📎 / 우측 Send(화살표) */}
              <div className="absolute inset-x-0 bottom-0 px-3 pb-3 flex items-end justify-between pointer-events-none">
                <div className="pointer-events-auto flex items-center gap-1.5">
                  <div className="relative" data-ite-composer-menu-root>
                    <button
                      type="button"
                      className="w-9 h-9 rounded-full border border-editor-border bg-editor-bg text-editor-muted
                                 hover:bg-editor-border hover:text-editor-text transition-colors"
                      title={t('chat.composerOptions')}
                      aria-label={t('chat.composerOptionsAriaLabel')}
                      onClick={() => {
                        setComposerMenuOpen((v) => !v);
                      }}
                      disabled={isLoading}
                    >
                      +
                    </button>
                    {composerMenuOpen && (
                      <div
                        data-ite-composer-menu
                        className="absolute bottom-12 left-0 w-56 rounded-xl border border-editor-border bg-editor-surface shadow-lg overflow-hidden"
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
                            // Settings 탭으로 전환하여 Notion 연결 유도
                            setActiveTab('settings');
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
                    className="w-9 h-9 rounded-full border border-editor-border bg-editor-bg text-editor-muted
                               hover:bg-editor-border hover:text-editor-text transition-colors flex items-center justify-center"
                    title={t('chat.attachFile')}
                    aria-label={t('chat.attachFileAriaLabel')}
                    onClick={() => void handleAttachClick()}
                    disabled={isLoading}
                  >
                    <svg
                      className="w-4 h-4"
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
                  <select
                    className="h-9 px-2 text-[11px] rounded-full border border-editor-border bg-editor-bg text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={chatModel}
                    onChange={(e) => setChatModel(e.target.value)}
                    aria-label={t('chat.chatModelAriaLabel')}
                    title={t('chat.chatModelTitle')}
                    disabled={isLoading}
                  >
                    {enabledChatPresets.map((group) => (
                      <optgroup key={group.group} label={group.group}>
                        {group.items.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={isLoading || !composerText.trim()}
                    className="w-9 h-9 rounded-full bg-primary-500 text-white
                               hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed
                               transition-colors flex items-center justify-center"
                    title={t('chat.send')}
                    aria-label={t('chat.sendAriaLabel')}
                  >
                    <span className="text-base leading-none">↑</span>
                  </button>
                </div>
              </div>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
