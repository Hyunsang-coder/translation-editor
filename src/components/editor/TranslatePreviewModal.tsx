import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorContent, useEditor } from '@tiptap/react';
import { generateText } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import DOMPurify from 'dompurify';
import { stripHtml } from '@/utils/hash';
import type { TipTapDocJson } from '@/ai/translateDocument';
import { VisualDiffViewer } from '@/components/ui/VisualDiffViewer';
import { SkeletonParagraph } from '@/components/ui/Skeleton';

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

/**
 * 단어 수 계산 (공백 기준)
 */
function countWords(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function TranslatePreviewModal(props: {
  open: boolean;
  title?: string;
  docJson: TipTapDocJson | null;
  sourceHtml?: string | null;
  originalHtml?: string | null;
  isLoading?: boolean;
  error?: string | null;
  onClose: () => void;
  onApply: () => void;
}): JSX.Element | null {
  const { t } = useTranslation();
  const { open, title, docJson, sourceHtml, originalHtml, isLoading, error, onClose, onApply } = props;
  // const theme = useUIStore((s) => s.theme);
  const [viewMode, setViewMode] = useState<'preview' | 'diff'>('preview');
  const [isApplying, setIsApplying] = useState(false); // 추가: 적용 중 상태
  const [diffOriginalHtmlSnapshot, setDiffOriginalHtmlSnapshot] = useState<string | null>(null);

  // Diff의 기준(original)은 모달을 열 때의 target 상태로 스냅샷 고정합니다.
  // Apply로 targetDocument가 바뀌어도 DiffEditor의 모델이 갈아끼워지지 않게 해서
  // "TextModel got disposed before ... reset" 레이스를 피합니다.
  useEffect(() => {
    if (open) {
      setDiffOriginalHtmlSnapshot(originalHtml ?? '');
    } else {
      setDiffOriginalHtmlSnapshot(null);
    }
  }, [open]);

  // 모달이 닫힐 때 상태 초기화
  useEffect(() => {
    if (!open) {
      setIsApplying(false);
    }
  }, [open]);

  // Apply 핸들러 래퍼
  const handleApply = (): void => {
    if (isApplying) return;
    setIsApplying(true);
    onApply();
    // onApply 호출 후 부모 컴포넌트가 open=false로 만들면 모달이 닫힘
  };

  // originalHtml이 있고 내용이 있으면 기본적으로 diff 모드로 보여줍니다.
  useEffect(() => {
    const baseHtml = (diffOriginalHtmlSnapshot ?? originalHtml) ?? '';
    if (open && baseHtml && stripHtml(baseHtml).trim().length > 0) {
      setViewMode('diff');
    } else {
      setViewMode('preview');
    }
  }, [open, originalHtml, diffOriginalHtmlSnapshot]);

  const content = useMemo(() => docJson ?? null, [docJson]);

  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: 'tiptap-link' },
    }),
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

  const translatedText = useMemo(() => {
    if (!docJson) return '';
    try {
      // TipTap JSON을 plain text로 변환 (Heading 등 구조 반영)
      const raw = generateText(docJson, extensions);
      return prepareDiffText(raw);
    } catch (err) {
      console.error('Failed to generate text from docJson:', err);
      return '';
    }
  }, [docJson, extensions]);

  // 단어 수 계산
  const sourceWordCount = useMemo(() => {
    if (!sourceHtml) return 0;
    return countWords(stripHtml(sourceHtml));
  }, [sourceHtml]);

  const translationWordCount = useMemo(() => {
    if (!docJson) return 0;
    try {
      const text = generateText(docJson, extensions);
      return countWords(text);
    } catch {
      return 0;
    }
  }, [docJson, extensions]);

  // docJson이 비동기로 들어오므로, 에디터가 이미 생성된 뒤에도 content를 갱신해줘야 합니다.
  useEffect(() => {
    if (!editor) return;
    if (!open) return;
    if (!docJson) return;
    // setContent는 내부적으로 selection을 바꾸므로, focus는 건드리지 않습니다.
    editor.commands.setContent(docJson);
  }, [editor, open, docJson]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-6">
      <div className="w-full max-w-6xl h-[85vh] bg-editor-bg border border-editor-border rounded-lg overflow-hidden flex flex-col">
        <div className="h-12 px-4 border-b border-editor-border flex items-center justify-between bg-editor-surface">
          <div className="flex items-center gap-4">
            <div className="text-sm font-medium text-editor-text">
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
            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60 transition-colors flex items-center gap-1.5"
              onClick={handleApply}
              disabled={isLoading || !docJson || isApplying}
              title={t('common.apply')}
            >
              {isApplying ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{t('common.loading')}</span>
                </>
              ) : (
                t('common.apply')
              )}
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-editor-bg text-editor-text hover:bg-editor-border transition-colors"
              onClick={onClose}
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
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(sourceHtml) }} 
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
                    <SkeletonParagraph seed={1} lines={9} />
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0 px-4 py-3 border-t border-editor-border bg-editor-bg">
                <div className="text-[11px] font-medium shimmer-text">
                  {t('editor.generatingTranslation')}
                  <span className="sr-only" aria-live="polite">
                    {t('editor.generatingTranslationAria')}
                  </span>
                </div>
              </div>
            </>
          ) : error ? (
            <div className="h-full flex items-center justify-center p-6">
              <div className="max-w-xl w-full bg-editor-surface border border-editor-border rounded-lg p-4">
                <div className="text-sm font-medium text-red-600 dark:text-red-400">
                  {t('editor.previewError')}
                </div>
                <div className="mt-2 text-sm text-editor-muted whitespace-pre-wrap">
                  {error}
                </div>
              </div>
            </div>
          ) : viewMode === 'diff' && originalText.trim().length > 0 ? (
            <div className="h-full flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 relative">
                <VisualDiffViewer
                  original={originalText}
                  suggested={translatedText}
                  className="h-full border-none rounded-none"
                />
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
                <span className="text-[10px] text-editor-muted">
                  {t('editor.sourceLabel')} {countWords(originalText).toLocaleString()} {t('editor.words')}
                </span>
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
              <div className="flex-shrink-0 px-4 py-2 border-t border-editor-border bg-editor-bg flex items-center justify-end gap-4">
                <span className="text-[10px] text-editor-muted">
                  {translationWordCount.toLocaleString()} {t('editor.words')}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


