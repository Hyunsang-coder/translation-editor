import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { useUIStore } from '@/stores/uiStore';
import { ConnectorsSection } from './ConnectorsSection';
import { testOllamaConnection } from '@/ai/ollamaUtils';
import i18n from 'i18next';

interface AppSettingsModalProps {
  onClose: () => void;
}

export function AppSettingsModal({ onClose }: AppSettingsModalProps): JSX.Element {
  const { t } = useTranslation();
  const { 
    language, setLanguage, 
    theme, setTheme,
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
    // Local LLM
    openaiBaseUrl,
    contextLimit,
    maxOutputTokens,
    customModelName,
    localLlmSupportsTools,
    availableLocalModels,
    setOpenaiBaseUrl,
    setContextLimit,
    setMaxOutputTokens,
    setCustomModelName,
    setLocalLlmSupportsTools,
    setAvailableLocalModels,
  } = useAiConfigStore();

  // Local LLM 연결 테스트 상태
  const [testing, setTesting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const handleTestConnection = async () => {
    if (!openaiBaseUrl) return;

    setTesting(true);
    setConnectionError(null);
    try {
      const result = await testOllamaConnection(openaiBaseUrl);
      if (result.success) {
        setAvailableLocalModels(result.models ?? []);
      } else {
        setConnectionError(result.error ?? 'Connection failed');
        setAvailableLocalModels([]);
      }
    } catch (e) {
      setConnectionError(e instanceof Error ? e.message : 'Unknown error');
      setAvailableLocalModels([]);
    } finally {
      setTesting(false);
    }
  };

  const handleClearLocalLlm = () => {
    setOpenaiBaseUrl(undefined);
    setContextLimit(4096);
    setMaxOutputTokens(512);
    setCustomModelName(undefined);
    setLocalLlmSupportsTools(false);
    setAvailableLocalModels([]);
    setConnectionError(null);
  };

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

            {/* Local LLM Settings */}
            <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">🖥️</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.localLlm.title')}</h3>
                </div>
                <p className="text-xs text-editor-muted">
                    {t('appSettings.localLlm.description')}
                </p>

                {/* 엔드포인트 입력 */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-editor-muted uppercase tracking-wider">
                        {t('appSettings.localLlm.endpoint')}
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            className="flex-1 h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-editor-muted"
                            placeholder={t('appSettings.localLlm.endpointPlaceholder')}
                            value={openaiBaseUrl || ''}
                            onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                        />
                        <button
                            onClick={handleTestConnection}
                            disabled={!openaiBaseUrl || testing}
                            className="px-3 py-1.5 text-sm font-medium rounded bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                        >
                            {testing ? t('appSettings.localLlm.testing') : t('appSettings.localLlm.testConnection')}
                        </button>
                    </div>
                    <p className="text-[10px] text-editor-muted">
                        {t('appSettings.localLlm.endpointHelp')}
                    </p>

                    {/* 연결 결과 표시 */}
                    {availableLocalModels.length > 0 && (
                        <p className="text-xs text-green-600 dark:text-green-400">
                            ✓ {t('appSettings.localLlm.connectionSuccess', { count: availableLocalModels.length })}
                        </p>
                    )}
                    {connectionError && (
                        <p className="text-xs text-red-600 dark:text-red-400">
                            ✕ {t('appSettings.localLlm.connectionFailed', { error: connectionError })}
                        </p>
                    )}
                </div>

                {/* 모델 선택 (연결 성공 시 표시) */}
                {availableLocalModels.length > 0 && (
                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-editor-muted uppercase tracking-wider">
                            {t('appSettings.localLlm.model')}
                        </label>
                        <select
                            className="w-full h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
                            value={customModelName || ''}
                            onChange={(e) => setCustomModelName(e.target.value)}
                        >
                            <option value="">{t('appSettings.localLlm.modelPlaceholder')}</option>
                            {availableLocalModels.map((model) => (
                                <option key={model} value={model}>{model}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* 커스텀 모델명 (연결 안됐을 때 직접 입력) */}
                {availableLocalModels.length === 0 && openaiBaseUrl && (
                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-editor-muted uppercase tracking-wider">
                            {t('appSettings.localLlm.model')}
                        </label>
                        <input
                            type="text"
                            className="w-full h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-editor-muted"
                            placeholder={t('appSettings.localLlm.modelPlaceholder')}
                            value={customModelName || ''}
                            onChange={(e) => setCustomModelName(e.target.value)}
                        />
                    </div>
                )}

                {/* Tool Calling 지원 */}
                {openaiBaseUrl && (
                    <div className="space-y-2 p-3 rounded-lg border border-editor-border bg-editor-bg/50">
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="local-llm-tools"
                                checked={localLlmSupportsTools}
                                onChange={(e) => setLocalLlmSupportsTools(e.target.checked)}
                                className="accent-primary-500 w-4 h-4 cursor-pointer"
                            />
                            <label
                                htmlFor="local-llm-tools"
                                className={`text-sm font-semibold cursor-pointer ${localLlmSupportsTools ? 'text-editor-text' : 'text-editor-muted'}`}
                            >
                                {t('appSettings.localLlm.supportsTools')}
                            </label>
                        </div>
                        <p className="text-[10px] text-editor-muted">
                            {t('appSettings.localLlm.supportsToolsHelp')}
                        </p>
                    </div>
                )}

                {/* 컨텍스트 제한 */}
                {openaiBaseUrl && (
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-editor-muted uppercase tracking-wider">
                                {t('appSettings.localLlm.contextLimit')} ({contextLimit ?? 4096})
                            </label>
                            <input
                                type="range"
                                className="w-full h-2 rounded bg-editor-border accent-primary-500 cursor-pointer"
                                min={2048}
                                max={8192}
                                step={512}
                                value={contextLimit ?? 4096}
                                onChange={(e) => setContextLimit(Number(e.target.value))}
                            />
                            <div className="flex justify-between text-[10px] text-editor-muted">
                                <span>2k</span>
                                <span>8k</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-editor-muted uppercase tracking-wider">
                                {t('appSettings.localLlm.maxOutput')} ({maxOutputTokens ?? 512})
                            </label>
                            <input
                                type="range"
                                className="w-full h-2 rounded bg-editor-border accent-primary-500 cursor-pointer"
                                min={128}
                                max={1024}
                                step={64}
                                value={maxOutputTokens ?? 512}
                                onChange={(e) => setMaxOutputTokens(Number(e.target.value))}
                            />
                            <div className="flex justify-between text-[10px] text-editor-muted">
                                <span>128</span>
                                <span>1024</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* 컨텍스트 경고 */}
                {openaiBaseUrl && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400">
                        ⚠️ {t('appSettings.localLlm.contextLimitHelp')}
                    </p>
                )}

                {/* 초기화 버튼 */}
                {openaiBaseUrl && (
                    <button
                        onClick={handleClearLocalLlm}
                        className="text-xs text-editor-muted hover:text-editor-text transition-colors"
                    >
                        {t('appSettings.localLlm.clearEndpoint')}
                    </button>
                )}

                {/* Ollama 설정 팁 */}
                {openaiBaseUrl && (
                    <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 space-y-1">
                        <p className="text-xs font-semibold text-blue-800 dark:text-blue-200">
                            💡 {t('appSettings.localLlm.ollamaTips')}
                        </p>
                        <ul className="text-[10px] text-blue-700 dark:text-blue-300 list-disc list-inside space-y-0.5">
                            <li>{t('appSettings.localLlm.ollamaTip1')}</li>
                            <li>{t('appSettings.localLlm.ollamaTip2')}</li>
                            <li>{t('appSettings.localLlm.ollamaTip3')}</li>
                        </ul>
                    </div>
                )}
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
                      <a
                        href="https://oddeyes-web.vercel.app/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-500 hover:text-primary-600 hover:underline"
                      >
                        oddeyes-web.vercel.app
                      </a>
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
