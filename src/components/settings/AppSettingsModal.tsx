import { useEffect, useState } from 'react';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { MODEL_PRESETS, type AiProvider } from '@/ai/config';
import { mcpClientManager, type McpConnectionStatus } from '@/ai/mcp/McpClientManager';

interface AppSettingsModalProps {
  onClose: () => void;
}

// 환경 변수 확인 헬퍼 (Deprecated)
function hasEnvKey(key: string): boolean {
  const v = (import.meta as any).env?.[key] as string | undefined;
  return typeof v === 'string' && v.trim().length > 0;
}

export function AppSettingsModal({ onClose }: AppSettingsModalProps): JSX.Element {
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

  // MCP State
  const [mcpStatus, setMcpStatus] = useState<McpConnectionStatus>(mcpClientManager.getStatus());
  const [atlassianEmail, setAtlassianEmail] = useState('');
  const [atlassianToken, setAtlassianToken] = useState('');
  const [atlassianUrl, setAtlassianUrl] = useState('');
  const [showMcpConfig, setShowMcpConfig] = useState(false);

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

  // MCP 상태 구독
  useEffect(() => {
    const unsubscribe = mcpClientManager.subscribe(setMcpStatus);
    return unsubscribe;
  }, []);

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

  // MCP 연결 핸들러
  const handleConnectMcp = async () => {
    if (!atlassianEmail || !atlassianToken || !atlassianUrl) {
      alert('Please fill in all Atlassian configuration fields.');
      return;
    }

    try {
      await mcpClientManager.connectAtlassian({
        email: atlassianEmail,
        apiToken: atlassianToken,
        instanceUrl: atlassianUrl
      });
    } catch (error) {
      // 에러는 mcpStatus.error에 반영됨
    }
  };

  // MCP 연결 해제 핸들러
  const handleDisconnectMcp = async () => {
    await mcpClientManager.disconnect();
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleOverlayClick}
    >
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col bg-editor-surface border border-editor-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="h-14 px-5 flex items-center justify-between border-b border-editor-border bg-editor-bg shrink-0">
          <h2 className="text-lg font-bold text-editor-text">App Settings</h2>
          <button 
            onClick={onClose}
            className="p-2 rounded-md hover:bg-editor-border text-editor-muted hover:text-editor-text transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-8">
            
            {/* 1. AI Provider */}
            <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">🤖</span>
                    <h3 className="font-semibold text-editor-text">AI Provider</h3>
                </div>

                {/* Provider Selection (Radio Group) */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-editor-muted uppercase tracking-wider">Provider</label>
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
                    <h3 className="font-semibold text-editor-text">API Keys</h3>
                </div>
                <p className="text-xs text-editor-muted">
                    Keys are stored securely in your OS keychain and are not saved to localStorage.
                </p>

                {/* OpenAI API Key */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-editor-text">OpenAI API Key</label>
                        {openaiApiKey && (
                            <button
                                onClick={() => setOpenaiApiKey(undefined)}
                                className="text-xs text-editor-muted hover:text-editor-text transition-colors"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <input
                            type="password"
                            className="w-full h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-editor-muted"
                            placeholder="Enter your OpenAI API key"
                            value={openaiApiKey || ''}
                            onChange={(e) => setOpenaiApiKey(e.target.value)}
                        />
                    </div>
                </div>

                {/* Anthropic API Key */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-editor-text">Anthropic API Key</label>
                        {anthropicApiKey && (
                            <button
                                onClick={() => setAnthropicApiKey(undefined)}
                                className="text-xs text-editor-muted hover:text-editor-text transition-colors"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <input
                            type="password"
                            className="w-full h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-editor-muted"
                            placeholder="Enter your Anthropic API key"
                            value={anthropicApiKey || ''}
                            onChange={(e) => setAnthropicApiKey(e.target.value)}
                        />
                    </div>
                </div>

                {/* Google API Key */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-editor-text">Google API Key</label>
                        {googleApiKey && (
                            <button
                                onClick={() => setGoogleApiKey(undefined)}
                                className="text-xs text-editor-muted hover:text-editor-text transition-colors"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <input
                            type="password"
                            className="w-full h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-editor-muted"
                            placeholder="Enter your Google API key"
                            value={googleApiKey || ''}
                            onChange={(e) => setGoogleApiKey(e.target.value)}
                        />
                    </div>
                </div>

                {/* Brave Search API Key */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-editor-text">Brave Search API Key</label>
                        {braveApiKey && (
                            <button
                                onClick={() => setBraveApiKey(undefined)}
                                className="text-xs text-editor-muted hover:text-editor-text transition-colors"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <input
                            type="password"
                            className="w-full h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-editor-muted"
                            placeholder="Enter your Brave Search API key"
                            value={braveApiKey || ''}
                            onChange={(e) => setBraveApiKey(e.target.value)}
                        />
                    </div>
                </div>
            </section>

             {/* 3. Integrations */}
             <section className="space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">🔌</span>
                    <h3 className="font-semibold text-editor-text">Integrations (MCP)</h3>
                </div>
                
                {/* Atlassian MCP Card */}
                <div className="rounded-lg border border-editor-border bg-editor-surface-hover/30 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold">A</div>
                            <div>
                                <h4 className="font-medium text-editor-text">Atlassian</h4>
                                <p className="text-xs text-editor-muted">Connect Jira & Confluence via MCP</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                             {/* Status Indicator */}
                             {mcpStatus.isConnecting && (
                                 <span className="text-xs text-primary-500 animate-pulse">Connecting...</span>
                             )}
                             {mcpStatus.isConnected && (
                                 <span className="text-xs text-green-500 font-medium">Connected</span>
                             )}
                             
                             <button
                                onClick={() => mcpStatus.isConnected ? handleDisconnectMcp() : setShowMcpConfig(!showMcpConfig)}
                                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                                    mcpStatus.isConnected
                                        ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50'
                                        : 'bg-white dark:bg-editor-surface text-editor-text border-editor-border hover:bg-editor-bg'
                                }`}
                                disabled={mcpStatus.isConnecting}
                             >
                                 {mcpStatus.isConnected ? 'Disconnect' : showMcpConfig ? 'Cancel' : 'Connect'}
                             </button>
                        </div>
                    </div>

                    {/* Error Message */}
                    {mcpStatus.error && (
                        <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/10 p-2 rounded">
                            Error: {mcpStatus.error}
                        </div>
                    )}

                    {/* Config Form */}
                    {showMcpConfig && !mcpStatus.isConnected && (
                        <div className="pt-2 space-y-3 border-t border-editor-border/50 animate-in slide-in-from-top-2 duration-200">
                             <div className="space-y-1">
                                <label className="text-xs font-medium text-editor-muted">Instance URL</label>
                                <input
                                    type="text"
                                    placeholder="https://your-domain.atlassian.net"
                                    className="w-full h-8 px-2 text-xs rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    value={atlassianUrl}
                                    onChange={(e) => setAtlassianUrl(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-editor-muted">Email</label>
                                <input
                                    type="email"
                                    placeholder="user@example.com"
                                    className="w-full h-8 px-2 text-xs rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    value={atlassianEmail}
                                    onChange={(e) => setAtlassianEmail(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-editor-muted">API Token</label>
                                <input
                                    type="password"
                                    placeholder="Atlassian API Token"
                                    className="w-full h-8 px-2 text-xs rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    value={atlassianToken}
                                    onChange={(e) => setAtlassianToken(e.target.value)}
                                />
                                <p className="text-[10px] text-editor-muted">
                                    Create a token at <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" className="text-primary-500 hover:underline">id.atlassian.com</a>
                                </p>
                            </div>
                            <div className="pt-1 flex justify-end">
                                <button
                                    onClick={handleConnectMcp}
                                    disabled={mcpStatus.isConnecting}
                                    className="px-3 py-1.5 bg-primary-500 text-white rounded text-xs font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors"
                                >
                                    {mcpStatus.isConnecting ? 'Connecting...' : 'Connect Atlassian'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* 4. Help & Info (Placeholder) */}
            <section className="space-y-3 opacity-60">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">ℹ️</span>
                    <h3 className="font-semibold text-editor-text">Help & Info</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-editor-border text-editor-muted">Coming soon</span>
                </div>
                <div className="text-sm text-editor-muted pl-1">
                    Version: 0.1.0-alpha <br/>
                    Tutorials and FAQ will be added soon.
                </div>
            </section>

        </div>
        
        {/* Footer */}
        <div className="h-12 px-5 flex items-center justify-end bg-editor-bg border-t border-editor-border shrink-0">
             <span className="text-xs text-editor-muted mr-auto">Changes are saved automatically.</span>
             <button 
                onClick={onClose}
                className="px-4 py-1.5 rounded-md bg-editor-surface border border-editor-border hover:bg-editor-border text-sm font-medium transition-colors"
            >
                Close
            </button>
        </div>
      </div>
    </div>
  );
}
