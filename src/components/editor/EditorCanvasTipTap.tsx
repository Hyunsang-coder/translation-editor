import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { SourceTipTapEditor, TargetTipTapEditor } from './TipTapEditor';
import { TipTapMenuBar } from './TipTapMenuBar';
import { TranslatePreviewModal } from './TranslatePreviewModal';
import { useCallback, useRef, useState } from 'react';
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
  const chatSessions = useChatStore((s) => s.sessions);
  const currentChatSessionId = useChatStore((s) => s.currentSessionId);
  const translationContextSessionId = useChatStore((s) => s.translationContextSessionId);
  const setTranslationContextSessionId = useChatStore((s) => s.setTranslationContextSessionId);

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
      // Translate 버튼을 누르는 “그 순간”의 활성 채팅 탭(currentSession) 기준 최신 10개를 사용합니다.
      // (탭이 여러 개일 수 있으므로, 기본값은 “현재 선택된 탭”이 가장 예측 가능합니다.)
      const chosenId = useChatStore.getState().translationContextSessionId;
      const state = useChatStore.getState();
      const session =
        chosenId
          ? state.sessions.find((s) => s.id === chosenId) ?? state.currentSession
          : state.currentSession;
      const history = session?.messages ?? [];
      const recentChatMessages = history.slice(Math.max(0, history.length - 10));
      const { doc } = await translateSourceDocToTargetDocJson({
        project,
        sourceDocJson,
        recentChatMessages,
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
              <select
                className="h-6 px-2 text-[11px] rounded border border-editor-border bg-editor-bg text-editor-text"
                value={translationContextSessionId ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setTranslationContextSessionId(v ? v : null);
                }}
                title="번역 컨텍스트로 사용할 채팅 탭"
              >
                <option value="">
                  현재 탭{currentChatSessionId ? '' : ' (없음)'}
                </option>
                {chatSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

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
    </div>
  );
}

