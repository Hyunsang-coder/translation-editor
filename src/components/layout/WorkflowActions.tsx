import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, ClipboardCheck, Highlighter, SlidersHorizontal } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useShallow } from 'zustand/shallow';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore } from '@/stores/reviewStore';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { Select, type SelectOption } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { RecentInstructions } from '@/components/ui/RecentInstructions';
import { useInstructionHistoryStore } from '@/stores/instructionHistoryStore';
import { PROVIDER_LABELS, type SelectableProvider } from '@/ai/config';
import { stripHtml } from '@/utils/hash';
import { shortcutLabel } from '@/utils/platform';

/** 검수·폴리싱 버튼의 공통 골격. 상태별 테두리/배경만 갈아끼운다. */
const SECONDARY_BUTTON_CLASS =
  'h-[34px] px-2.5 rounded-md border text-[13px] font-semibold flex items-center gap-1.5 transition-colors '
  + 'disabled:cursor-not-allowed '
  + 'focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2';

// 툴바 헤더가 bg-editor-surface라 hover도 surface면 아무 변화가 없다 (다른 툴바 버튼과 동일하게 border 색을 쓴다).
// 흐리게 처리는 idle 쪽에만 둔다 — 실행 중에도 disabled지만 그때는 진행 표시라 또렷해야 한다.
const SECONDARY_IDLE_CLASS = 'border-editor-border text-editor-text hover:bg-editor-border disabled:opacity-50';
const SECONDARY_RUNNING_CLASS = 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400';

const SHORTCUT_CHIP_CLASS = 'text-[11px] px-1 py-0.5 bg-editor-border/60 text-editor-muted rounded';

/**
 * 상단 툴바의 AI 워크플로 액션 (번역 · 검수 · 폴리싱) + 모델 선택.
 *
 * 세 액션 모두 "클릭 → 시작 모달 → 실행"으로 동작한다. 실행 로직은 각 소유자가
 * 갖고 있어(번역·폴리싱은 `EditorCanvasTipTap`, 검수는 `ReviewPanel`) 여기서는
 * `uiStore`의 nonce 트리거만 올린다. 진행 상태는 `uiStore.translateLoading` /
 * `polishLoading`과 `reviewStore.isReviewing`으로 되돌려 받아 버튼에 표시한다.
 *
 * 검수 모달만 여기 있는 이유: `ReviewPanel`은 사이드바가 닫혀 있으면 언마운트라
 * 모달을 열 수 없다. 실행 요청은 `reviewStore.requestReviewRun`이 상태로 들고
 * 있다가 패널이 마운트되면 소비한다.
 *
 * 앱 설정 모달은 부모(`Toolbar`)가 이미 갖고 있어서 여는 것만 콜백으로 받는다.
 */
interface WorkflowActionsProps {
  /** provider 드롭다운의 '상세 설정' 항목 — 앱 설정의 용도별 모델 지정으로 보낸다. */
  onOpenModelSettings: () => void;
}

