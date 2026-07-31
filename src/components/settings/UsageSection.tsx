/**
 * AI 사용량 · 추정 비용 섹션
 *
 * `ai_usage_records` 장부를 일별로 집계해 보여준다. 비용은 `pricing.ts`의 단가로 환산한
 * **추정치**이며, 실제 청구는 provider 콘솔이 진실이다(UI에도 그렇게 표기한다).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke, isTauriRuntime } from '@/tauri/invoke';
import { estimateCost, formatUsd } from '@/ai/pricing';

/** Rust `AiUsageDailyRow`와 1:1 */
interface UsageDailyRow {
  day: string;
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  modelCalls: number;
  requestCount: number;
}

const RANGE_DAYS = [7, 30, 90] as const;
type RangeDays = (typeof RANGE_DAYS)[number];

interface DaySummary {
  day: string;
  rows: UsageDailyRow[];
  totalTokens: number;
  costUsd: number;
  savingsUsd: number;
  /** 단가를 모르는 모델이 섞여 비용이 과소 집계된 경우 */
  hasUnpricedModel: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function summarize(rows: UsageDailyRow[]): DaySummary[] {
  const byDay = new Map<string, UsageDailyRow[]>();
  for (const row of rows) {
    const list = byDay.get(row.day);
    if (list) list.push(row);
    else byDay.set(row.day, [row]);
  }

  return [...byDay.entries()]
    .map(([day, dayRows]) => {
      let totalTokens = 0;
      let costUsd = 0;
      let savingsUsd = 0;
      let hasUnpricedModel = false;

      for (const row of dayRows) {
        // inputTokens에 캐시 read/write가 이미 포함되어 있으므로 따로 더하지 않는다(중복 계상).
        totalTokens += row.inputTokens + row.outputTokens;
        const cost = estimateCost(row.model, row);
        if (cost) {
          costUsd += cost.totalUsd;
          savingsUsd += cost.cacheSavingsUsd;
        } else {
          hasUnpricedModel = true;
        }
      }

      return { day, rows: dayRows, totalTokens, costUsd, savingsUsd, hasUnpricedModel };
    })
    .sort((a, b) => b.day.localeCompare(a.day));
}

export function UsageSection(): JSX.Element | null {
  const { t } = useTranslation();
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [rows, setRows] = useState<UsageDailyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const load = useCallback(async (days: RangeDays) => {
    setLoading(true);
    setError(null);
    try {
      // 로컬 자정 기준으로 N일 전부터.
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      from.setDate(from.getDate() - (days - 1));
      const result = await invoke<UsageDailyRow[]>('get_ai_usage_daily', {
        args: { fromMs: from.getTime(), toMs: null },
      });
      setRows(result ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void load(rangeDays);
  }, [load, rangeDays]);

  const summaries = useMemo(() => summarize(rows), [rows]);
  const totals = useMemo(
    () =>
      summaries.reduce(
        (acc, s) => ({
          tokens: acc.tokens + s.totalTokens,
          cost: acc.cost + s.costUsd,
          savings: acc.savings + s.savingsUsd,
          unpriced: acc.unpriced || s.hasUnpricedModel,
        }),
        { tokens: 0, cost: 0, savings: 0, unpriced: false },
      ),
    [summaries],
  );

  const handleClear = useCallback(async () => {
    if (!window.confirm(t('appSettings.usageClearConfirm'))) return;
    try {
      await invoke('clear_ai_usage', {});
      await load(rangeDays);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [t, load, rangeDays]);

  // 사용량 장부는 Tauri DB에만 있으므로 웹 하네스에서는 섹션 자체를 숨긴다.
  if (!isTauriRuntime()) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
        <span className="text-lg">📊</span>
        <h3 className="font-semibold text-editor-text">{t('appSettings.usage')}</h3>
      </div>

      <p className="text-xs text-editor-muted">{t('appSettings.usageEstimateNotice')}</p>

      <div className="flex items-center gap-2">
        {RANGE_DAYS.map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => setRangeDays(days)}
            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
              rangeDays === days
                ? 'border-primary-500 bg-primary-500/10 text-editor-text'
                : 'border-editor-border/50 text-editor-muted hover:text-editor-text'
            }`}
            data-testid={`usage-range-${days}`}
          >
            {t('appSettings.usageLastNDays', { count: days })}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load(rangeDays)}
          className="ml-auto px-2.5 py-1 text-xs rounded-md border border-editor-border/50
                     text-editor-muted hover:text-editor-text transition-colors"
        >
          {t('appSettings.usageRefresh')}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-500" role="alert">
          {error}
        </p>
      )}

      {/* 기간 합계 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-3 rounded-lg border border-editor-border/50">
          <div className="text-[10px] text-editor-muted">{t('appSettings.usageTotalTokens')}</div>
          <div className="text-sm font-semibold text-editor-text">{formatTokens(totals.tokens)}</div>
        </div>
        <div className="p-3 rounded-lg border border-editor-border/50">
          <div className="text-[10px] text-editor-muted">{t('appSettings.usageEstimatedCost')}</div>
          <div className="text-sm font-semibold text-editor-text">
            {formatUsd(totals.cost)}
            {totals.unpriced && <span className="ml-1 text-[10px] text-yellow-500">*</span>}
          </div>
        </div>
        <div className="p-3 rounded-lg border border-editor-border/50">
          <div className="text-[10px] text-editor-muted">{t('appSettings.usageCacheSavings')}</div>
          <div className="text-sm font-semibold text-green-600">{formatUsd(totals.savings)}</div>
        </div>
      </div>

      {totals.unpriced && (
        <p className="text-[10px] text-yellow-600">{t('appSettings.usageUnpricedNotice')}</p>
      )}

      {loading && <p className="text-xs text-editor-muted">{t('appSettings.usageLoading')}</p>}

      {!loading && summaries.length === 0 && (
        <p className="text-xs text-editor-muted">{t('appSettings.usageEmpty')}</p>
      )}

      {/* 일별 목록 (행을 누르면 기능·모델별 분해) */}
      <div className="space-y-1">
        {summaries.map((s) => (
          <div key={s.day} className="rounded-lg border border-editor-border/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedDay(expandedDay === s.day ? null : s.day)}
              className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-editor-border/10 transition-colors"
              data-testid={`usage-day-${s.day}`}
            >
              <span className="text-editor-text font-medium">{s.day}</span>
              <span className="text-editor-muted">{formatTokens(s.totalTokens)}</span>
              <span className="ml-auto text-editor-text font-medium">
                {formatUsd(s.costUsd)}
                {s.hasUnpricedModel && <span className="ml-0.5 text-yellow-500">*</span>}
              </span>
              <span className="text-editor-muted">{expandedDay === s.day ? '▾' : '▸'}</span>
            </button>

            {expandedDay === s.day && (
              <div className="px-3 pb-2 space-y-1 border-t border-editor-border/30 pt-2">
                {s.rows.map((row) => {
                  const cost = estimateCost(row.model, row);
                  return (
                    <div
                      key={`${row.feature}:${row.provider}:${row.model}`}
                      className="flex items-center gap-2 text-[11px]"
                    >
                      <span className="text-editor-text">
                        {t(`appSettings.usageFeature.${row.feature}`, row.feature)}
                      </span>
                      <span className="text-editor-muted truncate">{row.model}</span>
                      <span className="text-editor-muted">
                        {t('appSettings.usageCallCount', { count: row.modelCalls })}
                      </span>
                      <span className="ml-auto text-editor-muted whitespace-nowrap">
                        {formatTokens(row.inputTokens)} / {formatTokens(row.outputTokens)}
                      </span>
                      <span className="text-editor-text whitespace-nowrap w-16 text-right">
                        {cost ? formatUsd(cost.totalUsd) : t('appSettings.usageUnknownPrice')}
                      </span>
                    </div>
                  );
                })}
                <p className="text-[10px] text-editor-muted pt-1">
                  {t('appSettings.usageColumnHint')}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void handleClear()}
        className="text-[11px] text-editor-muted hover:text-red-500 transition-colors"
      >
        {t('appSettings.usageClear')}
      </button>
    </section>
  );
}

// 테스트에서 집계 로직만 따로 검증하기 위해 export.
export { summarize as summarizeUsageRows };
export type { UsageDailyRow };
