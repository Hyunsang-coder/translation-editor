import { memo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { confirm } from '@tauri-apps/plugin-dialog';
import type { ChatMessage, ChatMessageMetadata } from '@/types';
import { MemoizedMarkdown } from './MemoizedMarkdown';
import { SkeletonParagraph } from '@/components/ui/Skeleton';
import { useUIStore } from '@/stores/uiStore';

/**
 * LLM 응답에서 발생하는 불필요한 인용 마커(citation artifacts)를 제거합니다.
 */
function cleanCitationArtifacts(content: string): string {
  if (!content) return '';
  return content
    .replace(/([\uE000-\uF8FF]*(?:cite|turn\d+search\d+)[\uE000-\uF8FF]*)+/g, '')
    .replace(/[\uE000-\uF8FF]/g, '');
}

interface ChatMessageItemProps {
  message: ChatMessage;
  isStreaming: boolean;
  streamingContent: string | null;
  streamingMetadata: ChatMessage['metadata'] | null;
  showStreamingSkeleton: boolean;
  statusMessage: string | null;
  onEdit: (messageId: string, content: string) => void;
  onReplay: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onAppendToRules: (content: string) => void;
  onAppendToContext: (content: string) => void;
  onUpdateMessageMetadata: (messageId: string, metadata: Partial<ChatMessageMetadata>) => void;
}

/**
 * 개별 채팅 메시지 컴포넌트 (메모이제이션 적용)
 */
export const ChatMessageItem = memo(function ChatMessageItem({
  message,
  isStreaming,
  streamingContent,
  streamingMetadata,
  showStreamingSkeleton,
  statusMessage,
  onEdit,
  onReplay,
  onDelete,
  onAppendToRules,
  onAppendToContext,
  onUpdateMessageMetadata,
}: ChatMessageItemProps) {
  const { t } = useTranslation();
  const addToast = useUIStore((s) => s.addToast);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');

  // 스트리밍 중인 메시지이면 streamingContent/streamingMetadata 사용
  const displayContent = isStreaming && streamingContent !== null
    ? streamingContent
    : message.content;
  const displayMetadata = isStreaming && streamingMetadata
    ? streamingMetadata
    : message.metadata;

  const handleStartEdit = useCallback(() => {
    setIsEditing(true);
    setEditDraft(cleanCitationArtifacts(message.content));
  }, [message.content]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditDraft('');
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editDraft.trim()) {
      onEdit(message.id, editDraft);
      setIsEditing(false);
      setEditDraft('');
      onReplay(message.id);
    }
  }, [editDraft, message.id, onEdit, onReplay]);

  const handleDelete = useCallback(async () => {
    const ok = await confirm('이 메시지 이후의 대화가 모두 삭제됩니다. 계속할까요?', {
      title: '대화 삭제',
      kind: 'warning',
    });
    if (ok) {
      onDelete(message.id);
    }
  }, [message.id, onDelete]);

  const handleCopy = useCallback(async () => {
    try {
      const content = cleanCitationArtifacts(message.content);
      await navigator.clipboard.writeText(content);
      addToast({ type: 'success', message: t('common.copied', '클립보드에 복사되었습니다.') });
    } catch {
      addToast({ type: 'error', message: t('common.copyError', '복사에 실패했습니다.') });
    }
  }, [message.content, addToast, t]);

  const handleReplayMessage = useCallback(() => {
    onReplay(message.id);
  }, [message.id, onReplay]);

  const renderToolCallingBadge = useCallback((toolNames: string[]): JSX.Element | null => {
    const tools = toolNames.filter(Boolean);
    if (tools.length === 0) return null;
    const humanize = (t: string): string => {
      switch (t) {
        case 'web_search':
        case 'web_search_preview':
          return '웹검색';
        case 'get_source_document':
          return '원문 조회';
        case 'get_target_document':
          return '번역문 조회';
        case 'suggest_translation_rule':
          return '규칙 제안';
        case 'suggest_project_context':
          return '컨텍스트 제안';
        default:
          return t;
      }
    };

    const label =
      tools.length === 1 ? humanize(tools[0]!) : `${humanize(tools[0]!)} 외 ${tools.length - 1}개`;
    return (
      <div className="mt-2">
        <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full border border-editor-border bg-editor-bg text-[11px] text-editor-muted max-w-full">
          <span className="inline-block w-3 h-3 border-2 border-editor-border border-t-primary-500 rounded-full animate-spin" />
          <span className="truncate">툴 실행 중: {label}</span>
        </div>
      </div>
    );
  }, []);

  const renderToolsUsedBadge = useCallback((toolNames: string[]): JSX.Element | null => {
    const tools = toolNames.filter(Boolean);
    if (tools.length === 0) return null;
    const humanize = (t: string): string => {
      switch (t) {
        case 'web_search':
        case 'web_search_preview':
          return '웹검색';
        case 'get_source_document':
          return '원문 조회';
        case 'get_target_document':
          return '번역문 조회';
        case 'suggest_translation_rule':
          return '규칙 제안';
        case 'suggest_project_context':
          return '컨텍스트 제안';
        default:
          return t;
      }
    };
    const label =
      tools.length === 1 ? humanize(tools[0]!) : `${humanize(tools[0]!)} 외 ${tools.length - 1}개`;
    return (
      <div className="mt-2">
        <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full border border-editor-border bg-editor-bg text-[11px] text-editor-muted max-w-full">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary-500" />
          <span className="truncate">도구 사용됨: {label}</span>
        </div>
      </div>
    );
  }, []);

  const renderAssistantSkeleton = useCallback((toolsInProgress?: string[]): JSX.Element => {
    let statusText = statusMessage;

    if (!statusText && toolsInProgress && toolsInProgress.length > 0) {
      const toolName = toolsInProgress[0];
      const name =
          (toolName === 'web_search' || toolName === 'web_search_preview') ? '웹 검색'
        : toolName === 'get_source_document' ? '원문 분석'
        : toolName === 'get_target_document' ? '번역문 분석'
        : toolName === 'suggest_translation_rule' ? '번역 규칙 확인'
        : toolName === 'suggest_project_context' ? '프로젝트 맥락 확인'
        : toolName;
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

  return (
    <div
      className={`chat-message group ${message.role === 'user' ? 'chat-message-user' : 'chat-message-ai'
        } ${isStreaming ? 'ring-1 ring-primary-300/70' : ''}`}
    >
      {/* Message toolbar */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                className="w-full min-h-[88px] text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-bg text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveEdit();
                  }
                }}
                placeholder={t('chat.editMessagePlaceholder')}
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-md text-xs border border-editor-border text-editor-muted hover:text-editor-text"
                  onClick={handleCancelEdit}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-md text-xs bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60"
                  disabled={!editDraft.trim()}
                  onClick={handleSaveEdit}
                  title={t('chat.saveAfterEdit')}
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* 스트리밍 중이고 콘텐츠가 비어있으면 스켈레톤 표시 */}
              {isStreaming && (!displayContent || displayContent.trim().length === 0) ? (
                <div className="text-sm leading-relaxed">
                  {showStreamingSkeleton && renderAssistantSkeleton(displayMetadata?.toolCallsInProgress)}
                </div>
              ) : (
                <>
                  {isStreaming ? (
                    // 스트리밍 중: 단순 텍스트 렌더링 (성능 최적화)
                    <div className="text-sm leading-relaxed chat-markdown whitespace-pre-wrap">
                      {cleanCitationArtifacts(displayContent)}
                    </div>
                  ) : (
                    // 스트리밍 완료: Markdown 렌더링
                    <div className="text-sm leading-relaxed chat-markdown">
                      <MemoizedMarkdown content={displayContent} />
                    </div>
                  )}
                  {message.role === 'assistant' &&
                    !!displayMetadata?.toolCallsInProgress?.length &&
                    renderToolCallingBadge(displayMetadata.toolCallsInProgress)}
                  {message.role === 'assistant' &&
                    !!displayMetadata?.toolsUsed?.length &&
                    renderToolsUsedBadge(displayMetadata.toolsUsed)}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Timestamp + Action Icons */}
      <div className="flex items-center gap-2 mt-1">
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

        {/* Action icons - 호버 시에만 표시 */}
        {!isEditing && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* 재전송 (user only) */}
            {message.role === 'user' && (
              <button
                type="button"
                onClick={handleReplayMessage}
                className="p-1 rounded text-editor-muted hover:text-editor-text hover:bg-editor-border/60 transition-colors"
                title={t('chat.replay', '재전송')}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
            {/* 편집 (user only) */}
            {message.role === 'user' && (
              <button
                type="button"
                onClick={handleStartEdit}
                className="p-1 rounded text-editor-muted hover:text-editor-text hover:bg-editor-border/60 transition-colors"
                title={t('chat.editAfterEdit', '편집')}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
            {/* 복사 (all messages) */}
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="p-1 rounded text-editor-muted hover:text-editor-text hover:bg-editor-border/60 transition-colors"
              title={t('common.copy', '복사')}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            {/* 삭제 (all messages) */}
            <button
              type="button"
              onClick={() => void handleDelete()}
              className="p-1 rounded text-editor-muted hover:text-red-600 hover:bg-editor-border/60 transition-colors"
              title={t('chat.deleteAfterEdit', '삭제')}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Add to Rules / Context buttons */}
      {message.role === 'assistant' &&
        !isStreaming &&
        message.metadata?.suggestion && (
          <div className="mt-2">
            {/* 제안 내용 미리보기 */}
            {!message.metadata.rulesAdded && !message.metadata.contextAdded && (
              <div className="mb-2 p-2.5 rounded bg-editor-bg border border-editor-border">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-1 h-3 bg-primary-500 rounded-full" />
                  <span className="text-[10px] font-bold text-editor-muted uppercase tracking-wider">
                    {message.metadata.suggestion.type === 'rule' ? 'Suggested Rule' :
                     message.metadata.suggestion.type === 'context' ? 'Suggested Context' :
                     'Suggested Rule / Context'}
                  </span>
                </div>
                <div className="text-xs text-editor-text font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto scrollbar-thin">
                  {message.metadata.suggestion.content}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {(message.metadata.suggestion.type === 'rule' || message.metadata.suggestion.type === 'both') && !message.metadata.rulesAdded && (
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-editor-surface border border-editor-border hover:bg-editor-border transition-colors text-primary-500"
                  onClick={() => {
                    if (message.metadata?.suggestion?.content) {
                      onAppendToRules(message.metadata.suggestion.content);
                      onUpdateMessageMetadata(message.id, { rulesAdded: true });
                    }
                  }}
                  title={t('chat.addToRules')}
                >
                  Add to Rules
                </button>
              )}
              {(message.metadata.suggestion.type === 'context' || message.metadata.suggestion.type === 'both') &&
                !message.metadata.contextAdded && (
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-editor-surface border border-editor-border hover:bg-editor-border transition-colors text-editor-text"
                    onClick={() => {
                      if (message.metadata?.suggestion?.content) {
                        onAppendToContext(message.metadata.suggestion.content);
                        onUpdateMessageMetadata(message.id, { contextAdded: true });
                      }
                    }}
                    title={t('chat.addToContext')}
                  >
                    Add to Context
                  </button>
                )}
            </div>
          </div>
        )}
    </div>
  );
}, (prev, next) => {
  // 커스텀 비교: 실제 변경된 경우에만 리렌더링
  if (prev.isStreaming !== next.isStreaming) return false;
  if (prev.isStreaming && next.isStreaming) {
    // 스트리밍 중인 메시지: streamingContent와 streamingMetadata 비교
    if (prev.streamingContent !== next.streamingContent) return false;
    if (prev.streamingMetadata !== next.streamingMetadata) return false;
    if (prev.showStreamingSkeleton !== next.showStreamingSkeleton) return false;
    if (prev.statusMessage !== next.statusMessage) return false;
  }
  // 메시지 내용 비교
  if (prev.message.content !== next.message.content) return false;
  if (prev.message.metadata?.toolCallsInProgress !== next.message.metadata?.toolCallsInProgress) return false;
  if (prev.message.metadata?.toolsUsed !== next.message.metadata?.toolsUsed) return false;
  if (prev.message.metadata?.suggestion !== next.message.metadata?.suggestion) return false;
  if (prev.message.metadata?.rulesAdded !== next.message.metadata?.rulesAdded) return false;
  if (prev.message.metadata?.contextAdded !== next.message.metadata?.contextAdded) return false;
  return true;
});
