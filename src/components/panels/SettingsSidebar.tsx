import { useTranslation } from 'react-i18next';
import { Settings, Search } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { pickGlossaryFile, pickDocumentFile } from '@/tauri/dialog';
import { importGlossaryCsv, importGlossaryExcel } from '@/tauri/glossary';
import { isTauriRuntime } from '@/tauri/invoke';
import { confirm } from '@tauri-apps/plugin-dialog';
import { DebouncedTextarea } from '@/components/ui/DebouncedTextarea';
import { ReviewPanel } from '@/components/review/ReviewPanel';

/**
 * Settings & Review 사이드바 컴포넌트
 * 접힌 상태: 아이콘만 표시 (Settings/Review 아이콘)
 * 펼친 상태: Settings 또는 Review 탭 표시
 */
export function SettingsSidebar(): JSX.Element {
  const { t } = useTranslation();
  const { sidebarCollapsed, toggleSidebar, sidebarActiveTab, setSidebarActiveTab } = useUIStore();

  const translatorPersona = useChatStore((s) => s.translatorPersona);
  const setTranslatorPersona = useChatStore((s) => s.setTranslatorPersona);
  const translationRules = useChatStore((s) => s.translationRules);
  const setTranslationRules = useChatStore((s) => s.setTranslationRules);
  const projectContext = useChatStore((s) => s.projectContext);
  const setProjectContext = useChatStore((s) => s.setProjectContext);
  const attachments = useChatStore((s) => s.attachments);
  const attachFile = useChatStore((s) => s.attachFile);
  const deleteAttachment = useChatStore((s) => s.deleteAttachment);

  const project = useProjectStore((s) => s.project);
  const settingsKey = project?.id ?? 'none';
  const addGlossaryPath = useProjectStore((s) => s.addGlossaryPath);
  const removeGlossaryPath = useProjectStore((s) => s.removeGlossaryPath);

  // 접힌 상태: 아이콘만 표시
  if (sidebarCollapsed) {
    return (
      <div className="w-12 h-full flex flex-col items-center py-2 gap-1 bg-editor-surface border-r border-editor-border">
        {/* Settings 아이콘 */}
        <button
          type="button"
          onClick={() => {
            toggleSidebar();
            setSidebarActiveTab('settings');
          }}
          className="p-2.5 rounded-lg hover:bg-editor-border transition-colors text-editor-muted hover:text-editor-text"
          title={t('chat.settings')}
        >
          <Settings size={20} />
        </button>

        {/* Review 아이콘 */}
        <button
          type="button"
          onClick={() => {
            toggleSidebar();
            setSidebarActiveTab('review');
          }}
          className="p-2.5 rounded-lg hover:bg-editor-border transition-colors text-editor-muted hover:text-editor-text"
          title={t('review.title', '검수')}
        >
          <Search size={20} />
        </button>
      </div>
    );
  }

  const renderSettings = (): JSX.Element => (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6 bg-editor-bg">
      {/* Section 1: Translator Persona */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 group relative">
            <h3 className="text-xs font-semibold text-editor-text">1. {t('settings.translatorPersona')}</h3>
            <span className="cursor-help text-editor-muted text-[10px]">ⓘ</span>
            <div className="absolute left-0 top-full mt-2 hidden group-hover:block w-64 p-2 bg-editor-surface border border-editor-border rounded shadow-lg text-[10px] text-editor-text z-10 leading-relaxed whitespace-pre-line">
              {t('settings.translatorPersonaDescription')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs text-primary-500 hover:text-primary-600"
              onClick={() => setTranslatorPersona('')}
            >
              {t('common.clear')}
            </button>
          </div>
        </div>
        <DebouncedTextarea
          key={`translator-persona-${settingsKey}`}
          className="w-full min-h-[3.5rem] text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
          value={translatorPersona}
          onDebouncedChange={setTranslatorPersona}
          placeholder={t('settings.translatorPersonaPlaceholder')}
          rows={2}
        />
      </section>

      {/* Section 2: Translation Rules */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 group relative">
            <h3 className="text-xs font-semibold text-editor-text">2. {t('settings.translationRules')}</h3>
            <span className="cursor-help text-editor-muted text-[10px]">ⓘ</span>
            <div className="absolute left-0 top-full mt-2 hidden group-hover:block w-48 p-2 bg-editor-surface border border-editor-border rounded shadow-lg text-[10px] text-editor-text z-10 leading-relaxed">
              {t('settings.translationRulesDescription')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs text-primary-500 hover:text-primary-600"
              onClick={() => setTranslationRules('')}
            >
              {t('common.clear')}
            </button>
          </div>
        </div>
        <DebouncedTextarea
          key={`translation-rules-${settingsKey}`}
          className="w-full h-32 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
          value={translationRules}
          onDebouncedChange={setTranslationRules}
          placeholder={t('settings.translationRulesPlaceholder')}
        />
      </section>

      {/* Section 3: Project Context */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 group relative">
            <h3 className="text-xs font-semibold text-editor-text">3. {t('settings.projectContext')}</h3>
            <span className="cursor-help text-editor-muted text-[10px]">ⓘ</span>
            <div className="absolute left-0 top-full mt-2 hidden group-hover:block w-48 p-2 bg-editor-surface border border-editor-border rounded shadow-lg text-[10px] text-editor-text z-10 leading-relaxed">
              {t('settings.projectContextDescription')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs text-primary-500 hover:text-primary-600"
              onClick={() => setProjectContext('')}
            >
              {t('common.clear')}
            </button>
          </div>
        </div>
        <DebouncedTextarea
          key={`project-context-${settingsKey}`}
          className="w-full h-32 text-sm px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
          value={projectContext}
          onDebouncedChange={setProjectContext}
          placeholder={t('settings.projectContextPlaceholder')}
        />
      </section>

      {/* Section 4: Glossary */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-editor-text">4. {t('settings.glossary')}</h3>
            <span className="text-[10px] text-editor-muted">
              {t('settings.glossaryDescription')}
            </span>
          </div>
          <button
            type="button"
            className="px-2 py-1 rounded text-xs bg-primary-500 text-white hover:bg-primary-600 flex items-center gap-1"
            onClick={() => {
              void (async () => {
                if (!isTauriRuntime() || !project) return;
                const path = await pickGlossaryFile();
                if (path) {
                  const ext = path.split('.').pop()?.toLowerCase();
                  if (ext === 'csv') {
                    await importGlossaryCsv({ projectId: project.id, path, replaceProjectScope: false });
                  } else {
                    await importGlossaryExcel({ projectId: project.id, path, replaceProjectScope: false });
                  }
                  addGlossaryPath(path);
                }
              })();
            }}
          >
            <span>+</span>
            <span>{t('settings.glossaryAttach')}</span>
          </button>
        </div>

        {project?.metadata.glossaryPaths && project.metadata.glossaryPaths.length > 0 ? (
          <div className="space-y-1.5">
            {project.metadata.glossaryPaths.map((p) => {
              const filename = p.split('/').pop() || p.split('\\').pop() || p;
              const ext = filename.split('.').pop()?.toLowerCase();
              return (
                <div
                  key={p}
                  className="group flex items-center justify-between p-2 rounded bg-editor-surface border border-editor-border hover:border-editor-text transition-colors"
                  title={p}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs">
                      {ext === 'csv' ? '📋' : '📊'}
                    </span>
                    <span className="text-[11px] text-editor-text font-medium truncate">
                      {filename}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-editor-muted hover:text-red-500 transition-opacity"
                    onClick={() => {
                      void (async () => {
                        const ok = await confirm(t('settings.glossaryDeleteConfirm', { filename }), {
                          title: t('settings.glossaryDeleteTitle'),
                          kind: 'warning',
                        });
                        if (ok) {
                          removeGlossaryPath(p);
                        }
                      })();
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-editor-muted italic p-2 border border-dashed border-editor-border rounded">
            {t('settings.glossaryNoFiles')}
          </div>
        )}
      </section>

      {/* Section 5: Attachments */}
      <section className="space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-editor-text">5. {t('settings.attachments')}</h3>
            <span className="text-[10px] text-editor-muted whitespace-pre-line">
              {t('settings.attachmentsDescription')}
            </span>
          </div>
          <button
            type="button"
            className="px-2 py-1 rounded text-xs font-semibold bg-primary-500 text-white hover:bg-primary-600 flex items-center gap-1 flex-shrink-0"
            onClick={() => {
              void (async () => {
                if (!isTauriRuntime() || !project) return;
                const path = await pickDocumentFile();
                if (path) {
                  await attachFile(path);
                }
              })();
            }}
          >
            <span>+</span>
            <span>{t('settings.attachmentsAttach')}</span>
          </button>
        </div>

        {attachments.length > 0 ? (
          <div className="space-y-1.5">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="group flex items-center justify-between p-2 rounded bg-editor-surface border border-editor-border hover:border-editor-text transition-colors"
                title={`${att.filename} (${att.fileType.toUpperCase()})`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs">
                    {att.fileType === 'pdf' ? '📄' : att.fileType === 'docx' ? '📝' : att.fileType === 'pptx' ? '📊' : '📄'}
                  </span>
                  <div className="min-w-0 flex flex-col">
                    <span className="text-[11px] text-editor-text font-medium truncate">
                      {att.filename}
                    </span>
                    {att.fileSize && (
                      <span className="text-[9px] text-editor-muted">
                        {(att.fileSize / 1024).toFixed(1)} KB
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-editor-muted hover:text-red-500 transition-opacity"
                  onClick={() => {
                    void (async () => {
                      const ok = await confirm(t('settings.attachmentsDeleteConfirm', { filename: att.filename }), {
                        title: t('settings.attachmentsDeleteTitle'),
                        kind: 'warning',
                      });
                      if (ok) {
                        await deleteAttachment(att.id);
                      }
                    })();
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-editor-muted italic p-2 border border-dashed border-editor-border rounded">
            {t('settings.attachmentsNoFiles')}
          </div>
        )}
      </section>
    </div>
  );

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Tab Header */}
      <div className="h-10 border-b border-editor-border flex items-center bg-editor-bg select-none">
        {/* 접기 버튼 */}
        <button
          type="button"
          onClick={toggleSidebar}
          className="p-2 hover:bg-editor-border transition-colors text-editor-muted"
          title={t('common.collapse', '접기')}
        >
          {sidebarActiveTab === 'settings' ? <Settings size={18} /> : <Search size={18} />}
        </button>

        <div className="flex-1 flex items-center overflow-x-auto no-scrollbar">
          {/* Settings 탭 */}
          <div
            onClick={() => setSidebarActiveTab('settings')}
            className={`
              group relative h-10 px-3 flex items-center gap-2 text-xs font-medium cursor-pointer border-r border-editor-border min-w-[100px] max-w-[160px]
              ${sidebarActiveTab === 'settings'
                ? 'bg-editor-surface text-primary-500 border-b-2 border-b-primary-500'
                : 'text-editor-muted hover:bg-editor-surface hover:text-editor-text'
              }
            `}
            title={t('chat.settings')}
          >
            <span className="truncate flex-1">{t('chat.settings')}</span>
          </div>

          {/* Review 탭 - 항상 표시 */}
          <div
            onClick={() => setSidebarActiveTab('review')}
            className={`
              group relative h-10 px-3 flex items-center gap-2 text-xs font-medium cursor-pointer border-r border-editor-border min-w-[80px] max-w-[120px]
              ${sidebarActiveTab === 'review'
                ? 'bg-editor-surface text-primary-500 border-b-2 border-b-primary-500'
                : 'text-editor-muted hover:bg-editor-surface hover:text-editor-text'
              }
            `}
            title={t('review.title', '검수')}
          >
            <span className="truncate flex-1">{t('review.title', '검수')}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      {sidebarActiveTab === 'settings' ? renderSettings() : <ReviewPanel />}
    </div>
  );
}
