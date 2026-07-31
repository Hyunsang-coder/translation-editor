import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-shell';
import { check } from '@tauri-apps/plugin-updater';
import { getErrorMessage, useAiConfigStore } from '@/stores/aiConfigStore';
import { useUIStore } from '@/stores/uiStore';
import { useShallow } from 'zustand/shallow';
import { CollapsibleSection } from './CollapsibleSection';
import { ConnectorsSection } from './ConnectorsSection';
import { ModelOverridesSection } from './ModelOverridesSection';
import { UsageSection } from './UsageSection';
import { PROVIDER_LABELS } from '@/ai/config';
import { Modal } from '@/components/ui/Modal';
import { invoke } from '@/tauri/invoke';
import { isTauriRuntime } from '@/tauri/invoke';
import { resetSecureStorage } from '@/tauri/secrets';
import i18n from 'i18next';

type McpRegistrationStatus = {
  status: 'notInstalled' | 'notRegistered' | 'registered';
  configPath: string | null;
};

const MCP_STATUSES = new Set(['notInstalled', 'notRegistered', 'registered']);
function isMcpStatus(s: string): s is McpRegistrationStatus['status'] {
  return MCP_STATUSES.has(s);
}

// Static snippets — platform-aware for Windows cmd /c wrapper
const IS_WINDOWS = process.platform === 'win32';

const MCP_NPX_ENTRY = IS_WINDOWS
  ? { command: "cmd", args: ["/c", "npx", "-y", "oddeyes-desktop-mcp"] } as const
  : { command: "npx", args: ["-y", "oddeyes-desktop-mcp"] } as const;

const DESKTOP_SNIPPET = JSON.stringify({
  mcpServers: { "oddeyes-desktop": MCP_NPX_ENTRY },
}, null, 2);

const CODE_SNIPPET = JSON.stringify({
  mcpServers: { oddeyes: MCP_NPX_ENTRY },
}, null, 2);

/**
 * 라벨 한 칸 + 컨트롤 한 칸으로 된 설정 행.
 *
 * 설명문은 상시 노출하지 않고 `hint`의 ⓘ 툴팁으로 접는다 — 이 저장소에는 Tooltip 컴포넌트가
 * 없고 native `title`을 쓰는 관례다(ConnectorsSection 참조).
 */
