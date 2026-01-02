import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { useUIStore } from '@/stores/uiStore';
import { MODEL_PRESETS, type AiProvider } from '@/ai/config';
import i18n from 'i18next';

interface AppSettingsModalProps {
  onClose: () => void;
}

export function AppSettingsModal({ onClose }: AppSettingsModalProps): JSX.Element {
  const { t } = useTranslation();
  const { language, setLanguage } = useUIStore();
  const { 
    provider, 
    openaiApiKey,
    anthropicApiKey,
    googleApiKey,
    braveApiKey,
    setProvider, 
    setTranslationModel, 
    setChatModel,
    setOpenaiApiKey,
    setAnthropicApiKey,
    setGoogleApiKey,
    setBraveApiKey,
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

  // Provider 변경 시 모델 목록이 달라지므로, 적절한 기본값으로 재설정
  const handleProviderChange = (newProvider: AiProvider) => {
    setProvider(newProvider);
    
    const presetsKey: Exclude<AiProvider, 'mock'> = newProvider === 'mock' ? 'openai' : newProvider;
    const targetPresets = MODEL_PRESETS[presetsKey];
    
    // 현재 모델이 새 프리셋에 없으면 첫 번째 프리셋으로 변경
    if (targetPresets && targetPresets.length > 0) {
        // 번역 모델 리셋
        setTranslationModel(targetPresets[0].value);
        // 채팅 모델 리셋
        setChatModel(targetPresets[0].value);
    }
  };

  // 언어 변경 핸들러
  const handleLanguageChange = (newLanguage: 'ko' | 'en') => {
    setLanguage(newLanguage);
    i18n.changeLanguage(newLanguage);
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

            {/* 1. AI Provider */}
            <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">🤖</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.aiProvider')}</h3>
                </div>

                {/* Provider Selection (Radio Group) */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-editor-muted uppercase tracking-wider">{t('appSettings.aiProviderLabel')}</label>
                    <div className="flex items-center gap-4">
                        {(['openai', 'anthropic', 'google'] as AiProvider[]).map((p) => {
                            return (
                                <label 
                                    key={p} 
                                    className="flex items-center gap-2 cursor-pointer group"
                                >
                                    <input 
                                        type="radio" 
                                        name="provider" 
                                        value={p} 
                                        checked={provider === p}
                                        onChange={() => handleProviderChange(p)}
                                        className="accent-primary-500 w-4 h-4 cursor-pointer"
                                    />
                                    <span className={`text-sm font-medium transition-colors ${provider === p ? 'text-editor-text' : 'text-editor-muted group-hover:text-editor-text'}`}>
                                        {p === 'openai' ? 'OpenAI' : p === 'anthropic' ? 'Anthropic' : 'Google'}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </div>

            </section>

            {/* 2. API Keys */}
            <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">🔑</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.apiKeys')}</h3>
                </div>
                <p className="text-xs text-editor-muted">
                    {t('appSettings.apiKeysDescription')}
                </p>

                {/* OpenAI API Key */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-editor-text">{t('appSettings.openaiApiKey')}</label>
                        {openaiApiKey && (
                            <button
                                onClick={() => setOpenaiApiKey(undefined)}
                                className="text-xs text-editor-muted hover:text-editor-text transition-colors"
                            >
                                {t('common.clear')}
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <input
                            type="password"
                            className="w-full h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-editor-muted"
                            placeholder={t('appSettings.openaiApiKeyPlaceholder')}
                            value={openaiApiKey || ''}
                            onChange={(e) => setOpenaiApiKey(e.target.value)}
                        />
                    </div>
                </div>

                {/* Anthropic API Key */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-editor-text">{t('appSettings.anthropicApiKey')}</label>
                        {anthropicApiKey && (
                            <button
                                onClick={() => setAnthropicApiKey(undefined)}
                                className="text-xs text-editor-muted hover:text-editor-text transition-colors"
                            >
                                {t('common.clear')}
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <input
                            type="password"
                            className="w-full h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-editor-muted"
                            placeholder={t('appSettings.anthropicApiKeyPlaceholder')}
                            value={anthropicApiKey || ''}
                            onChange={(e) => setAnthropicApiKey(e.target.value)}
                        />
                    </div>
                </div>

                {/* Google API Key */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-editor-text">{t('appSettings.googleApiKey')}</label>
                        {googleApiKey && (
                            <button
                                onClick={() => setGoogleApiKey(undefined)}
                                className="text-xs text-editor-muted hover:text-editor-text transition-colors"
                            >
                                {t('common.clear')}
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <input
                            type="password"
                            className="w-full h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-editor-muted"
                            placeholder={t('appSettings.googleApiKeyPlaceholder')}
                            value={googleApiKey || ''}
                            onChange={(e) => setGoogleApiKey(e.target.value)}
                        />
                    </div>
                </div>

                {/* Brave Search API Key */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-editor-text">{t('appSettings.braveApiKey')}</label>
                        {braveApiKey && (
                            <button
                                onClick={() => setBraveApiKey(undefined)}
                                className="text-xs text-editor-muted hover:text-editor-text transition-colors"
                            >
                                {t('common.clear')}
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <input
                            type="password"
                            className="w-full h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-editor-muted"
                            placeholder={t('appSettings.braveApiKeyPlaceholder')}
                            value={braveApiKey || ''}
                            onChange={(e) => setBraveApiKey(e.target.value)}
                        />
                    </div>
                </div>
            </section>

            {/* 4. Help & Info (Placeholder) */}
            <section className="space-y-3 opacity-60">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">ℹ️</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.helpInfo')}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-editor-border text-editor-muted">{t('appSettings.helpInfoComingSoon')}</span>
                </div>
                <div className="text-sm text-editor-muted pl-1">
                    {t('appSettings.helpInfoVersion')} <br/>
                    {t('appSettings.helpInfoTutorials')}
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
