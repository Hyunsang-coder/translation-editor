import { useEffect, useMemo, useRef, useState } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { CollapsibleSection } from '@/components/settings/CollapsibleSection';
import { useShallow } from 'zustand/shallow';
import { MoreHorizontal } from 'lucide-react';
import type { ProjectMemoryCategory } from '@/types';
import { MEMORY_CATEGORY_PRIORITY } from '@/ai/context/projectMemoryPolicy';
import { renderChatMemoryDigest } from '@/ai/context/projectKnowledgeRender';
import { ProjectMemoryImportModal } from '@/components/panels/ProjectMemoryImportModal';
import { useProjectMemoryStore } from '@/stores/projectMemoryStore';
import { useUIStore } from '@/stores/uiStore';

/**
 * 선택지 순서는 상한 초과 시 남는 우선순위를 그대로 따른다.
 * 둘이 어긋나면 사용자가 더 먼저 잘릴 카테고리를 위쪽 선택지로 착각한다.
 */
const CATEGORIES = (Object.keys(MEMORY_CATEGORY_PRIORITY) as ProjectMemoryCategory[])
  .sort((a, b) => MEMORY_CATEGORY_PRIORITY[a] - MEMORY_CATEGORY_PRIORITY[b]);

/**
 * 행 액션을 ⋯ 하나로 모은다.
 *
 * 높이가 가변인 행에 버튼 두 개를 놓을 안정적인 자리가 없고(위 정렬은 아래가 비고 늘리면
 * 짧은 행에서 안 벌어진다), 삭제를 편집 옆에 나란히 두면 오클릭을 부른다.
 * 사용처가 한 곳뿐이라 별도 파일로 빼지 않는다.
 */
function RowMenu({
  onEdit,
  onDelete,
  deleteDisabled = false,
}: {
  onEdit: () => void;
  onDelete: () => void;
  deleteDisabled?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }
    // click(버블) 대신 mousedown — PromptPresetMenu와 같은 이유로 리렌더 경합을 피한다.
    document.addEventListener('mousedown', onDocPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        data-testid="project-memory-row-menu"
        aria-label={t('common.moreActions', '더보기')}
        aria-expanded={open}
        className={`flex h-6 w-6 items-center justify-center rounded text-editor-muted transition-opacity hover:bg-editor-border/60 hover:text-editor-text ${
          open ? 'opacity-100' : 'opacity-50 group-hover:opacity-100 focus-visible:opacity-100'
        }`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-10 min-w-24 rounded-lg border border-editor-border bg-editor-surface py-1 shadow-lg">
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-xs text-editor-text hover:bg-editor-border/60"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            {t('common.edit', '편집')}
          </button>
          <div className="my-1 border-t border-editor-hairline" />
          <button
            type="button"
            data-testid="project-memory-delete"
            disabled={deleteDisabled}
            className="block w-full px-3 py-1.5 text-left text-xs text-severity-critical hover:bg-severity-critical/10 disabled:opacity-50"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            {t('common.delete', '삭제')}
          </button>
        </div>
      )}
    </div>
  );
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
  } = useProjectMemoryStore(useShallow((state) => ({
    items: state.items,
    forbiddenTerms: state.forbiddenTerms,
    saving: state.saving,
    addItem: state.addItem,
    replaceItem: state.replaceItem,
    deleteItem: state.deleteItem,
  })));
  const [category, setCategory] = useState<ProjectMemoryCategory>('general');
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  /**
   * 개수 상한만 세면 과대 보고가 된다 — digest는 문자 예산에서도 잘리므로
   * 실제 주입분은 렌더러 자신에게 물어야 한다.
   */
  const chatDigest = useMemo(
    () => renderChatMemoryDigest({ items, forbiddenTerms }),
    [items, forbiddenTerms],
  );
  const injectedIds = useMemo(() => new Set(chatDigest.itemIds), [chatDigest]);

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
      <CollapsibleSection
        dense
        persistId="projectMemory"
        title={t('memory.settingsTitle', '프로젝트 메모리')}
        testId="project-memory-settings"
        action={(
          <button
            type="button"
            data-testid="project-memory-import-open"
            className="text-xs text-editor-muted hover:text-primary-500"
            onClick={() => setImportOpen(true)}
          >
            {t('memory.import.open', '가져오기')}
          </button>
        )}
      >

        <div className="space-y-1.5">
          {/* 대부분 기본값으로 충분하므로 상시 폼이 아니라 눈에 덜 띄는 보조 컨트롤로 둔다. */}
          <label className="flex items-center gap-1 text-[11px] text-editor-muted">
            {t('memory.categoryLabel', '카테고리')}
            <select
              className="bg-transparent text-[11px] text-editor-muted outline-none"
              value={category}
              onChange={(event) => setCategory(event.target.value as ProjectMemoryCategory)}
            >
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>{t(`memory.category.${value}`)}</option>
              ))}
            </select>
          </label>
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
              className="rounded-lg bg-primary-fill px-3 py-2 text-xs text-white disabled:opacity-50"
              disabled={saving || !content.trim()}
              onClick={() => void handleAdd()}
            >
              {t('memory.add', '추가')}
            </button>
          </div>
        </div>

        <div className="space-y-0.5">
          {items.map((item) => {
            const isEditing = editing?.id === item.id;
            const injected = injectedIds.has(item.id);
            return (
              <div
                key={item.id}
                data-testid="project-memory-item"
                className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-editor-surface"
              >
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <textarea
                      className="min-h-16 w-full rounded-lg border border-editor-border bg-editor-bg px-2 py-1.5 text-xs text-editor-text"
                      value={editing.content}
                      onChange={(event) => setEditing({ id: item.id, content: event.target.value })}
                    />
                  ) : (
                    /* 본문이 카테고리의 유일한 hover 대상이다. 네이티브 title은 뜨기까지
                       1초 넘게 걸려 카테고리를 확인하려면 매번 기다려야 했다 —
                       설정 패널의 다른 도움말과 같은 group-hover 툴팁으로 바꿔 즉시 뜬다. */
                    <div className="group/tip relative">
                      <div
                        className={`whitespace-pre-wrap break-words text-xs ${
                          injected ? 'text-editor-text' : 'text-editor-muted'
                        }`}
                      >
                        {item.content}
                      </div>
                      <div className="absolute left-0 top-full z-10 mt-1 hidden w-max max-w-[13rem] rounded border border-editor-border bg-editor-surface px-2 py-1 text-[11px] leading-relaxed text-editor-text shadow-lg group-hover/tip:block">
                        {t(`memory.category.${item.category}`)}
                        {!injected && (
                          <>
                            <br />
                            {t(
                              'memory.notInChat',
                              '채팅에는 전달되지 않습니다. 번역·검수·폴리싱에는 포함됩니다.',
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {item.status !== 'active' && (
                    <span className="text-[11px] text-editor-muted">
                      {t(`memory.status.${item.status}`)}
                    </span>
                  )}
                </div>
                {/* 저장/취소는 한 쌍으로 읽혀야 하므로 메뉴에 넣지 않고 그대로 노출한다. */}
                {isEditing ? (
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <button
                      type="button"
                      className="text-xs text-primary-500"
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
                      className="text-xs text-editor-muted"
                      onClick={() => setEditing(null)}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                ) : (
                  <RowMenu
                    onEdit={() => setEditing({ id: item.id, content: item.content })}
                    onDelete={() => void handleDelete(item.id)}
                    deleteDisabled={saving}
                  />
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      <ProjectMemoryImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
