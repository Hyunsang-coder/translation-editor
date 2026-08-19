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
import type { SelectionEditMode } from '@/ai/retranslateSelection';

/**
 * 부분 재번역에서 고른 블록 하나(표 셀 또는 문단). 여러 블록 재번역은 경계가
 * 무너지면 안 되므로 한 덩어리 텍스트로 합쳐 보여주지 않는다 (손편집도 막는다).
 */
export interface SelectionEditCell {
  /** 짝을 못 찾으면 빈 문자열 — 그 블록은 원문 없이 기존 번역문만 다듬는다. */
  sourceText: string;
  currentText: string;
  replacementText: string;
  /** 이 셀이 속한 열의 헤더 — 모델에 문맥으로 들어간 것을 사용자에게도 보여준다. */
  columnHeader?: { source?: string; target: string } | undefined;
}

interface SelectionEditPreviewModalProps {
  open: boolean;
  selection: SelectionContext | null;
  /** 재번역은 원문을 기준으로 다시 옮기고, 폴리싱은 의미를 둔 채 표현만 다듬는다. */
  mode?: SelectionEditMode;
  sourceText: string;
  sourceAlignmentPrecision?: SourceAlignmentPrecision | undefined;
  replacementText: string;
  /** 있으면 셀마다 원문/현재/제안을 나눠 보여준다. 없으면 기존 단일 선택 화면. */
  cells?: SelectionEditCell[] | undefined;
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

/** 좌우 비교 diff. 삽입·삭제를 한 줄에 섞으면 취소선 사이로 문장이 끊겨 읽기 어렵다. */
function ProposalDiff({
  original,
  suggested,
}: {
  original: string;
  suggested: string;
}): JSX.Element {
  const { t } = useTranslation();
  const changes = useMemo(() => Diff.diffWords(original, suggested), [original, suggested]);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0 sm:border-r sm:border-editor-hairline/40 sm:pr-3">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-severity-critical/80">
          {t('editor.selectiveDiff.original', '기존')}
        </div>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-editor-muted">
          {changes.map((change, index) =>
            change.added ? null : change.removed ? (
              <span
                key={`${index}-${change.value}`}
                className="bg-diff-deletion-bg text-editor-text line-through decoration-diff-deletion decoration-1 rounded-[2px] px-0.5"
              >
                {change.value}
              </span>
            ) : (
              <span key={`${index}-${change.value}`}>{change.value}</span>
            ),
          )}
        </div>
      </div>
      <div className="min-w-0">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-diff-insertion/80">
          {t('editor.selectiveDiff.suggested', '제안')}
        </div>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-editor-text">
          {changes.map((change, index) =>
            change.removed ? null : change.added ? (
              <span
                key={`${index}-${change.value}`}
                className="bg-diff-insertion-bg text-editor-text rounded-[2px] px-0.5"
              >
                {change.value}
              </span>
            ) : (
              <span key={`${index}-${change.value}`}>{change.value}</span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

const OPTION_KEYS: Array<{
  key: keyof ContextReferenceOptions;
  label: string;
}> = [
  { key: 'translationRules', label: 'selection.reference.translationRules' },
  { key: 'forbiddenTerms', label: 'selection.reference.forbiddenTerms' },
  { key: 'glossary', label: 'selection.reference.glossary' },
  { key: 'projectMemory', label: 'selection.reference.projectMemory' },
];

export function SelectionEditPreviewModal({
  open,
  selection,
  mode = 'retranslate',
  sourceText,
  sourceAlignmentPrecision,
  replacementText,
  cells,
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
  if (!open || !selection) return null;

  // 여러 셀일 때는 제안이 셀마다 따로 있다. 하나라도 오면 "적용" 단계로 넘어간다.
  const hasProposal = cells
    ? cells.some((cell) => Boolean(cell.replacementText))
    : Boolean(replacementText);
  // 손편집은 셀 경계를 무너뜨릴 수 있어 여러 셀에서는 막는다 (D5).
  const canEditProposal = Boolean(
    !cells && onReplacementChange && replacementText && !isLoading,
  );

  const isPolish = mode === 'polish';
  // 폴리싱은 원문 없이도 진행한다 — 그 경우 Source 카드를 비워 두지 않고 아예 뺀다.
  const showSourceCard = Boolean(sourceText.trim());
  const actionLabel = isPolish
    ? t('selection.polishAction', '폴리싱')
    : t('selection.generate', '재번역');

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
              {cells
                ? isPolish
                  ? t('selection.tableCellsPolishTitle', { count: cells.length })
                  : t('selection.tableCellsRetranslateTitle', { count: cells.length })
                : isPolish
                  ? t('selection.polishTitle', '선택 영역 폴리싱')
                  : t('selection.retranslateTitle', '선택 영역 재번역')}
            </h2>
            <p className="mt-1 text-xs text-editor-muted">
              {cells
                ? isPolish
                  ? t('selection.tableCellsPolishDescription')
                  : t('selection.tableCellsRetranslateDescription')
                : isPolish
                  ? t('selection.polishDescription', '현재 번역문의 의미는 그대로 두고 표현만 자연스럽게 다듬습니다.')
                  : t('selection.retranslateDescription', '연결된 원문을 기준으로 선택한 번역문만 바꿉니다.')}
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

        {cells ? (
          // 셀마다 원문·현재·제안을 따로 보여준다. 이어 붙여 보여주면 어느 제안이 어느
          // 셀로 가는지가 흐려지고, 손편집이 열리면 셀 경계가 무너진다.
          <div className="mt-4 space-y-3">
            {cells.map((cell, index) => (
              <section
                key={index}
                data-testid="selection-edit-cell"
                className="rounded-xl border border-editor-border bg-editor-bg p-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase text-editor-muted">
                  <span>{t('selection.tableCellLabel', { index: index + 1 })}</span>
                  {cell.columnHeader && (
                    <span className="normal-case font-medium text-primary-500">
                      {t('selection.tableColumnHeaderLabel', {
                        header: [cell.columnHeader.source, cell.columnHeader.target]
                          .filter(Boolean)
                          .join(' / '),
                      })}
                    </span>
                  )}
                </div>
                {cell.sourceText ? (
                  <div className="mb-2 whitespace-pre-wrap text-xs text-editor-muted">
                    {cell.sourceText}
                  </div>
                ) : isPolish ? (
                  // 폴리싱은 원문이 없어도 정상 경로다 — 경고가 아니라 사실만 적는다
                  <div className="mb-2 text-xs text-editor-muted">
                    {t('selection.sourceUnavailable', '원문 없이 번역문만 다듬습니다')}
                  </div>
                ) : (
                  // 원문 없이 기존 번역문만 다듬은 블록 — 적용 전에 구분되어야 한다
                  <div className="mb-2 text-xs font-medium text-severity-major-deep">
                    {t('selection.segmentSourceMissing')}
                  </div>
                )}
                {cell.replacementText ? (
                  <ProposalDiff original={cell.currentText} suggested={cell.replacementText} />
                ) : (
                  <div className="whitespace-pre-wrap text-sm text-editor-text">
                    {cell.currentText}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className={`mt-4 grid gap-3 ${showSourceCard ? 'sm:grid-cols-2' : ''}`}>
            {showSourceCard && (
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
            )}
            <section className="rounded-xl border border-editor-border bg-editor-bg p-3">
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase text-editor-muted">
                <span>Target</span>
                {/* 원문 카드가 빠진 이유를 카드 안에서 밝힌다 — 폴리싱에서만 생기는 상태 */}
                {isPolish && !showSourceCard && (
                  <span className="normal-case font-medium text-editor-muted">
                    {t('selection.sourceUnavailable', '원문 없이 번역문만 다듬습니다')}
                  </span>
                )}
              </div>
              <div className="whitespace-pre-wrap text-sm text-editor-text">{selection.text}</div>
            </section>
          </div>
        )}

        {!proposalOnly && <label className="mt-4 block">
          <span className="text-xs font-medium text-editor-text">
            {t('selection.instruction', '추가 지시사항')}
          </span>
          <textarea
            data-testid="selection-edit-instruction"
            className="mt-1 min-h-20 w-full rounded-xl border border-editor-border bg-editor-bg px-3 py-2 text-sm text-editor-text outline-none focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
            value={instruction}
            onChange={(event) => onInstructionChange(event.target.value)}
            placeholder={
              isPolish
                ? t('selection.polishInstructionPlaceholder', '예: 더 간결하게, 문어체로')
                : t('selection.instructionPlaceholder', '예: 더 간결하고 자연스럽게')
            }
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

        {!cells && (replacementText || isLoading) && (
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
                // SelectiveDiffList(폴리싱)와 같은 좌우 비교
                <ProposalDiff original={selection.text} suggested={replacementText} />
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
          {!proposalOnly && hasProposal && !isLoading && (
            <button
              type="button"
              data-testid="selection-edit-regenerate-button"
              className="rounded-lg border border-primary-300 px-3 py-2 text-sm font-medium text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-950/40"
              onClick={onGenerate}
            >
              {actionLabel}
            </button>
          )}
          <button
            type="button"
            data-testid="selection-edit-primary-button"
            className="rounded-lg bg-primary-fill px-3 py-2 text-sm font-medium text-white hover:bg-primary-fill-hover disabled:opacity-50"
            onClick={hasProposal && !isLoading ? onApply : onGenerate}
            // 폴리싱은 원문이 없어도 실행된다 — 있어야 하는 건 다듬을 번역문뿐이다.
            disabled={
              isLoading ||
              (!hasProposal && !(isPolish ? selection.text.trim() : sourceText.trim()))
            }
          >
            {hasProposal
              ? t('common.apply', '적용')
              : isLoading
                ? isPolish
                  ? t('editor.polishing')
                  : t('editor.translating')
                : actionLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
