import * as Diff from 'diff';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import type {
  ContextManifest,
  ContextReferenceOptions,
  SelectionContext,
} from '@/types';
import type { SourceAlignmentPrecision } from '@/editor/utils/alignedSelectionRange';

interface SelectionEditPreviewModalProps {
  open: boolean;
  selection: SelectionContext | null;
  sourceText: string;
  sourceAlignmentPrecision?: SourceAlignmentPrecision | undefined;
  replacementText: string;
  instruction: string;
  referenceOptions: ContextReferenceOptions;
  contextManifest: ContextManifest | undefined;
  isLoading: boolean;
  error: string | null | undefined;
  proposalOnly?: boolean;
  onInstructionChange: (value: string) => void;
  onReferenceOptionsChange: (value: ContextReferenceOptions) => void;
  onGenerate: () => void;
  onApply: () => void;
  onClose: () => void;
  /** 수정안을 손으로 고칠 수 있게 한다. 없으면 읽기 전용(채팅 제안 미리보기). */
  onReplacementChange?: (value: string) => void;
}

const OPTION_KEYS: Array<{
  key: keyof ContextReferenceOptions;
  label: string;
}> = [
  { key: 'translationRules', label: 'selection.reference.translationRules' },
  { key: 'forbiddenTerms', label: 'selection.reference.forbiddenTerms' },
  { key: 'glossary', label: 'selection.reference.glossary' },
  { key: 'projectContext', label: 'selection.reference.projectContext' },
];

