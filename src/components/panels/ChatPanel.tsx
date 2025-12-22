import { useEffect, useRef, useCallback, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { pickGlossaryCsvFile, pickGlossaryExcelFile } from '@/tauri/dialog';
import { importGlossaryCsv, importGlossaryExcel } from '@/tauri/glossary';
import { isTauriRuntime } from '@/tauri/invoke';
import { confirm } from '@tauri-apps/plugin-dialog';

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
  const activeMemory = useChatStore((s) => s.activeMemory);
  const setActiveMemory = useChatStore((s) => s.setActiveMemory);

  const project = useProjectStore((s) => s.project);
  const addGlossaryPath = useProjectStore((s) => s.addGlossaryPath);
  const hydrateForProject = useChatStore((s) => s.hydrateForProject);

  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 2. Effects
  // 프로젝트 전환 시: 채팅(현재 세션 1개) + ChatPanel 설정을 DB에서 복원
  useEffect(() => {
    void hydrateForProject(project?.id ?? null);
  }, [project?.id, hydrateForProject]);

  useEffect(() => {
    if (sidebarCollapsed) return;
    // selection에서 Add to chat을 눌렀을 때 즉시 타이핑 가능하게 포커스
    inputRef.current?.focus();
  }, [focusNonce, sidebarCollapsed]);

  // 3. Handlers
  const handleSubmit = useCallback(async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!composerText.trim() || isLoading) return;

    const message = composerText.trim();
    setComposerText('');
    await sendMessage(message);
  }, [composerText, isLoading, sendMessage, setComposerText]);

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

  // Full-page Settings Interaction
  if (showPromptEditor) {
    return (
      <div className="h-full flex flex-col bg-editor-bg">
        {/* Settings Header */}
        <div className="h-12 border-b border-editor-border flex items-center justify-between px-4 shrink-0">
          <h2 className="text-sm font-medium text-editor-text">Settings</h2>
          <button
            type="button"
            onClick={() => setShowPromptEditor(false)}
            className="p-1 rounded hover:bg-editor-border transition-colors text-editor-muted"
            title="Close Settings"
          >
            ✕
          </button>
        </div>

        {/* Settings Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Section 1: System Prompt */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-editor-text">1. System Prompt</h3>
              <button
                type="button"
                className="text-xs text-primary-500 hover:text-primary-600"
                onClick={() => setSystemPromptOverlay('')}
              >
                Clear
              </button>
            </div>
            <textarea
              className="w-full h-32 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
              value={systemPromptOverlay}
              onChange={(e) => setSystemPromptOverlay(e.target.value)}
              placeholder="Enter system prompt..."
            />
          </section>

          {/* Section 2: Translation Rules (Active Memory) */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-editor-text">2. Translation Rules</h3>
              <button
                type="button"
                className="text-xs text-primary-500 hover:text-primary-600"
                onClick={() => setActiveMemory('')}
              >
                Clear
              </button>
            </div>
            <textarea
              className="w-full h-32 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
              value={activeMemory}
              onChange={(e) => setActiveMemory(e.target.value)}
              placeholder="Enter translation rules..."
            />
          </section>

          {/* Section 3: Glossary */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-editor-text">3. Glossary</h3>
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
      </div>
    );
  }

  // 5. Main Render
  return (
    <div className="h-full flex flex-col">
      {/* Session Tabs Header */}
      <div className="h-10 border-b border-editor-border flex items-center bg-editor-bg select-none">
        <div className="flex-1 flex items-center overflow-x-auto no-scrollbar">
          {chatSessions.map((session) => (
            <div
              key={session.id}
              onClick={() => useChatStore.getState().switchSession(session.id)}
              className={`
                group relative h-10 px-3 flex items-center gap-2 text-xs font-medium cursor-pointer border-r border-editor-border min-w-[100px] max-w-[160px]
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
            onClick={() => void useChatStore.getState().createSession()}
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
            onClick={() => setShowPromptEditor(true)}
            className="p-1.5 rounded hover:bg-editor-border transition-colors text-editor-muted"
            title="Settings"
          >
            ⚙️
          </button>
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
      {!showPromptEditor && summarySuggestionOpen && (
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

      {/* 메시지 목록 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {currentSession?.messages.map((message) => (
          <div
            key={message.id}
            className={`chat-message ${message.role === 'user' ? 'chat-message-user' : 'chat-message-ai'
              } ${streamingMessageId === message.id ? 'ring-1 ring-primary-300/70' : ''}`}
          >
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
            <span className="text-xs text-editor-muted mt-1 block">
              {new Date(message.timestamp).toLocaleTimeString('ko-KR')}
            </span>

            {/* Apply 버튼: apply 전용 응답(appliable)일 때만 노출 */}
            {message.role === 'assistant' && message.metadata?.appliable === true && (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary-500 text-white hover:bg-primary-600 transition-colors"
                  onClick={() => {
                    const clean = message.metadata?.cleanContent ?? message.content;
                    const meta = message.metadata ?? {};
                    const { targetDocument, openDocDiffPreview } = useProjectStore.getState();

                    let start = meta.selectionStartOffset;
                    let end = meta.selectionEndOffset;
                    const selText = meta.selectionText;

                    // --- Smart Match Strategy ---
                    // 1. If offsets are missing or seem invalid, try to find the selection text in the document.
                    if (
                      (typeof start !== 'number' || typeof end !== 'number') &&
                      selText
                    ) {
                      const foundIdx = targetDocument.indexOf(selText);
                      if (foundIdx >= 0) {
                        start = foundIdx;
                        end = foundIdx + selText.length;
                      }
                    } else if (
                      typeof start === 'number' && typeof end === 'number' &&
                      selText &&
                      targetDocument.slice(start, end) !== selText
                    ) {
                      // 2. Drift detection: content at offsets changed? Search globally.
                      const foundIdx = targetDocument.indexOf(selText);
                      if (foundIdx >= 0) {
                        start = foundIdx;
                        end = foundIdx + selText.length;
                      }
                    }

                    if (typeof start === 'number' && typeof end === 'number') {
                      openDocDiffPreview({
                        startOffset: start,
                        endOffset: end,
                        suggestedText: clean,
                        originMessageId: message.id,
                      });
                    } else {
                      window.alert('자동 적용할 위치를 찾을 수 없습니다. (원본 텍스트가 변경되었거나 선택되지 않음)');
                    }
                  }}
                  title="Apply translation to selected text"
                >
                  Apply
                </button>
              </div>
            )}

            {/* Apply 차단 사유 */}
            {message.role === 'assistant' &&
              message.metadata?.appliable === false &&
              message.metadata?.applyBlockedReason && (
                <div className="mt-2 text-[11px] text-red-600 dark:text-red-400 whitespace-pre-wrap">
                  {message.metadata.applyBlockedReason}
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
          <input
            type="text"
            ref={inputRef}
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            placeholder="Type a message... (Cmd+L to send selection)"
            className="flex-1 px-4 py-2 rounded-lg bg-editor-bg border border-editor-border
                       text-editor-text placeholder-editor-muted
                       focus:outline-none focus:ring-2 focus:ring-primary-500"
            disabled={isLoading}
            data-ite-chat-composer
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
    </div>
  );
}
