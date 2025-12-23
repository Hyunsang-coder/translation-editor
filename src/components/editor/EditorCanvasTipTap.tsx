import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { SourceTipTapEditor, TargetTipTapEditor } from './TipTapEditor';
import { TipTapMenuBar } from './TipTapMenuBar';
import { TranslatePreviewModal } from './TranslatePreviewModal';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { translateSourceDocToTargetDocJson } from '@/ai/translateDocument';

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
  const translationRules = useChatStore((s) => s.translationRules);
  const activeMemory = useChatStore((s) => s.activeMemory);

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setActivePanel = useUIStore((s) => s.setActivePanel);

  const sourceEditorRef = useRef<Editor | null>(null);
  const targetEditorRef = useRef<Editor | null>(null);
  const [sourceEditor, setSourceEditor] = useState<Editor | null>(null);
  const [targetEditor, setTargetEditor] = useState<Editor | null>(null);

  const [translatePreviewOpen, setTranslatePreviewOpen] = useState(false);
  const [translatePreviewDoc, setTranslatePreviewDoc] = useState<Record<string, unknown> | null>(null);
  const [translatePreviewError, setTranslatePreviewError] = useState<string | null>(null);
  const [translateLoading, setTranslateLoading] = useState(false);

  const [addToChatBubble, setAddToChatBubble] = useState<null | {
    top: number;
    left: number;
    text: string;
  }>(null);
  const selectionTimerRef = useRef<number | null>(null);
  const selectionTokenRef = useRef<number>(0);

  const clearSelectionTimer = (): void => {
    if (selectionTimerRef.current !== null) {
      window.clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = null;
    }
  };

  const scheduleAddToChatBubble = useCallback((editor: Editor) => {
    const { from, to } = editor.state.selection;
    if (from === to) {
      clearSelectionTimer();
      setAddToChatBubble(null);
      return;
    }

    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim();
    if (!selectedText) {
      clearSelectionTimer();
      setAddToChatBubble(null);
      return;
    }

    // 드래그 후 1초 정도 멈추면 버튼 표시
    clearSelectionTimer();
    setAddToChatBubble(null);
    const token = Date.now();
    selectionTokenRef.current = token;

    selectionTimerRef.current = window.setTimeout(() => {
      if (selectionTokenRef.current !== token) return;

      try {
        const coords = editor.view.coordsAtPos(to);
        const top = Math.max(8, coords.top - 36);
        const left = Math.min(window.innerWidth - 140, Math.max(8, coords.left));
        setAddToChatBubble({ top, left, text: selectedText });
      } catch {
        // ignore
      }
    }, 1000);
  }, []);

  const attachSelectionWatcher = useCallback((editor: Editor) => {
    // TipTap 이벤트로 selection 변화 감지
    const onSelection = (): void => scheduleAddToChatBubble(editor);
    const onBlur = (): void => {
      clearSelectionTimer();
      setAddToChatBubble(null);
    };

    editor.on('selectionUpdate', onSelection);
    editor.on('blur', onBlur);

    // 초기 상태 반영
    onSelection();

    return () => {
      editor.off('selectionUpdate', onSelection);
      editor.off('blur', onBlur);
    };
  }, [scheduleAddToChatBubble]);

  const openTranslatePreview = useCallback(async (): Promise<void> => {
    if (!project) return;
    if (!sourceEditorRef.current) {
      window.alert('Source 에디터가 아직 준비되지 않았습니다.');
      return;
    }

    // 옵션: 사용자가 원문 컨텍스트를 끈 경우엔 번역 버튼을 막는 게 UX적으로 안전합니다.
    if (includeSourceInPayload === false) {
      const ok = window.confirm(
        '현재 “원문 컨텍스트에 포함”이 꺼져 있습니다. 그래도 Source 전체 번역을 진행할까요?',
      );
      if (!ok) return;
    }

    setTranslatePreviewError(null);
    setTranslatePreviewDoc(null);
    setTranslatePreviewOpen(true);
    setTranslateLoading(true);

    try {
      const sourceDocJson = sourceEditorRef.current.getJSON() as Record<string, unknown>;
      const { doc } = await translateSourceDocToTargetDocJson({
        project,
        sourceDocJson,
        translationRules,
        activeMemory,
      });
      setTranslatePreviewDoc(doc);
    } catch (e) {
      setTranslatePreviewError(e instanceof Error ? e.message : '번역 생성에 실패했습니다.');
    } finally {
      setTranslateLoading(false);
    }
  }, [
    project,
    includeSourceInPayload,
    translationRules,
    activeMemory,
  ]);

  const applyTranslatePreview = useCallback((): void => {
    if (!translatePreviewDoc) return;
    if (!targetEditorRef.current) {
      window.alert('Translation 에디터가 아직 준비되지 않았습니다.');
      return;
    }

    // 문서 전체 덮어쓰기: 현재 내용이 있으면 한 번 확인
    const hasExisting = (targetDocument ?? '').trim().length > 0;
    if (hasExisting) {
      const ok = window.confirm(
        '번역문(Target)을 전체 덮어씁니다. 계속할까요?',
      );
      if (!ok) return;
    }

    targetEditorRef.current.commands.setContent(translatePreviewDoc);
    setTranslatePreviewOpen(false);
  }, [translatePreviewDoc, targetDocument]);

  // Source 에디터 준비 완료 콜백
  const handleSourceEditorReady = useCallback((editor: Editor) => {
    sourceEditorRef.current = editor;
    setSourceEditor(editor);
  }, []);

  // Target 에디터 준비 완료 콜백
  const handleTargetEditorReady = useCallback((editor: Editor) => {
    targetEditorRef.current = editor;
    setTargetEditor(editor);
  }, []);

  // Source/Target 중 포커스된 에디터의 selection watcher를 연결
  useEffect(() => {
    const cleaners: Array<() => void> = [];
    if (sourceEditor) cleaners.push(attachSelectionWatcher(sourceEditor));
    if (targetEditor) cleaners.push(attachSelectionWatcher(targetEditor));
    return () => {
      cleaners.forEach((fn) => fn());
      clearSelectionTimer();
    };
  }, [sourceEditor, targetEditor, attachSelectionWatcher]);

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
            <div className="min-h-0 flex-1 overflow-hidden">
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
          <div className="h-8 px-4 flex items-center justify-between border-b border-editor-border bg-editor-bg">
            <span className="text-[11px] font-bold text-editor-muted uppercase tracking-wider">
              TRANSLATION ({project.metadata.targetLanguage})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void openTranslatePreview()}
                className="px-2 py-1 text-[11px] rounded border border-editor-border hover:bg-editor-surface transition-colors disabled:opacity-60"
                disabled={translateLoading}
                title="Source 전체 번역 → Preview"
              >
                {translateLoading ? 'Translating…' : 'Translate'}
              </button>
            </div>
          </div>
          <TipTapMenuBar editor={targetEditor} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <TargetTipTapEditor
              content={targetDocument || ''}
              onChange={setTargetDocument}
              className="h-full"
              onEditorReady={handleTargetEditorReady}
            />
          </div>
        </div>
      </div>

      <TranslatePreviewModal
        open={translatePreviewOpen}
        title="번역 미리보기 (Source 전체 → Target 전체)"
        docJson={translatePreviewDoc}
        isLoading={translateLoading}
        error={translatePreviewError}
        onClose={() => {
          setTranslatePreviewOpen(false);
        }}
        onApply={applyTranslatePreview}
      />

      {/* TipTap Add to chat 버튼 (드래그 후 1초) */}
      {addToChatBubble && (
        <button
          type="button"
          style={{
            position: 'fixed',
            top: addToChatBubble.top,
            left: addToChatBubble.left,
            zIndex: 80,
          }}
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-editor-surface border border-editor-border hover:bg-editor-bg transition-colors shadow-sm"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const text = addToChatBubble.text.trim();
            if (!text) return;
            if (sidebarCollapsed) toggleSidebar();
            setActivePanel('chat');
            appendComposerText(text);
            requestComposerFocus();
            setAddToChatBubble(null);
          }}
          title="선택한 텍스트를 채팅 입력창에 추가"
        >
          Add to chat
        </button>
      )}
    </div>
  );
}