export function SelectionEditPreviewModal({
  open,
  selection,
  sourceText,
  sourceAlignmentPrecision,
  replacementText,
  instruction,
  referenceOptions,
  contextManifest,
  isLoading,
  error,
  proposalOnly = false,
  onInstructionChange,
  onReferenceOptionsChange,
  onGenerate,
  onApply,
  onClose,
  onReplacementChange,
}: SelectionEditPreviewModalProps): JSX.Element | null {
  const { t } = useTranslation();
  const [editingProposal, setEditingProposal] = useState(false);
  // 모달을 닫거나 재생성이 시작되면 편집 모드를 해제한다(스트리밍 중 편집 금지).
  useEffect(() => {
    if (!open || isLoading) setEditingProposal(false);
  }, [open, isLoading]);
  const changes = useMemo(
    () => selection && replacementText
      ? Diff.diffWords(selection.text, replacementText)
      : [],
    [selection, replacementText],
  );
  if (!open || !selection) return null;

  const canEditProposal = Boolean(onReplacementChange && replacementText && !isLoading);

  const alignmentLabel = sourceAlignmentPrecision === 'selection'
    ? t('selection.alignment.selection', 'AI 구절 대응')
    : sourceAlignmentPrecision === 'sentence'
      ? t('selection.alignment.sentence', '문장 단위 대응')
      : sourceAlignmentPrecision === 'unit'
        ? t('selection.alignment.unit', '문단 단위 참고')
        : null;

  return (
    <Modal open={open} onClose={onClose} labelId="selection-edit-title">
      <div className="absolute inset-0 bg-black/35" aria-hidden />
      <div
        data-testid="selection-edit-modal"
        className="relative z-10 w-[min(720px,calc(100vw-32px))] max-h-[85vh] overflow-y-auto rounded-2xl border border-editor-border bg-editor-surface p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="selection-edit-title" className="text-base font-semibold text-editor-text">
              {t('selection.retranslateTitle', '선택 영역 재번역')}
            </h2>
            <p className="mt-1 text-xs text-editor-muted">
              {t('selection.retranslateDescription', '연결된 원문을 기준으로 선택한 번역문만 바꿉니다.')}
            </p>
          </div>
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-editor-muted hover:bg-editor-border/60"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <section className="rounded-xl border border-editor-border bg-editor-bg p-3">
            <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase text-editor-muted">
              <span>Source</span>
              {alignmentLabel && (
                <span
                  data-testid="selection-source-alignment-precision"
                  className="normal-case font-medium text-primary-500"
                >
                  {alignmentLabel}
                </span>
              )}
            </div>
            <div className="whitespace-pre-wrap text-sm text-editor-text">{sourceText}</div>
          </section>
          <section className="rounded-xl border border-editor-border bg-editor-bg p-3">
            <div className="mb-1 text-[10px] font-semibold uppercase text-editor-muted">Target</div>
            <div className="whitespace-pre-wrap text-sm text-editor-text">{selection.text}</div>
          </section>
        </div>

        {!proposalOnly && <label className="mt-4 block">
          <span className="text-xs font-medium text-editor-text">
            {t('selection.instruction', '추가 지시사항')}
          </span>
          <textarea
            data-testid="selection-edit-instruction"
            className="mt-1 min-h-20 w-full rounded-xl border border-editor-border bg-editor-bg px-3 py-2 text-sm text-editor-text outline-none focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
            value={instruction}
            onChange={(event) => onInstructionChange(event.target.value)}
            placeholder={t('selection.instructionPlaceholder', '예: 더 간결하고 자연스럽게')}
            disabled={isLoading}
          />
        </label>}

        {!proposalOnly && <fieldset className="mt-3">
          <legend className="text-xs font-medium text-editor-text">
            {t('selection.optionalReferences', '선택적 컨텍스트')}
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {OPTION_KEYS.map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center gap-2 rounded-lg border border-editor-border bg-editor-bg px-3 py-2 text-xs text-editor-text"
              >
                <input
                  data-testid={`selection-reference-${key}`}
                  type="checkbox"
                  checked={referenceOptions[key]}
                  onChange={(event) =>
                    onReferenceOptionsChange({
                      ...referenceOptions,
                      [key]: event.target.checked,
                    })
                  }
                  disabled={isLoading}
                />
                {t(label)}
              </label>
            ))}
          </div>
        </fieldset>}

        {(replacementText || isLoading) && (
          <section className="mt-4 rounded-xl border border-primary-300/70 bg-primary-50/40 p-3 dark:bg-primary-950/20">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-editor-text">
                {t('selection.proposal', '수정안')}
              </span>
              {canEditProposal && (
                <button
                  type="button"
                  data-testid="selection-edit-proposal-toggle"
                  className="rounded px-2 py-0.5 text-[11px] font-medium text-primary-500 hover:bg-primary-100/60 dark:hover:bg-primary-900/40"
                  onClick={() => setEditingProposal((value) => !value)}
                >
                  {editingProposal
                    ? t('selection.previewChanges', '변경 미리보기')
                    : t('selection.editProposal', '직접 수정')}
                </button>
              )}
            </div>
            {replacementText ? (
              editingProposal && canEditProposal ? (
                <textarea
                  data-testid="selection-edit-proposal-editor"
                  className="min-h-24 w-full rounded-lg border border-editor-border bg-editor-bg px-3 py-2 text-sm leading-relaxed text-editor-text outline-none focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
                  value={replacementText}
                  onChange={(event) => onReplacementChange?.(event.target.value)}
                  autoFocus
                />
              ) : (
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {changes.map((change, index) => (
                    <span
                      key={`${index}-${change.value}`}
                      className={
                        change.added
                          ? 'bg-diff-insertion-bg text-editor-text'
                          : change.removed
                            ? 'bg-diff-deletion-bg text-editor-text line-through decoration-diff-deletion'
                            : 'text-editor-text'
                      }
                    >
                      {change.value}
                    </span>
                  ))}
                </div>
              )
            ) : (
              <div className="text-sm text-editor-muted">
                {t('selection.generating', '수정안을 생성하는 중…')}
              </div>
            )}
          </section>
        )}

        {contextManifest && (
          <div className="mt-2 text-[10px] text-editor-muted">
            {t('chat.contextReferences', '참조')}: {contextManifest.included.join(' · ')}
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-xs text-severity-critical-deep">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-testid="selection-edit-cancel-button"
            className="rounded-lg border border-editor-border px-3 py-2 text-sm text-editor-muted hover:bg-editor-border/60"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
          {!proposalOnly && replacementText && !isLoading && (
            <button
              type="button"
              data-testid="selection-edit-regenerate-button"
              className="rounded-lg border border-primary-300 px-3 py-2 text-sm font-medium text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-950/40"
              onClick={onGenerate}
            >
              {t('selection.regenerate', '재번역')}
            </button>
          )}
          <button
            type="button"
            data-testid="selection-edit-primary-button"
            className="rounded-lg bg-primary-500 px-3 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
            onClick={replacementText && !isLoading ? onApply : onGenerate}
            disabled={isLoading || (!replacementText && !sourceText.trim())}
          >
            {replacementText
              ? t('common.apply', '적용')
              : isLoading
                ? t('editor.translating')
                : t('selection.generate', '재번역')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
