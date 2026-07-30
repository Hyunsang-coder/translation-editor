import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, ClipboardCheck, Highlighter } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useShallow } from 'zustand/shallow';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore } from '@/stores/reviewStore';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { Select, type SelectOption } from '@/components/ui/Select';
import { PROVIDER_LABELS, type SelectableProvider } from '@/ai/config';
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
    <div className="flex items-center gap-1.5 min-w-0 whitespace-nowrap">
      {/* 번역 실행 — 기본 액션 */}
      <button
        type="button"
        onClick={triggerTranslate}
        disabled={translateLoading}
        className="h-[34px] px-3 rounded-md bg-primary-500 text-white text-[13px] font-semibold flex items-center gap-1.5 hover:bg-primary-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2"
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

      <span className="w-3 h-0.5 bg-editor-border shrink-0" aria-hidden="true" />

      {/* 검수 */}
      <button
        type="button"
        onClick={() => openReviewPanel()}
        className="h-[34px] px-2.5 rounded-md border border-editor-border text-editor-text text-[13px] font-semibold flex items-center gap-1.5 hover:bg-editor-surface transition-colors focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2"
        title={t('editor.reviewTitle', '번역 검수')}
        data-testid="editor-review-button"
      >
        <ClipboardCheck size={15} />
        <span>{t('editor.review', '검수')}</span>
        {issueCount > 0 && (
          <span className="min-w-[17px] h-[17px] px-1 bg-primary-500 text-white text-[11px] font-bold rounded-sm inline-flex items-center justify-center tabular-nums">
            {issueCount}
          </span>
        )}
        <span className="text-[11px] px-1 py-0.5 bg-editor-border/60 text-editor-muted rounded">
          {shortcutLabel('R')}
        </span>
      </button>

      <span className="w-3 h-0.5 bg-editor-border shrink-0" aria-hidden="true" />

      {/* 폴리싱 */}
      <button
        type="button"
        onClick={triggerPolish}
        disabled={!hasTargetContent || polishLoading}
        className="h-[34px] px-2.5 rounded-md border border-editor-border text-editor-text text-[13px] font-semibold flex items-center gap-1.5 hover:bg-editor-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2"
        title={t('review.polish', '폴리싱')}
        data-testid="editor-polish-button"
      >
        {polishLoading ? (
          <span className="w-3.5 h-3.5 border-2 border-editor-border border-t-primary-500 rounded-full animate-spin" />
        ) : (
          <Highlighter size={15} />
        )}
        <span>{t('review.polish', '폴리싱')}</span>
        <span className="text-[11px] px-1 py-0.5 bg-editor-border/60 text-editor-muted rounded">
          {shortcutLabel('P')}
        </span>
      </button>

      <div className="w-px h-[20px] bg-editor-border mx-1 shrink-0" />

      {/* AI Provider — 워크플로 버튼보다 낮은 위계라 기존 md 사이즈를 그대로 쓴다.
          용도별 모델·effort는 앱이 고정하므로 사용자가 고르는 값은 이것 하나다(ADR-0012). */}
      <Select
        value={provider}
        onChange={(v) => setProvider(v as SelectableProvider)}
        options={providerOptions}
        aria-label={t('editor.providerAriaLabel')}
        title={t('editor.provider')}
        size="md"
        className="min-w-[118px]"
      />
    </div>
  );
}
