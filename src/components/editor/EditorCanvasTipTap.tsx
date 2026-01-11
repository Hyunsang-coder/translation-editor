import { useTranslation } from 'react-i18next';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { SourceTipTapEditor, TargetTipTapEditor } from './TipTapEditor';
import { TipTapMenuBar } from './TipTapMenuBar';
import { TranslatePreviewModal } from './TranslatePreviewModal';
// ReviewModal은 더 이상 사용하지 않음 (ChatPanel의 Review 탭으로 대체)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { translateSourceDocToTargetDocJson } from '@/ai/translateDocument';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { MODEL_PRESETS, type AiProvider } from '@/ai/config';
import { stripHtml } from '@/utils/hash';

interface EditorCanvasProps {
  focusMode: boolean;
}

/**
 * TipTap 기반 에디터 캔버스
 * Notion 스타일의 리치 텍스트 편집 환경
 */
export function EditorCanvasTipTap({ focusMode }: EditorCanvasProps): JSX.Element {
  const { t } = useTranslation();
  const project = useProjectStore((s) => s.project);
  const sourceDocument = useProjectStore((s) => s.sourceDocument);
  const targetDocument = useProjectStore((s) => s.targetDocument);
  const setSourceDocument = useProjectStore((s) => s.setSourceDocument);
  const setTargetDocument = useProjectStore((s) => s.setTargetDocument);
  const setSourceDocJson = useProjectStore((s) => s.setSourceDocJson);
  const setTargetDocJson = useProjectStore((s) => s.setTargetDocJson);
  const setTargetLanguage = useProjectStore((s) => s.setTargetLanguage);

  const appendComposerText = useChatStore((s) => s.appendComposerText);
  const requestComposerFocus = useChatStore((s) => s.requestComposerFocus);
  const translationRules = useChatStore((s) => s.translationRules);
  const projectContext = useChatStore((s) => s.projectContext);
  const translatorPersona = useChatStore((s) => s.translatorPersona);

  const setChatPanelOpen = useUIStore((s) => s.setChatPanelOpen);
  const openReviewPanel = useUIStore((s) => s.openReviewPanel);

  const provider = useAiConfigStore((s) => s.provider);
  const translationModel = useAiConfigStore((s) => s.translationModel);
  const setTranslationModel = useAiConfigStore((s) => s.setTranslationModel);
  const providerKey: Exclude<AiProvider, 'mock'> = provider === 'mock' ? 'openai' : provider;
  const translationPresets = MODEL_PRESETS[providerKey];

  useEffect(() => {
    // translationPresets가 비어있는 경우(예: mock)나 로딩 중일 때 처리
    if (!translationPresets || (translationPresets as unknown as any[]).length === 0) return;
    
    if (!translationPresets.some((p) => p.value === translationModel)) {
      setTranslationModel(translationPresets[0].value);
    }
  }, [translationModel, translationPresets, setTranslationModel]);

  const sourceEditorRef = useRef<Editor | null>(null);
  const targetEditorRef = useRef<Editor | null>(null);
  const [sourceEditor, setSourceEditor] = useState<Editor | null>(null);
  const [targetEditor, setTargetEditor] = useState<Editor | null>(null);

  // 추가: Flash 효과 상태
  const [targetFlash, setTargetFlash] = useState(false);

  const [translatePreviewOpen, setTranslatePreviewOpen] = useState(false);
  const [translatePreviewDoc, setTranslatePreviewDoc] = useState<Record<string, unknown> | null>(null);
  const [translatePreviewError, setTranslatePreviewError] = useState<string | null>(null);
  const [translateLoading, setTranslateLoading] = useState(false);

  // 검수 모달 상태는 더 이상 사용하지 않음 (Review 탭으로 대체)

  const [addToChatBubble, setAddToChatBubble] = useState<null | {
    top: number;
    left: number;
    text: string;
  }>(null);
  const selectionTimerRef = useRef<number | null>(null);
  const selectionTokenRef = useRef<number>(0);

  // 단어 수 계산 함수
  const countWords = useCallback((text: string): number => {
    if (!text || text.trim().length === 0) return 0;
    return text.trim().split(/\s+/).filter(Boolean).length;
  }, []);

  // Source 단어 수 계산
  const sourceWordCount = useMemo(() => {
    if (!sourceDocument) return 0;
    return countWords(stripHtml(sourceDocument));
  }, [sourceDocument, countWords]);

  // Target 단어 수 계산
  const targetWordCount = useMemo(() => {
    if (!targetDocument) return 0;
    return countWords(stripHtml(targetDocument));
  }, [targetDocument, countWords]);

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

    if (!project.metadata.targetLanguage) {
      window.alert('타겟 언어를 선택하세요.');
      return;
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
        projectContext,
        translatorPersona,
      });
      setTranslatePreviewDoc(doc);
    } catch (e) {
      setTranslatePreviewError(e instanceof Error ? e.message : '번역 생성에 실패했습니다.');
    } finally {
      setTranslateLoading(false);
    }
  }, [
    project,
    translationRules,
    projectContext,
    translatorPersona,
  ]);

  const applyTranslatePreview = useCallback((): void => {
    if (!translatePreviewDoc) return;
    if (!targetEditorRef.current) {
      window.alert('Translation 에디터가 아직 준비되지 않았습니다.');
      return;
    }

    // setContent는 onUpdate를 트리거하지 않을 수 있으므로, 명시적으로 store 업데이트
    targetEditorRef.current.commands.setContent(translatePreviewDoc);
    // setContent 후 즉시 HTML을 가져와서 store에 반영
    const updatedHtml = targetEditorRef.current.getHTML();
    setTargetDocument(updatedHtml);
    setTranslatePreviewOpen(false);

    // Flash 효과 트리거 (1초 동안 지속)
    setTargetFlash(true);
    setTimeout(() => setTargetFlash(false), 1000);
  }, [translatePreviewDoc, setTargetDocument]);

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
        {t('editor.loadingProject')}
      </div>
    );
  }

  return (
    <div className="flex-1 h-full flex flex-col min-w-0 bg-editor-surface">
      {/* Header */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-editor-border shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-editor-text tracking-wide">{t('editor.editorLabel')}</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-7 px-2 text-[11px] rounded border border-editor-border bg-editor-bg text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
            value={translationModel}
            onChange={(e) => setTranslationModel(e.target.value)}
            aria-label={t('editor.translationModelAriaLabel')}
            title={t('editor.translationModel')}
          >
            {translationPresets.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void openTranslatePreview()}
            className="px-2 py-1 rounded text-xs bg-primary-500 text-white hover:bg-primary-600 flex items-center gap-1 disabled:opacity-60 transition-colors"
            disabled={translateLoading}
            title={t('editor.translateTitle')}
          >
            {translateLoading ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>{t('editor.translating')}</span>
              </>
            ) : (
              t('editor.translate')
            )}
          </button>
          <button
            type="button"
            onClick={() => openReviewPanel()}
            className="px-2 py-1 rounded text-xs border border-editor-border text-editor-text hover:bg-editor-bg flex items-center gap-1 transition-colors"
            title={t('editor.reviewTitle', '번역 검수')}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {t('editor.review', '검수')}
          </button>
        </div>
      </div>

      {/* Editor Panels */}
      <PanelGroup orientation="horizontal" className="flex-1 min-h-0 min-w-0" id="editor-panels">
        {/* Source Panel */}
        {!focusMode && (
          <>
            <Panel id="source" defaultSize="50" minSize="20" className="min-w-0">
              <div className="h-full flex flex-col min-w-0">
                <div className="h-8 px-4 flex items-center justify-between bg-editor-bg border-b border-editor-border">
                  <span className="text-[11px] font-bold text-editor-muted uppercase tracking-wider">
                    SOURCE
                  </span>
                  <span className="text-[10px] text-editor-muted">
                    {sourceWordCount.toLocaleString()} words
                  </span>
                </div>
                <TipTapMenuBar editor={sourceEditor} />
                <div className="min-h-0 flex-1 overflow-hidden">
                  <SourceTipTapEditor
                    content={sourceDocument || ''}
                    onChange={setSourceDocument}
                    onJsonChange={setSourceDocJson}
                    className="h-full"
                    onEditorReady={handleSourceEditorReady}
                  />
                </div>
              </div>
            </Panel>
            <PanelResizeHandle className="w-1 bg-editor-border hover:bg-primary-500 transition-colors cursor-col-resize z-10" />
          </>
        )}

        {/* Target Panel */}
        <Panel id="target" defaultSize={focusMode ? "100" : "50"} minSize="20" className="min-w-0">
          <div className="h-full flex flex-col min-w-0">
          <div className="h-8 px-4 flex items-center justify-between border-b border-editor-border bg-editor-bg">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-bold text-editor-muted uppercase tracking-wider">
                TRANSLATION
              </span>
              <select
                className="text-[10px] bg-editor-surface border border-editor-border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary-500 text-editor-text"
                value={project.metadata.targetLanguage || ''}
                onChange={(e) => setTargetLanguage(e.target.value)}
              >
                <option value="" disabled>{t('editor.selectLanguage')}</option>
                <option value="한국어">{t('editor.languages.korean')}</option>
                <option value="영어">{t('editor.languages.english')}</option>
                <option value="일본어">{t('editor.languages.japanese')}</option>
                <option value="중국어">{t('editor.languages.chinese')}</option>
                <option value="스페인어">{t('editor.languages.spanish')}</option>
                <option value="러시아어">{t('editor.languages.russian')}</option>
              </select>
            </div>
            <span className="text-[10px] text-editor-muted">
              {targetWordCount.toLocaleString()} words
            </span>
          </div>
          <TipTapMenuBar editor={targetEditor} />
          {/* 여기에 transition 효과 추가 */}
          <div className={`min-h-0 flex-1 overflow-hidden transition-colors duration-500 ${targetFlash ? 'bg-green-500/10' : ''}`}>
            <TargetTipTapEditor
              content={targetDocument || ''}
              onChange={setTargetDocument}
              onJsonChange={setTargetDocJson}
              className="h-full"
              onEditorReady={handleTargetEditorReady}
            />
          </div>
          </div>
        </Panel>
      </PanelGroup>

      <TranslatePreviewModal
        open={translatePreviewOpen}
        title={t('editor.previewTitleFull')}
        docJson={translatePreviewDoc}
        sourceHtml={sourceDocument}
        originalHtml={targetDocument}
        isLoading={translateLoading}
        error={translatePreviewError}
        onClose={() => {
          setTranslatePreviewOpen(false);
        }}
        onApply={applyTranslatePreview}
        onCancel={() => {
          setTranslateLoading(false);
          setTranslatePreviewOpen(false);
        }}
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
            // 플로팅 Chat 패널 열기
            setChatPanelOpen(true);
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
