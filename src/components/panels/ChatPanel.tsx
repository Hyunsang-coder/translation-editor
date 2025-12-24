import { useEffect, useRef, useCallback, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { pickGlossaryCsvFile, pickGlossaryExcelFile } from '@/tauri/dialog';
import { importGlossaryCsv, importGlossaryExcel } from '@/tauri/glossary';
import { isTauriRuntime } from '@/tauri/invoke';
import { confirm } from '@tauri-apps/plugin-dialog';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * AI 채팅 패널 컴포넌트
 * 멀티 세션 지원 채팅창
 */
export function ChatPanel(): JSX.Element {
  // 1. Hooks (Top-level)
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  const { currentSession, sendMessage, isLoading } = useChatStore();
  const chatSessions = useChatStore((s) => s.sessions); // Hoisted selector
  const isSummarizing = useChatStore((s) => s.isSummarizing);
  const summarySuggestionOpen = useChatStore((s) => s.summarySuggestionOpen);
  const summarySuggestionReason = useChatStore((s) => s.summarySuggestionReason);
  const dismissSummarySuggestion = useChatStore((s) => s.dismissSummarySuggestion);
  const generateActiveMemorySummary = useChatStore((s) => s.generateActiveMemorySummary);

  const composerText = useChatStore((s) => s.composerText);
  const setComposerText = useChatStore((s) => s.setComposerText);
  const focusNonce = useChatStore((s) => s.composerFocusNonce);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const systemPromptOverlay = useChatStore((s) => s.systemPromptOverlay);
  const setSystemPromptOverlay = useChatStore((s) => s.setSystemPromptOverlay);
  const translationRules = useChatStore((s) => s.translationRules);
  const setTranslationRules = useChatStore((s) => s.setTranslationRules);
  const activeMemory = useChatStore((s) => s.activeMemory);
  const setActiveMemory = useChatStore((s) => s.setActiveMemory);
  const [activeTab, setActiveTab] = useState<'settings' | 'chat'>('settings');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<string>('');

  // Settings Preview States
  const [previewSystemPrompt, setPreviewSystemPrompt] = useState(false);
  const [previewTranslationRules, setPreviewTranslationRules] = useState(false);
  const [previewActiveMemory, setPreviewActiveMemory] = useState(false);

  const isHydrating = useChatStore((s) => s.isHydrating);
  const project = useProjectStore((s) => s.project);
  const addGlossaryPath = useProjectStore((s) => s.addGlossaryPath);
  const hydrateForProject = useChatStore((s) => s.hydrateForProject);

  const editMessage = useChatStore((s) => s.editMessage);
  const replayMessage = useChatStore((s) => s.replayMessage);
  const appendToTranslationRules = useChatStore((s) => s.appendToTranslationRules);
  const appendToActiveMemory = useChatStore((s) => s.appendToActiveMemory);
  const deleteMessageFrom = useChatStore((s) => s.deleteMessageFrom);
  const createSession = useChatStore((s) => s.createSession);
  const updateMessage = useChatStore((s) => s.updateMessage);

  const isRuleLikeMessage = useCallback((text: string): boolean => {
    const t = text.trim();
    if (t.length < 12) return false;
    // 너무 긴 본문(예: 검수 리포트 전체)에는 기본적으로 노출을 줄임
    if (t.length > 1200) return false;

    const keywords = [
      '번역 규칙',
      '용어',
      '용어집',
      '표기',
      '표기법',
      '스타일',
      '톤',
      '문체',
      '금지어',
      '권장',
      '유지',
      '통일',
      '일관',
      '띄어쓰기',
      '존댓말',
      '반말',
      '하십시오',
      '해요체',
    ];

    const hit = keywords.some((k) => t.includes(k));
    const looksLikeRulesList = /\n-\s+/.test(t) || /\n\d+\.\s+/.test(t);
    const looksLikeDirective = /(하세요|하지 마세요|금지|유지하세요|통일하세요|권장)/.test(t);

    return hit && (looksLikeRulesList || looksLikeDirective || t.split('\n').length >= 2);
  }, []);

  // 2. Effects
  // 프로젝트 전환 시: 채팅(현재 세션 1개) + ChatPanel 설정을 DB에서 복원 + 탭 초기화
  useEffect(() => {
    void hydrateForProject(project?.id ?? null);
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
      inputRef.current?.focus();
    }, 100);
  }, [focusNonce]);

  // 기본 채팅 세션 1개는 자동 생성
  useEffect(() => {
    if (!project?.id) return;
    if (isHydrating) return; // 로드 중에는 자동 생성 대기 (데이터 유실 방지)
    if (chatSessions.length > 0) return;
    createSession('Chat 1');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, isHydrating, chatSessions.length]);

  // 3. Handlers
  const sendCurrent = useCallback(async (): Promise<void> => {
    if (!composerText.trim() || isLoading) return;

    const message = composerText.trim();
    setComposerText('');
    await sendMessage(message);
  }, [composerText, isLoading, sendMessage, setComposerText]);

  useEffect(() => {
    if (activeTab !== 'chat') return;
    if (sidebarCollapsed) return;
    inputRef.current?.focus();
  }, [activeTab, sidebarCollapsed]);

  const handleSubmit = useCallback(async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    await sendCurrent();
  }, [sendCurrent]);

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
    <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-editor-bg">
      {/* Section 1: System Prompt */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 group relative">
            <h3 className="text-xs font-semibold text-editor-text">1. System Prompt</h3>
            <span className="cursor-help text-editor-muted text-[10px]">ⓘ</span>
            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-editor-surface border border-editor-border rounded shadow-lg text-[10px] text-editor-text z-10 leading-relaxed">
              AI의 기본적인 페르소나와 번역 태도를 정의합니다. {`{언어}`} 변수를 사용할 수 있습니다.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`text-[10px] px-1.5 py-0.5 rounded border ${previewSystemPrompt ? 'bg-primary-500 text-white border-primary-500' : 'text-editor-muted border-editor-border hover:text-editor-text'}`}
              onClick={() => setPreviewSystemPrompt(!previewSystemPrompt)}
            >
              {previewSystemPrompt ? 'Edit' : 'Preview'}
            </button>
            <button
              type="button"
              className="text-xs text-primary-500 hover:text-primary-600"
              onClick={() =>
                setSystemPromptOverlay(
                  '당신은 경험많은 전문 번역가입니다. 원문의 내용을 {언어}로 자연스럽게 번역하세요.',
                )
              }
            >
              Reset
            </button>
          </div>
        </div>
        {previewSystemPrompt ? (
          <div className="w-full h-32 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text overflow-y-auto chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
              {systemPromptOverlay || '*No content*'}
            </ReactMarkdown>
          </div>
        ) : (
          <textarea
            className="w-full h-32 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
            value={systemPromptOverlay}
            onChange={(e) => setSystemPromptOverlay(e.target.value)}
            placeholder="Enter system prompt..."
          />
        )}
      </section>

      {/* Section 2: Translation Rules */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 group relative">
            <h3 className="text-xs font-semibold text-editor-text">2. Translation Rules</h3>
            <span className="cursor-help text-editor-muted text-[10px]">ⓘ</span>
            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-editor-surface border border-editor-border rounded shadow-lg text-[10px] text-editor-text z-10 leading-relaxed">
              모든 번역에 공통적으로 적용될 고정 규칙입니다. (예: "해요체 사용", "따옴표 유지" 등)
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`text-[10px] px-1.5 py-0.5 rounded border ${previewTranslationRules ? 'bg-primary-500 text-white border-primary-500' : 'text-editor-muted border-editor-border hover:text-editor-text'}`}
              onClick={() => setPreviewTranslationRules(!previewTranslationRules)}
            >
              {previewTranslationRules ? 'Edit' : 'Preview'}
            </button>
            <button
              type="button"
              className="text-xs text-primary-500 hover:text-primary-600"
              onClick={() => setTranslationRules('')}
            >
              Clear
            </button>
          </div>
        </div>
        {previewTranslationRules ? (
          <div className="w-full h-32 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text overflow-y-auto chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
              {translationRules || '*No rules defined*'}
            </ReactMarkdown>
          </div>
        ) : (
          <textarea
            className="w-full h-32 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
            value={translationRules}
            onChange={(e) => setTranslationRules(e.target.value)}
            placeholder="Enter translation rules..."
          />
        )}
      </section>

      {/* Section 3: Active Memory */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 group relative">
            <h3 className="text-xs font-semibold text-editor-text">3. Active Memory</h3>
            <span className="cursor-help text-editor-muted text-[10px]">ⓘ</span>
            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-editor-surface border border-editor-border rounded shadow-lg text-[10px] text-editor-text z-10 leading-relaxed">
              대화 중 발견된 일시적 규칙이나 컨텍스트를 저장합니다. AI가 자동으로 제안할 수 있습니다.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`text-[10px] px-1.5 py-0.5 rounded border ${previewActiveMemory ? 'bg-primary-500 text-white border-primary-500' : 'text-editor-muted border-editor-border hover:text-editor-text'}`}
              onClick={() => setPreviewActiveMemory(!previewActiveMemory)}
            >
              {previewActiveMemory ? 'Edit' : 'Preview'}
            </button>
            <button
              type="button"
              className="text-xs text-primary-500 hover:text-primary-600"
              onClick={() => setActiveMemory('')}
            >
              Clear
            </button>
          </div>
        </div>
        {previewActiveMemory ? (
          <div className="w-full h-32 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text overflow-y-auto chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
              {activeMemory || '*Memory is empty*'}
            </ReactMarkdown>
          </div>
        ) : (
          <textarea
            className="w-full h-32 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
            value={activeMemory}
            onChange={(e) => setActiveMemory(e.target.value)}
            placeholder="Enter active memory..."
          />
        )}
      </section>

      {/* Section 3: Glossary */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-editor-text">4. Glossary</h3>
            <span className="text-[10px] text-editor-muted">
              Columns: [Source] [Target] (Header required, case-insensitive)
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
              Import CSV
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
              Import Excel
            </button>
          </div>
        </div>

        {project?.metadata.glossaryPaths && project.metadata.glossaryPaths.length > 0 ? (
          <div className="p-2 rounded bg-editor-surface border border-editor-border">
            <div className="text-xs text-editor-muted">Linked Glossaries:</div>
            <ul className="mt-1 space-y-1">
              {project.metadata.glossaryPaths.map((p) => (
                <li key={p} className="text-xs text-editor-text truncate" title={p}>• {p}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="text-xs text-editor-muted italic p-2">No glossary files linked.</div>
        )}
      </section>
    </div>
  );

  // 5. Main Render
  return (
    <div className="h-full flex flex-col">
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
            title="Settings"
          >
            <span className="truncate flex-1">Settings</span>
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
                      const ok = await confirm('Delete this chat session?', { title: 'Delete Session', kind: 'warning' });
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

          <button
            onClick={() => {
              const id = useChatStore.getState().createSession();
              useChatStore.getState().switchSession(id);
              setActiveTab('chat');
            }}
            className="h-10 px-3 flex items-center justify-center text-editor-muted hover:text-primary-500 hover:bg-editor-surface transition-colors border-r border-editor-border"
            title="New Chat"
          >
            +
          </button>
        </div>

        {/* Panel Controls */}
        <div className="flex items-center px-2 gap-1 border-l border-editor-border bg-editor-bg shrink-0">
          <button
            type="button"
            onClick={toggleSidebar}
            className="p-1.5 rounded hover:bg-editor-border transition-colors text-editor-muted"
            title="Close Panel"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Smart Context Memory 제안 */}
      {activeTab === 'chat' && summarySuggestionOpen && (
        <div className="border-b border-editor-border bg-editor-surface/60 px-4 py-2 flex items-start justify-between gap-2 shrink-0">
          <div className="text-[11px] text-editor-muted leading-relaxed">
            {summarySuggestionReason}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="px-2 py-1 rounded text-[11px] bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60"
              disabled={isSummarizing}
              onClick={() => void generateActiveMemorySummary()}
            >
              {isSummarizing ? 'Summarizing...' : 'Summarize'}
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded text-[11px] bg-editor-bg text-editor-muted hover:bg-editor-border"
              onClick={dismissSummarySuggestion}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {activeTab === 'settings' ? (
        renderSettings()
      ) : (
        <>
          {/* 메시지 목록 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {currentSession?.messages.map((message) => (
              <div
                key={message.id}
                className={`chat-message ${message.role === 'user' ? 'chat-message-user' : 'chat-message-ai'
                  } ${streamingMessageId === message.id ? 'ring-1 ring-primary-300/70' : ''}`}
              >
                {/* Message toolbar */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {editingMessageId === message.id ? (
                      <div className="space-y-2">
                        <textarea
                          className="w-full min-h-[88px] text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-bg text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
                          value={editingDraft}
                          onChange={(e) => setEditingDraft(e.target.value)}
                          placeholder="Edit message..."
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="px-3 py-1.5 rounded-md text-xs border border-editor-border text-editor-muted hover:text-editor-text"
                            onClick={() => {
                              setEditingMessageId(null);
                              setEditingDraft('');
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="px-3 py-1.5 rounded-md text-xs bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60"
                            disabled={!editingDraft.trim()}
                            onClick={() => {
                              editMessage(message.id, editingDraft);
                              setEditingMessageId(null);
                              setEditingDraft('');
                              void replayMessage(message.id);
                            }}
                            title="Save (이후 대화는 삭제됩니다)"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm leading-relaxed chat-markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          skipHtml
                          urlTransform={defaultUrlTransform}
                          components={{
                            a: ({ node: _node, ...props }) => (
                              <a {...props} target="_blank" rel="noreferrer noopener" className="underline" />
                            ),
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>

                  {/* Edit/Delete (truncate) */}
                  {editingMessageId !== message.id && (
                    <div className="shrink-0 flex items-center gap-1">
                      {message.role === 'user' && (
                        <button
                          type="button"
                          className="px-2 py-1 rounded text-[11px] text-editor-muted hover:text-editor-text hover:bg-editor-border/60"
                          onClick={() => {
                            setEditingMessageId(message.id);
                            setEditingDraft(message.content);
                          }}
                          title="Edit (이후 대화는 삭제됩니다)"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        className="px-2 py-1 rounded text-[11px] text-editor-muted hover:text-red-600 hover:bg-editor-border/60"
                        onClick={() => {
                          const ok = window.confirm('이 메시지 이후의 대화가 모두 삭제됩니다. 계속할까요?');
                          if (!ok) return;
                          deleteMessageFrom(message.id);
                        }}
                        title="Delete (이후 대화는 삭제됩니다)"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-end justify-between gap-2 mt-1">
                  <span className="text-xs text-editor-muted">
                    {new Date(message.timestamp).toLocaleTimeString('ko-KR')}
                    {message.metadata?.editedAt && (
                      <span className="ml-1.5 group/edited relative inline-block cursor-help hover:text-editor-text transition-colors">
                        (edited)
                        <div className="absolute left-0 bottom-full mb-1.5 hidden group-hover/edited:block w-48 p-2 bg-editor-surface border border-editor-border rounded shadow-lg text-[10px] text-editor-text z-20 leading-relaxed overflow-hidden">
                          <div className="font-semibold mb-1 border-b border-editor-border pb-0.5">Original Content:</div>
                          <div className="line-clamp-6 italic opacity-80">{message.metadata.originalContent}</div>
                        </div>
                      </span>
                    )}
                  </span>
                </div>

                {/* Add to Rules / Memory */}
                {message.role === 'assistant' &&
                  streamingMessageId !== message.id &&
                  message.content.length >= 20 &&
                  !message.metadata?.rulesAdded &&
                  !message.metadata?.memoryAdded && (
                    <div className="mt-2 flex gap-2">
                      {isRuleLikeMessage(message.content) && (
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-md text-xs font-medium bg-editor-surface border border-editor-border hover:bg-editor-border transition-colors text-primary-500"
                          onClick={() => {
                            appendToTranslationRules(message.content);
                            updateMessage(message.id, { metadata: { rulesAdded: true } });
                          }}
                          title="이 내용을 Translation Rules에 추가"
                        >
                          Add to Rules
                        </button>
                      )}
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-md text-xs font-medium bg-editor-surface border border-editor-border hover:bg-editor-border transition-colors text-editor-text"
                        onClick={() => {
                          appendToActiveMemory(message.content);
                          updateMessage(message.id, { metadata: { memoryAdded: true } });
                        }}
                        title="이 내용을 Active Memory에 추가"
                      >
                        Add to Memory
                      </button>
                    </div>
                  )}
              </div>
            ))}

            {isLoading && !streamingMessageId && (
              <div className="chat-message chat-message-ai">
                <div className="flex items-center gap-2">
                  <span className="animate-pulse-soft">●</span>
                  <span className="text-sm text-editor-muted">Thinking...</span>
                </div>
              </div>
            )}
          </div>

          {/* 입력창 */}
          <form onSubmit={handleSubmit} className="p-4 border-t border-editor-border">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                placeholder="Type a message... (Cmd+L to send selection)"
                className="flex-1 px-4 py-2 rounded-lg bg-editor-bg border border-editor-border
                           text-editor-text placeholder-editor-muted
                           focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled={isLoading}
                data-ite-chat-composer
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendCurrent();
                  }
                }}
              />
              <button
                type="submit"
                disabled={isLoading || !composerText.trim()}
                className="px-4 py-2 bg-primary-500 text-white rounded-lg font-medium
                           hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors"
              >
                Send
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
