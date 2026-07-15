import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, BookOpen, Plus, X } from 'lucide-react';
import { GlossaryManagerModal } from './GlossaryManagerModal';
import { useGlossaryStore } from '@/stores/glossaryStore';
import { useUIStore } from '@/stores/uiStore';

interface ProjectGlossarySectionProps {
  projectId: string;
}

export function ProjectGlossarySection({
  projectId,
}: ProjectGlossarySectionProps): JSX.Element {
  const { t } = useTranslation();
  const addToast = useUIStore((state) => state.addToast);
  const projectGlossaries = useGlossaryStore((state) => state.projectGlossaries);
  const loading = useGlossaryStore((state) => state.loading);
  const error = useGlossaryStore((state) => state.error);
  const loadLibrary = useGlossaryStore((state) => state.loadLibrary);
  const createEntry = useGlossaryStore((state) => state.createEntry);
  const saveProjectSelection = useGlossaryStore((state) => state.saveProjectSelection);
  const saving = useGlossaryStore((state) => state.saving);
  const [managerOpen, setManagerOpen] = useState(false);
  const [glossaryId, setGlossaryId] = useState('');
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');

  useEffect(() => {
    setManagerOpen(false);
    setGlossaryId('');
    setSource('');
    setTarget('');
    void loadLibrary(projectId).catch(() => undefined);
  }, [loadLibrary, projectId]);

  useEffect(() => {
    if (projectGlossaries.some((item) => item.id === glossaryId)) return;
    setGlossaryId(projectGlossaries[0]?.id ?? '');
  }, [glossaryId, projectGlossaries]);

  const handleQuickAdd = async () => {
    if (
      useGlossaryStore.getState().saving
      || !glossaryId
      || !source.trim()
      || !target.trim()
    ) return;
    try {
      await createEntry({
        glossaryId,
        source,
        target,
        notes: null,
        domain: null,
        caseSensitive: false,
      });
      setSource('');
      setTarget('');
      addToast({ type: 'success', message: t('glossaryManager.termAdded') });
    } catch (caught) {
      addToast({
        type: 'error',
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  };

  const handleUnlink = async (unlinkId: string) => {
    if (useGlossaryStore.getState().saving) return;
    const nextIds = projectGlossaries
      .filter((item) => item.id !== unlinkId)
      .map((item) => item.id);
    try {
      await saveProjectSelection(projectId, nextIds);
      addToast({ type: 'success', message: t('glossaryManager.unlinkedFromProject') });
    } catch (caught) {
      addToast({
        type: 'error',
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  };

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-xs font-semibold text-editor-text">
              3. {t('settings.glossary')}
            </h3>
            <span className="text-[10px] text-editor-muted">
              {t('settings.glossaryDescription')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="flex shrink-0 items-center gap-1 rounded-md border border-editor-border bg-editor-surface px-2 py-1 text-[11px] font-medium text-editor-text hover:border-primary-500 hover:text-primary-500"
          >
            <BookOpen size={12} />
            {t('glossaryManager.manage')}
          </button>
        </div>

        {error && projectGlossaries.length === 0 ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-[11px] text-red-500">
            {error}
          </div>
        ) : loading ? (
          <div className="rounded-md border border-editor-border p-3 text-center text-xs text-editor-muted">
            {t('common.loading')}
          </div>
        ) : projectGlossaries.length > 0 ? (
          <div className="space-y-1">
            {projectGlossaries.map((glossary, index) => (
              <div
                key={glossary.id}
                className="group flex items-center gap-2 rounded-md border border-editor-border bg-editor-surface px-2.5 py-2"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary-500/15 text-[9px] font-semibold text-primary-500">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-editor-text">
                  {glossary.name}
                </span>
                <span className="text-[9px] tabular-nums text-editor-muted">
                  {t('glossaryManager.termCount', { count: glossary.entryCount })}
                </span>
                <button
                  type="button"
                  onClick={() => void handleUnlink(glossary.id)}
                  disabled={saving}
                  className="rounded p-0.5 text-editor-muted opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40"
                  aria-label={t('glossaryManager.unlinkFromProject', { name: glossary.name })}
                  title={t('glossaryManager.unlinkFromProject', { name: glossary.name })}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="w-full rounded-md border border-dashed border-editor-border p-3 text-left text-[11px] text-editor-muted hover:border-primary-500 hover:text-editor-text"
          >
            {t('glossaryManager.noActiveGlossaries')}
          </button>
        )}

        {projectGlossaries.length > 0 && (
          <div className="rounded-lg border border-editor-border bg-editor-bg/55 p-2.5">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold text-editor-muted">
              <Plus size={11} />
              {t('glossaryManager.quickAdd')}
            </div>
            {projectGlossaries.length > 1 && (
              <select
                value={glossaryId}
                onChange={(event) => setGlossaryId(event.target.value)}
                className="mb-2 w-full rounded border border-editor-border bg-editor-surface px-2 py-1.5 text-[10px] text-editor-text outline-none focus:border-primary-500"
              >
                {projectGlossaries.map((glossary) => (
                  <option key={glossary.id} value={glossary.id}>{glossary.name}</option>
                ))}
              </select>
            )}
            <div className="space-y-1.5">
              <input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder={t('glossaryManager.sourcePlaceholder')}
                aria-label={t('glossaryManager.source')}
                className="w-full rounded border border-editor-border bg-editor-surface px-2 py-1.5 text-[11px] text-editor-text outline-none focus:border-primary-500"
              />
              <div className="flex items-center gap-1.5">
                <ArrowRight size={12} className="shrink-0 text-primary-500" />
                <input
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleQuickAdd();
                  }}
                  placeholder={t('glossaryManager.targetPlaceholder')}
                  aria-label={t('glossaryManager.target')}
                  className="min-w-0 flex-1 rounded border border-editor-border bg-editor-surface px-2 py-1.5 text-[11px] text-editor-text outline-none focus:border-primary-500"
                />
                <button
                  type="button"
                  onClick={() => void handleQuickAdd()}
                  disabled={!source.trim() || !target.trim() || saving}
                  className="rounded bg-primary-500 px-2 py-1.5 text-[10px] font-semibold text-white hover:bg-primary-600 disabled:opacity-40"
                >
                  {t('glossaryManager.add')}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <GlossaryManagerModal
        open={managerOpen}
        projectId={projectId}
        onClose={() => setManagerOpen(false)}
      />
    </>
  );
}
