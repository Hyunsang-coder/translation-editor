import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-shell';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { useUIStore } from '@/stores/uiStore';
import { ConnectorsSection } from './ConnectorsSection';
import i18n from 'i18next';

interface AppSettingsModalProps {
  onClose: () => void;
}

export function AppSettingsModal({ onClose }: AppSettingsModalProps): JSX.Element {
  const { t } = useTranslation();
  const {
    language, setLanguage,
    theme, setTheme,
    pasteImageMode, setPasteImageMode,
    pasteLinkPreserve, setPasteLinkPreserve,
  } = useUIStore();
  const {
    openaiApiKey,
    anthropicApiKey,
    setOpenaiApiKey,
    setAnthropicApiKey,
    openaiEnabled,
    anthropicEnabled,
    setOpenaiEnabled,
    setAnthropicEnabled,
  } = useAiConfigStore();

  // 모달 외부 클릭 시 닫기
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // ESC 키로 닫기
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  // 언어 변경 핸들러
  const handleLanguageChange = (newLanguage: 'ko' | 'en') => {
    setLanguage(newLanguage);
    i18n.changeLanguage(newLanguage);
  };

  // 테마 변경 핸들러
  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleOverlayClick}
    >
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col bg-editor-surface border border-editor-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="h-14 px-5 flex items-center justify-between border-b border-editor-border bg-editor-bg shrink-0">
          <h2 className="text-lg font-bold text-editor-text">{t('appSettings.title')}</h2>
          <button 
            onClick={onClose}
            className="p-2 rounded-md hover:bg-editor-border text-editor-muted hover:text-editor-text transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-8">
            
            {/* 0. Language */}
            <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">🌐</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.language')}</h3>
                </div>
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-editor-muted uppercase tracking-wider">{t('appSettings.language')}</label>
                    <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer group">
                            <input 
                                type="radio" 
                                name="language" 
                                value="ko" 
                                checked={language === 'ko'}
                                onChange={() => handleLanguageChange('ko')}
                                className="accent-primary-500 w-4 h-4 cursor-pointer"
                            />
                            <span className={`text-sm font-medium transition-colors ${language === 'ko' ? 'text-editor-text' : 'text-editor-muted group-hover:text-editor-text'}`}>
                                {t('appSettings.languageKorean')}
                            </span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer group">
                            <input 
                                type="radio" 
                                name="language" 
                                value="en" 
                                checked={language === 'en'}
                                onChange={() => handleLanguageChange('en')}
                                className="accent-primary-500 w-4 h-4 cursor-pointer"
                            />
                            <span className={`text-sm font-medium transition-colors ${language === 'en' ? 'text-editor-text' : 'text-editor-muted group-hover:text-editor-text'}`}>
                                {t('appSettings.languageEnglish')}
                            </span>
                        </label>
                    </div>
                </div>
            </section>

            {/* Theme */}
            <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">🎨</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.theme')}</h3>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => handleThemeChange('light')}
                        className={`
                            flex items-center justify-center w-12 h-12 rounded-lg
                            transition-all duration-200
                            ${theme === 'light'
                                ? 'bg-primary-500 text-white shadow-md scale-105'
                                : 'bg-editor-bg text-editor-muted hover:bg-editor-border hover:text-editor-text'
                            }
                        `}
                        title={t('appSettings.themeLight')}
                    >
                        <span className="text-xl">☀️</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => handleThemeChange('dark')}
                        className={`
                            flex items-center justify-center w-12 h-12 rounded-lg
                            transition-all duration-200
                            ${theme === 'dark'
                                ? 'bg-primary-500 text-white shadow-md scale-105'
                                : 'bg-editor-bg text-editor-muted hover:bg-editor-border hover:text-editor-text'
                            }
                        `}
                        title={t('appSettings.themeDark')}
                    >
                        <span className="text-xl">🌙</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => handleThemeChange('system')}
                        className={`
                            flex items-center justify-center w-12 h-12 rounded-lg
                            transition-all duration-200
                            ${theme === 'system'
                                ? 'bg-primary-500 text-white shadow-md scale-105'
                                : 'bg-editor-bg text-editor-muted hover:bg-editor-border hover:text-editor-text'
                            }
                        `}
                        title={t('appSettings.themeSystem')}
                    >
                        <span className="text-xl">🖥️</span>
                    </button>
                </div>
            </section>

            {/* Paste Settings */}
            <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">📋</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.paste')}</h3>
                </div>

                {/* Image Paste Mode */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-editor-muted uppercase tracking-wider">{t('appSettings.pasteImageMode')}</label>
                    <p className="text-[10px] text-editor-muted">{t('appSettings.pasteImageModeDescription')}</p>
                    <div className="flex items-center gap-2">
                        {(['placeholder', 'original', 'ignore'] as const).map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                onClick={() => setPasteImageMode(mode)}
                                className={`
                                    px-3 py-1.5 rounded-lg text-xs font-medium
                                    transition-all duration-200
                                    ${pasteImageMode === mode
                                        ? 'bg-primary-500 text-white shadow-md scale-105'
                                        : 'bg-editor-bg text-editor-muted hover:bg-editor-border hover:text-editor-text'
                                    }
                                `}
                            >
                                {t(`appSettings.pasteImageMode${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Link Preserve */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="paste-link-preserve"
                            checked={pasteLinkPreserve}
                            onChange={(e) => setPasteLinkPreserve(e.target.checked)}
                            className="accent-primary-500 w-4 h-4 cursor-pointer"
                        />
                        <label
                            htmlFor="paste-link-preserve"
                            className={`text-sm font-medium cursor-pointer ${pasteLinkPreserve ? 'text-editor-text' : 'text-editor-muted'}`}
                        >
                            {t('appSettings.pasteLinkPreserve')}
                        </label>
                    </div>
                    <p className="text-[10px] text-editor-muted pl-6">{t('appSettings.pasteLinkPreserveDescription')}</p>
                </div>
            </section>

            {/* API Keys & Provider Enable */}
            <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">🔑</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.apiKeys')}</h3>
                </div>
                <p className="text-xs text-editor-muted">
                    {t('appSettings.apiKeysDescription')}
                </p>

                {/* OpenAI API Key + Enable Checkbox */}
                <div className="space-y-2 p-3 rounded-lg border border-editor-border bg-editor-bg/50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="openai-enabled"
                                checked={openaiEnabled}
                                onChange={(e) => setOpenaiEnabled(e.target.checked)}
                                disabled={!openaiApiKey}
                                className="accent-primary-500 w-4 h-4 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <label
                                htmlFor="openai-enabled"
                                className={`text-sm font-semibold cursor-pointer ${openaiEnabled && openaiApiKey ? 'text-editor-text' : 'text-editor-muted'}`}
                            >
                                {t('appSettings.useOpenai')}
                            </label>
                        </div>
                        {openaiApiKey && (
                            <button
                                onClick={() => setOpenaiApiKey(undefined)}
                                className="text-xs text-editor-muted hover:text-editor-text transition-colors"
                            >
                                {t('common.clear')}
                            </button>
                        )}
                    </div>
                    <input
                        type="password"
                        className="w-full h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-editor-muted"
                        placeholder={t('appSettings.openaiApiKeyPlaceholder')}
                        value={openaiApiKey || ''}
                        onChange={(e) => setOpenaiApiKey(e.target.value)}
                    />
                    {!openaiApiKey && (
                        <p className="text-[10px] text-editor-muted">{t('appSettings.apiKeyRequiredToEnable')}</p>
                    )}
                </div>

                {/* Anthropic API Key + Enable Checkbox */}
                <div className="space-y-2 p-3 rounded-lg border border-editor-border bg-editor-bg/50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="anthropic-enabled"
                                checked={anthropicEnabled}
                                onChange={(e) => setAnthropicEnabled(e.target.checked)}
                                disabled={!anthropicApiKey}
                                className="accent-primary-500 w-4 h-4 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <label
                                htmlFor="anthropic-enabled"
                                className={`text-sm font-semibold cursor-pointer ${anthropicEnabled && anthropicApiKey ? 'text-editor-text' : 'text-editor-muted'}`}
                            >
                                {t('appSettings.useAnthropic')}
                            </label>
                        </div>
                        {anthropicApiKey && (
                            <button
                                onClick={() => setAnthropicApiKey(undefined)}
                                className="text-xs text-editor-muted hover:text-editor-text transition-colors"
                            >
                                {t('common.clear')}
                            </button>
                        )}
                    </div>
                    <input
                        type="password"
                        className="w-full h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-editor-muted"
                        placeholder={t('appSettings.anthropicApiKeyPlaceholder')}
                        value={anthropicApiKey || ''}
                        onChange={(e) => setAnthropicApiKey(e.target.value)}
                    />
                    {!anthropicApiKey && (
                        <p className="text-[10px] text-editor-muted">{t('appSettings.apiKeyRequiredToEnable')}</p>
                    )}
                </div>
            </section>

            {/* Connectors */}
            <ConnectorsSection />

            {/* Help & Info */}
            <section className="space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">ℹ️</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.helpInfo')}</h3>
                </div>
                <div className="text-sm text-editor-muted pl-1 space-y-1">
                    <p>{t('appSettings.helpInfoVersionLabel', 'Version')}: {__APP_VERSION__}</p>
                    <p>
                      {t('appSettings.helpInfoHomepage', '홈페이지')}:{' '}
                      <button
                        type="button"
                        onClick={() => open('https://oddeyes-web.vercel.app/')}
                        className="text-primary-500 hover:text-primary-600 hover:underline"
                      >
                        oddeyes-web.vercel.app
                      </button>
                    </p>
                </div>
            </section>

        </div>
        
        {/* Footer */}
        <div className="h-12 px-5 flex items-center justify-end bg-editor-bg border-t border-editor-border shrink-0">
             <span className="text-xs text-editor-muted mr-auto">{t('appSettings.footerAutoSave')}</span>
             <button 
                onClick={onClose}
                className="px-4 py-1.5 rounded-md bg-editor-surface border border-editor-border hover:bg-editor-border text-sm font-medium transition-colors"
            >
                {t('common.close')}
            </button>
        </div>
      </div>
    </div>
  );
}
