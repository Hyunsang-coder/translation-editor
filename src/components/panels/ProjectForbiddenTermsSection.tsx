import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CollapsibleSection } from '@/components/settings/CollapsibleSection';
import { useShallow } from 'zustand/shallow';
import { useProjectMemoryStore } from '@/stores/projectMemoryStore';
import { useUIStore } from '@/stores/uiStore';

/**
 * 설정 패널 최하단(용어집 아래) 섹션.
 *
 * 프로젝트 메모리와 같은 스토어를 쓰지만 UI에서는 떼어 놓는다 — 대부분의 프로젝트가
 * 등록 없이 쓰는 기능이라 메모리·용어집보다 아래에 있어야 한다.
 */
export function ProjectForbiddenTermsSection(): JSX.Element {
  const { t } = useTranslation();
  const addToast = useUIStore((state) => state.addToast);
  const {
    forbiddenTerms,
    saving,
    saveForbiddenTerm,
    removeForbiddenTerm,
  } = useProjectMemoryStore(useShallow((state) => ({
    forbiddenTerms: state.forbiddenTerms,
    saving: state.saving,
    saveForbiddenTerm: state.saveForbiddenTerm,
    removeForbiddenTerm: state.removeForbiddenTerm,
  })));
  const [term, setTerm] = useState('');
  const [replacement, setReplacement] = useState('');

  const reportError = (error: unknown): void => {
    addToast({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  };

  return (
    <CollapsibleSection
      dense
      persistId="forbiddenTerms"
      title={t('memory.forbiddenTermsTitle', '금칙어')}
      description={t(
        'memory.forbiddenTermsDescription',
        'AI가 번역문에 쓰지 않을 표현입니다.',
      )}
      testId="forbidden-terms-settings"
    >
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <input
          data-testid="forbidden-term-input"
          className="min-w-0 rounded-lg border border-editor-border bg-editor-surface px-3 py-2 text-xs text-editor-text"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t('memory.forbiddenTerm', '금칙어')}
        />
        <input
          data-testid="forbidden-term-replacement"
          className="min-w-0 rounded-lg border border-editor-border bg-editor-surface px-3 py-2 text-xs text-editor-text"
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
          placeholder={t('memory.replacement', '권장 표현')}
        />
        <button
          type="button"
          data-testid="forbidden-term-add"
          className="rounded-lg bg-primary-fill px-3 py-2 text-xs text-white disabled:opacity-50"
          disabled={saving || !term.trim()}
          onClick={() => {
            void saveForbiddenTerm({
              term: term.trim(),
              ...(replacement.trim() ? { replacement: replacement.trim() } : {}),
              enabled: true,
            }).then(() => {
              setTerm('');
              setReplacement('');
            }).catch(reportError);
          }}
        >
          {t('memory.add', '추가')}
        </button>
      </div>
      <div className="space-y-0.5">
        {forbiddenTerms.map((item) => (
          <div
            key={item.id}
            className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-editor-surface"
          >
            <input
              type="checkbox"
              checked={item.enabled}
              onChange={(event) =>
                void saveForbiddenTerm({
                  id: item.id,
                  term: item.term,
                  ...(item.replacement ? { replacement: item.replacement } : {}),
                  ...(item.note ? { note: item.note } : {}),
                  enabled: event.target.checked,
                }).catch(reportError)
              }
            />
            <span className={item.enabled ? 'text-editor-text' : 'text-editor-muted'}>
              {item.term}
            </span>
            {item.replacement && <span className="text-editor-muted">→ {item.replacement}</span>}
            <button
              type="button"
              className="ml-auto shrink-0 text-editor-muted opacity-50 transition-opacity hover:text-severity-critical group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => void removeForbiddenTerm(item.id).catch(reportError)}
            >
              {t('common.delete', '삭제')}
            </button>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}
