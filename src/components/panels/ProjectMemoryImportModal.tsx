import { useCallback, useEffect, useMemo, useState } from 'react';
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

  return (
    <Modal open onClose={onClose} labelId="memory-import-title" className="bg-black/40 p-4">
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-editor-border bg-editor-surface"
        data-testid="project-memory-import-modal"
      >
        <div className="border-b border-editor-hairline px-4 py-3">
          <h3 id="memory-import-title" className="text-sm font-semibold text-editor-text">
            {t('memory.import.title', '다른 프로젝트에서 가져오기')}
          </h3>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <label className="block space-y-1">
            <span className="text-[10px] text-editor-muted">
              {t('memory.import.sourceLabel', '원본 프로젝트')}
            </span>
            <select
              data-testid="project-memory-import-source"
              className="w-full rounded-lg border border-editor-border bg-editor-bg px-2 py-2 text-xs text-editor-text"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            >
              <option value="">
                {projects.length === 0
                  ? t('memory.import.noProjects', '다른 프로젝트가 없습니다.')
                  : t('memory.import.selectSource', '프로젝트를 선택하세요')}
              </option>
              {projects.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.title}</option>
              ))}
            </select>
          </label>

          {loading && (
            <p className="text-xs text-editor-muted">{t('common.loading')}</p>
          )}

          {preview && !loading && (
            preview.items.length === 0 && preview.forbiddenTerms.length === 0 ? (
              <p className="text-xs text-editor-muted">
                {t('memory.import.empty', '가져올 항목이 없습니다.')}
              </p>
            ) : (
              <>
                <button
                  type="button"
                  className="text-[11px] text-primary-500"
                  onClick={handleToggleAll}
                >
                  {allSelected
                    ? t('memory.import.deselectAll', '전체 해제')
                    : t('memory.import.selectAll', '전체 선택')}
                </button>

                {preview.items.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-editor-muted">
                      {t('memory.settingsTitle', '프로젝트 메모리')}
                    </p>
                    {preview.items.map((item) => (
                      <label
                        key={item.id}
                        className="flex items-start gap-2 rounded-lg px-2 py-1 text-xs hover:bg-editor-bg"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={selectedItems.has(item.id)}
                          onChange={() => setSelectedItems((current) => toggle(current, item.id))}
                        />
                        <span className="shrink-0 text-[10px] text-editor-muted">
                          {t(`memory.category.${item.category}`)}
                        </span>
                        <span className="min-w-0 flex-1 break-words text-editor-text">
                          {item.content}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {preview.forbiddenTerms.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-editor-muted">
                      {t('memory.forbiddenTermsTitle', '금칙어')}
                    </p>
                    {preview.forbiddenTerms.map((term) => (
                      <label
                        key={term.id}
                        className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-editor-bg"
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

                <p className="text-[10px] leading-relaxed text-editor-muted">
                  {t('memory.import.copyHint', '복사본으로 들어옵니다. 원본을 나중에 고쳐도 반영되지 않습니다. 이미 있는 항목은 건너뜁니다.')}
                </p>
                {projectedActive > chatLimit && (
                  <p className="text-[10px] leading-relaxed text-primary-500">
                    {t('memory.import.limitHint', {
                      total: projectedActive,
                      limit: chatLimit,
                      defaultValue: '가져오면 활성 {{total}}개가 됩니다. 채팅에는 상위 {{limit}}개만 전달됩니다.',
                    })}
                  </p>
                )}
              </>
            )
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-editor-hairline px-4 py-3">
          <button
            type="button"
            className="rounded border border-editor-border px-3 py-1.5 text-sm text-editor-text hover:bg-editor-bg disabled:opacity-60"
            disabled={saving}
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            data-testid="project-memory-import-submit"
            className="rounded bg-primary-fill px-3 py-1.5 text-sm text-white hover:bg-primary-fill-hover disabled:opacity-60"
            disabled={saving || selectedCount === 0}
            onClick={() => void handleImport()}
          >
            {t('memory.import.submit', {
              selected: selectedCount,
              defaultValue: '가져오기 ({{selected}})',
            })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