function SettingRow({ label, hint, htmlFor, children }: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 min-h-[32px]">
      <label htmlFor={htmlFor} className="shrink-0 text-sm text-editor-text">
        {label}
        {hint && (
          <span className="ml-1.5 cursor-help text-editor-muted" title={hint} aria-label={hint}>
            ⓘ
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

/**
 * 언어·테마·붙여넣기가 공유하는 단일 선택 컨트롤.
 *
 * 셋이 각각 라디오·큰 아이콘 버튼·pill로 갈라져 있던 것을 하나로 묶었다. 행 안에 들어가야 하므로
 * 높이를 28px로 고정하고, 선택 강조는 크기(scale)가 아니라 색으로만 준다.
 */
function SegmentedControl<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: readonly { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  label: string;
}): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex shrink-0 items-center gap-0.5 rounded-lg border border-editor-border bg-editor-bg p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.title}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`h-7 rounded-md px-2.5 text-xs font-medium transition-colors ${
            value === option.value
              ? 'bg-primary-500 text-white shadow-sm'
              : 'text-editor-muted hover:bg-editor-border/60 hover:text-editor-text'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

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
  } = useUIStore(
    useShallow((s) => ({
      language: s.language, setLanguage: s.setLanguage,
      theme: s.theme, setTheme: s.setTheme,
      pasteImageMode: s.pasteImageMode, setPasteImageMode: s.setPasteImageMode,
      pasteLinkPreserve: s.pasteLinkPreserve, setPasteLinkPreserve: s.setPasteLinkPreserve,
    }))
  );
  const {
    openaiApiKey,
    anthropicApiKey,
    secureKeyPersistError,
    setOpenaiApiKey,
    setAnthropicApiKey,
    openaiEnabled,
    anthropicEnabled,
    setOpenaiEnabled,
    setAnthropicEnabled,
    clearApiKeysAfterSecureStorageReset,
  } = useAiConfigStore(
    useShallow((s) => ({
      openaiApiKey: s.openaiApiKey, anthropicApiKey: s.anthropicApiKey,
      secureKeyPersistError: s.secureKeyPersistError,
      setOpenaiApiKey: s.setOpenaiApiKey, setAnthropicApiKey: s.setAnthropicApiKey,
      openaiEnabled: s.openaiEnabled, anthropicEnabled: s.anthropicEnabled,
      setOpenaiEnabled: s.setOpenaiEnabled, setAnthropicEnabled: s.setAnthropicEnabled,
      clearApiKeysAfterSecureStorageReset: s.clearApiKeysAfterSecureStorageReset,
    }))
  );

  // 접힌 API 키 섹션의 요약 겸 자동 펼침 판정. 키가 있어도 꺼져 있으면 AI가 안 도므로
  // "키가 있는지"가 아니라 "실제로 쓸 수 있는 provider가 있는지"로 센다.
  const usableProviders = [
    openaiEnabled && openaiApiKey ? PROVIDER_LABELS.openai : null,
    anthropicEnabled && anthropicApiKey ? PROVIDER_LABELS.anthropic : null,
  ].filter((v): v is string => Boolean(v));

  // Claude MCP 상태 (Desktop + Code 공용)
  const [mcpStatus, setMcpStatus] = useState<{ bridgePort: number } | null>(null);
  const [desktopReg, setDesktopReg] = useState<McpRegistrationStatus | null>(null);
  const [desktopBusy, setDesktopBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<'desktop' | 'code' | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    invoke<{ bridgePort: number }>('get_oddeyes_desktop_mcp_status')
      .then((r) => { if (!cancelled) setMcpStatus(r); })
      .catch(() => { if (!cancelled) setMcpStatus(null); });
    invoke<{ status: string; configPath: string | null }>('check_claude_desktop_mcp_registered')
      .then((r) => { if (!cancelled && isMcpStatus(r.status)) setDesktopReg({ status: r.status, configPath: r.configPath }); })
      .catch(() => { if (!cancelled) setDesktopReg(null); });
    return () => { cancelled = true; };
  }, []);

  // Cleanup copy timer on unmount
  useEffect(() => () => { clearTimeout(copyTimerRef.current); }, []);

  const handleToggleRegistration = useCallback(async (
    command: string,
    setBusy: (v: boolean) => void,
    setReg: (v: McpRegistrationStatus) => void,
  ) => {
    setBusy(true);
    try {
      const r = await invoke<{ status: string; configPath: string | null }>(command);
      if (isMcpStatus(r.status)) setReg({ status: r.status, configPath: r.configPath });
    } catch (e) {
      console.error(`Failed ${command}:`, e);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleCopySnippet = useCallback(async (snippet: string, id: 'desktop' | 'code') => {
    await navigator.clipboard.writeText(snippet);
    setCopiedId(id);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // 업데이트 확인 상태
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'latest' | 'error'>('idle');
  const [showSecureStorageResetConfirm, setShowSecureStorageResetConfirm] = useState(false);
  const [isResettingSecureStorage, setIsResettingSecureStorage] = useState(false);
  const [secureStorageResetMessage, setSecureStorageResetMessage] = useState<string | null>(null);
  const [secureStorageResetError, setSecureStorageResetError] = useState<string | null>(null);

  const handleCheckForUpdate = async () => {
    if (checkState === 'checking') return;
    setCheckState('checking');
    try {
      const update = await check();
      if (update) {
        onClose();
        window.dispatchEvent(new CustomEvent('app:update-found', { detail: update }));
      } else {
        setCheckState('latest');
      }
    } catch {
      setCheckState('error');
    }
  };

  // 언어 변경 핸들러
  const handleLanguageChange = (newLanguage: 'ko' | 'en') => {
    setLanguage(newLanguage);
    i18n.changeLanguage(newLanguage);
  };

  // 테마 변경 핸들러
  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
  };

  const handleResetSecureStorage = useCallback(async () => {
    if (isResettingSecureStorage) return;
    setIsResettingSecureStorage(true);
    setSecureStorageResetError(null);
    setSecureStorageResetMessage(null);

    try {
      const result = await resetSecureStorage();
      clearApiKeysAfterSecureStorageReset();
      setSecureStorageResetMessage(
        t('appSettings.secureStorageResetSuccess', {
          backupPath: result.vaultBackupPath ?? t('appSettings.secureStorageResetNoVault'),
        }),
      );
      setShowSecureStorageResetConfirm(false);
    } catch (error) {
      setSecureStorageResetError(getErrorMessage(error));
    } finally {
      setIsResettingSecureStorage(false);
    }
  }, [clearApiKeysAfterSecureStorageReset, isResettingSecureStorage, t]);

  return (
    <>
    <Modal open onClose={onClose} labelId="app-settings-title" className="bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col bg-editor-surface border border-editor-border rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="h-14 px-5 flex items-center justify-between border-b border-editor-border bg-editor-bg shrink-0">
          <h2 id="app-settings-title" className="text-lg font-bold text-editor-text">{t('appSettings.title')}</h2>
          <button 
            onClick={onClose}
            className="p-2 rounded-md hover:bg-editor-border text-editor-muted hover:text-editor-text transition-colors"
            data-testid="app-settings-close-button"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        {/* 섹션 대부분이 접히므로 헤더끼리 붙는다 — space-y-8은 접힌 목록에서 과하다 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
            
            {/* 일반 — 언어·테마·붙여넣기. 컨트롤 4개짜리라 섹션을 셋으로 쪼개면 헤더가 내용보다 커진다. */}
            <section className="space-y-1">
                <div className="flex items-center gap-2 pb-2 mb-2 border-b border-editor-border/50">
                    <span className="text-lg">⚙️</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.general')}</h3>
                </div>

                <SettingRow label={t('appSettings.language')}>
                    <SegmentedControl
                        label={t('appSettings.language')}
                        value={language}
                        onChange={handleLanguageChange}
                        options={[
                            { value: 'ko', label: t('appSettings.languageKorean') },
                            { value: 'en', label: t('appSettings.languageEnglish') },
                        ]}
                    />
                </SettingRow>

                <SettingRow label={t('appSettings.theme')}>
                    <SegmentedControl
                        label={t('appSettings.theme')}
                        value={theme}
                        onChange={handleThemeChange}
                        options={[
                            { value: 'light', label: '☀️', title: t('appSettings.themeLight') },
                            { value: 'dark', label: '🌙', title: t('appSettings.themeDark') },
                            { value: 'system', label: '🖥️', title: t('appSettings.themeSystem') },
                        ]}
                    />
                </SettingRow>

                <SettingRow
                    label={t('appSettings.pasteImageMode')}
                    hint={t('appSettings.pasteImageModeDescription')}
                >
                    <SegmentedControl
                        label={t('appSettings.pasteImageMode')}
                        value={pasteImageMode}
                        onChange={setPasteImageMode}
                        options={[
                            { value: 'placeholder', label: t('appSettings.pasteImageModePlaceholder') },
                            { value: 'original', label: t('appSettings.pasteImageModeOriginal') },
                            { value: 'ignore', label: t('appSettings.pasteImageModeIgnore') },
                        ]}
                    />
                </SettingRow>

                <SettingRow
                    label={t('appSettings.pasteLinkPreserve')}
                    hint={t('appSettings.pasteLinkPreserveDescription')}
                    htmlFor="paste-link-preserve"
                >
                    <input
                        type="checkbox"
                        id="paste-link-preserve"
                        checked={pasteLinkPreserve}
                        onChange={(e) => setPasteLinkPreserve(e.target.checked)}
                        className="accent-primary-500 w-4 h-4 cursor-pointer"
                    />
                </SettingRow>
            </section>

            {/* API Keys & Provider Enable — 쓸 수 있는 provider가 없으면 펼친 채로 연다.
                접힌 채로 두면 키를 넣을 곳을 못 찾는 것이 이 섹션의 유일한 실패 모드다. */}
            <CollapsibleSection
                icon="🔑"
                title={t('appSettings.apiKeys')}
                summary={usableProviders.join(' · ') || t('appSettings.apiKeysNoneSet')}
                defaultOpen={usableProviders.length === 0}
                testId="app-settings-api-keys-toggle"
            >
                <p className="text-xs text-editor-muted">
                    {t('appSettings.apiKeysDescription')}
                </p>
                {secureKeyPersistError && (
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
                        <p>{t('appSettings.apiKeysSaveFailed')}</p>
                        <p className="mt-1 break-words opacity-80">
                            {t('appSettings.apiKeysSaveFailedDetail', { message: secureKeyPersistError })}
                        </p>
                    </div>
                )}

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
            </CollapsibleSection>

            {/* Connectors */}
            <ConnectorsSection />

            {/* 용도별 모델 직접 지정 (실험) — 사용량 섹션 바로 위에 둬서 비교 대상과 결과를 붙여 놓는다 */}
            <ModelOverridesSection />

            {/* AI 사용량 · 추정 비용 */}
            <UsageSection />

            {/* Security Recovery */}
            {isTauriRuntime() && (
            <CollapsibleSection
                icon="🔒"
                title={t('appSettings.security')}
                testId="app-settings-security-toggle"
            >
                <p className="text-xs text-editor-muted">
                    {t('appSettings.securityDescription')}
                </p>
                <div className="space-y-2 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                            <h4 className="text-sm font-semibold text-editor-text">
                                {t('appSettings.secureStorageResetTitle')}
                            </h4>
                            <p className="text-[10px] text-editor-muted">
                                {t('appSettings.secureStorageResetDescription')}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowSecureStorageResetConfirm(true)}
                            disabled={isResettingSecureStorage}
                            className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-yellow-500/40 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-500/10 transition-colors disabled:opacity-50"
                        >
                            {isResettingSecureStorage
                                ? t('appSettings.secureStorageResetting')
                                : t('appSettings.secureStorageResetButton')}
                        </button>
                    </div>
                    {secureStorageResetMessage && (
                        <p className="text-[10px] text-green-600 dark:text-green-400 break-words">
                            {secureStorageResetMessage}
                        </p>
                    )}
                    {secureStorageResetError && (
                        <p className="text-[10px] text-red-600 dark:text-red-300 break-words">
                            {t('appSettings.secureStorageResetFailed', { message: secureStorageResetError })}
                        </p>
                    )}
                </div>
            </CollapsibleSection>
            )}

            {/* Claude Integration */}
            {isTauriRuntime() && (
            <CollapsibleSection
                icon="🤖"
                title={t('appSettings.claudeIntegration.title')}
                summary={desktopReg?.status === 'registered' ? t('appSettings.claudeDesktop.registered') : undefined}
                testId="app-settings-claude-toggle"
            >
                <p className="text-xs text-editor-muted">
                    {t('appSettings.claudeIntegration.description')}
                </p>

                {/* Sub-card: Claude Desktop */}
                <div className="p-3 rounded-lg border border-editor-border bg-editor-bg/50 space-y-2">
                    <h4 className="text-xs font-semibold text-editor-muted uppercase tracking-wider">{t('appSettings.claudeDesktop.title')}</h4>
                    <div className="flex items-center gap-3 flex-wrap">
                        {desktopReg?.status === 'registered' ? (
                            <>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                    {t('appSettings.claudeDesktop.registered')}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => handleToggleRegistration('unregister_claude_desktop_mcp', setDesktopBusy, setDesktopReg)}
                                    disabled={desktopBusy}
                                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-editor-border text-editor-muted hover:text-red-500 hover:border-red-300 transition-colors disabled:opacity-50"
                                >
                                    {t('appSettings.claudeDesktop.unregister')}
                                </button>
                            </>
                        ) : desktopReg?.status === 'notRegistered' ? (
                            <button
                                type="button"
                                onClick={() => handleToggleRegistration('register_claude_desktop_mcp', setDesktopBusy, setDesktopReg)}
                                disabled={desktopBusy}
                                className="px-4 py-2 text-sm font-medium rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50"
                            >
                                {desktopBusy
                                    ? t('appSettings.claudeDesktop.registering')
                                    : t('appSettings.claudeDesktop.register')}
                            </button>
                        ) : desktopReg?.status === 'notInstalled' ? (
                            <span className="text-xs text-editor-muted">
                                {t('appSettings.claudeDesktop.notInstalled')}
                            </span>
                        ) : null}

                        {mcpStatus?.bridgePort && (
                            <span className="text-xs text-green-600 dark:text-green-400">
                                {t('appSettings.claudeDesktop.bridgeActive', { port: mcpStatus.bridgePort })}
                            </span>
                        )}
                    </div>
                    {desktopReg?.status === 'registered' && (
                        <p className="text-[10px] text-editor-muted">
                            {t('appSettings.claudeDesktop.restartHint')}
                        </p>
                    )}

                    {/* Manual Setup */}
                    <details className="group">
                        <summary className="text-xs text-editor-muted cursor-pointer hover:text-editor-text transition-colors select-none">
                            {t('appSettings.claudeDesktop.manualSetup')}
                        </summary>
                        <div className="mt-2 space-y-1.5">
                            <p className="text-[10px] text-editor-muted">{t('appSettings.claudeDesktop.manualHint')}</p>
                            <div className="relative">
                                <pre className="text-[10px] leading-relaxed p-2.5 rounded-md bg-editor-bg border border-editor-border text-editor-text overflow-x-auto font-mono">{DESKTOP_SNIPPET}</pre>
                                <button
                                    type="button"
                                    onClick={() => handleCopySnippet(DESKTOP_SNIPPET, 'desktop')}
                                    className="absolute top-1.5 right-1.5 px-2 py-0.5 text-[10px] font-medium rounded border border-editor-border bg-editor-surface text-editor-muted hover:text-editor-text transition-colors"
                                >
                                    {copiedId === 'desktop' ? t('appSettings.claudeDesktop.copied') : '📋'}
                                </button>
                            </div>
                        </div>
                    </details>
                </div>

                {/* Sub-card: Claude Code — Desktop 쪽 수동 설정과 대칭으로 접는다. 내용이 스니펫
                    하나뿐이라 펼쳐 두면 이 카드가 섹션에서 가장 높은 칸이 된다. */}
                <details className="p-3 rounded-lg border border-editor-border bg-editor-bg/50">
                    <summary className="text-xs font-semibold text-editor-muted uppercase tracking-wider cursor-pointer hover:text-editor-text transition-colors select-none">
                        {t('appSettings.claudeCode.title')}
                    </summary>
                    <div className="mt-2 space-y-1.5">
                        <p className="text-[10px] text-editor-muted">{t('appSettings.claudeCode.manualHint')}</p>
                        <div className="relative">
                            <pre className="text-[10px] leading-relaxed p-2.5 rounded-md bg-editor-bg border border-editor-border text-editor-text overflow-x-auto font-mono">{CODE_SNIPPET}</pre>
                            <button
                                type="button"
                                onClick={() => handleCopySnippet(CODE_SNIPPET, 'code')}
                                className="absolute top-1.5 right-1.5 px-2 py-0.5 text-[10px] font-medium rounded border border-editor-border bg-editor-surface text-editor-muted hover:text-editor-text transition-colors"
                            >
                                {copiedId === 'code' ? t('appSettings.claudeCode.copied') : '📋'}
                            </button>
                        </div>
                    </div>
                </details>
            </CollapsibleSection>
            )}

            {/* Help & Info */}
            <section className="space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">ℹ️</span>
                    <h3 className="font-semibold text-editor-text">{t('appSettings.helpInfo')}</h3>
                </div>
                <div className="text-sm text-editor-muted pl-1 space-y-2">
                    <div className="flex items-center gap-3">
                        <p>{t('appSettings.helpInfoVersionLabel', 'Version')}: {__APP_VERSION__}</p>
                        {checkState === 'idle' && (
                            <button
                                type="button"
                                onClick={handleCheckForUpdate}
                                className="px-2.5 py-1 text-xs font-medium rounded-md bg-editor-bg border border-editor-border hover:bg-editor-border hover:text-editor-text transition-colors"
                            >
                                {t('update.checkForUpdate')}
                            </button>
                        )}
                        {checkState === 'checking' && (
                            <span className="text-xs text-editor-muted animate-pulse">{t('update.checking')}</span>
                        )}
                        {checkState === 'latest' && (
                            <button
                                type="button"
                                onClick={() => setCheckState('idle')}
                                className="text-xs text-green-600 dark:text-green-400 hover:underline cursor-pointer"
                            >
                                {t('update.upToDate')}
                            </button>
                        )}
                        {checkState === 'error' && (
                            <button
                                type="button"
                                onClick={() => setCheckState('idle')}
                                className="text-xs text-red-500 hover:underline cursor-pointer"
                            >
                                {t('update.checkFailed')}
                            </button>
                        )}
                    </div>
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
    </Modal>
    <Modal
      open={showSecureStorageResetConfirm}
      onClose={() => {
        if (!isResettingSecureStorage) setShowSecureStorageResetConfirm(false);
      }}
      labelId="secure-storage-reset-title"
      closeOnOverlay={!isResettingSecureStorage}
      closeOnEsc={!isResettingSecureStorage}
      className="bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-editor-border bg-editor-surface p-5 shadow-2xl space-y-4">
        <div className="space-y-2">
          <h3 id="secure-storage-reset-title" className="text-base font-bold text-editor-text">
            {t('appSettings.secureStorageResetConfirmTitle')}
          </h3>
          <p className="text-sm text-editor-muted">
            {t('appSettings.secureStorageResetConfirmDescription')}
          </p>
        </div>
        {secureStorageResetError && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300 break-words">
            {t('appSettings.secureStorageResetFailed', { message: secureStorageResetError })}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowSecureStorageResetConfirm(false)}
            disabled={isResettingSecureStorage}
            className="px-3 py-1.5 rounded-md border border-editor-border text-sm text-editor-muted hover:text-editor-text hover:bg-editor-bg transition-colors disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleResetSecureStorage}
            disabled={isResettingSecureStorage}
            className="px-3 py-1.5 rounded-md bg-red-600 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {isResettingSecureStorage
              ? t('appSettings.secureStorageResetting')
              : t('appSettings.secureStorageResetConfirmButton')}
          </button>
        </div>
      </div>
    </Modal>
    </>
  );
}