export function WorkflowActions({ onOpenModelSettings }: WorkflowActionsProps): JSX.Element {
  const { t } = useTranslation();

  const { translateLoading, polishLoading, reviewTrigger, triggerTranslate, triggerPolish, triggerReview, openReviewPanel } = useUIStore(
    useShallow((s) => ({
      translateLoading: s.translateLoading,
      polishLoading: s.polishLoading,
      reviewTrigger: s.reviewTrigger,
      triggerTranslate: s.triggerTranslate,
      triggerPolish: s.triggerPolish,
      triggerReview: s.triggerReview,
      openReviewPanel: s.openReviewPanel,
    }))
  );

  const projectId = useProjectStore((s) => s.project?.id);
  const targetDocument = useProjectStore((s) => s.targetDocument);
  const hasTargetContent = useMemo(
    () => stripHtml(targetDocument || '').trim().length > 0,
    [targetDocument],
  );

  const issueCount = useReviewStore((s) => s.getAllIssues().length);
  const isReviewing = useReviewStore((s) => s.isReviewing);

  // 검수 시작 모달 (⌘R 단축키도 uiStore nonce를 통해 같은 모달을 연다)
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewInstruction, setReviewInstruction] = useState('');

  const openReviewModal = useCallback(() => {
    if (useReviewStore.getState().isReviewing) return;
    setReviewInstruction('');
    setReviewModalOpen(true);
  }, []);

  const prevReviewTriggerRef = useRef(reviewTrigger);
  useEffect(() => {
    if (reviewTrigger > prevReviewTriggerRef.current) openReviewModal();
    prevReviewTriggerRef.current = reviewTrigger;
  }, [reviewTrigger, openReviewModal]);

  const startReview = useCallback(() => {
    setReviewModalOpen(false);
    openReviewPanel();
    useInstructionHistoryStore.getState().recordInstruction(
      useProjectStore.getState().project?.id,
      'review',
      reviewInstruction,
    );
    useReviewStore.getState().requestReviewRun(reviewInstruction);
  }, [openReviewPanel, reviewInstruction]);

  const openaiEnabled = useAiConfigStore((s) => s.openaiEnabled);
  const anthropicEnabled = useAiConfigStore((s) => s.anthropicEnabled);
  const provider = useAiConfigStore((s) => s.provider);
  const setProvider = useAiConfigStore((s) => s.setProvider);

  // 비활성 provider가 선택되는 상황은 aiConfigStore의 enable 토글이 막는다.
  // 현재 선택은 목록에 없더라도 항상 노출해 조용히 바뀌지 않게 한다.
  const providerOptions = useMemo((): SelectOption[] => {
    const enabled: SelectableProvider[] = [];
    if (anthropicEnabled) enabled.push('anthropic');
    if (openaiEnabled) enabled.push('openai');
    if (!enabled.includes(provider)) enabled.unshift(provider);
    return enabled.map((p) => ({ value: p, label: PROVIDER_LABELS[p] }));
  }, [openaiEnabled, anthropicEnabled, provider]);

  return (
    <>
    <div className="flex items-center gap-1.5 min-w-0 whitespace-nowrap">
      {/* 번역 실행 — 기본 액션 */}
      <button
        type="button"
        onClick={triggerTranslate}
        disabled={translateLoading}
        className="h-[34px] px-3 rounded-md bg-primary-fill text-white text-[13px] font-semibold flex items-center gap-1.5 hover:bg-primary-fill-hover active:scale-95 transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
        title={t('editor.translateTitle')}
        data-testid="editor-translate-button"
      >
        {translateLoading ? (
          <>
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span>{t('editor.translating')}</span>
          </>
        ) : (
          <>
            <Sparkles size={15} />
            <span>{t('workflow.translateDocument')}</span>
            <span className="text-[11px] px-1 py-0.5 bg-white/20 rounded">{shortcutLabel('T')}</span>
          </>
        )}
      </button>

      {/* 검수 */}
      <button
        type="button"
        onClick={triggerReview}
        disabled={isReviewing}
        className={`${SECONDARY_BUTTON_CLASS} ${isReviewing ? SECONDARY_RUNNING_CLASS : SECONDARY_IDLE_CLASS}`}
        title={t('editor.reviewTitle', '번역 검수')}
        data-testid="editor-review-button"
      >
        {isReviewing ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            <span>{t('status.reviewing', '검수 중')}</span>
          </>
        ) : (
          <>
            <ClipboardCheck size={15} />
            <span>{t('editor.review', '검수')}</span>
            {issueCount > 0 && (
              <span className="min-w-[17px] h-[17px] px-1 bg-primary-fill text-white text-[11px] font-bold rounded-sm inline-flex items-center justify-center tabular-nums">
                {issueCount}
              </span>
            )}
            <span className={SHORTCUT_CHIP_CLASS}>{shortcutLabel('R')}</span>
          </>
        )}
      </button>

      {/* 폴리싱 */}
      <button
        type="button"
        onClick={triggerPolish}
        disabled={!hasTargetContent || polishLoading}
        className={`${SECONDARY_BUTTON_CLASS} ${polishLoading ? SECONDARY_RUNNING_CLASS : SECONDARY_IDLE_CLASS}`}
        title={t('review.polish', '폴리싱')}
        data-testid="editor-polish-button"
      >
        {polishLoading ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            <span>{t('editor.polishing', '폴리싱 중…')}</span>
          </>
        ) : (
          <>
            <Highlighter size={15} />
            <span>{t('review.polish', '폴리싱')}</span>
            <span className={SHORTCUT_CHIP_CLASS}>{shortcutLabel('P')}</span>
          </>
        )}
      </button>

      <div className="w-px h-[20px] bg-editor-border mx-1 shrink-0" />

      {/* AI Provider — 워크플로 버튼보다 낮은 위계라 기존 md 사이즈를 그대로 쓴다.
          여기서 고르는 값은 provider 하나뿐이고(ADR-0012), 용도별 모델·effort를 직접
          지정하는 평가용 손잡이(ADR-0017)는 목록 맨 아래 '상세 설정'으로 보낸다 —
          드물게 쓰는 기능이라 상시 노출 대신 이 드롭다운 안에 둔다. */}
      <Select
        value={provider}
        onChange={(v) => setProvider(v as SelectableProvider)}
        options={providerOptions}
        aria-label={t('editor.providerAriaLabel')}
        title={t('editor.provider')}
        size="md"
        className="min-w-[118px]"
        data-testid="editor-provider-select"
        footerAction={{
          label: t('editor.providerAdvanced'),
          onSelect: onOpenModelSettings,
          icon: <SlidersHorizontal size={13} />,
        }}
      />
    </div>

    {/* 검수 시작 모달 — 번역/폴리싱 시작 모달과 같은 형태 */}
    {reviewModalOpen && (
      <Modal
        open
        onClose={() => setReviewModalOpen(false)}
        labelId="review-instruction-title"
        className="bg-black/50 p-4"
        closeOnOverlay={false}
      >
        <div className="bg-editor-surface border border-editor-border rounded-lg shadow-xl w-full max-w-md">
          <div className="px-4 py-3 border-b border-editor-hairline">
            <h3 id="review-instruction-title" className="text-sm font-semibold text-editor-text">
              {t('editor.reviewModal.title', '검수')}
            </h3>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-editor-muted">
              {t('editor.reviewModal.description', '원문과 번역문을 대조해 오역·누락·불일치를 찾습니다.')}
            </p>
            <div>
              <label className="text-xs font-medium text-editor-text">
                {t('editor.reviewModal.messageLabel', '추가 지시사항')}
                <span className="ml-1 text-editor-muted font-normal">
                  {t('editor.reviewModal.optional', '(선택)')}
                </span>
              </label>
              <textarea
                value={reviewInstruction}
                onChange={(e) => setReviewInstruction(e.target.value)}
                placeholder={t('editor.reviewModal.placeholder', '예: 용어 일관성 위주로 봐주세요.')}
                className="mt-1.5 w-full h-24 px-3 py-2 text-sm bg-editor-bg border border-editor-border rounded-md resize-none focus:outline-none focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2 text-editor-text placeholder:text-editor-muted"
                autoFocus
                data-testid="review-instruction-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) startReview();
                }}
              />
              <RecentInstructions
                projectId={projectId}
                kind="review"
                value={reviewInstruction}
                onPick={setReviewInstruction}
              />
            </div>
          </div>
          <div className="px-4 py-3 border-t border-editor-hairline flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setReviewModalOpen(false)}
              className="px-3 py-1.5 text-xs rounded border border-editor-border text-editor-text hover:bg-editor-bg active:scale-95 transition-colors"
            >
              {t('common.cancel', '취소')}
            </button>
            <button
              type="button"
              onClick={startReview}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-primary-fill text-white hover:bg-primary-fill-hover active:scale-95 transition-colors"
              data-testid="review-modal-start"
            >
              {t('editor.reviewModal.execute', '검수 시작')}
            </button>
          </div>
        </div>
      </Modal>
    )}
    </>
  );
}
