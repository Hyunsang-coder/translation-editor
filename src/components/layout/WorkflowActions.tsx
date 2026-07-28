import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, ClipboardCheck, Highlighter } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useShallow } from 'zustand/shallow';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore } from '@/stores/reviewStore';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { Select, type SelectOptionGroup } from '@/components/ui/Select';
import { MODEL_PRESETS } from '@/ai/config';
import { stripHtml } from '@/utils/hash';
import { shortcutLabel } from '@/utils/platform';

/**
 * 상단 툴바의 AI 워크플로 액션 (번역 → 검수 → 폴리싱) + 모델 선택.
 *
 * 실행 로직은 `EditorCanvasTipTap`이 소유한다(양쪽 TipTap 인스턴스·프리뷰 모달과
 * 결합되어 있어 이동이 불가). 여기서는 `uiStore`의 nonce 트리거만 올리고,
 * 진행 상태는 `uiStore.translateLoading` / `polishLoading`으로 되돌려 받는다.
 * `reviewStore.reviewTrigger` ← `ReviewPanel` 과 같은 패턴이다.
 */
export function WorkflowActions(): JSX.Element {
  const { t } = useTranslation();

  const { translateLoading, polishLoading, triggerTranslate, triggerPolish, openReviewPanel } = useUIStore(
    useShallow((s) => ({
      translateLoading: s.translateLoading,
      polishLoading: s.polishLoading,
      triggerTranslate: s.triggerTranslate,
      triggerPolish: s.triggerPolish,
      openReviewPanel: s.openReviewPanel,
    }))
  );

  const targetDocument = useProjectStore((s) => s.targetDocument);
  const hasTargetContent = useMemo(
    () => stripHtml(targetDocument || '').trim().length > 0,
    [targetDocument],
  );

  const issueCount = useReviewStore((s) => s.getAllIssues().length);

  const openaiEnabled = useAiConfigStore((s) => s.openaiEnabled);
  const anthropicEnabled = useAiConfigStore((s) => s.anthropicEnabled);
  const translationModel = useAiConfigStore((s) => s.translationModel);
  const setTranslationModel = useAiConfigStore((s) => s.setTranslationModel);

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
  const allTranslationModels = useMemo(
    () => enabledPresets.flatMap((g) => g.options),
    [enabledPresets],
  );

  // 선택된 모델이 비활성화된 프로바이더면 첫 번째 활성 모델로 변경
  useEffect(() => {
    if (allTranslationModels.length === 0) return;
    const firstModel = allTranslationModels[0];
    if (!firstModel) return;
    if (!allTranslationModels.some((m) => m.value === translationModel)) {
      setTranslationModel(firstModel.value);
    }
  }, [translationModel, allTranslationModels, setTranslationModel]);

  return (
    <div className="flex items-center gap-2 min-w-0">
      {/* 번역 실행 — 기본 액션 */}
      <button
        type="button"
        onClick={triggerTranslate}
        disabled={translateLoading}
        className="h-[38px] px-4 rounded-md bg-primary-500 text-white text-sm font-bold flex items-center gap-2 hover:bg-primary-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2"
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
            <Sparkles size={17} />
            <span>{t('workflow.translateDocument')}</span>
            <span className="text-[11px] px-1.5 py-0.5 bg-white/20 rounded">{shortcutLabel('T')}</span>
          </>
        )}
      </button>

      <span className="w-4 h-0.5 bg-editor-border shrink-0" aria-hidden="true" />

      {/* 검수 */}
      <button
        type="button"
        onClick={() => openReviewPanel()}
        className="h-[38px] px-3.5 rounded-md border border-editor-border text-editor-text text-sm font-bold flex items-center gap-2 hover:bg-editor-surface transition-colors focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2"
        title={t('editor.reviewTitle', '번역 검수')}
        data-testid="editor-review-button"
      >
        <ClipboardCheck size={16} />
        <span>{t('editor.review', '검수')}</span>
        {issueCount > 0 && (
          <span className="min-w-[18px] h-[18px] px-1.5 bg-primary-500 text-white text-[11px] font-bold rounded-sm inline-flex items-center justify-center tabular-nums">
            {issueCount}
          </span>
        )}
        <span className="text-[11px] px-1.5 py-0.5 bg-editor-border/60 text-editor-muted rounded">
          {shortcutLabel('R')}
        </span>
      </button>

      <span className="w-4 h-0.5 bg-editor-border shrink-0" aria-hidden="true" />

      {/* 폴리싱 */}
      <button
        type="button"
        onClick={triggerPolish}
        disabled={!hasTargetContent || polishLoading}
        className="h-[38px] px-3.5 rounded-md border border-editor-border text-editor-text text-sm font-bold flex items-center gap-2 hover:bg-editor-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2"
        title={t('review.polish', '폴리싱')}
        data-testid="editor-polish-button"
      >
        {polishLoading ? (
          <span className="w-3 h-3 border-2 border-editor-border border-t-primary-500 rounded-full animate-spin" />
        ) : (
          <Highlighter size={16} />
        )}
        <span>{t('review.polish', '폴리싱')}</span>
        <span className="text-[11px] px-1.5 py-0.5 bg-editor-border/60 text-editor-muted rounded">
          {shortcutLabel('P')}
        </span>
      </button>

      <div className="w-px h-[22px] bg-editor-border mx-1.5 shrink-0" />

      {/* 번역 모델 */}
      <Select
        value={translationModel}
        onChange={setTranslationModel}
        options={enabledPresets}
        aria-label={t('editor.translationModelAriaLabel')}
        title={t('editor.translationModel')}
        size="lg"
        caption={t('workflow.aiModel')}
        className="min-w-[150px]"
      />
    </div>
  );
}
