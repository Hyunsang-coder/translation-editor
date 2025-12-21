import { useEffect, useRef, useCallback, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { pickGlossaryCsvFile, pickGlossaryExcelFile } from '@/tauri/dialog';
import { importGlossaryCsv, importGlossaryExcel } from '@/tauri/glossary';

/**
 * AI 채팅 패널 컴포넌트
 * 멀티 세션 지원 채팅창
 */
export function ChatPanel(): JSX.Element {
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const selectedBlockId = useUIStore((s) => s.selectedBlockId);
  const { currentSession, sendMessage, isLoading } = useChatStore();
  const isSummarizing = useChatStore((s) => s.isSummarizing);
  const summarySuggestionOpen = useChatStore((s) => s.summarySuggestionOpen);
  const summarySuggestionReason = useChatStore((s) => s.summarySuggestionReason);
  const dismissSummarySuggestion = useChatStore((s) => s.dismissSummarySuggestion);
  const generateActiveMemorySummary = useChatStore((s) => s.generateActiveMemorySummary);
  const applySuggestionToBlock = useProjectStore((s) => s.applySuggestionToBlock);
  const openDocDiffPreview = useProjectStore((s) => s.openDocDiffPreview);
  const getBlock = useProjectStore((s) => s.getBlock);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const composerText = useChatStore((s) => s.composerText);
  const setComposerText = useChatStore((s) => s.setComposerText);
  const focusNonce = useChatStore((s) => s.composerFocusNonce);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const systemPromptOverlay = useChatStore((s) => s.systemPromptOverlay);
  const setSystemPromptOverlay = useChatStore((s) => s.setSystemPromptOverlay);
  const referenceNotes = useChatStore((s) => s.referenceNotes);
  const setReferenceNotes = useChatStore((s) => s.setReferenceNotes);
  const activeMemory = useChatStore((s) => s.activeMemory);
  const setActiveMemory = useChatStore((s) => s.setActiveMemory);
  const lastInjectedGlossary = useChatStore((s) => s.lastInjectedGlossary);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const project = useProjectStore((s) => s.project);
  const addGlossaryPath = useProjectStore((s) => s.addGlossaryPath);

  const handleSubmit = useCallback(async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!composerText.trim() || isLoading) return;

    const message = composerText.trim();
    setComposerText('');
    await sendMessage(message);
  }, [composerText, isLoading, sendMessage, setComposerText]);

  useEffect(() => {
    if (sidebarCollapsed) return;
    // selection에서 Add to chat을 눌렀을 때 즉시 타이핑 가능하게 포커스
    inputRef.current?.focus();
  }, [focusNonce, sidebarCollapsed]);

  // 사이드바 축소 상태
  if (sidebarCollapsed) {
    return (
      <div className="h-full flex flex-col items-center py-4">
        <button
          type="button"
          onClick={toggleSidebar}
          className="p-2 rounded-md hover:bg-editor-border transition-colors"
          title="채팅 패널 열기"
        >
          💬
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 */}
      <div className="h-12 border-b border-editor-border flex items-center justify-between px-4 gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-editor-text">AI Assistant</h2>
          <button
            type="button"
            onClick={() => setShowPromptEditor((prev) => !prev)}
            className={`px-2 py-1 rounded text-xs border ${
              showPromptEditor ? 'bg-primary-500 text-white border-primary-500' : 'bg-editor-bg text-editor-muted border-editor-border'
            }`}
            title="시스템 프롬프트 오버레이 편집"
          >
            System Prompt
          </button>
        </div>
        <button
          type="button"
          onClick={toggleSidebar}
          className="p-1 rounded hover:bg-editor-border transition-colors text-editor-muted"
          title="패널 축소"
        >
          ✕
        </button>
      </div>

      {/* Smart Context Memory 제안 (System Prompt 패널이 닫혀 있어도 노출) */}
      {!showPromptEditor && summarySuggestionOpen && (
        <div className="border-b border-editor-border bg-editor-surface/60 px-4 py-2 flex items-start justify-between gap-2">
          <div className="text-[11px] text-editor-muted leading-relaxed">
            {summarySuggestionReason}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="px-2 py-1 rounded text-[11px] bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60"
              disabled={isSummarizing}
              onClick={() => void generateActiveMemorySummary()}
              title="대화에서 확정된 용어/톤 규칙을 요약해 Active Memory로 저장"
            >
              {isSummarizing ? '요약 중…' : '요약 생성'}
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded text-[11px] bg-editor-bg text-editor-muted hover:bg-editor-border"
              onClick={dismissSummarySuggestion}
              title="닫기"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {showPromptEditor && (
        <div className="border-b border-editor-border bg-editor-surface/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-editor-muted">시스템 프롬프트 오버레이(프로젝트 지침/톤)</p>
            <button
              type="button"
              className="text-xs text-primary-500 hover:text-primary-600"
              onClick={() => setSystemPromptOverlay('')}
              title="초기화"
            >
              초기화
            </button>
          </div>
          <textarea
            className="w-full h-20 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-bg text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
            value={systemPromptOverlay}
            onChange={(e) => setSystemPromptOverlay(e.target.value)}
            placeholder="예: 용어집의 고유명사는 원문 표기 유지, 문체는 반말 금지 등"
          />
          <p className="text-[11px] text-editor-muted">
            TRD 3.2: 프로젝트 메타 + 사용자 지침을 시스템 프롬프트에 함께 반영합니다.
          </p>
          <div className="h-px bg-editor-border" />
          <div className="flex items-center justify-between">
            <p className="text-xs text-editor-muted">참조문서/용어집 메모(모델에 그대로 전달)</p>
            <button
              type="button"
              className="text-xs text-primary-500 hover:text-primary-600"
              onClick={() => setReferenceNotes('')}
              title="초기화"
            >
              초기화
            </button>
          </div>
          <textarea
            className="w-full h-20 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-bg text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
            value={referenceNotes}
            onChange={(e) => setReferenceNotes(e.target.value)}
            placeholder="예: glossary: {user}=플레이어 이름 유지, <br>은 줄바꿈 그대로 유지"
          />
          <p className="text-[11px] text-editor-muted">
            참고 메모는 시스템 메시지와 함께 모델로 전달됩니다.
          </p>

          <div className="h-px bg-editor-border" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-editor-muted">로컬 글로서리(CSV) — 프로젝트 DB 임포트</p>
              <p className="text-[11px] text-editor-muted">
                TRD 5.2: 모델 호출(send/edit) 시에만 관련 용어를 자동 주입합니다(비벡터).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-2 py-1 rounded text-[11px] bg-editor-bg text-editor-muted hover:bg-editor-border"
                onClick={() => {
                  void (async () => {
                    if (!project) {
                      window.alert('프로젝트가 로드되지 않았습니다.');
                      return;
                    }
                    const path = await pickGlossaryCsvFile();
                    if (!path) return;
                    try {
                      const res = await importGlossaryCsv({
                        projectId: project.id,
                        path,
                        replaceProjectScope: false,
                      });
                      addGlossaryPath(path);
                      window.alert(
                        `글로서리 임포트 완료\n- inserted: ${res.inserted}\n- updated: ${res.updated}\n- skipped: ${res.skipped}`,
                      );
                    } catch (e) {
                      window.alert(e instanceof Error ? e.message : '글로서리 임포트 실패');
                    }
                  })();
                }}
                title="CSV 파일을 프로젝트 DB(glossary_entries)에 임포트"
              >
                CSV 가져오기
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded text-[11px] bg-editor-bg text-editor-muted hover:bg-editor-border"
                onClick={() => {
                  void (async () => {
                    if (!project) {
                      window.alert('프로젝트가 로드되지 않았습니다.');
                      return;
                    }
                    const path = await pickGlossaryExcelFile();
                    if (!path) return;
                    try {
                      const res = await importGlossaryExcel({
                        projectId: project.id,
                        path,
                        replaceProjectScope: false,
                      });
                      addGlossaryPath(path);
                      window.alert(
                        `글로서리 임포트 완료\n- inserted: ${res.inserted}\n- updated: ${res.updated}\n- skipped: ${res.skipped}`,
                      );
                    } catch (e) {
                      window.alert(e instanceof Error ? e.message : '글로서리 임포트 실패');
                    }
                  })();
                }}
                title="Excel(.xlsx/.xls) 파일을 프로젝트 DB(glossary_entries)에 임포트"
              >
                Excel 가져오기
              </button>
            </div>
          </div>

          {project?.metadata.glossaryPaths && project.metadata.glossaryPaths.length > 0 && (
            <div className="text-[11px] text-editor-muted">
              현재 연결된 CSV:
              <div className="mt-1 space-y-1">
                {project.metadata.glossaryPaths.slice(0, 3).map((p) => (
                  <div key={p} className="truncate" title={p}>
                    - {p}
                  </div>
                ))}
                {project.metadata.glossaryPaths.length > 3 && (
                  <div className="text-[11px] text-editor-muted">
                    …외 {project.metadata.glossaryPaths.length - 3}개
                  </div>
                )}
              </div>
            </div>
          )}

          {lastInjectedGlossary.length > 0 && (
            <div className="rounded-md border border-editor-border bg-editor-bg p-2">
              <div className="text-[11px] text-editor-muted mb-1">
                이번 요청에서 주입된 용어({lastInjectedGlossary.length})
              </div>
              <div className="space-y-1">
                {lastInjectedGlossary.slice(0, 8).map((e) => (
                  <div key={e.id} className="text-[11px] text-editor-text">
                    - <span className="font-medium">{e.source}</span> → {e.target}
                    {e.notes ? <span className="text-editor-muted"> ({e.notes})</span> : null}
                  </div>
                ))}
                {lastInjectedGlossary.length > 8 && (
                  <div className="text-[11px] text-editor-muted">
                    …외 {lastInjectedGlossary.length - 8}개
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="h-px bg-editor-border" />
          <div className="flex items-center justify-between">
            <p className="text-xs text-editor-muted">Active Memory(용어/톤 규칙 요약)</p>
            <button
              type="button"
              className="text-xs text-primary-500 hover:text-primary-600"
              onClick={() => setActiveMemory('')}
              title="초기화"
            >
              초기화
            </button>
          </div>
          <textarea
            className="w-full h-16 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-bg text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
            value={activeMemory}
            onChange={(e) => setActiveMemory(e.target.value)}
            placeholder="예: 고유명사 표기 규칙, 존칭/말투, 포맷 지침 등"
          />
          <p className="text-[11px] text-editor-muted">
            요약된 톤/용어 규칙을 모델에 주입합니다(길이 제한 1200자).
          </p>

          {summarySuggestionOpen && (
            <div className="mt-2 rounded-md border border-editor-border bg-editor-bg p-2 flex items-start justify-between gap-2">
              <div className="text-[11px] text-editor-muted leading-relaxed">
                {summarySuggestionReason}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  className="px-2 py-1 rounded text-[11px] bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60"
                  disabled={isSummarizing}
                  onClick={() => void generateActiveMemorySummary()}
                  title="대화에서 확정된 용어/톤 규칙을 요약해 Active Memory로 저장"
                >
                  {isSummarizing ? '요약 중…' : '요약 생성'}
                </button>
                <button
                  type="button"
                  className="px-2 py-1 rounded text-[11px] bg-editor-surface text-editor-muted hover:bg-editor-border"
                  onClick={dismissSummarySuggestion}
                  title="닫기"
                >
                  닫기
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 메시지 목록 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {currentSession?.messages.map((message) => (
          <div
            key={message.id}
            className={`chat-message ${
              message.role === 'user' ? 'chat-message-user' : 'chat-message-ai'
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
                    // 신규: Target 단일 문서(selection offset 기반) → DiffPreview
                    const start = message.metadata?.selectionStartOffset;
                    const end = message.metadata?.selectionEndOffset;
                    if (typeof start === 'number' && typeof end === 'number') {
                      openDocDiffPreview({
                        startOffset: start,
                        endOffset: end,
                        suggestedText: message.content,
                        originMessageId: message.id,
                      });
                      return;
                    }

                    // 레거시: block 기반 Apply (프로토타입 유지)
                    const candidate =
                      message.metadata?.suggestedBlockId ?? selectedBlockId ?? null;
                    if (!candidate) {
                      window.alert('적용할 블록이 선택되지 않았습니다. 번역 블록을 클릭한 뒤 다시 시도하세요.');
                      return;
                    }
                    const block = getBlock(candidate);
                    if (!block || block.type !== 'target') {
                      window.alert('번역(Target) 블록을 선택한 뒤 Apply 해주세요.');
                      return;
                    }
                    applySuggestionToBlock(
                      candidate,
                      message.content,
                      message.metadata?.selectionText,
                    );
                  }}
                  title="AI 제안 내용을 현재 선택된 번역 블록에 적용( Diff 표시 )"
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
              <span className="text-sm text-editor-muted">생각 중...</span>
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
            placeholder="메시지를 입력하세요... (Cmd+L로 텍스트 전송)"
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
            전송
          </button>
        </div>
      </form>
    </div>
  );
}

