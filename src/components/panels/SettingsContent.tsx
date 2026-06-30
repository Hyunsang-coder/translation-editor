import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { useShallow } from 'zustand/shallow';
import { pickGlossaryFile, pickDocumentFile } from '@/tauri/dialog';
import { importGlossaryCsv, importGlossaryExcel } from '@/tauri/glossary';
import { isTauriRuntime } from '@/tauri/invoke';
import { confirm } from '@tauri-apps/plugin-dialog';
import { DebouncedTextarea } from '@/components/ui/DebouncedTextarea';
import { useUIStore } from '@/stores/uiStore';
import { PromptPresetMenu } from '@/components/panels/PromptPresetMenu';

/**
 * Settings 탭 콘텐츠 (UnifiedSidebar에서 렌더링)
 * SettingsSidebar에서 추출한 순수 콘텐츠 컴포넌트
 */
export function SettingsContent(): JSX.Element {
  const { t } = useTranslation();
  const addToast = useUIStore((s) => s.addToast);

  const { translatorPersona, setTranslatorPersona, translationRules, setTranslationRules,
          projectContext, setProjectContext, attachments, attachFile, deleteAttachment } =
    useChatStore(useShallow((s) => ({
      translatorPersona: s.translatorPersona, setTranslatorPersona: s.setTranslatorPersona,
      translationRules: s.translationRules, setTranslationRules: s.setTranslationRules,
      projectContext: s.projectContext, setProjectContext: s.setProjectContext,
      attachments: s.attachments, attachFile: s.attachFile, deleteAttachment: s.deleteAttachment,
    })));

  const { project, addGlossaryPath, removeGlossaryPath } =
    useProjectStore(useShallow((s) => ({
      project: s.project, addGlossaryPath: s.addGlossaryPath, removeGlossaryPath: s.removeGlossaryPath,
    })));
  const settingsKey = project?.id ?? 'none';

  // 프리셋 저장/덮어쓰기/dirty 판정이 디바운스 지연 없는 "현재 입력값"을 보도록
  // textarea의 live 값을 추적한다. (store 값은 500ms 디바운스 후에야 갱신됨)
  const [liveValues, setLiveValues] = useState({
    persona: translatorPersona,
    rules: translationRules,
    context: projectContext,
  });
  // store 값(프로젝트 전환/프리셋 적용 등 외부 변경)과 동기화
  useEffect(() => {
    setLiveValues({ persona: translatorPersona, rules: translationRules, context: projectContext });
  }, [translatorPersona, translationRules, projectContext]);

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin p-4 space-y-6 bg-editor-bg">
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
          <PromptPresetMenu
            key={`preset-persona-${settingsKey}`}
            kind="persona"
            currentValue={liveValues.persona}
            onApply={setTranslatorPersona}
            onClear={() => setTranslatorPersona('')}
          />
        </div>
        <DebouncedTextarea
          key={`translator-persona-${settingsKey}`}
          data-testid="settings-translator-persona"
          className="w-full min-h-[3.5rem] text-xs px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
          value={translatorPersona}
          onDebouncedChange={setTranslatorPersona}
          onLiveChange={(v) => setLiveValues((prev) => ({ ...prev, persona: v }))}
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
          <PromptPresetMenu
            key={`preset-rules-${settingsKey}`}
            kind="rules"
            currentValue={liveValues.rules}
            onApply={setTranslationRules}
            onClear={() => setTranslationRules('')}
          />
        </div>
        <DebouncedTextarea
          key={`translation-rules-${settingsKey}`}
          data-testid="settings-translation-rules"
          className="w-full h-32 text-xs px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
          value={translationRules}
          onDebouncedChange={setTranslationRules}
          onLiveChange={(v) => setLiveValues((prev) => ({ ...prev, rules: v }))}
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
          <PromptPresetMenu
            key={`preset-context-${settingsKey}`}
            kind="context"
            currentValue={liveValues.context}
            onApply={setProjectContext}
            onClear={() => setProjectContext('')}
          />
        </div>
        <DebouncedTextarea
          key={`project-context-${settingsKey}`}
          data-testid="settings-project-context"
          className="w-full h-32 text-xs px-3 py-2 rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
          value={projectContext}
          onDebouncedChange={setProjectContext}
          onLiveChange={(v) => setLiveValues((prev) => ({ ...prev, context: v }))}
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
            className="px-2 py-1 rounded text-xs font-semibold bg-primary-500 text-white hover:bg-primary-600 flex-shrink-0"
            onClick={() => {
              void (async () => {
                if (!isTauriRuntime() || !project) return;
                const path = await pickGlossaryFile();
                if (path) {
                  try {
                    const ext = path.split('.').pop()?.toLowerCase();
                    const result = ext === 'csv'
                      ? await importGlossaryCsv({ projectId: project.id, path, replaceProjectScope: false })
                      : await importGlossaryExcel({ projectId: project.id, path, replaceProjectScope: false });
                    addGlossaryPath(path);
                    addToast({ type: 'success', message: t('settings.glossaryImportSuccess', { inserted: result.inserted, updated: result.updated, skipped: result.skipped }) });
                    for (const warning of result.warnings) {
                      addToast({ type: 'warning', message: t('settings.glossaryImportWarning', { warning }) });
                    }
                  } catch (err) {
                    addToast({ type: 'error', message: String(err) });
                  }
                }
              })();
            }}
          >
            {t('settings.glossaryAttach')}
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
            className="px-2 py-1 rounded text-xs font-semibold bg-primary-500 text-white hover:bg-primary-600 flex-shrink-0"
            onClick={() => {
              void (async () => {
                if (!isTauriRuntime() || !project) return;
                const path = await pickDocumentFile();
                if (path) {
                  try {
                    await attachFile(path);
                  } catch (err) {
                    const e = err as { code?: string; message?: string } | undefined;
                    const code = e?.code;
                    let msg: string;
                    if (code === 'FILE_TOO_LARGE') {
                      // "파일 크기가 너무 큽니다: 422MB (최대 200MB)" → size, max 추출
                      const match = e?.message?.match(/(\d+)MB.*?(\d+)MB/);
                      msg = match
                        ? t('settings.attachmentErrorFileTooLarge', { size: match[1], max: match[2] })
                        : t('settings.attachmentErrorFileTooLarge', { size: '?', max: '200' });
                    } else if (code === 'EXTRACT_ERROR') {
                      msg = t('settings.attachmentErrorExtractFailed');
                    } else if (code === 'SECURITY_ERROR') {
                      msg = t('settings.attachmentErrorPathBlocked');
                    } else if (code === 'PATH_ERROR' || code === 'FILE_ERROR') {
                      msg = t('settings.attachmentErrorFileNotFound');
                    } else {
                      msg = t('settings.attachmentErrorUnknown');
                    }
                    addToast({ type: 'error', message: msg });
                  }
                }
              })();
            }}
          >
            {t('settings.attachmentsAttach')}
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
                    <div className="flex items-center gap-1.5">
                      {att.fileSize && (
                        <span className="text-[9px] text-editor-muted">
                          {(att.fileSize / 1024).toFixed(1)} KB
                        </span>
                      )}
                      {att.extractedTextLength != null && att.extractedTextLength > 10000 && (
                        <span className="text-[9px] text-amber-500 font-medium" title={`${(att.extractedTextLength / 1000).toFixed(0)}K chars`}>
                          {t('settings.attachmentsTruncationWarning')}
                        </span>
                      )}
                    </div>
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
}
