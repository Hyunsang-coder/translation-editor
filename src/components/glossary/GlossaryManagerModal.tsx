import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { confirm } from '@tauri-apps/plugin-dialog';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useGlossaryStore } from '@/stores/glossaryStore';
import { useUIStore } from '@/stores/uiStore';
import {
  pickGlossaryCsvFile,
  pickGlossaryExcelFile,
  pickGlossaryExportPath,
} from '@/tauri/dialog';
import { exportGlossary } from '@/tauri/glossary';
import type { GlossaryEntry } from '@/types';

interface GlossaryManagerModalProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
}

interface EntryDraft {
  source: string;
  target: string;
  notes: string;
  domain: string | null;
  caseSensitive: boolean;
}

const EMPTY_ENTRY: EntryDraft = {
  source: '',
  target: '',
  notes: '',
  domain: null,
  caseSensitive: false,
};

export function GlossaryManagerModal({
  open,
  projectId,
  onClose,
}: GlossaryManagerModalProps): JSX.Element | null {
  const { t } = useTranslation();
  const addToast = useUIStore((state) => state.addToast);
  const glossaries = useGlossaryStore((state) => state.glossaries);
  const projectGlossaries = useGlossaryStore((state) => state.projectGlossaries);
  const entriesByGlossary = useGlossaryStore((state) => state.entriesByGlossary);
  const selectedGlossaryId = useGlossaryStore((state) => state.selectedGlossaryId);
  const loading = useGlossaryStore((state) => state.loading);
  const entriesLoading = useGlossaryStore((state) => state.entriesLoading);
  const saving = useGlossaryStore((state) => state.saving);
  const error = useGlossaryStore((state) => state.error);
  const loadLibrary = useGlossaryStore((state) => state.loadLibrary);
  const loadEntries = useGlossaryStore((state) => state.loadEntries);
  const selectGlossary = useGlossaryStore((state) => state.selectGlossary);
  const createGlossary = useGlossaryStore((state) => state.createGlossary);
  const renameGlossary = useGlossaryStore((state) => state.renameGlossary);
  const removeGlossary = useGlossaryStore((state) => state.removeGlossary);
  const saveProjectSelection = useGlossaryStore((state) => state.saveProjectSelection);
  const createEntry = useGlossaryStore((state) => state.createEntry);
  const importFile = useGlossaryStore((state) => state.importFile);
  const updateEntry = useGlossaryStore((state) => state.updateEntry);
  const deleteEntry = useGlossaryStore((state) => state.deleteEntry);

  const [showNewGlossary, setShowNewGlossary] = useState(false);
  const [newGlossaryName, setNewGlossaryName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [glossaryName, setGlossaryName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [entryDraft, setEntryDraft] = useState<EntryDraft>(EMPTY_ENTRY);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const selectedGlossary = glossaries.find((item) => item.id === selectedGlossaryId) ?? null;
  const activeIndex = projectGlossaries.findIndex((item) => item.id === selectedGlossaryId);
  const isActive = activeIndex >= 0;
  const entries = selectedGlossaryId
    ? entriesByGlossary[selectedGlossaryId] ?? []
    : [];

  const visibleEntries = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => (
      entry.source.toLocaleLowerCase().includes(query)
      || entry.target.toLocaleLowerCase().includes(query)
      || entry.notes?.toLocaleLowerCase().includes(query)
    ));
  }, [entries, searchQuery]);

  useEffect(() => {
    if (!open || !projectId) return;
    void loadLibrary(projectId).catch(() => undefined);
  }, [loadLibrary, open, projectId]);

  useEffect(() => {
    if (!open || !selectedGlossaryId) return;
    void loadEntries(selectedGlossaryId).catch(() => undefined);
  }, [loadEntries, open, selectedGlossaryId]);

  useEffect(() => {
    setGlossaryName(selectedGlossary?.name ?? '');
    setRenaming(false);
    setEntryDraft(EMPTY_ENTRY);
    setEditingEntryId(null);
    setSearchQuery('');
  }, [selectedGlossary?.id, selectedGlossary?.name]);

  const notifyError = (caught: unknown) => {
    addToast({
      type: 'error',
      message: caught instanceof Error ? caught.message : String(caught),
    });
  };

  const handleCreateGlossary = async () => {
    const state = useGlossaryStore.getState();
    if (state.loading || state.saving || !newGlossaryName.trim()) return;
    try {
      await createGlossary(newGlossaryName);
      setNewGlossaryName('');
      setShowNewGlossary(false);
      addToast({ type: 'success', message: t('glossaryManager.glossaryCreated') });
    } catch (caught) {
      notifyError(caught);
    }
  };

  const handleRenameGlossary = async () => {
    if (
      useGlossaryStore.getState().loading
      || useGlossaryStore.getState().saving
      || !selectedGlossary
      || !glossaryName.trim()
    ) return;
    try {
      await renameGlossary(selectedGlossary.id, glossaryName, selectedGlossary.description);
      setRenaming(false);
      addToast({ type: 'success', message: t('glossaryManager.glossaryRenamed') });
    } catch (caught) {
      notifyError(caught);
    }
  };

  const handleDeleteGlossary = async () => {
    const state = useGlossaryStore.getState();
    if (state.loading || state.saving || !selectedGlossary) return;
    const accepted = await confirm(
      t('glossaryManager.deleteGlossaryConfirm', { name: selectedGlossary.name }),
      { title: t('glossaryManager.deleteGlossary'), kind: 'warning' },
    );
    if (!accepted) return;
    try {
      await removeGlossary(selectedGlossary.id);
      addToast({ type: 'success', message: t('glossaryManager.glossaryDeleted') });
    } catch (caught) {
      notifyError(caught);
    }
  };

  const handleToggleProject = async () => {
    const state = useGlossaryStore.getState();
    if (state.loading || state.saving || !selectedGlossaryId) return;
    const nextIds = isActive
      ? projectGlossaries.filter((item) => item.id !== selectedGlossaryId).map((item) => item.id)
      : [...projectGlossaries.map((item) => item.id), selectedGlossaryId];
    try {
      await saveProjectSelection(projectId, nextIds);
    } catch (caught) {
      notifyError(caught);
    }
  };

  const handleMove = async (direction: -1 | 1) => {
    const state = useGlossaryStore.getState();
    if (state.loading || state.saving || activeIndex < 0) return;
    const destination = activeIndex + direction;
    if (destination < 0 || destination >= projectGlossaries.length) return;
    const nextIds = projectGlossaries.map((item) => item.id);
    [nextIds[activeIndex], nextIds[destination]] = [
      nextIds[destination]!,
      nextIds[activeIndex]!,
    ];
    try {
      await saveProjectSelection(projectId, nextIds);
    } catch (caught) {
      notifyError(caught);
    }
  };

  const handleSaveEntry = async () => {
    if (
      useGlossaryStore.getState().loading
      || useGlossaryStore.getState().saving
      || !selectedGlossaryId
      || !entryDraft.source.trim()
      || !entryDraft.target.trim()
    ) return;
    const wasLinked = isActive;
    try {
      if (editingEntryId) {
        await updateEntry({
          glossaryId: selectedGlossaryId,
          entryId: editingEntryId,
          ...entryDraft,
        });
        addToast({ type: 'success', message: t('glossaryManager.termUpdated') });
      } else {
        await createEntry({
          glossaryId: selectedGlossaryId,
          ...entryDraft,
        });
        const nowLinked = useGlossaryStore.getState().projectGlossaries
          .some((item) => item.id === selectedGlossaryId);
        addToast({
          type: 'success',
          message: (!wasLinked && nowLinked)
            ? t('glossaryManager.termAddedAndLinked')
            : t('glossaryManager.termAdded'),
        });
      }
      setEntryDraft(EMPTY_ENTRY);
      setEditingEntryId(null);
    } catch (caught) {
      notifyError(caught);
    }
  };

  const beginEditEntry = (entry: GlossaryEntry) => {
    setEditingEntryId(entry.id);
    setEntryDraft({
      source: entry.source,
      target: entry.target,
      notes: entry.notes ?? '',
      domain: entry.domain ?? null,
      caseSensitive: entry.caseSensitive,
    });
  };

  const handleDeleteEntry = async (entry: GlossaryEntry) => {
    const state = useGlossaryStore.getState();
    if (state.loading || state.saving || !selectedGlossaryId) return;
    const accepted = await confirm(
      t('glossaryManager.deleteTermConfirm', { source: entry.source }),
      { title: t('glossaryManager.deleteTerm'), kind: 'warning' },
    );
    if (!accepted) return;
    try {
      await deleteEntry(selectedGlossaryId, entry.id);
    } catch (caught) {
      notifyError(caught);
    }
  };

  const handleImport = async (format: 'csv' | 'excel') => {
    if (importing || saving || loading || !selectedGlossaryId) return;
    setImporting(true);
    try {
      const path = format === 'excel'
        ? await pickGlossaryExcelFile()
        : await pickGlossaryCsvFile();
      if (!path) return;

      const result = await importFile({
        glossaryId: selectedGlossaryId,
        path,
        format,
      });
      addToast({
        type: 'success',
        message: t('settings.glossaryImportSuccess', {
          inserted: result.inserted,
          updated: result.updated,
          skipped: result.skipped,
        }),
      });
      for (const warning of result.warnings.slice(0, 3)) {
        addToast({
          type: 'warning',
          message: t('settings.glossaryImportWarning', { warning }),
        });
      }
    } catch (caught) {
      notifyError(caught);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async (format: 'csv' | 'excel') => {
    if (importing || exporting || saving || loading || !selectedGlossary) return;
    setExporting(true);
    try {
      const path = await pickGlossaryExportPath(format, selectedGlossary.name);
      if (!path) return;
      await exportGlossary({
        glossaryId: selectedGlossary.id,
        path,
        format,
      });
      addToast({
        type: 'success',
        message: t('glossaryManager.exportSuccess', { name: selectedGlossary.name }),
      });
    } catch (caught) {
      notifyError(caught);
    } finally {
      setExporting(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelId="glossary-manager-title"
      className="bg-black/55 backdrop-blur-sm p-4"
    >
      <div className="flex h-[min(760px,88vh)] w-[min(1080px,94vw)] flex-col overflow-hidden rounded-xl border border-editor-border bg-editor-surface shadow-2xl">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-editor-border bg-editor-bg px-5">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500/15 text-primary-500">
              <BookOpen size={17} />
            </span>
            <div>
              <h2 id="glossary-manager-title" className="text-sm font-semibold text-editor-text">
                {t('glossaryManager.title')}
              </h2>
              <p className="text-[11px] text-editor-muted">
                {t('glossaryManager.description')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-editor-muted hover:bg-editor-border hover:text-editor-text"
            aria-label={t('common.close')}
          >
            <X size={17} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-64 shrink-0 flex-col border-r border-editor-border bg-editor-bg/70">
            <div className="flex items-center justify-between px-4 pb-2 pt-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-editor-muted">
                {t('glossaryManager.myGlossaries')}
              </span>
              <button
                type="button"
                onClick={() => setShowNewGlossary(true)}
                disabled={loading}
                className="rounded p-1 text-primary-500 hover:bg-primary-500/10 disabled:opacity-40"
                aria-label={t('glossaryManager.newGlossary')}
              >
                <Plus size={16} />
              </button>
            </div>

            {showNewGlossary && (
              <div className="mx-3 mb-2 rounded-lg border border-primary-500/40 bg-editor-surface p-2">
                <input
                  value={newGlossaryName}
                  onChange={(event) => setNewGlossaryName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleCreateGlossary();
                    if (event.key === 'Escape') setShowNewGlossary(false);
                  }}
                  placeholder={t('glossaryManager.glossaryName')}
                  aria-label={t('glossaryManager.glossaryName')}
                  className="w-full rounded border border-editor-border bg-editor-bg px-2 py-1.5 text-xs text-editor-text outline-none focus:border-primary-500"
                  autoFocus
                />
                <div className="mt-2 flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setShowNewGlossary(false)}
                    className="rounded p-1 text-editor-muted hover:bg-editor-border"
                    aria-label={t('common.cancel')}
                  >
                    <X size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreateGlossary()}
                    disabled={loading || !newGlossaryName.trim() || saving}
                    className="rounded bg-primary-500 p-1 text-white disabled:opacity-40"
                    aria-label={t('common.confirm')}
                  >
                    <Check size={14} />
                  </button>
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
              {loading ? (
                <p className="px-2 py-6 text-center text-xs text-editor-muted">
                  {t('common.loading')}
                </p>
              ) : glossaries.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setShowNewGlossary(true)}
                  className="m-2 rounded-lg border border-dashed border-editor-border p-4 text-left text-xs text-editor-muted hover:border-primary-500 hover:text-editor-text"
                >
                  {t('glossaryManager.emptyGlossaries')}
                </button>
              ) : glossaries.map((glossary) => {
                const linked = projectGlossaries.find((item) => item.id === glossary.id);
                const selected = glossary.id === selectedGlossaryId;
                return (
                  <button
                    type="button"
                    key={glossary.id}
                    onClick={() => selectGlossary(glossary.id)}
                    aria-pressed={selected}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                      selected
                        ? 'bg-primary-500/12 text-editor-text'
                        : 'text-editor-muted hover:bg-editor-border/60 hover:text-editor-text'
                    }`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${
                      linked ? 'bg-primary-500' : 'border border-editor-muted'
                    }`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{glossary.name}</span>
                      <span className="block text-[10px] text-editor-muted">
                        {t('glossaryManager.termCount', { count: glossary.entryCount })}
                      </span>
                    </span>
                    {linked && (
                      <span className="text-[10px] tabular-nums text-primary-500">
                        {linked.priority + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            {!selectedGlossary ? (
              <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-editor-muted">
                {error || t('glossaryManager.selectGlossary')}
              </div>
            ) : (
              <>
                <div className="shrink-0 border-b border-editor-border px-5 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      {renaming ? (
                        <div className="flex max-w-md items-center gap-2">
                          <input
                            value={glossaryName}
                            onChange={(event) => setGlossaryName(event.target.value)}
                            className="min-w-0 flex-1 rounded border border-primary-500 bg-editor-bg px-2 py-1 text-sm font-semibold text-editor-text outline-none"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => void handleRenameGlossary()}
                            disabled={loading || saving}
                            className="text-primary-500"
                            aria-label={t('common.save')}
                          >
                            <Check size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setGlossaryName(selectedGlossary.name);
                              setRenaming(false);
                            }}
                            className="text-editor-muted"
                            disabled={loading || saving}
                            aria-label={t('common.cancel')}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-base font-semibold text-editor-text">
                            {selectedGlossary.name}
                          </h3>
                          <button
                            type="button"
                            onClick={() => setRenaming(true)}
                            disabled={loading || saving}
                            className="rounded p-1 text-editor-muted hover:bg-editor-border hover:text-editor-text"
                            aria-label={t('glossaryManager.renameGlossary')}
                          >
                            <Pencil size={13} />
                          </button>
                        </div>
                      )}
                      <p className="mt-0.5 text-[11px] text-editor-muted">
                        {selectedGlossary.description || t('glossaryManager.noDescription')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteGlossary()}
                      disabled={loading || saving}
                      className="rounded p-2 text-editor-muted hover:bg-red-500/10 hover:text-red-500"
                      aria-label={t('glossaryManager.deleteGlossary')}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-lg border border-editor-border bg-editor-bg px-3 py-2">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-editor-text">
                      <input
                        type="checkbox"
                        checked={isActive}
                        disabled={loading || saving}
                        onChange={() => void handleToggleProject()}
                        className="accent-primary-500"
                        aria-label={t('glossaryManager.useInProject')}
                      />
                      {t('glossaryManager.useInProject')}
                    </label>
                    {isActive && (
                      <div className="flex items-center gap-2 text-[11px] text-editor-muted">
                        <span>
                          {t('glossaryManager.priority', { priority: activeIndex + 1 })}
                        </span>
                        <button
                          type="button"
                          disabled={loading || activeIndex === 0 || saving}
                          onClick={() => void handleMove(-1)}
                          className="rounded p-1 hover:bg-editor-border disabled:opacity-30"
                          aria-label={t('glossaryManager.moveUp')}
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={loading || activeIndex === projectGlossaries.length - 1 || saving}
                          onClick={() => void handleMove(1)}
                          className="rounded p-1 hover:bg-editor-border disabled:opacity-30"
                          aria-label={t('glossaryManager.moveDown')}
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="shrink-0 border-b border-editor-border px-5 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleImport('csv')}
                      disabled={importing || exporting || loading || saving}
                      className="flex items-center gap-1 rounded-md border border-editor-border bg-editor-bg px-2 py-1 text-[10px] text-editor-text hover:border-primary-500 disabled:opacity-40"
                    >
                      <FileText size={11} />
                      {t('settings.glossaryImportCsv')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleImport('excel')}
                      disabled={importing || exporting || loading || saving}
                      className="flex items-center gap-1 rounded-md border border-editor-border bg-editor-bg px-2 py-1 text-[10px] text-editor-text hover:border-primary-500 disabled:opacity-40"
                    >
                      <FileSpreadsheet size={11} />
                      {t('settings.glossaryImportExcel')}
                    </button>
                    <span className="mx-0.5 h-4 w-px bg-editor-border" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => void handleExport('csv')}
                      disabled={importing || exporting || loading || saving}
                      className="flex items-center gap-1 rounded-md border border-editor-border bg-editor-bg px-2 py-1 text-[10px] text-editor-text hover:border-primary-500 disabled:opacity-40"
                    >
                      <Download size={11} />
                      {t('glossaryManager.exportCsv')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleExport('excel')}
                      disabled={importing || exporting || loading || saving}
                      className="flex items-center gap-1 rounded-md border border-editor-border bg-editor-bg px-2 py-1 text-[10px] text-editor-text hover:border-primary-500 disabled:opacity-40"
                    >
                      <FileSpreadsheet size={11} />
                      {t('glossaryManager.exportExcel')}
                    </button>
                    <span className="text-[10px] text-editor-muted">
                      {t('settings.glossaryColumns')}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 border-b border-editor-border bg-editor-bg/45 px-5 py-3">
                  <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2">
                    <label className="min-w-0 text-[11px] font-medium text-editor-muted">
                      {t('glossaryManager.source')}
                      <input
                        aria-label={t('glossaryManager.source')}
                        value={entryDraft.source}
                        onChange={(event) => setEntryDraft((draft) => ({ ...draft, source: event.target.value }))}
                        placeholder={t('glossaryManager.sourcePlaceholder')}
                        className="mt-1 w-full rounded-md border border-editor-border bg-editor-surface px-2.5 py-2 text-xs text-editor-text outline-none focus:border-primary-500"
                      />
                    </label>
                    <ArrowRight size={16} className="mb-2 text-primary-500" />
                    <label className="min-w-0 text-[11px] font-medium text-editor-muted">
                      {t('glossaryManager.target')}
                      <input
                        aria-label={t('glossaryManager.target')}
                        value={entryDraft.target}
                        onChange={(event) => setEntryDraft((draft) => ({ ...draft, target: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void handleSaveEntry();
                        }}
                        placeholder={t('glossaryManager.targetPlaceholder')}
                        className="mt-1 w-full rounded-md border border-editor-border bg-editor-surface px-2.5 py-2 text-xs text-editor-text outline-none focus:border-primary-500"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleSaveEntry()}
                      disabled={loading || !entryDraft.source.trim() || !entryDraft.target.trim() || saving}
                      className="mb-px rounded-md bg-primary-500 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-600 disabled:opacity-40"
                    >
                      {editingEntryId
                        ? t('glossaryManager.saveTerm')
                        : t('glossaryManager.addTerm')}
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      value={entryDraft.notes}
                      onChange={(event) => setEntryDraft((draft) => ({ ...draft, notes: event.target.value }))}
                      placeholder={t('glossaryManager.notesPlaceholder')}
                      aria-label={t('glossaryManager.notesPlaceholder')}
                      className="min-w-0 flex-1 border-0 bg-transparent text-[11px] text-editor-text outline-none placeholder:text-editor-muted"
                    />
                    <label className="flex items-center gap-1.5 text-[10px] text-editor-muted">
                      <input
                        type="checkbox"
                        checked={entryDraft.caseSensitive}
                        onChange={(event) => setEntryDraft((draft) => ({
                          ...draft,
                          caseSensitive: event.target.checked,
                        }))}
                        className="accent-primary-500"
                      />
                      {t('glossaryManager.caseSensitive')}
                    </label>
                    {editingEntryId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingEntryId(null);
                          setEntryDraft(EMPTY_ENTRY);
                        }}
                        className="text-[10px] text-editor-muted hover:text-editor-text"
                      >
                        {t('common.cancel')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col px-5 py-3">
                  <div className="relative mb-3">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-editor-muted" />
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={t('glossaryManager.searchTerms')}
                      aria-label={t('glossaryManager.searchTerms')}
                      className="w-full rounded-md border border-editor-border bg-editor-bg py-2 pl-8 pr-3 text-xs text-editor-text outline-none focus:border-primary-500"
                    />
                  </div>

                  {error && (
                    <div className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
                      {error}
                    </div>
                  )}

                  <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-editor-border">
                    {entriesLoading ? (
                      <p className="p-6 text-center text-xs text-editor-muted">
                        {t('common.loading')}
                      </p>
                    ) : visibleEntries.length === 0 ? (
                      <p className="p-8 text-center text-xs text-editor-muted">
                        {searchQuery
                          ? t('glossaryManager.noSearchResults')
                          : t('glossaryManager.emptyTerms')}
                      </p>
                    ) : visibleEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="group grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-editor-border px-3 py-2.5 last:border-b-0 hover:bg-editor-bg"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-editor-text">{entry.source}</p>
                          {entry.caseSensitive && (
                            <p className="text-[9px] text-editor-muted">
                              {t('glossaryManager.caseSensitive')}
                            </p>
                          )}
                        </div>
                        <ArrowRight size={14} className="text-primary-500/70" />
                        <div className="min-w-0">
                          <p className="truncate text-xs text-editor-text">{entry.target}</p>
                          {entry.notes && (
                            <p className="truncate text-[10px] text-editor-muted">{entry.notes}</p>
                          )}
                        </div>
                        <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => beginEditEntry(entry)}
                            disabled={loading || saving}
                            className="rounded p-1.5 text-editor-muted hover:bg-editor-border hover:text-editor-text"
                            aria-label={t('glossaryManager.editTerm')}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteEntry(entry)}
                            disabled={loading || saving}
                            className="rounded p-1.5 text-editor-muted hover:bg-red-500/10 hover:text-red-500"
                            aria-label={t('glossaryManager.deleteTerm')}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </Modal>
  );
}
