import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { useUIStore } from '@/stores/uiStore';
import { ConnectorsSection } from './ConnectorsSection';
import { migrateLegacySecrets, type MigrationResult } from '@/tauri/secrets';
import i18n from 'i18next';

interface AppSettingsModalProps {
  onClose: () => void;
}

export function AppSettingsModal({ onClose }: AppSettingsModalProps): JSX.Element {
  const { t } = useTranslation();
  const { 
    language, setLanguage, 
    theme, setTheme,
    maxChatSessions, setMaxChatSessions,
    chatLengthNotifyThreshold, setChatLengthNotifyThreshold,
  } = useUIStore();
  const { 
    openaiApiKey,
    braveApiKey,
    setOpenaiApiKey,
    setBraveApiKey,
  } = useAiConfigStore();

  // 마이그레이션 상태
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);

  // 마이그레이션 핸들러
  const handleMigrateLegacySecrets = async () => {
    setIsMigrating(true);
    setMigrationResult(null);
    try {
      const result = await migrateLegacySecrets();
      setMigrationResult(result);
    } catch (error) {
      console.error('[Settings] Migration failed:', error);
      setMigrationResult({
        migrated: 0,
        failed: 1,
        details: [`오류: ${String(error)}`],
      });
    } finally {
      setIsMigrating(false);
    }
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

            {/* API Keys */}
            <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">🔑</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.apiKeys')}</h3>
                </div>
                <p className="text-xs text-editor-muted">
                    {t('appSettings.apiKeysDescription')}
                </p>

                {/* OpenAI API Key (필수) */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-editor-text">
                            {t('appSettings.openaiApiKey')}
                            <span className="ml-1 text-red-400">*</span>
                        </label>
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

                {/* Brave Search API Key (선택 - 웹검색 폴백용) */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-editor-text">
                            {t('appSettings.braveApiKey')}
                            <span className="ml-1 text-editor-muted font-normal">({t('appSettings.braveApiKeyOptional')})</span>
                        </label>
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

            {/* Connectors */}
            <ConnectorsSection />

            {/* Security */}
            <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">🔒</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.security', '보안')}</h3>
                </div>
                <div className="space-y-3">
                    <p className="text-xs text-editor-muted">
                        {t('appSettings.securityDescription', '이전 버전에서 저장된 로그인 정보를 새로운 보안 저장소로 가져옵니다.')}
                    </p>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleMigrateLegacySecrets}
                            disabled={isMigrating}
                            className={`
                                px-4 py-2 rounded-md text-sm font-medium transition-colors
                                ${isMigrating 
                                    ? 'bg-editor-border text-editor-muted cursor-not-allowed' 
                                    : 'bg-primary-500 text-white hover:bg-primary-600'
                                }
                            `}
                        >
                            {isMigrating 
                                ? t('appSettings.migrating', '마이그레이션 중...') 
                                : t('appSettings.migrateLegacy', '기존 로그인 정보 가져오기')
                            }
                        </button>
                    </div>
                    {migrationResult && (
                        <div className={`
                            p-3 rounded-md text-sm
                            ${migrationResult.failed > 0 
                                ? 'bg-red-500/10 border border-red-500/20' 
                                : 'bg-green-500/10 border border-green-500/20'
                            }
                        `}>
                            <p className={migrationResult.failed > 0 ? 'text-red-400' : 'text-green-400'}>
                                {migrationResult.migrated > 0 
                                    ? t('appSettings.migrationSuccess', '{{count}}개 항목이 마이그레이션되었습니다.', { count: migrationResult.migrated })
                                    : t('appSettings.migrationNone', '마이그레이션할 항목이 없습니다.')
                                }
                                {migrationResult.failed > 0 && ` (${migrationResult.failed}개 실패)`}
                            </p>
                            {migrationResult.details.length > 0 && (
                                <ul className="mt-2 text-xs text-editor-muted space-y-1">
                                    {migrationResult.details.map((detail, i) => (
                                        <li key={i}>{detail}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {/* Chat Settings */}
            <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">💬</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.chatSettings', '채팅 설정')}</h3>
                </div>
                <div className="space-y-4">
                    {/* Max Chat Sessions */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-editor-text">
                            {t('appSettings.maxChatSessions', '최대 채팅 세션 수')}
                        </label>
                        <p className="text-[10px] text-editor-muted">
                            {t('appSettings.maxChatSessionsDescription', '동시에 열 수 있는 채팅 탭의 최대 개수입니다. (1-5)')}
                        </p>
                        <div className="flex items-center gap-3">
                            <input
                                type="range"
                                min="1"
                                max="5"
                                value={maxChatSessions}
                                onChange={(e) => setMaxChatSessions(Number(e.target.value))}
                                className="flex-1 accent-primary-500"
                            />
                            <span className="w-6 text-center text-sm font-medium text-editor-text">{maxChatSessions}</span>
                        </div>
                    </div>
                    
                    {/* Chat Length Notify Threshold */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-editor-text">
                            {t('appSettings.chatLengthNotifyThreshold', '대화 길이 알림 임계값')}
                        </label>
                        <p className="text-[10px] text-editor-muted">
                            {t('appSettings.chatLengthNotifyThresholdDescription', '이 개수 이상의 메시지가 쌓이면 새 세션 시작을 권장합니다. (10-50)')}
                        </p>
                        <div className="flex items-center gap-3">
                            <input
                                type="range"
                                min="10"
                                max="50"
                                step="5"
                                value={chatLengthNotifyThreshold}
                                onChange={(e) => setChatLengthNotifyThreshold(Number(e.target.value))}
                                className="flex-1 accent-primary-500"
                            />
                            <span className="w-8 text-center text-sm font-medium text-editor-text">{chatLengthNotifyThreshold}</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* Help & Info (Placeholder) */}
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
