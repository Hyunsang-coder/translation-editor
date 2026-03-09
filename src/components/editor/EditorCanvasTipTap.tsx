import { useTranslation } from 'react-i18next';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useEditorStore } from '@/stores/editorStore';
import { SourceTipTapEditor, TargetTipTapEditor } from './TipTapEditor';
import { TipTapMenuBar } from './TipTapMenuBar';
import { TranslatePreviewModal } from './TranslatePreviewModal';
import { SearchBar } from './SearchBar';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Editor } from '@tiptap/react';
import {
  translateWithStreaming,
  formatTranslationError,
} from '@/ai/translateDocument';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { MODEL_PRESETS } from '@/ai/config';
import { Select, type SelectOptionGroup } from '@/components/ui/Select';
import { stripHtml } from '@/utils/hash';
import { searchGlossary } from '@/tauri/glossary';
import { tipTapJsonToMarkdown } from '@/utils/markdownConverter';
import { AddToChatButton } from '@/components/ui/AddToChatButton';
import { replaceDocContent } from '@/editor/utils/replaceDocContent';

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

  const openReviewPanel = useUIStore((s) => s.openReviewPanel);
  const addToast = useUIStore((s) => s.addToast);
  const toggleFocusMode = useUIStore((s) => s.toggleFocusMode);

  // 복사용 JSON 상태
  const sourceDocJson = useProjectStore((s) => s.sourceDocJson);
  const targetDocJson = useProjectStore((s) => s.targetDocJson);

  // Source/Target 패널별 폰트 설정
  const sourceFontSize = useUIStore((s) => s.sourceFontSize);
  const sourceLineHeight = useUIStore((s) => s.sourceLineHeight);
  const targetFontSize = useUIStore((s) => s.targetFontSize);
  const targetLineHeight = useUIStore((s) => s.targetLineHeight);

  const openaiEnabled = useAiConfigStore((s) => s.openaiEnabled);
  const anthropicEnabled = useAiConfigStore((s) => s.anthropicEnabled);
  const translationModel = useAiConfigStore((s) => s.translationModel);
  const setTranslationModel = useAiConfigStore((s) => s.setTranslationModel);

  const createSnapshotIfChanged = useHistoryStore((s) => s.createSnapshotIfChanged);

  // 활성화된 프로바이더의 모델만 표시
  const enabledPresets = useMemo((): SelectOptionGroup[] => {
    const presets: SelectOptionGroup[] = [];
    if (anthropicEnabled) {
      presets.push({
        label: 'Anthropic',
        options: MODEL_PRESETS.anthropic.map((m) => ({ value: m.value, label: m.label })),
      });
    }
    if (openaiEnabled) {
      presets.push({
        label: 'OpenAI',
        options: MODEL_PRESETS.openai.map((m) => ({ value: m.value, label: m.label })),
      });
    }
    return presets;
  }, [openaiEnabled, anthropicEnabled]);

  // 모든 모델 플랫 리스트 (유효성 검사용)
  const allTranslationModels = useMemo(() => {
    return enabledPresets.flatMap((g) => g.options);
  }, [enabledPresets]);

  // 선택된 모델이 비활성화된 프로바이더면 첫 번째 활성 모델로 변경
  useEffect(() => {
    if (allTranslationModels.length === 0) return;
    const firstModel = allTranslationModels[0];
    if (!firstModel) return;
    if (!allTranslationModels.some((m) => m.value === translationModel)) {
      setTranslationModel(firstModel.value);
    }
  }, [translationModel, allTranslationModels, setTranslationModel]);

  const sourceEditorRef = useRef<Editor | null>(null);
  const targetEditorRef = useRef<Editor | null>(null);
  const [sourceEditor, setSourceEditor] = useState<Editor | null>(null);
  const [targetEditor, setTargetEditor] = useState<Editor | null>(null);

  // 추가: Flash 효과 상태
  const [targetFlash, setTargetFlash] = useState(false);

  // 검색바 상태 (패널별 독립)
  const [sourceSearchOpen, setSourceSearchOpen] = useState(false);
  const [targetSearchOpen, setTargetSearchOpen] = useState(false);
  const [targetSearchReplaceMode, setTargetSearchReplaceMode] = useState(false);

  const [translatePreviewOpen, setTranslatePreviewOpen] = useState(false);
  const [translatePreviewDoc, setTranslatePreviewDoc] = useState<Record<string, unknown> | null>(null);
  const [translatePreviewError, setTranslatePreviewError] = useState<string | null>(null);
  const [translateLoading, setTranslateLoading] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const translateAbortController = useRef<AbortController | null>(null);

  // 재번역 지시사항 모달 (타겟에 내용이 이미 있을 때)
  const [retranslateModalOpen, setRetranslateModalOpen] = useState(false);
  const [retranslateMessage, setRetranslateMessage] = useState('');

  // 검수 모달 상태는 더 이상 사용하지 않음 (Review 탭으로 대체)

  const [addToChatBubble, setAddToChatBubble] = useState<null | {
    top: number;
    left: number;
    text: string;
  }>(null);
  const selectionTimerRef = useRef<number | null>(null);
  const selectionTokenRef = useRef<number>(0);

  // 단어 수 계산 (debounced: 매 변경마다 stripHtml 재계산 방지)
  const [sourceWordCount, setSourceWordCount] = useState(0);
  const [targetWordCount, setTargetWordCount] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!sourceDocument) { setSourceWordCount(0); return; }
      const text = stripHtml(sourceDocument).trim();
      setSourceWordCount(text.length === 0 ? 0 : text.split(/\s+/).filter(Boolean).length);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [sourceDocument]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!targetDocument) { setTargetWordCount(0); return; }
      const text = stripHtml(targetDocument).trim();
      setTargetWordCount(text.length === 0 ? 0 : text.split(/\s+/).filter(Boolean).length);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [targetDocument]);

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

  const openTranslatePreview = useCallback(async (extraMessage?: string): Promise<void> => {
    if (!project) return;
    if (!sourceEditorRef.current) {
      addToast({ type: 'error', message: t('editor.sourceEditorNotReady', 'Source 에디터가 아직 준비되지 않았습니다.') });
      return;
    }

    if (!project.metadata.targetLanguage) {
      addToast({ type: 'warning', message: t('editor.selectTargetLanguage', '타겟 언어를 선택하세요.') });
      return;
    }

    // 빈 문서 검증: 텍스트 콘텐츠가 없으면 번역 불필요
    if (sourceEditorRef.current.isEmpty) {
      addToast({ type: 'warning', message: t('editor.emptySource', '번역할 원문이 없습니다. 원문을 먼저 입력해주세요.') });
      return;
    }

    setTranslatePreviewError(null);
    setTranslatePreviewDoc(null);
    setTranslatePreviewOpen(true);
    setTranslateLoading(true);
    setStreamingText(null);

    // AbortController 생성
    const abortController = new AbortController();
    translateAbortController.current = abortController;

    try {
      const sourceDocJson = sourceEditorRef.current.getJSON() as Record<string, unknown>;

      // 용어집 검색 (채팅 모드와 동일한 패턴)
      let glossary = '';
      try {
        // 원문을 Markdown으로 변환하여 검색 쿼리로 사용
        const sourceMarkdown = tipTapJsonToMarkdown(sourceDocJson);
        const query = sourceMarkdown.slice(0, 2000); // 앞부분 2000자로 검색
        if (query.trim().length > 0) {
          const hits = await searchGlossary({
            projectId: project.id,
            query,
            domain: project.metadata.domain,
            limit: 30, // 번역은 전체 문서이므로 더 많이
          });
          if (hits.length > 0) {
            glossary = hits
              .map((e) => `- ${e.source} = ${e.target}${e.notes ? ` (${e.notes})` : ''}`)
              .join('\n');
            console.warn(`[Translation] Glossary injected: ${hits.length} terms`);
          }
        }
      } catch (glossaryError) {
        // 용어집 검색 실패는 조용히 무시 (번역은 계속 진행)
        console.warn('[Translation] Glossary search failed:', glossaryError);
      }

      const trimmedMessage = extraMessage?.trim();
      const { doc } = await translateWithStreaming({
        project,
        sourceDocJson,
        translationRules,
        projectContext,
        translatorPersona,
        glossary,
        ...(trimmedMessage ? { retranslateMessage: trimmedMessage } : {}),
        onToken: (text) => {
          setStreamingText(text);
        },
        abortSignal: abortController.signal,
      });
      setTranslatePreviewDoc(doc);
      setStreamingText(null); // 완료 후 스트리밍 텍스트 초기화
    } catch (e) {
      // 취소된 경우
      if (abortController.signal.aborted) {
        setTranslatePreviewError('번역이 취소되었습니다.');
      } else {
        setTranslatePreviewError(formatTranslationError(e));
      }
    } finally {
      setTranslateLoading(false);
      translateAbortController.current = null;
    }
  }, [
    project,
    translationRules,
    projectContext,
    translatorPersona,
    addToast,
    t,
  ]);

  // 번역 버튼 클릭 핸들러: 타겟에 내용이 있으면 재번역 모달 먼저 표시
  const handleTranslateClick = useCallback(() => {
    if (!sourceEditorRef.current) return;
    const hasTarget = stripHtml(targetDocument || '').trim().length > 0;
    if (hasTarget) {
      setRetranslateMessage('');
      setRetranslateModalOpen(true);
    } else {
      void openTranslatePreview();
    }
  }, [targetDocument, openTranslatePreview]);

  // 번역 취소 핸들러
  const handleTranslateCancel = useCallback((): void => {
    if (translateAbortController.current) {
      translateAbortController.current.abort();
    }
    setTranslateLoading(false);
    setTranslatePreviewOpen(false);
    setStreamingText(null);
  }, []);

  const applyTranslatePreview = useCallback((): void => {
    if (!translatePreviewDoc) return;
    if (!targetEditorRef.current) {
      addToast({ type: 'error', message: t('editor.targetEditorNotReady', 'Target 에디터가 아직 준비되지 않았습니다.') });
      return;
    }

    // replaceDocContent는 onUpdate를 발동시키므로 store 자동 동기화됨
    // addToHistory: true → Ctrl+Z로 번역 취소 가능
    replaceDocContent(targetEditorRef.current, translatePreviewDoc, { addToHistory: true });
    setTranslatePreviewOpen(false);

    // Flash 효과 트리거 (1초 동안 지속)
    setTargetFlash(true);
    setTimeout(() => setTargetFlash(false), 1000);

    // 번역 적용 후 자동 스냅샷
    const { project, materializeBlocksForSnapshot } = useProjectStore.getState();
    if (project) {
      const blocks = materializeBlocksForSnapshot();
      if (blocks) {
        const model = useAiConfigStore.getState().translationModel;
        const dateLabel = new Date().toLocaleDateString('sv'); // YYYY-MM-DD
        void createSnapshotIfChanged({
          projectId: project.id,
          description: `${t('history.autoSnapshotAfterTranslate')}(${model}) ${dateLabel}`,
          blocks,
        }).catch((err: unknown) => {
          console.warn('[history] auto snapshot after translate failed:', err);
        });
      }
    }
  }, [translatePreviewDoc, addToast, t, createSnapshotIfChanged]);

  // 번역 재시도 핸들러
  const handleTranslateRetry = useCallback((): void => {
    void openTranslatePreview(retranslateMessage);
  }, [openTranslatePreview, retranslateMessage]);

  // Source 에디터 준비 완료 콜백
  const handleSourceEditorReady = useCallback((editor: Editor) => {
    sourceEditorRef.current = editor;
    setSourceEditor(editor);
    useEditorStore.getState().setSourceEditor(editor);
  }, []);

  // Target 에디터 준비 완료 콜백
  const handleTargetEditorReady = useCallback((editor: Editor) => {
    targetEditorRef.current = editor;
    setTargetEditor(editor);
    useEditorStore.getState().setTargetEditor(editor);
  }, []);

  // 에디터 unmount/재생성 시 editorStore에서 stale 참조 정리
  useEffect(() => {
    return () => {
      useEditorStore.getState().clearEditors();
    };
  }, []);

  // 검색바 핸들러
  const handleSourceSearchOpen = useCallback(() => {
    setSourceSearchOpen(true);
  }, []);

  const handleSourceSearchClose = useCallback(() => {
    setSourceSearchOpen(false);
  }, []);

  const handleTargetSearchOpen = useCallback(() => {
    setTargetSearchReplaceMode(false);
    setTargetSearchOpen(true);
  }, []);

  const handleTargetSearchOpenWithReplace = useCallback(() => {
    setTargetSearchReplaceMode(true);
    setTargetSearchOpen(true);
  }, []);

  const handleTargetSearchClose = useCallback(() => {
    setTargetSearchOpen(false);
    setTargetSearchReplaceMode(false);
  }, []);

  // 패널 복사 핸들러
  const handleCopySource = useCallback(async () => {
    if (!sourceDocJson) {
      addToast({ type: 'error', message: t('common.copyError', '복사할 내용이 없습니다.') });
      return;
    }
    try {
      const markdown = tipTapJsonToMarkdown(sourceDocJson as Record<string, unknown>);
      await navigator.clipboard.writeText(markdown);
      addToast({ type: 'success', message: t('common.copied', '클립보드에 복사되었습니다.') });
    } catch {
      addToast({ type: 'error', message: t('common.copyError', '복사에 실패했습니다.') });
    }
  }, [sourceDocJson, addToast, t]);

  const handleCopyTarget = useCallback(async () => {
    if (!targetDocJson) {
      addToast({ type: 'error', message: t('common.copyError', '복사할 내용이 없습니다.') });
      return;
    }
    try {
      const markdown = tipTapJsonToMarkdown(targetDocJson as Record<string, unknown>);
      await navigator.clipboard.writeText(markdown);
      addToast({ type: 'success', message: t('common.copied', '클립보드에 복사되었습니다.') });
    } catch {
      addToast({ type: 'error', message: t('common.copyError', '복사에 실패했습니다.') });
    }
  }, [targetDocJson, addToast, t]);

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
          <Select
            value={translationModel}
            onChange={setTranslationModel}
            options={enabledPresets}
            aria-label={t('editor.translationModelAriaLabel')}
            title={t('editor.translationModel')}
            size="sm"
            className="min-w-[130px]"
          />
          <button
            type="button"
            onClick={handleTranslateClick}
            className="px-2 py-1 rounded text-xs font-semibold bg-primary-500 text-white hover:bg-primary-600 flex items-center gap-1 disabled:opacity-60 transition-colors"
            disabled={translateLoading}
            title={t('editor.translateTitle')}
            data-testid="editor-translate-button"
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
            className="px-2 py-1 rounded text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
            title={t('editor.reviewTitle', '번역 검수')}
            data-testid="editor-review-button"
          >
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
              <div
                className="h-full flex flex-col min-w-0"
                style={{
                  '--editor-font-size': `${sourceFontSize}px`,
                  '--editor-line-height': sourceLineHeight,
                } as CSSProperties}
              >
                <div className="h-8 px-4 flex items-center justify-between bg-editor-bg border-b border-editor-border">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-editor-muted uppercase tracking-wider">
                      {t('editor.source').toUpperCase()}
                    </span>
                    <button
                      type="button"
                      onClick={toggleFocusMode}
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium text-editor-muted hover:text-amber-600 hover:bg-amber-500/10 transition-colors"
                      title={t('editor.hideSource')}
                    >
                      {t('editor.hideSource')}
                    </button>
                  </div>
                  <span className="text-[10px] text-editor-muted">
                    {sourceWordCount.toLocaleString()} {t('editor.words')}
                  </span>
                </div>
                <TipTapMenuBar editor={sourceEditor} panelType="source" />
                <SearchBar
                  editor={sourceEditor}
                  panelType="source"
                  isOpen={sourceSearchOpen}
                  onClose={handleSourceSearchClose}
                />
                <div className="min-h-0 flex-1 overflow-hidden relative group/source">
                  <SourceTipTapEditor
                    content={sourceDocument || ''}
                    onChange={setSourceDocument}
                    onJsonChange={setSourceDocJson}
                    className="h-full"
                    onEditorReady={handleSourceEditorReady}
                    onSearchOpen={handleSourceSearchOpen}
                  />
                  {/* 호버 복사 버튼 */}
                  <button
                    type="button"
                    onClick={() => void handleCopySource()}
                    className="absolute top-2 right-2 opacity-0 group-hover/source:opacity-50 hover:!opacity-100 transition-opacity p-1 rounded text-[10px] bg-editor-surface/60 border border-editor-border/40 flex items-center gap-1 text-editor-muted hover:text-editor-text"
                    title={t('common.copyToClipboard', '복사')}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {t('common.copy', '복사')}
                  </button>
                </div>
              </div>
            </Panel>
            <PanelResizeHandle className="w-1 bg-editor-border hover:bg-primary-500 transition-colors cursor-col-resize z-10" />
          </>
        )}

        {/* Target Panel */}
        <Panel id="target" defaultSize={focusMode ? "100" : "50"} minSize="20" className="min-w-0">
          <div
            className="h-full flex flex-col min-w-0"
            style={{
              '--editor-font-size': `${targetFontSize}px`,
              '--editor-line-height': targetLineHeight,
            } as CSSProperties}
          >
            <div className="h-8 px-4 flex items-center justify-between border-b border-editor-border bg-editor-bg">
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-bold text-editor-muted uppercase tracking-wider">
                  {t('editor.target').toUpperCase()}
                </span>
                {focusMode && (
                  <button
                    type="button"
                    onClick={toggleFocusMode}
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium text-editor-muted hover:text-amber-600 hover:bg-amber-500/10 transition-colors"
                    title={t('editor.showSource')}
                  >
                    {t('editor.showSource')}
                  </button>
                )}
                <Select
                  value={project.metadata.targetLanguage || ''}
                  onChange={setTargetLanguage}
                  options={[
                    { value: '한국어', label: t('editor.languages.korean') },
                    { value: '영어', label: t('editor.languages.english') },
                    { value: '일본어', label: t('editor.languages.japanese') },
                    { value: '중국어', label: t('editor.languages.chinese') },
                    { value: '스페인어', label: t('editor.languages.spanish') },
                    { value: '러시아어', label: t('editor.languages.russian') },
                  ]}
                  placeholder={t('editor.selectLanguage')}
                  size="sm"
                  className="min-w-[80px]"
                  data-testid="target-language-select"
                />
              </div>
              <span className="text-[10px] text-editor-muted">
                {targetWordCount.toLocaleString()} {t('editor.words')}
              </span>
            </div>
            <TipTapMenuBar editor={targetEditor} panelType="target" />
            <SearchBar
              editor={targetEditor}
              panelType="target"
              isOpen={targetSearchOpen}
              onClose={handleTargetSearchClose}
              initialReplaceMode={targetSearchReplaceMode}
            />
            {/* 여기에 transition 효과 추가 */}
            <div className={`min-h-0 flex-1 overflow-hidden transition-colors duration-500 relative group/target ${targetFlash ? 'bg-green-500/10' : ''}`}>
              <TargetTipTapEditor
                content={targetDocument || ''}
                onChange={setTargetDocument}
                onJsonChange={setTargetDocJson}
                className="h-full"
                onEditorReady={handleTargetEditorReady}
                onSearchOpen={handleTargetSearchOpen}
                onSearchOpenWithReplace={handleTargetSearchOpenWithReplace}
              />
              {/* 호버 복사 버튼 */}
              <button
                type="button"
                onClick={() => void handleCopyTarget()}
                className="absolute top-2 right-2 opacity-0 group-hover/target:opacity-50 hover:!opacity-100 transition-opacity p-1 rounded text-[10px] bg-editor-surface/60 border border-editor-border/40 flex items-center gap-1 text-editor-muted hover:text-editor-text"
                title={t('common.copyToClipboard', '복사')}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {t('common.copy', '복사')}
              </button>
            </div>
          </div>
        </Panel>
      </PanelGroup>

      {/* 재번역 지시사항 모달 (타겟에 이미 내용이 있을 때 번역 버튼 클릭 시) */}
      {retranslateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-editor-surface border border-editor-border rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="px-4 py-3 border-b border-editor-border">
              <h3 className="text-sm font-semibold text-editor-text">
                {t('editor.retranslateModal.title', '재번역')}
              </h3>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-editor-muted">
                {t('editor.retranslateModal.description', '번역문이 이미 있습니다. 처음부터 다시 번역합니다.')}
              </p>
              <div>
                <label className="text-xs font-medium text-editor-text">
                  {t('review.retranslate.modal.messageLabel', '추가 지시사항')}
                  <span className="ml-1 text-editor-muted font-normal">
                    {t('review.retranslate.modal.optional', '(선택)')}
                  </span>
                </label>
                <textarea
                  value={retranslateMessage}
                  onChange={(e) => setRetranslateMessage(e.target.value)}
                  placeholder={t('review.retranslate.modal.placeholder', '추가로 반영할 내용을 입력하세요...')}
                  className="mt-1.5 w-full h-24 px-3 py-2 text-sm bg-editor-bg border border-editor-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary-500 text-editor-text placeholder:text-editor-muted"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      setRetranslateModalOpen(false);
                      void openTranslatePreview(retranslateMessage);
                    }
                    if (e.key === 'Escape') {
                      setRetranslateModalOpen(false);
                    }
                  }}
                />
              </div>
            </div>
            <div className="px-4 py-3 border-t border-editor-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRetranslateModalOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-editor-border text-editor-text hover:bg-editor-bg transition-colors"
              >
                {t('common.cancel', '취소')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRetranslateModalOpen(false);
                  void openTranslatePreview(retranslateMessage);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors"
              >
                {t('review.retranslate.modal.execute', '재번역 실행')}
              </button>
            </div>
          </div>
        </div>
      )}

      <TranslatePreviewModal
        open={translatePreviewOpen}
        title={t('editor.previewTitleFull')}
        docJson={translatePreviewDoc}
        sourceHtml={sourceDocument}
        originalHtml={targetDocument}
        isLoading={translateLoading}
        error={translatePreviewError}
        streamingText={streamingText}
        onClose={() => {
          setTranslatePreviewOpen(false);
        }}
        onApply={applyTranslatePreview}
        onCancel={handleTranslateCancel}
        {...(translatePreviewError ? { onRetry: handleTranslateRetry } : {})}
      />

      {/* TipTap Add to chat 버튼 (드래그 후 1초) */}
      {addToChatBubble && (
        <AddToChatButton
          style={{
            position: 'fixed',
            top: addToChatBubble.top,
            left: addToChatBubble.left,
            zIndex: 80,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const text = addToChatBubble.text.trim();
            if (!text) return;
            // 채팅 패널 열기
            useUIStore.getState().openActiveChat();
            appendComposerText(text);
            requestComposerFocus();
            setAddToChatBubble(null);
          }}
        />
      )}
    </div>
  );
}
