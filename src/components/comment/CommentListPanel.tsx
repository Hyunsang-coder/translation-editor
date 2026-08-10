import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Trash2, NotebookPen } from 'lucide-react';
import { useCommentStore, type CommentField, type UserComment } from '@/stores/commentStore';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';
import { scrollToComment, removeCommentMark } from '@/editor/utils/commentNavigation';

/**
 * 인라인 코멘트 목록 패널 (Docking Sidebar의 'comments' 탭에서 렌더).
 *
 * - source/target 필드별로 그룹핑하여 표시.
 * - 항목 클릭 → 해당 필드 에디터에서 마크 위치로 스크롤.
 * - 해결 토글: LLM 주입 제외 대상 표시.
 * - 삭제: 에디터의 마크와 commentStore 항목을 함께 제거 후 영속.
 */
export function CommentListPanel(): JSX.Element {
  const { t } = useTranslation();
  const comments = useCommentStore((s) => s.comments);
  const resolveComment = useCommentStore((s) => s.resolveComment);
  const removeComment = useCommentStore((s) => s.removeComment);

  const grouped = useMemo(() => {
    const source = comments.filter((c) => c.field === 'source');
    const target = comments.filter((c) => c.field === 'target');
    return { source, target };
  }, [comments]);

  const editorFor = (field: CommentField) => {
    const { sourceEditor, targetEditor } = useEditorStore.getState();
    return field === 'source' ? sourceEditor : targetEditor;
  };

  const handleJump = (comment: UserComment): void => {
    const editor = editorFor(comment.field);
    if (editor) scrollToComment(editor, comment.id);
  };

  const handleDelete = (comment: UserComment): void => {
    const editor = editorFor(comment.field);
    if (editor) removeCommentMark(editor, comment.id);
    removeComment(comment.id);
    // 마크 제거가 onUpdate를 발동시키지만, 마크가 이미 고아인 경우 대비해 명시 저장
    void useProjectStore.getState().saveProject();
  };

  const handleToggleResolve = (comment: UserComment): void => {
    resolveComment(comment.id, !comment.resolved);
    void useProjectStore.getState().saveProject();
  };

  const renderGroup = (field: CommentField, items: UserComment[]): JSX.Element | null => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-1.5">
        <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-editor-muted">
          {field === 'source' ? t('editor.source') : t('editor.target')} ({items.length})
        </div>
        {items.map((comment) => (
          <div
            key={comment.id}
            className={`group rounded-md border border-editor-border bg-editor-surface p-2 transition-colors hover:border-primary-500/50 ${
              comment.resolved ? 'opacity-50' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => handleJump(comment)}
              className="block w-full text-left"
              title={t('comment.jumpTo', '에디터에서 위치 보기')}
            >
              <div className="mb-1 truncate text-[11px] italic text-editor-muted" title={comment.excerpt}>
                “{comment.excerpt}”
              </div>
              <div className={`text-xs text-editor-text ${comment.resolved ? 'line-through' : ''}`}>
                {comment.comment}
              </div>
            </button>
            <div className="mt-1.5 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => handleToggleResolve(comment)}
                className={`rounded p-1 hover:bg-editor-bg ${
                  comment.resolved ? 'text-diff-insertion' : 'text-editor-muted hover:text-diff-insertion'
                }`}
                title={comment.resolved ? t('comment.unresolve', '미해결로 표시') : t('comment.resolve', '해결로 표시')}
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(comment)}
                className="rounded p-1 text-editor-muted hover:bg-editor-bg hover:text-severity-critical"
                title={t('common.delete', '삭제')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor-bg">
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
        {comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <NotebookPen size={28} className="mb-3 text-editor-muted/50" />
            <p className="text-sm text-editor-muted">{t('comment.empty', '코멘트가 없습니다.')}</p>
            <p className="mt-1 text-xs text-editor-muted/70">
              {t('comment.emptyHint', '에디터에서 텍스트를 선택해 코멘트를 추가하세요.')}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {renderGroup('source', grouped.source)}
            {renderGroup('target', grouped.target)}
          </div>
        )}
      </div>
    </div>
  );
}
