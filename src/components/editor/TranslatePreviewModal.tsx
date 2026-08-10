import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { EditorContent, useEditor } from '@tiptap/react';
import { generateText } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { ImagePlaceholder } from '@/editor/extensions/ImagePlaceholder';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import DOMPurify from 'dompurify';
import { stripHtml } from '@/utils/hash';
import { countTotalWords } from '@/utils/wordCounter';
import type { TipTapDocJson } from '@/ai/translateDocument';
import { useTranslationPreviewStore, type PreviewStreamingChannel } from '@/stores/translationPreviewStore';
import { VisualDiffViewer } from '@/components/ui/VisualDiffViewer';
import { SelectiveDiffList } from '@/components/editor/SelectiveDiffList';
import { buildDocDiffPlan, mergeDocBySelection } from '@/utils/docBlockDiff';
import { SkeletonParagraph } from '@/components/ui/Skeleton';

/**
 * 경과 시간을 포맷팅 (mm:ss)
 */
function formatElapsedTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Diff 비교를 위한 텍스트 정규화
 * - 줄 바꿈 통일 (Windows/Unix)
 * - 과도한 빈 줄 정리
 * - 앞뒤 공백 제거
 */
function normalizeDiffText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')           // Windows 줄 바꿈 → Unix
    // TipTap generateText는 문단 경계를 \n\n 로 만들 수 있고,
    // HTML->stripHtml 경로는 \n 로 만드는 경우가 있어 diff에서만 "빈 줄" 차이가 생길 수 있습니다.
    // Diff 안정성을 위해 연속 줄바꿈(문단 구분 포함)은 1개로 통일합니다.
    .replace(/\n{2,}/g, '\n')         // 2개 이상 줄 바꿈 → 1개
    .replace(/[ \t]+$/gm, '')         // 줄 끝 공백 제거
    .trim();
}

/**
 * Diff용 최종 텍스트 준비
 * - 정규화만 수행 (문장 단위 분할 제거하여 줄 밀림 방지)
 */
function prepareDiffText(text: string): string {
  return normalizeDiffText(text);
}

interface TranslatePreviewModalProps {
  open: boolean;
  title?: string;
  docJson: TipTapDocJson | null;
  sourceHtml?: string | null;
  originalHtml?: string | null;
  isLoading?: boolean;
  error?: string | null;
  /** 청크 분할 번역 진행률 */
  progress?: { completed: number; total: number } | null;
  /** 스트리밍 중 실시간 Markdown 텍스트 (prop 경로 — ReviewPanel 등 기존 호출부 호환) */
  streamingText?: string | null;
  /**
   * P4: 스트리밍 텍스트를 translationPreviewStore 채널에서 직접 구독.
   * 지정 시 모달만 토큰 델타로 리렌더되고, 캔버스(부모)는 리렌더되지 않는다.
   * streamingText prop보다 우선한다.
   */
  streamingChannel?: PreviewStreamingChannel;
  /** 선택 적용 모드: 결과와 비교할 원본 Target 문서 JSON (onApplySelective와 함께 제공 시 변경사항 탭에서 문단별 선택 가능) */
  originalDocJson?: TipTapDocJson | null;
  /** 선택된 변경 그룹만 병합한 문서로 적용 */
  onApplySelective?: (mergedDoc: TipTapDocJson) => void | Promise<void>;
  onClose: () => void;
  onApply: () => void | Promise<void>;
  onCancel?: () => void;
  onRetry?: () => void;
}

/**
 * Outer wrapper: only mounts the inner component when open===true.
 * This ensures the TipTap editor created by useEditor is properly
 * destroyed when the modal closes (component unmounts).
 */
export function TranslatePreviewModal(props: TranslatePreviewModalProps): JSX.Element | null {
  if (!props.open) return null;
  return <TranslatePreviewModalInner {...props} />;
}

