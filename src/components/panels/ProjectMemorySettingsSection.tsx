import { useState } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import type { ProjectMemoryCategory } from '@/types';
import { useProjectMemoryStore } from '@/stores/projectMemoryStore';
import { useUIStore } from '@/stores/uiStore';

const CATEGORIES: ProjectMemoryCategory[] = [
  'domain',
  'audience',
  'product',
  'worldbuilding',
  'character',
  'intent',
  'decision',
  'reference_fact',
  'general',
];

export function ProjectMemorySettingsSection(): JSX.Element {
  const { t } = useTranslation();
  const addToast = useUIStore((state) => state.addToast);
  const {
    items,
    forbiddenTerms,
    saving,
    addItem,
    replaceItem,
    deleteItem,
    saveForbiddenTerm,
    removeForbiddenTerm,
  } = useProjectMemoryStore(useShallow((state) => ({
    items: state.items,
    forbiddenTerms: state.forbiddenTerms,
    saving: state.saving,
    addItem: state.addItem,
    replaceItem: state.replaceItem,
    deleteItem: state.deleteItem,
    saveForbiddenTerm: state.saveForbiddenTerm,
    removeForbiddenTerm: state.removeForbiddenTerm,
  })));
  const [category, setCategory] = useState<ProjectMemoryCategory>('general');
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [term, setTerm] = useState('');
  const [replacement, setReplacement] = useState('');

  const reportError = (error: unknown): void => {
    addToast({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  };

  const handleAdd = async (): Promise<void> => {
    if (!content.trim()) return;
    try {
      const result = await addItem({
        category,
        content: content.trim(),
        source: 'user',
        status: 'active',
      });
      if (result.duplicate) {
        addToast({
          type: 'info',
          message: t('memory.alreadyExists', '이미 동일한 메모리가 있습니다.'),
        });
      }
      setContent('');
    } catch (error) {
      reportError(error);
    }
  };

  const handleDelete = async (itemId: string): Promise<void> => {
    const ok = await confirm(t('memory.deleteConfirm'), {
      title: t('memory.deleteTitle'),
      kind: 'warning',
    });
    if (!ok) return;
    try {
      await deleteItem(itemId);
      if (editing?.id === itemId) setEditing(null);
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <>
      <section className="space-y-3" data-testid="project-memory-settings">
        <h3 className="text-xs font-semibold text-editor-text">
          {t('memory.settingsTitle', '프로젝트 메모리')}
        </h3>
        <p className="text-[10px] leading-relaxed text-editor-muted">
          {t('memory.settingsDescription', '승인된 항목은 다음 채팅과 번역·검수·폴리싱에 사용됩니다.')}
        </p>
        <div className="flex gap-2">
          <select
            className="rounded-lg border border-editor-border bg-editor-surface px-2 py-2 text-xs text-editor-text"
            value={category}
            onChange={(event) => setCategory(event.target.value as ProjectMemoryCategory)}
          >
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>{t(`memory.category.${value}`)}</option>
            ))}
          </select>
          <input
            data-testid="project-memory-new-item"
            className="min-w-0 flex-1 rounded-lg border border-editor-border bg-editor-surface px-3 py-2 text-xs text-editor-text"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t('memory.newItemPlaceholder', '장기적으로 유지할 프로젝트 정보')}
          />
          <button
            type="button"
            data-testid="project-memory-add"
            className="rounded-lg bg-primary-500 px-3 py-2 text-xs text-white disabled:opacity-50"
            disabled={saving || !content.trim()}
            onClick={() => void handleAdd()}
          >
            {t('memory.add', '추가')}
          </button>
        </div>

        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-editor-border bg-editor-surface p-3"
            >
              <div className="flex items-center gap-2 text-[10px] text-editor-muted">
                <span>{t(`memory.category.${item.category}`)}</span>
                <span>·</span>
                <span>{t(`memory.status.${item.status}`)}</span>
                <span className="ml-auto">{t(`memory.source.${item.source}`)}</span>
              </div>
              {editing?.id === item.id ? (
                <textarea
                  className="mt-2 min-h-16 w-full rounded-lg border border-editor-border bg-editor-bg px-2 py-1.5 text-xs text-editor-text"
                  value={editing.content}
                  onChange={(event) => setEditing({ id: item.id, content: event.target.value })}
                />
              ) : (
                <div className="mt-1 whitespace-pre-wrap text-xs text-editor-text">{item.content}</div>
              )}
              {item.status === 'active' && (
                <div className="mt-2 flex gap-2">
                  {editing?.id === item.id ? (
                    <>
                      <button
                        type="button"
                        className="text-[11px] text-primary-500"
                        onClick={() => {
                          const next = editing.content.trim();
                          if (!next) return;
                          void replaceItem(item.id, {
                            category: item.category,
                            content: next,
                            source: 'user',
                            status: 'active',
                          }).then(() => setEditing(null)).catch(reportError);
                        }}
                      >
                        {t('common.save')}
                      </button>
                      <button
                        type="button"
                        className="text-[11px] text-editor-muted"
                        onClick={() => setEditing(null)}
                      >
                        {t('common.cancel')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="text-[11px] text-primary-500"
                        onClick={() => setEditing({ id: item.id, content: item.content })}
                      >
                        {t('common.edit', '편집')}
                      </button>
                      <button
                        type="button"
                        data-testid="project-memory-delete"
                        className="text-[11px] text-editor-muted hover:text-red-500"
                        disabled={saving}
                        onClick={() => void handleDelete(item.id)}
                      >
                        {t('common.delete', '삭제')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3" data-testid="forbidden-terms-settings">
        <h3 className="text-xs font-semibold text-editor-text">
          {t('memory.forbiddenTermsTitle', '금칙어')}
        </h3>
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
            className="rounded-lg bg-primary-500 px-3 py-2 text-xs text-white disabled:opacity-50"
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
        <div className="space-y-1.5">
          {forbiddenTerms.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-editor-border bg-editor-surface px-3 py-2 text-xs"
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
              <span className="text-editor-text">{item.term}</span>
              {item.replacement && <span className="text-editor-muted">→ {item.replacement}</span>}
              <button
                type="button"
                className="ml-auto text-editor-muted hover:text-red-500"
                onClick={() => void removeForbiddenTerm(item.id).catch(reportError)}
              >
                {t('common.delete', '삭제')}
              </button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
