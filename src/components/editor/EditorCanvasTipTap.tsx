import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { SourceTipTapEditor, TargetTipTapEditor } from './TipTapEditor';
import { TipTapMenuBar } from './TipTapMenuBar';
import { useCallback, useRef, useState } from 'react';
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
  const setSourceDocument = useProjectStore((s) => s.setSourceDocument);
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

  const sourceEditorRef = useRef<Editor | null>(null);
  const targetEditorRef = useRef<Editor | null>(null);
  const [sourceEditor, setSourceEditor] = useState<Editor | null>(null);
  const [targetEditor, setTargetEditor] = useState<Editor | null>(null);

  // 선택된 텍스트를 채팅창에 복사하는 함수
  const copySelectionToChat = useCallback((editor: Editor) => {
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim();
    
    if (!selectedText) return;

    if (sidebarCollapsed) toggleSidebar();
    setActivePanel('chat');
    appendComposerText(selectedText);
    requestComposerFocus();
  }, [sidebarCollapsed, toggleSidebar, setActivePanel, appendComposerText, requestComposerFocus]);

  // Source 에디터 준비 완료 콜백
  const handleSourceEditorReady = useCallback((editor: Editor) => {
    sourceEditorRef.current = editor;
    setSourceEditor(editor);

    // 우클릭 이벤트 핸들러 추가
    const handleContextMenu = (e: MouseEvent) => {
      const { from, to } = editor.state.selection;
      if (from === to) {
        // 선택된 텍스트가 없으면 기본 동작 수행
        return;
      }

      e.preventDefault();
      copySelectionToChat(editor);
    };

    editor.view.dom.addEventListener('contextmenu', handleContextMenu);

    // 클린업 함수는 에디터가 언마운트될 때 자동으로 처리됨
    // (TipTap이 내부적으로 관리)
  }, [copySelectionToChat]);

  // Target 에디터 준비 완료 콜백
  const handleTargetEditorReady = useCallback((editor: Editor) => {
    targetEditorRef.current = editor;
    setTargetEditor(editor);

    // 우클릭 이벤트 핸들러 추가
    const handleContextMenu = (e: MouseEvent) => {
      const { from, to } = editor.state.selection;
      if (from === to) {
        // 선택된 텍스트가 없으면 기본 동작 수행
        return;
      }

      e.preventDefault();
      copySelectionToChat(editor);
    };

    editor.view.dom.addEventListener('contextmenu', handleContextMenu);
  }, [copySelectionToChat]);

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
            <TipTapMenuBar editor={sourceEditor} />
            <div className="min-h-0 flex-1 overflow-auto">
              <SourceTipTapEditor
                content={sourceDocument || ''}
                onChange={setSourceDocument}
                className="h-full"
                onEditorReady={handleSourceEditorReady}
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
          <TipTapMenuBar editor={targetEditor} />
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

