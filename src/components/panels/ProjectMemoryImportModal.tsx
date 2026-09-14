import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { memoryItemLimit } from '@/ai/context/projectMemoryPolicy';
import { useProjectMemoryStore } from '@/stores/projectMemoryStore';
import { useUIStore } from '@/stores/uiStore';
import { loadProjectMemory } from '@/tauri/projectMemory';
import { listRecentProjects, type RecentProjectInfo } from '@/tauri/storage';
import type { ForbiddenTerm, ProjectMemoryItem } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface SourcePreview {
  items: ProjectMemoryItem[];
  forbiddenTerms: ForbiddenTerm[];
}

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

export function ProjectMemoryImportModal({ open, onClose }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const addToast = useUIStore((state) => state.addToast);
  const activeProjectId = useProjectMemoryStore((state) => state.activeProjectId);
  const activeCount = useProjectMemoryStore(
    (state) => state.items.filter((item) => item.status === 'active').length,
  );
  const importFrom = useProjectMemoryStore((state) => state.importFrom);
  const saving = useProjectMemoryStore((state) => state.saving);

  const [projects, setProjects] = useState<RecentProjectInfo[]>([]);
  const [sourceId, setSourceId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectedTerms, setSelectedTerms] = useState<Set<string>>(new Set());

  const reportError = useCallback((error: unknown): void => {
    addToast({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }, [addToast]);

  useEffect(() => {
    if (!open) return;
    setSourceId('');
    setQuery('');
    setPreview(null);
    setSelectedItems(new Set());
    setSelectedTerms(new Set());
    listRecentProjects()
      .then((all) => setProjects(all.filter((entry) => entry.id !== activeProjectId)))
      .catch(reportError);
  }, [open, activeProjectId, reportError]);

  useEffect(() => {
    if (!sourceId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadProjectMemory(sourceId)
      .then((snapshot) => {
        if (cancelled) return;
        const items = snapshot.items.filter((item) => item.status === 'active');
        setPreview({ items, forbiddenTerms: snapshot.forbiddenTerms });
        setSelectedItems(new Set(items.map((item) => item.id)));
        setSelectedTerms(new Set(snapshot.forbiddenTerms.map((term) => term.id)));
      })
      .catch((error) => {
        if (!cancelled) reportError(error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [sourceId, reportError]);

  // 검색은 왼쪽 목록만 거른다. 이미 고른 프로젝트가 걸러져도 오른쪽 체크리스트는 유지한다.
  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return projects;
    return projects.filter((entry) => entry.title.toLocaleLowerCase().includes(normalized));
  }, [projects, query]);

  const selectedCount = selectedItems.size + selectedTerms.size;
  const chatLimit = memoryItemLimit('general-chat');
  const projectedActive = activeCount + selectedItems.size;

  const allSelected = useMemo(() => (
    preview !== null
    && preview.items.every((item) => selectedItems.has(item.id))
    && preview.forbiddenTerms.every((term) => selectedTerms.has(term.id))
  ), [preview, selectedItems, selectedTerms]);

  const handleToggleAll = (): void => {
    if (!preview) return;
    if (allSelected) {
      setSelectedItems(new Set());
      setSelectedTerms(new Set());
      return;
    }
    setSelectedItems(new Set(preview.items.map((item) => item.id)));
    setSelectedTerms(new Set(preview.forbiddenTerms.map((term) => term.id)));
  };

  const handleImport = async (): Promise<void> => {
    if (!sourceId || selectedCount === 0) return;
    try {
      const result = await importFrom({
        sourceProjectId: sourceId,
        itemIds: [...selectedItems],
        termIds: [...selectedTerms],
      });
      const skipped = result.skippedItems + result.skippedTerms;
      addToast({
        type: 'success',
        message: skipped > 0
          ? t('memory.import.resultWithSkipped', {
            imported: result.importedItems + result.importedTerms,
            skipped,
            defaultValue: '{{imported}}건 가져왔습니다. 이미 있는 {{skipped}}건은 건너뛰었습니다.',
          })
          : t('memory.import.result', {
            imported: result.importedItems + result.importedTerms,
            defaultValue: '{{imported}}건 가져왔습니다.',
          }),
      });
      onClose();
    } catch (error) {
      reportError(error);
    }
  };

  if (!open) return null;

  const totalCount = preview ? preview.items.length + preview.forbiddenTerms.length : 0;

  return (
    <Modal open onClose={onClose} labelId="memory-import-title" className="bg-black/40 p-4">
      {/* 높이를 고정해 프로젝트를 고를 때 모달이 늘어나지 않게 한다. 목록은 각 칸 안에서만 스크롤한다. */}
      <div
        className="flex h-[min(34rem,85vh)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-editor-border bg-editor-surface shadow-xl"
        data-testid="project-memory-import-modal"
      >
        <div className="flex items-start gap-3 border-b border-editor-hairline px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 id="memory-import-title" className="text-sm font-semibold text-editor-text">
              {t('memory.import.title', '다른 프로젝트에서 가져오기')}
            </h3>
            {/* 체크를 끝낸 뒤가 아니라 고르기 전에 읽혀야 하는 안내라 제목 아래에 둔다. */}
            <p className="mt-1 text-xs leading-relaxed text-editor-muted">
              {t('memory.import.copyHint', '복사본으로 들어옵니다. 원본을 나중에 고쳐도 반영되지 않습니다. 이미 있는 항목은 건너뜁니다.')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-lg leading-none text-editor-muted transition-colors hover:text-editor-text"
            aria-label={t('common.close')}
          >
            &times;
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-52 shrink-0 flex-col border-r border-editor-hairline bg-editor-bg">
            <p className="px-4 pb-1 pt-3 text-xs font-medium text-editor-muted">
              {t('memory.import.sourceLabel', '원본 프로젝트')}
            </p>
            <div className="relative px-2 pb-2">
              <Search
                size={13}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 -mt-1 text-editor-muted"
              />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('projectSidebar.searchProjects')}
                aria-label={t('projectSidebar.searchProjects')}
                autoFocus
                data-testid="project-memory-import-search"
                className="w-full rounded-md border border-editor-border bg-editor-surface py-1.5 pl-7 pr-2 text-xs text-editor-text focus:outline-none focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
              />
            </div>
            <ul
              data-testid="project-memory-import-source"
              className="min-h-0 flex-1 space-y-0.5 overflow-y-auto scrollbar-thin px-2 pb-2"
            >
              {projects.length === 0 ? (
                <li className="px-2 py-1.5 text-xs text-editor-muted">
                  {t('memory.import.noProjects', '다른 프로젝트가 없습니다.')}
                </li>
              ) : visibleProjects.length === 0 ? (
                <li className="px-2 py-1.5 text-xs text-editor-muted">
                  {t('projectSidebar.noSearchResults')}
                </li>
              ) : visibleProjects.map((entry) => {
                const selected = entry.id === sourceId;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSourceId(entry.id)}
                      className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                        selected ? 'bg-primary-500/10' : 'hover:bg-editor-border/60'
                      }`}
                    >
                      <span className={`block truncate text-sm ${selected ? 'font-medium text-primary-600' : 'text-editor-text'}`}>
                        {entry.title}
                      </span>
                      <span className="block text-xs text-editor-muted">
                        {new Date(entry.updatedAt).toLocaleDateString()}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-5 py-3">
            {!sourceId ? (
              <div className="flex h-full items-center justify-center text-xs text-editor-muted">
                {t('memory.import.selectSource', '왼쪽에서 프로젝트를 선택하세요')}
              </div>
            ) : loading ? (
              <p className="text-xs text-editor-muted">{t('common.loading')}</p>
            ) : preview && (
              totalCount === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-editor-muted">
                  {t('memory.import.empty', '가져올 항목이 없습니다.')}
                </div>
              ) : (
                <div className="space-y-4">
                  <label className="flex items-center gap-2 border-b border-editor-hairline pb-2 text-xs text-editor-text">
                    <input type="checkbox" checked={allSelected} onChange={handleToggleAll} />
                    <span className="flex-1">
                      {allSelected
                        ? t('memory.import.deselectAll', '전체 해제')
                        : t('memory.import.selectAll', '전체 선택')}
                    </span>
                    <span className="tabular-nums text-editor-muted">{selectedCount} / {totalCount}</span>
                  </label>

                  {preview.items.length > 0 && (
                    <div className="space-y-0.5">
                      <p className="pb-1 text-xs font-medium text-editor-muted">
                        {t('memory.settingsTitle', '프로젝트 메모리')}
                      </p>
                      {preview.items.map((item) => (
                        <label
                          key={item.id}
                          className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-editor-bg"
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={selectedItems.has(item.id)}
                            onChange={() => setSelectedItems((current) => toggle(current, item.id))}
                          />
                          <span className="min-w-0 flex-1 break-words text-editor-text">
                            {item.content}
                          </span>
                          <span className="mt-0.5 shrink-0 text-xs text-editor-muted">
                            {t(`memory.category.${item.category}`)}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}

                  {preview.forbiddenTerms.length > 0 && (
                    <div className="space-y-0.5">
                      <p className="pb-1 text-xs font-medium text-editor-muted">
                        {t('memory.forbiddenTermsTitle', '금칙어')}
                      </p>
                      {preview.forbiddenTerms.map((term) => (
                        <label
                          key={term.id}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-editor-bg"
                        >
                          <input
                            type="checkbox"
                            checked={selectedTerms.has(term.id)}
                            onChange={() => setSelectedTerms((current) => toggle(current, term.id))}
                          />
                          <span className="text-editor-text">{term.term}</span>
                          {term.replacement && (
                            <span className="text-editor-muted">→ {term.replacement}</span>
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-editor-hairline px-5 py-3">
          {/* 체크를 바꾸는 즉시 보이도록 목록 끝이 아니라 버튼 옆에 둔다. */}
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-primary-600">
            {projectedActive > chatLimit && t('memory.import.limitHint', {
              total: projectedActive,
              limit: chatLimit,
              defaultValue: '가져오면 활성 {{total}}개가 됩니다. 채팅에는 상위 {{limit}}개만 전달됩니다.',
            })}
          </p>
          <button
            type="button"
            className="shrink-0 rounded border border-editor-border px-3 py-1.5 text-sm text-editor-text hover:bg-editor-bg disabled:opacity-60"
            disabled={saving}
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            data-testid="project-memory-import-submit"
            className="shrink-0 rounded bg-primary-fill px-3 py-1.5 text-sm text-white hover:bg-primary-fill-hover disabled:opacity-60"
            disabled={saving || selectedCount === 0}
            onClick={() => void handleImport()}
          >
            {selectedCount > 0
              ? t('memory.import.submit', { selected: selectedCount, defaultValue: '{{selected}}개 가져오기' })
              : t('memory.import.open', '가져오기')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
