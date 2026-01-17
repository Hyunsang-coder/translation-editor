import { useTranslation } from 'react-i18next';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { SourceTipTapEditor, TargetTipTapEditor } from './TipTapEditor';
import { TipTapMenuBar } from './TipTapMenuBar';
import { TranslatePreviewModal } from './TranslatePreviewModal';
import { SearchBar } from './SearchBar';
// ReviewModal은 더 이상 사용하지 않음 (ChatPanel의 Review 탭으로 대체)
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Editor } from '@tiptap/react';
import {
  translateWithStreaming,
  formatTranslationError,
} from '@/ai/translateDocument';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { MODEL_PRESETS } from '@/ai/config';
import { stripHtml } from '@/utils/hash';
import { searchGlossary } from '@/tauri/glossary';
import { tipTapJsonToMarkdown } from '@/utils/markdownConverter';
import { setTargetEditor as setTargetEditorRegistry } from '@/editor/editorRegistry';

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
  const addToast = useUIStore((s) => s.addToast);

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

  // 활성화된 프로바이더의 모델만 표시
  type ModelPreset = { value: string; label: string; description: string };
  const enabledPresets = useMemo(() => {
    const presets: Array<{ group: string; items: readonly ModelPreset[] }> = [];
    if (openaiEnabled) {
      presets.push({ group: 'OpenAI', items: MODEL_PRESETS.openai });
    }
    if (anthropicEnabled) {
      presets.push({ group: 'Anthropic', items: MODEL_PRESETS.anthropic });
    }
    return presets;
  }, [openaiEnabled, anthropicEnabled]);

  // 선택된 모델이 비활성화된 프로바이더면 첫 번째 활성 모델로 변경
  useEffect(() => {
    if (enabledPresets.length === 0) return;
    const allModels = enabledPresets.flatMap((p) => p.items);
    const firstModel = allModels[0];
    if (!firstModel) return;
    if (!allModels.some((m) => m.value === translationModel)) {
      setTranslationModel(firstModel.value);
    }
  }, [translationModel, enabledPresets, setTranslationModel]);

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
            console.log(`[Translation] Glossary injected: ${hits.length} terms`);
          }
        }
      } catch (glossaryError) {
        // 용어집 검색 실패는 조용히 무시 (번역은 계속 진행)
        console.warn('[Translation] Glossary search failed:', glossaryError);
      }

      const { doc } = await translateWithStreaming({
        project,
        sourceDocJson,
        translationRules,
        projectContext,
        translatorPersona,
        glossary,
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
  ]);

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
      window.alert('Translation 에디터가 아직 준비되지 않았습니다.');
      return;
    }

    // setContent는 onUpdate를 트리거하지 않을 수 있으므로, 명시적으로 store 업데이트
    targetEditorRef.current.commands.setContent(translatePreviewDoc);
    // setContent 후 즉시 HTML/JSON을 가져와서 store에 반영
    const updatedHtml = targetEditorRef.current.getHTML();
    setTargetDocument(updatedHtml);
    // Issue #4 수정: AI 도구용 JSON 캐시도 동기화
    setTargetDocJson(targetEditorRef.current.getJSON() as Record<string, unknown>);
    setTranslatePreviewOpen(false);

    // Flash 효과 트리거 (1초 동안 지속)
    setTargetFlash(true);
    setTimeout(() => setTargetFlash(false), 1000);
  }, [translatePreviewDoc, setTargetDocument]);

  // 번역 재시도 핸들러
  const handleTranslateRetry = useCallback((): void => {
    // 기존 에러 클리어하고 다시 번역 시도
    void openTranslatePreview();
  }, [openTranslatePreview]);

  // Source 에디터 준비 완료 콜백
  const handleSourceEditorReady = useCallback((editor: Editor) => {
    sourceEditorRef.current = editor;
    setSourceEditor(editor);
  }, []);

  // Target 에디터 준비 완료 콜백
  const handleTargetEditorReady = useCallback((editor: Editor) => {
    targetEditorRef.current = editor;
    setTargetEditor(editor);
    // 글로벌 레지스트리에도 저장 (ReviewPanel 등에서 접근용)
    setTargetEditorRegistry(editor);
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
          <select
            className="h-7 px-2 text-[11px] rounded border border-editor-border bg-editor-bg text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
            value={translationModel}
            onChange={(e) => setTranslationModel(e.target.value)}
            aria-label={t('editor.translationModelAriaLabel')}
            title={t('editor.translationModel')}
          >
            {enabledPresets.map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.items.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
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
              <div
                className="h-full flex flex-col min-w-0"
                style={{
                  '--editor-font-size': `${sourceFontSize}px`,
                  '--editor-line-height': sourceLineHeight,
                } as CSSProperties}
              >
                <div className="h-8 px-4 flex items-center justify-between bg-editor-bg border-b border-editor-border">
                  <span className="text-[11px] font-bold text-editor-muted uppercase tracking-wider">
                    SOURCE
                  </span>
                  <span className="text-[10px] text-editor-muted">
                    {sourceWordCount.toLocaleString()} words
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
                    className="absolute bottom-4 right-4 opacity-0 group-hover/source:opacity-100 transition-opacity px-2.5 py-1.5 rounded-md text-xs font-medium bg-editor-surface border border-editor-border hover:bg-editor-bg shadow-sm flex items-center gap-1.5 text-editor-text"
                    title={t('common.copyToClipboard', '복사')}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              className="absolute bottom-4 right-4 opacity-0 group-hover/target:opacity-100 transition-opacity px-2.5 py-1.5 rounded-md text-xs font-medium bg-editor-surface border border-editor-border hover:bg-editor-bg shadow-sm flex items-center gap-1.5 text-editor-text"
              title={t('common.copyToClipboard', '복사')}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {t('common.copy', '복사')}
            </button>
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
