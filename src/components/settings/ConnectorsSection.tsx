/**
 * 커넥터 설정 섹션
 * 
 * OpenAI 빌트인 커넥터와 MCP 커넥터의 연결 상태를 표시하고 관리합니다.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectorStore } from '@/stores/connectorStore';
import { BUILTIN_CONNECTORS, MCP_CONNECTORS } from '@/ai/connectors';
import { mcpClientManager, type McpConnectionStatus } from '@/ai/mcp/McpClientManager';

interface ConnectorItemProps {
  icon: string;
  label: string;
  description: string | undefined;
  enabled: boolean;
  hasToken: boolean;
  isConnecting?: boolean;
  onToggle: (enabled: boolean) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  comingSoon?: boolean;
}

function ConnectorItem({
  icon,
  label,
  description,
  enabled,
  hasToken,
  isConnecting,
  onToggle,
  onConnect,
  onDisconnect,
  comingSoon,
}: ConnectorItemProps): JSX.Element {
  const { t } = useTranslation();

  const statusText = isConnecting
    ? t('appSettings.connectors.connecting')
    : hasToken
      ? t('appSettings.connectors.connected')
      : t('appSettings.connectors.notConnected');

  const statusColor = isConnecting
    ? 'text-yellow-500'
    : hasToken
      ? 'text-green-500'
      : 'text-editor-muted';

  return (
    <div className={`p-3 rounded-lg border ${enabled && hasToken ? 'border-primary-500/30 bg-primary-500/5' : 'border-editor-border bg-editor-bg'} ${comingSoon ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3">
        <span className="text-xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-editor-text">{label}</span>
            {comingSoon && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-editor-border text-editor-muted">
                {t('appSettings.connectors.comingSoon')}
              </span>
            )}
          </div>
          {description && (
            <p className="text-xs text-editor-muted truncate">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${statusColor}`}>
            {statusText}
          </span>
          {!comingSoon && (
            hasToken ? (
              <button
                onClick={onDisconnect}
                disabled={isConnecting}
                className="px-2 py-1 text-xs rounded bg-editor-border hover:bg-red-500/20 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                {t('appSettings.connectors.disconnect')}
              </button>
            ) : (
              <button
                onClick={onConnect}
                disabled={isConnecting}
                className="px-2 py-1 text-xs rounded bg-primary-500/20 text-primary-400 hover:bg-primary-500/30 transition-colors disabled:opacity-50"
              >
                {isConnecting ? '...' : t('appSettings.connectors.connect')}
              </button>
            )
          )}
        </div>
      </div>
      {hasToken && !comingSoon && (
        <div className="mt-2 pt-2 border-t border-editor-border/50">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onToggle(e.target.checked)}
              className="w-4 h-4 accent-primary-500"
            />
            <span className="text-xs text-editor-muted">
              {t('appSettings.connectors.enableForChat')}
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

export function ConnectorsSection(): JSX.Element {
  const { t } = useTranslation();
  const { enabledMap, setEnabled, setTokenStatus } = useConnectorStore();
  
  // MCP 상태
  const [mcpStatus, setMcpStatus] = useState<McpConnectionStatus>({
    isConnected: false,
    isConnecting: false,
  });

  // MCP 상태 구독
  useEffect(() => {
    const unsubscribe = mcpClientManager.subscribe((status) => {
      setMcpStatus(status);
      // Atlassian 커넥터 토큰 상태 동기화
      setTokenStatus('atlassian', status.hasStoredToken ?? false);
    });
    return unsubscribe;
  }, [setTokenStatus]);

  // Atlassian MCP 연결
  const handleAtlassianConnect = useCallback(async () => {
    try {
      await mcpClientManager.connectAtlassian();
    } catch (error) {
      console.error('[Connectors] Atlassian connect failed:', error);
    }
  }, []);

  // Atlassian MCP 연결 해제
  const handleAtlassianDisconnect = useCallback(async () => {
    try {
      await mcpClientManager.logout();
    } catch (error) {
      console.error('[Connectors] Atlassian disconnect failed:', error);
    }
  }, []);

  // 빌트인 커넥터 연결 (TODO: OAuth 구현 후 활성화)
  const handleBuiltinConnect = useCallback((connectorId: string) => {
    console.log(`[Connectors] Connect ${connectorId} - OAuth not implemented yet`);
    // TODO: startConnectorOAuth(connectorId)
  }, []);

  const handleBuiltinDisconnect = useCallback((connectorId: string) => {
    console.log(`[Connectors] Disconnect ${connectorId}`);
    // TODO: deleteConnectorToken(connectorId)
  }, []);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
        <span className="text-lg">🔌</span>
        <h3 className="font-semibold text-editor-text">{t('appSettings.connectors.title')}</h3>
      </div>
      <p className="text-xs text-editor-muted">
        {t('appSettings.connectors.description')}
      </p>

      {/* MCP 커넥터 (Atlassian) */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-editor-muted uppercase tracking-wider">
          {t('appSettings.connectors.mcpServices')}
        </h4>
        <div className="space-y-2">
          {MCP_CONNECTORS.map((connector) => (
            <ConnectorItem
              key={connector.id}
              icon={connector.icon ?? '🔗'}
              label={connector.label}
              description={connector.description}
              enabled={enabledMap[connector.id] ?? false}
              hasToken={connector.id === 'atlassian' ? (mcpStatus.hasStoredToken ?? false) : false}
              isConnecting={connector.id === 'atlassian' ? mcpStatus.isConnecting : false}
              onToggle={(enabled) => setEnabled(connector.id, enabled)}
              onConnect={connector.id === 'atlassian' ? handleAtlassianConnect : () => {}}
              onDisconnect={connector.id === 'atlassian' ? handleAtlassianDisconnect : () => {}}
              comingSoon={connector.id !== 'atlassian'}
            />
          ))}
        </div>
      </div>

      {/* OpenAI 빌트인 커넥터 (Google, Dropbox, Microsoft) */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-editor-muted uppercase tracking-wider">
          {t('appSettings.connectors.cloudServices')}
        </h4>
        <div className="space-y-2">
          {BUILTIN_CONNECTORS.map((connector) => (
            <ConnectorItem
              key={connector.id}
              icon={connector.icon ?? '📁'}
              label={connector.label}
              description={connector.description}
              enabled={enabledMap[connector.id] ?? false}
              hasToken={false} // TODO: 토큰 상태 확인
              onToggle={(enabled) => setEnabled(connector.id, enabled)}
              onConnect={() => handleBuiltinConnect(connector.id)}
              onDisconnect={() => handleBuiltinDisconnect(connector.id)}
              comingSoon={true} // OAuth 구현 전까지 비활성화
            />
          ))}
        </div>
      </div>
    </section>
  );
}