/**
 * Inner component: contains all state, hooks, and rendering logic.
 * Only mounted when the modal is open, guaranteeing proper cleanup on close.
 */
function TranslatePreviewModalInner(props: TranslatePreviewModalProps): JSX.Element {
  const { t } = useTranslation();
  const {
    title,
    docJson,
    sourceHtml,
    originalHtml,
    isLoading,
    error,
    progress,
    streamingText: streamingTextProp,
    streamingChannel,
    originalDocJson,
    onApplySelective,
    onClose,
    onApply,
    onCancel,
    onRetry,
  } = props;

  // P4: 채널이 지정되면 store를 직접 구독(캔버스 리렌더 없이 모달만 갱신), 아니면 prop 사용
  const streamingTextFromStore = useTranslationPreviewStore((s) =>
    streamingChannel ? s.streaming[streamingChannel] : null,
  );
  const streamingText = streamingChannel ? streamingTextFromStore : streamingTextProp;

  const [viewMode, setViewMode] = useState<'preview' | 'diff'>(() => {
    // originalHtml이 있고 내용이 있으면 기본적으로 diff 모드
    const baseHtml = originalHtml ?? '';
    if (baseHtml && stripHtml(baseHtml).trim().length > 0) {
      return 'diff';
    }
    return 'preview';
  });
  const [isApplying, setIsApplying] = useState(false);

  // Diff의 기준(original)은 모달을 열 때의 target 상태로 스냅샷 고정합니다.
  // Apply로 targetDocument가 바뀌어도 DiffEditor의 모델이 갈아끼워지지 않게 해서
  // "TextModel got disposed before ... reset" 레이스를 피합니다.
  const [diffOriginalHtmlSnapshot] = useState<string>(() => originalHtml ?? '');

  // 경과 시간 상태
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalElapsedSeconds, setFinalElapsedSeconds] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedSecondsRef = useRef(0);

  // elapsedSeconds가 변경될 때마다 ref도 업데이트
  useEffect(() => {
    elapsedSecondsRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  // 타이머 시작
  const startTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setElapsedSeconds(0);
    setFinalElapsedSeconds(null);
    elapsedSecondsRef.current = 0;
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => {
        elapsedSecondsRef.current = prev + 1;
        return prev + 1;
      });
    }, 1000);
  }, []);

  // 타이머 정지
  const stopTimer = useCallback((saveFinal: boolean = false) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (saveFinal && elapsedSecondsRef.current > 0) {
      setFinalElapsedSeconds(elapsedSecondsRef.current);
    }
  }, []);

  // isLoading 상태에 따라 타이머 제어
  useEffect(() => {
    if (isLoading) {
      startTimer();
    } else {
      // 로딩이 끝날 때 최종 시간 저장 (에러가 없고 결과가 있을 때만)
      stopTimer(docJson !== null && !error);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isLoading, docJson, error, startTimer, stopTimer]);

  // 선택 적용 모드: 원본/결과 문서를 문장 단위 변경 unit으로 분해
  const diffPlan = useMemo(
    () => (docJson && originalDocJson ? buildDocDiffPlan(originalDocJson, docJson) : null),
    [docJson, originalDocJson],
  );
  // 콜백 함수의 참조가 바뀌는 것은 새 폴리싱 결과가 아니다. 선택 가능 여부만
  // 콜백 존재로 결정하고 diff 계획은 문서 스냅샷에만 묶어 사용자 선택을 보존한다.
  const selectiveEnabled = Boolean(onApplySelective);
  const changeUnits = useMemo(
    () => (selectiveEnabled ? (diffPlan?.units ?? []) : []),
    [diffPlan, selectiveEnabled],
  );
  const [selectedUnitIds, setSelectedUnitIds] = useState<ReadonlySet<string>>(new Set());
  // 결과 도착 시 기본값: 전체 선택
  useEffect(() => {
    setSelectedUnitIds(new Set(changeUnits.map((u) => u.id)));
  }, [changeUnits]);

  const selectiveActive = changeUnits.length > 0;
  const selectedCount = changeUnits.filter((unit) => selectedUnitIds.has(unit.id)).length;

  const toggleUnit = useCallback((id: string) => {
    setSelectedUnitIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAllUnits = useCallback((selected: boolean) => {
    setSelectedUnitIds(selected ? new Set(changeUnits.map((unit) => unit.id)) : new Set());
  }, [changeUnits]);

  // Apply 핸들러 래퍼
  const handleApply = (): void => {
    if (isApplying) return;
    setIsApplying(true);
    void (async () => {
      try {
        if (
          selectiveActive &&
          diffPlan &&
          originalDocJson &&
          onApplySelective &&
          // 부분 선택일 때만 병합. 전체 선택이면 full apply로 우회해 diff 표현력의
          // 한계(마크/공백/노드타입-only 변경이 unit이 되지 않음)로 인한 유실을 막는다.
          selectedCount < changeUnits.length
        ) {
          const merged = mergeDocBySelection(originalDocJson, diffPlan, selectedUnitIds);
          await onApplySelective(merged);
        } else {
          await onApply();
        }
      } finally {
        setIsApplying(false);
      }
    })();
  };

  const handleRequestClose = useCallback((): void => {
    if (isLoading && onCancel) {
      onCancel();
      return;
    }
    onClose();
  }, [isLoading, onCancel, onClose]);

  const content = useMemo(() => docJson ?? null, [docJson]);

  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    Link.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      HTMLAttributes: { class: 'tiptap-link' },
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    ImagePlaceholder.configure({
      inline: true,
      allowBase64: true,
    }),
    Underline,
    Highlight.configure({ multicolor: false }),
    Subscript,
    Superscript,
  ], []);

  const editor = useEditor({
    extensions,
    ...(content !== null && { content }),
    editable: false,
    editorProps: {
      attributes: {
        class: 'tiptap-editor focus:outline-none',
      },
    },
  });

  // diff용 텍스트 추출 (정규화 + 문장 분할 적용)
  const originalText = useMemo(() => {
    const baseHtml = diffOriginalHtmlSnapshot ?? originalHtml ?? '';
    const raw = baseHtml ? stripHtml(baseHtml) : '';
    return prepareDiffText(raw);
  }, [diffOriginalHtmlSnapshot, originalHtml]);

  const translatedTextRaw = useMemo(() => {
    if (!docJson) return '';
    try {
      return generateText(docJson, extensions);
    } catch (err) {
      console.error('Failed to generate text from docJson:', err);
      return '';
    }
  }, [docJson, extensions]);

  const translatedText = useMemo(() => prepareDiffText(translatedTextRaw), [translatedTextRaw]);

  // 단어 수 계산
  const sourceWordCount = useMemo(() => {
    if (!sourceHtml) return 0;
    // placeholder 이미지([Image] 라벨)가 단어로 집계되지 않도록 공용 카운터 사용
    return countTotalWords(sourceHtml);
  }, [sourceHtml]);

  // source/translation 단어 수는 동일 알고리즘(countTotalWords)으로 세어 분량 비교가 일관되게 한다.
  const translationWordCount = useMemo(() => countTotalWords(translatedTextRaw), [translatedTextRaw]);

  // docJson이 비동기로 들어오므로, 에디터가 이미 생성된 뒤에도 content를 갱신해줘야 합니다.
  useEffect(() => {
    if (!editor) return;
    if (!docJson) return;
    // setContent는 내부적으로 selection을 바꾸므로, focus는 건드리지 않습니다.
    editor.commands.setContent(docJson);
  }, [editor, docJson]);

  return (
    <Modal open onClose={handleRequestClose} labelId="translate-preview-title" className="!z-[210] bg-black/40 p-3 sm:p-6" closeOnOverlay={false}>
      <div className="w-full max-w-6xl h-[85dvh] max-h-[calc(100dvh-1.5rem)] min-h-0 bg-editor-bg border border-editor-border rounded-lg overflow-hidden flex flex-col">
        <div className="h-12 shrink-0 px-4 border-b border-editor-border flex items-center justify-between bg-editor-surface">
          <div className="flex items-center gap-4">
            <div id="translate-preview-title" className="text-sm font-medium text-editor-text">
              {title ?? t('editor.previewDefaultTitle')}
            </div>
            {originalText.trim().length > 0 && !isLoading && !error && (
              <div className="flex bg-editor-bg border border-editor-border rounded-md p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('preview')}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${viewMode === 'preview' ? 'bg-editor-surface text-primary-500 font-bold' : 'text-editor-muted hover:text-editor-text'}`}
                >
                  {t('editor.preview')}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('diff')}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${viewMode === 'diff' ? 'bg-editor-surface text-primary-500 font-bold' : 'text-editor-muted hover:text-editor-text'}`}
                >
                  {t('editor.diff')}
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isLoading && onCancel && (
              <button
                type="button"
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-editor-bg text-editor-text hover:bg-editor-border transition-colors"
                onClick={onCancel}
                title={t('common.cancel')}
              >
                {t('common.cancel')}
              </button>
            )}
            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60 transition-colors flex items-center gap-1.5"
              onClick={handleApply}
              disabled={isLoading || !docJson || isApplying || (selectiveActive && selectedCount === 0)}
              title={t('common.apply')}
              data-testid="translate-preview-apply-button"
            >
              {isApplying ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{t('common.loading')}</span>
                </>
              ) : selectiveActive && selectedCount < changeUnits.length ? (
                t('editor.applySelected', '선택한 {{count}}개 적용', { count: selectedCount })
              ) : (
                t('common.apply')
              )}
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-editor-bg text-editor-text hover:bg-editor-border transition-colors"
              onClick={handleRequestClose}
              title={t('common.close')}
            >
              {t('common.close')}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {isLoading ? (
            <>
              <div className="flex-1 min-h-0 grid grid-cols-2 gap-0 overflow-hidden">
                <div className="min-w-0 min-h-0 flex flex-col border-r border-editor-border overflow-hidden">
                  <div className="h-10 flex-shrink-0 px-4 flex items-center justify-between bg-editor-surface border-b border-editor-border">
                    <span className="text-[11px] font-bold text-editor-muted uppercase tracking-wider">
                      {t('editor.source')}
                    </span>
                    <span className="text-[10px] text-editor-muted">
                      {sourceWordCount.toLocaleString()} {t('editor.words')}
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4 bg-editor-surface">
                    {sourceHtml ? (
                      <div
                        className="tiptap ProseMirror focus:outline-none max-w-none"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(sourceHtml, { FORBID_TAGS: ['img'] }) }}
                      />
                    ) : (
                      <SkeletonParagraph seed={0} lines={9} />
                    )}
                  </div>
                </div>
                <div className="min-w-0 min-h-0 flex flex-col overflow-hidden">
                  <div className="h-10 flex-shrink-0 px-4 flex items-center justify-between bg-editor-surface border-b border-editor-border">
                    <span className="text-[11px] font-bold text-editor-muted uppercase tracking-wider">
                      {t('editor.target')}
                    </span>
                    <span className="text-[10px] text-editor-muted">
                      {isLoading ? '—' : `${translationWordCount.toLocaleString()} ${t('editor.words')}`}
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 p-4 overflow-y-auto scrollbar-thin">
                    {streamingText ? (
                      <div className="whitespace-pre-wrap font-mono text-sm text-editor-text leading-relaxed">
                        {streamingText}
                        <span className="inline-block w-2 h-4 bg-primary-500 animate-pulse ml-0.5 align-middle" />
                      </div>
                    ) : (
                      <SkeletonParagraph seed={1} lines={9} />
                    )}
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0 px-4 py-3 border-t border-editor-border bg-editor-bg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="text-[11px] font-medium shimmer-text">
                      {progress && progress.total > 1 ? (
                        <>
                          {t('editor.generatingTranslation')} ({progress.completed}/{progress.total} {t('editor.chunks', '섹션')})
                        </>
                      ) : (
                        t('editor.generatingTranslation')
                      )}
                      <span className="sr-only" aria-live="polite">
                        {t('editor.generatingTranslationAria')}
                      </span>
                    </div>
                    {/* 경과 시간 표시 */}
                    <span className="text-[10px] text-editor-muted tabular-nums">
                      {formatElapsedTime(elapsedSeconds)}
                    </span>
                  </div>
                  {progress && progress.total > 1 && (
                    <div className="flex items-center gap-2">
                      <div className="w-32 h-1.5 bg-editor-border rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary-500 transition-all duration-300 ease-out"
                          style={{ width: `${Math.round((progress.completed / progress.total) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-editor-muted tabular-nums">
                        {Math.round((progress.completed / progress.total) * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : error ? (
            <div className="h-full flex items-center justify-center p-6">
              <div className="max-w-xl w-full bg-editor-surface border border-editor-border rounded-lg p-4">
                <div className="text-sm font-medium text-severity-critical">
                  {t('editor.previewError')}
                </div>
                <div className="mt-2 text-sm text-editor-muted whitespace-pre-wrap">
                  {error}
                </div>
                {onRetry && (
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={onRetry}
                      className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary-500 text-white hover:bg-primary-600 transition-colors"
                    >
                      {t('common.retry')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : viewMode === 'diff' && originalText.trim().length > 0 ? (
            <div className="h-full flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 relative">
                {selectiveActive ? (
                  <SelectiveDiffList
                    units={changeUnits}
                    selectedIds={selectedUnitIds}
                    onToggle={toggleUnit}
                    onToggleAll={toggleAllUnits}
                  />
                ) : (
                  <VisualDiffViewer
                    original={originalText}
                    suggested={translatedText}
                    className="h-full border-none rounded-none"
                  />
                )}
                {isApplying && (
                  <div className="absolute inset-0 bg-editor-bg/80 backdrop-blur-[1px] flex items-center justify-center z-10">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                      <div className="text-sm font-medium">{t('editor.applyingChanges')}</div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex-shrink-0 px-4 py-2 border-t border-editor-border bg-editor-bg flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-editor-muted">
                    {t('editor.sourceLabel')} {countTotalWords(originalText).toLocaleString()} {t('editor.words')}
                  </span>
                  {finalElapsedSeconds !== null && (
                    <span className="text-[10px] text-primary-500 tabular-nums">
                      {t('editor.completedIn', '완료')} {formatElapsedTime(finalElapsedSeconds)}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-editor-muted">
                  {t('editor.translationLabel')} {translationWordCount.toLocaleString()} {t('editor.words')}
                </span>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 p-4 overflow-hidden relative">
                <div className="tiptap-wrapper h-full">
                  {editor ? (
                    <EditorContent editor={editor} className="h-full" />
                  ) : (
                    <div className="h-full animate-pulse bg-editor-surface rounded-md" />
                  )}
                </div>
                {isApplying && (
                  <div className="absolute inset-0 bg-editor-bg/80 backdrop-blur-[1px] flex items-center justify-center z-10">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                      <div className="text-sm font-medium">{t('editor.applyingChanges')}</div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex-shrink-0 px-4 py-2 border-t border-editor-border bg-editor-bg flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {finalElapsedSeconds !== null && (
                    <span className="text-[10px] text-primary-500 tabular-nums">
                      {t('editor.completedIn', '완료')} {formatElapsedTime(finalElapsedSeconds)}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-editor-muted">
                  {translationWordCount.toLocaleString()} {t('editor.words')}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
