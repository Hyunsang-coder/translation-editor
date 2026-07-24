import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { useShallow } from 'zustand/shallow';
import { DebouncedTextarea } from '@/components/ui/DebouncedTextarea';
import { PromptPresetMenu } from '@/components/panels/PromptPresetMenu';
import { ProjectGlossarySection } from '@/components/glossary/ProjectGlossarySection';
import { ProjectMemorySettingsSection } from './ProjectMemorySettingsSection';

/**
 * Settings 탭 콘텐츠 (UnifiedSidebar에서 렌더링)
 * SettingsSidebar에서 추출한 순수 콘텐츠 컴포넌트
 */
export function SettingsContent(): JSX.Element {
  const { t } = useTranslation();

  const { translationRules, setTranslationRules } =
    useChatStore(useShallow((s) => ({
      translationRules: s.translationRules, setTranslationRules: s.setTranslationRules,
    })));

  const project = useProjectStore((s) => s.project);
  const settingsKey = project?.id ?? 'none';

  // 프리셋 저장/덮어쓰기/dirty 판정이 디바운스 지연 없는 "현재 입력값"을 보도록
  // textarea의 live 값을 추적한다. (store 값은 500ms 디바운스 후에야 갱신됨)
  const [liveValues, setLiveValues] = useState({
    rules: translationRules,
  });
  // store 값(프로젝트 전환/프리셋 적용 등 외부 변경)과 동기화
  useEffect(() => {
    setLiveValues({ rules: translationRules });
  }, [translationRules]);

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin p-4 space-y-6 bg-editor-bg">
      {/* Section 1: Translation Rules */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 group relative">
            <h3 className="text-xs font-semibold text-editor-text">{t('settings.translationRules')}</h3>
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

      {/* 프로젝트 컨텍스트(legacy)는 승인 기반 Project Memory로 대체됨.
          기존 값은 hydrate 시 1회 Project Memory로 migration되며, 저장 필드와
          Desktop MCP 주입 경로는 호환을 위해 유지된다. */}
      {project && <ProjectMemorySettingsSection />}

      {/* Glossary */}
      {project && <ProjectGlossarySection projectId={project.id} />}
    </div>
  );
}
