/**
 * 용도별 모델 직접 지정 (ADR-0017)
 *
 * 기본값은 언제나 `MODEL_BY_USE`이고, 여기서 고른 값은 그 위에 얹는 **덮어쓰기**다.
 * 실사용으로 모델을 비교해 보기 위한 장치이므로, 지정이 하나라도 살아 있으면 눈에 띄게
 * 표시하고 한 번에 되돌릴 수 있어야 한다 — ADR-0012가 없앤 "드롭다운을 되돌리는 것을 잊는"
 * 실패를 되살리지 않기 위한 조건이다.
 *
 * 그 조건을 `CollapsibleSection`의 두 장치로 지킨다: 지정이 있으면 모달을 열 때 펼쳐지고
 * (`defaultOpen`), 접어 두더라도 헤더의 `summary`에 개수가 남는다.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EFFORT_CHOICES,
  MODEL_BY_USE,
  MODEL_CHOICES,
  PROVIDER_LABELS,
  type ModelUseFor,
  type ReasoningEffort,
} from '@/ai/config';
import { modelSupportsEffort } from '@/ai/modelCallOptions';
import { getModelPrice } from '@/ai/pricing';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { CollapsibleSection } from './CollapsibleSection';

/** 표시 순서. `ModelUseFor` 선언 순서가 아니라 사용자가 인지하는 순서다. */
const USE_FOR_ORDER: readonly ModelUseFor[] = [
  'translation',
  'review',
  'polish',
  'chat',
  'summary',
];

/**
 * 모델 ID에 100만 토큰당 입력/출력 단가를 붙인다.
 *
 * 단가가 없으면 ID만 돌려준다 — 다만 `MODEL_CHOICES`의 모든 모델에 단가가 있는지는
 * `pricing.test.ts`가 강제하므로, 실제로는 목록에 없는 모델을 넘겼을 때만 일어난다.
 */
function withPrice(model: string): string {
  const price = getModelPrice(model);
  if (!price) return model;
  return `${model} — $${price.inputPerMTok}/$${price.outputPerMTok}`;
}

export function ModelOverridesSection(): JSX.Element {
  const { t } = useTranslation();
  const provider = useAiConfigStore((s) => s.provider);
  const modelOverrides = useAiConfigStore((s) => s.modelOverrides);
  const setModelOverride = useAiConfigStore((s) => s.setModelOverride);
  const clearModelOverrides = useAiConfigStore((s) => s.clearModelOverrides);

  const setEffortOverride = useAiConfigStore((s) => s.setEffortOverride);

  // 모델·effort를 각각 1건으로 센다 — 배지 숫자가 "되돌릴 것이 몇 개인지"와 같아야 한다.
  const activeCount = useMemo(
    () =>
      Object.values(modelOverrides).reduce(
        (sum, byUse) =>
          sum +
          Object.values(byUse ?? {}).reduce(
            (n, entry) => n + (entry?.model ? 1 : 0) + (entry?.effort ? 1 : 0),
            0,
          ),
        0,
      ),
    [modelOverrides],
  );

  const current = modelOverrides[provider] ?? {};

  return (
    <CollapsibleSection
      icon="🧪"
      title={t('appSettings.modelOverrides')}
      // 접어 둬도 지정이 몇 건 살아 있는지는 헤더에 남는다.
      summary={
        activeCount > 0 ? (
          <span className="text-yellow-600" data-testid="model-overrides-badge">
            ● {t('appSettings.modelOverridesActive', { count: activeCount })}
          </span>
        ) : undefined
      }
      // 지정이 있으면 모달을 열 때 펼쳐진다(마운트 시점 판정 — 모달은 열 때마다 새로 마운트된다).
      defaultOpen={activeCount > 0}
      testId="app-settings-model-overrides-toggle"
    >
      <p className="text-xs text-editor-muted">{t('appSettings.modelOverridesDescription')}</p>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-[10px] text-editor-muted">
            {t('appSettings.modelOverridesScope', { provider: PROVIDER_LABELS[provider] })}
          </p>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearModelOverrides}
              className="ml-auto shrink-0 text-[11px] text-editor-muted hover:text-editor-text
                         transition-colors"
              data-testid="model-overrides-reset"
            >
              {t('appSettings.modelOverridesReset')}
            </button>
          )}
        </div>

        {USE_FOR_ORDER.map((useFor) => {
          const base = MODEL_BY_USE[provider][useFor];
          const entry = current[useFor] ?? {};
          const selectedModel = entry.model ?? '';
          const selectedEffort = entry.effort ?? '';
          // effort가 붙는 대상은 "실제로 호출될 모델" — 지정이 있으면 그쪽을 본다.
          const effectiveModel = entry.model ?? base.model;
          const effortAllowed = modelSupportsEffort(effectiveModel);

          return (
            <div key={useFor} className="flex items-center gap-2 text-xs">
              <label
                htmlFor={`model-override-${useFor}`}
                className="w-20 shrink-0 text-editor-muted"
              >
                {t(`appSettings.modelUseFor.${useFor}`)}
              </label>

              <select
                id={`model-override-${useFor}`}
                value={selectedModel}
                onChange={(e) => setModelOverride(provider, useFor, e.target.value || null)}
                data-testid={`model-override-${useFor}`}
                className="flex-1 min-w-0 px-2 py-1 rounded-md border border-editor-border/50
                           bg-transparent text-editor-text"
              >
                {/* 기본 모델도 단가를 함께 보여야 한다 — 비교의 기준이 되는 값이다. */}
                <option value="">
                  {t('appSettings.modelOverridesDefaultOption', { model: withPrice(base.model) })}
                </option>
                {MODEL_CHOICES[provider]
                  .filter((m) => m !== base.model)
                  .map((m) => (
                    <option key={m} value={m}>
                      {withPrice(m)}
                    </option>
                  ))}
              </select>

              <select
                aria-label={t('appSettings.modelOverridesEffortLabel')}
                value={effortAllowed ? selectedEffort : ''}
                disabled={!effortAllowed}
                onChange={(e) =>
                  setEffortOverride(
                    provider,
                    useFor,
                    (e.target.value || null) as ReasoningEffort | null,
                  )
                }
                data-testid={`effort-override-${useFor}`}
                className="w-28 shrink-0 px-2 py-1 rounded-md border border-editor-border/50
                           bg-transparent text-editor-text disabled:opacity-40"
              >
                <option value="">
                  {effortAllowed
                    ? t('appSettings.modelOverridesDefaultOption', { model: base.effort })
                    : t('appSettings.modelOverridesEffortUnsupported')}
                </option>
                {effortAllowed &&
                  EFFORT_CHOICES.filter((e) => e !== base.effort).map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
              </select>

              {(selectedModel || (effortAllowed && selectedEffort)) && (
                <span className="text-yellow-600 text-[10px]">●</span>
              )}
            </div>
          );
        })}

        {/* pl은 라벨 w-20(5rem) + gap-2(0.5rem) — Tailwind v3 스케일에 22가 없어 임의값을 쓴다 */}
        {(current.chat?.model || current.chat?.effort) && (
          <p className="text-[10px] text-yellow-600 pl-[5.5rem]">
            {t('appSettings.modelOverridesChatNotice')}
          </p>
        )}
      </div>
    </CollapsibleSection>
  );
}
