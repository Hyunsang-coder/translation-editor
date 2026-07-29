import { useMemo, useState } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import type { ProjectMemoryCategory } from '@/types';
import { MEMORY_CATEGORY_PRIORITY } from '@/ai/context/projectMemoryPolicy';
import { renderChatMemoryDigest } from '@/ai/context/projectKnowledgeRender';
import { useProjectMemoryStore } from '@/stores/projectMemoryStore';
import { useUIStore } from '@/stores/uiStore';

/**
 * 선택지 순서는 상한 초과 시 남는 우선순위를 그대로 따른다.
 * 둘이 어긋나면 사용자가 더 먼저 잘릴 카테고리를 위쪽 선택지로 착각한다.
 */
const CATEGORIES = (Object.keys(MEMORY_CATEGORY_PRIORITY) as ProjectMemoryCategory[])
  .sort((a, b) => MEMORY_CATEGORY_PRIORITY[a] - MEMORY_CATEGORY_PRIORITY[b]);

/**
 * 카테고리 9개를 우선순위 3단계 색으로 압축한다. 라벨 9종을 모든 행에 노출하면
 * 정작 읽어야 할 본문이 묻힌다. 정확한 카테고리는 점의 툴팁으로 확인한다.
 */
const TIER_DOT = ['bg-primary-500', 'bg-editor-text', 'bg-editor-muted'] as const;

function categoryTier(category: ProjectMemoryCategory): number {
  const priority = MEMORY_CATEGORY_PRIORITY[category];
  if (priority <= 2) return 0;
  if (priority <= 4) return 1;
  return 2;
}

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

  /**
   * 개수 상한만 세면 과대 보고가 된다 — digest는 문자 예산에서도 잘리므로
   * 실제 주입분은 렌더러 자신에게 물어야 한다.
   */
  const chatDigest = useMemo(
    () => renderChatMemoryDigest({ items, forbiddenTerms }),
    [items, forbiddenTerms],
  );
  const injectedIds = useMemo(() => new Set(chatDigest.itemIds), [chatDigest]);
  const activeCount = useMemo(
    () => items.filter((item) => item.status === 'active').length,
    [items],
  );

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
        <div className="flex items-baseline gap-2">
          <h3 className="text-xs font-semibold text-editor-text">
            {t('memory.settingsTitle', '프로젝트 메모리')}
          </h3>
          {activeCount > 0 && (
            <span
              className={`ml-auto text-[10px] ${
                chatDigest.truncated ? 'text-primary-500' : 'text-editor-muted'
              }`}
              title={t('memory.chatInjectionHint', {
                injected: chatDigest.itemIds.length,
                defaultValue: '채팅에는 상위 {{injected}}개만 전달됩니다. 번역·검수·폴리싱에는 전체가 전달됩니다.',
              })}
            >
              {t('memory.chatInjection', {
                injected: chatDigest.itemIds.length,
                total: activeCount,
                defaultValue: '채팅 {{injected}}/{{total}}',
              })}
            </span>
          )}
        </div>
        <p className="text-[10px] leading-relaxed text-editor-muted">
          {t('memory.settingsDescription', '승인된 항목은 다음 채팅과 번역·검수·폴리싱에 사용됩니다.')}
        </p>

        <div className="space-y-1.5">
          <div className="flex gap-2">
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
          {/* 대부분 기본값으로 충분하므로 상시 폼이 아니라 눈에 덜 띄는 보조 컨트롤로 둔다. */}
          <label className="flex items-center gap-1 text-[10px] text-editor-muted">
            {t('memory.categoryLabel', '카테고리')}
            <select
              className="bg-transparent text-[10px] text-editor-muted outline-none"
              value={category}
              onChange={(event) => setCategory(event.target.value as ProjectMemoryCategory)}
            >
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>{t(`memory.category.${value}`)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-0.5">
          {items.map((item) => {
            const isEditing = editing?.id === item.id;
            const injected = injectedIds.has(item.id);
            return (
              <div
                key={item.id}
                className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-editor-surface"
              >
                <span
                  className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${TIER_DOT[categoryTier(item.category)]}`}
                  title={`${t(`memory.category.${item.category}`)} · ${t(`memory.source.${item.source}`)}`}
                />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <textarea
                      className="min-h-16 w-full rounded-lg border border-editor-border bg-editor-bg px-2 py-1.5 text-xs text-editor-text"
                      value={editing.content}
                      onChange={(event) => setEditing({ id: item.id, content: event.target.value })}
                    />
                  ) : (
                    <div
                      className={`whitespace-pre-wrap break-words text-xs ${
                        injected ? 'text-editor-text' : 'text-editor-muted'
                      }`}
                      title={injected ? undefined : t(
                        'memory.notInChat',
                        '채팅에는 전달되지 않습니다. 번역·검수·폴리싱에는 포함됩니다.',
                      )}
                    >
                      {item.content}
                    </div>
                  )}
                  {item.status !== 'active' && (
                    <span className="text-[10px] text-editor-muted">
                      {t(`memory.status.${item.status}`)}
                    </span>
                  )}
                </div>
                {/* 항상 렌더하고 대비만 낮춘다. 숨기면 키보드·터치에서 닿지 않는다. */}
                <div className="flex shrink-0 gap-2 opacity-50 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  {isEditing ? (
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
                        className="text-[11px] text-editor-muted hover:text-primary-500"
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
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3" data-testid="forbidden-terms-settings">
        <div className="space-y-1">
          <h3 className="text-xs font-semibold text-editor-text">
            {t('memory.forbiddenTermsTitle', '금칙어')}
          </h3>
          <p className="text-[10px] leading-relaxed text-editor-muted">
            {t(
              'memory.forbiddenTermsDescription',
              '모든 AI 요청에 항상 전달되는 지시입니다. 문서를 검사하지는 않습니다.',
            )}
          </p>
        </div>
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
                className="ml-auto shrink-0 text-editor-muted opacity-50 transition-opacity hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100"
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
