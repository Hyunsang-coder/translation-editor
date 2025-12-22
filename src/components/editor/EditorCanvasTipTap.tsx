import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { SourceTipTapEditor, TargetTipTapEditor } from './TipTapEditor';
import { useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';

interface EditorCanvasProps {
  focusMode: boolean;
}

/**
 * TipTap 기반 에디터 캔버스
 * Notion 스타일의 리치 텍스트 편집 환경
 */
export function EditorCanvasTipTap({ focusMode }: EditorCanvasProps): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const sourceDocument = useProjectStore((s) => s.sourceDocument);
  const targetDocument = useProjectStore((s) => s.targetDocument);
  const setTargetDocument = useProjectStore((s) => s.setTargetDocument);

  const includeSourceInPayload = useChatStore((s) => s.includeSourceInPayload);
  const includeTargetInPayload = useChatStore((s) => s.includeTargetInPayload);
  const setIncludeSourceInPayload = useChatStore((s) => s.setIncludeSourceInPayload);
  const setIncludeTargetInPayload = useChatStore((s) => s.setIncludeTargetInPayload);
  const appendComposerText = useChatStore((s) => s.appendComposerText);
  const requestComposerFocus = useChatStore((s) => s.requestComposerFocus);

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setActivePanel = useUIStore((s) => s.setActivePanel);

  const targetEditorRef = useRef<Editor | null>(null);

  // Add to Chat 기능
  const handleAddToChat = useCallback(() => {
    if (!targetEditorRef.current) return;
    
    const { from, to } = targetEditorRef.current.state.selection;
    const selectedText = targetEditorRef.current.state.doc.textBetween(from, to, ' ').trim();
    
    if (!selectedText) return;

    if (sidebarCollapsed) toggleSidebar();
    setActivePanel('chat');
    appendComposerText(selectedText);
    requestComposerFocus();
  }, [sidebarCollapsed, toggleSidebar, setActivePanel, appendComposerText, requestComposerFocus]);

  // 키보드 단축키 처리
  const handleTargetEditorReady = useCallback((editor: Editor) => {
    targetEditorRef.current = editor;

    // Cmd+K: Add to Chat
    editor.view.dom.addEventListener('keydown', (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        handleAddToChat();
      }
    });
  }, [handleAddToChat]);

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center text-editor-muted">
        프로젝트를 불러오는 중...
      </div>
    );
  }

  return (
    <div className="flex-1 h-full flex flex-col min-w-0 bg-editor-surface">
      {/* Header */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-editor-border shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-editor-text tracking-wide">EDITOR</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-editor-muted">
          <label className="inline-flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSourceInPayload}
              onChange={(e) => setIncludeSourceInPayload(e.target.checked)}
              className="checkbox-sm"
            />
            <span>원문 컨텍스트에 포함</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeTargetInPayload}
              onChange={(e) => setIncludeTargetInPayload(e.target.checked)}
              className="checkbox-sm"
            />
            <span>번역문 컨텍스트에 포함</span>
          </label>
          <button
            type="button"
            onClick={handleAddToChat}
            className="px-2 py-1 text-xs rounded border border-editor-border hover:bg-editor-bg transition-colors"
            title="선택한 텍스트를 채팅에 추가 (Cmd+K)"
          >
            Add to Chat
          </button>
        </div>
      </div>

      {/* Editor Panels */}
      <div className="flex-1 flex min-h-0">
        {/* Source Panel */}
        {!focusMode && (
          <div className="flex-1 flex flex-col min-w-0 border-r border-editor-border">
            <div className="h-8 px-4 flex items-center justify-between bg-editor-bg border-b border-editor-border">
              <span className="text-[11px] font-bold text-editor-muted uppercase tracking-wider">
                SOURCE ({project.metadata.sourceLanguage})
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <SourceTipTapEditor
                content={sourceDocument || ''}
                className="h-full"
              />
            </div>
          </div>
        )}

        {/* Target Panel */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-8 px-4 flex items-center border-b border-editor-border bg-editor-bg">
            <span className="text-[11px] font-bold text-editor-muted uppercase tracking-wider">
              TRANSLATION ({project.metadata.targetLanguage})
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <TargetTipTapEditor
              content={targetDocument || ''}
              onChange={setTargetDocument}
              className="h-full"
              onEditorReady={handleTargetEditorReady}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

