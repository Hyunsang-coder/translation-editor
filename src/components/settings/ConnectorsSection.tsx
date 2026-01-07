/**
 * 커넥터 설정 섹션
 * 
 * OpenAI 빌트인 커넥터와 MCP 커넥터의 연결 상태를 표시하고 관리합니다.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectorStore } from '@/stores/connectorStore';
import { BUILTIN_CONNECTORS, MCP_CONNECTORS } from '@/ai/connectors';
import { mcpClientManager, type McpConnectionStatus } from '@/ai/mcp/McpClientManager';

interface NotionTokenDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (token: string) => void;
}

function NotionTokenDialog({ isOpen, onClose, onSubmit }: NotionTokenDialogProps): JSX.Element | null {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setToken('');
      setError('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError(t('appSettings.connectors.notion.tokenRequired'));
      return;
    }
    // Integration Token 형식 검증
    if (!token.startsWith('ntn_') && !token.startsWith('secret_')) {
      setError(t('appSettings.connectors.notion.invalidTokenFormat'));
      return;
    }
    onSubmit(token.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-editor-bg border border-editor-border rounded-lg shadow-xl w-full max-w-md p-4">
        <h3 className="text-lg font-semibold text-editor-text mb-2">
          {t('appSettings.connectors.notion.dialogTitle')}
        </h3>
        <p className="text-sm text-editor-muted mb-4">
          {t('appSettings.connectors.notion.dialogDescription')}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-editor-text mb-1">
              {t('appSettings.connectors.notion.tokenLabel')}
            </label>
            <input
              ref={inputRef}
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setError('');
              }}
              placeholder="ntn_xxx... or secret_xxx..."
              className="w-full px-3 py-2 bg-editor-bg border border-editor-border rounded text-sm text-editor-text focus:outline-none focus:border-primary-500"
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-editor-muted hover:text-editor-text transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-primary-500 text-white rounded hover:bg-primary-600 transition-colors"
            >
              {t('appSettings.connectors.connect')}
            </button>
          </div>
        </form>
        <div className="mt-4 pt-4 border-t border-editor-border">
          <p className="text-xs text-editor-muted">
            {t('appSettings.connectors.notion.helpText')}{' '}
            <a
              href="https://www.notion.so/my-integrations"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-400 hover:underline"
            >
              notion.so/my-integrations
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

interface ConnectorItemProps {
  icon: string;
  label: string;
  description: string | undefined;
  hasToken: boolean;
  isConnected: boolean;
  isConnecting?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  comingSoon?: boolean;
}

function ConnectorItem({
  icon,
  label,
  description,
  hasToken,
  isConnected,
  isConnecting,
  onConnect,
  onDisconnect,
  comingSoon,
}: ConnectorItemProps): JSX.Element {
  const { t } = useTranslation();

  const statusText = isConnecting
    ? t('appSettings.connectors.connecting')
    : isConnected
      ? t('appSettings.connectors.connected')
      : hasToken
        ? t('appSettings.connectors.authenticated')
      : t('appSettings.connectors.notConnected');

  const statusColor = isConnecting
    ? 'text-yellow-500'
    : isConnected
      ? 'text-green-500'
      : hasToken
        ? 'text-blue-500'
      : 'text-editor-muted';

  // 아이콘이 이미지 경로인지 확인 (확장자로 판단)
  const isImagePath = icon && /\.(png|jpg|jpeg|svg|gif|webp)$/i.test(icon);

  return (
    <div className={`p-3 rounded-lg border ${hasToken ? 'border-primary-500/30 bg-primary-500/5' : 'border-editor-border bg-editor-bg'} ${comingSoon ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3">
        {isImagePath ? (
          <img 
            src={icon} 
            alt={label}
            className="w-5 h-5 object-contain"
          />
        ) : (
          <span className="text-xl">{icon}</span>
        )}
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
            isConnected ? (
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
    </div>
  );
}

export function ConnectorsSection(): JSX.Element {
  const { t } = useTranslation();
  const { setTokenStatus } = useConnectorStore();
  
  // MCP 상태 (Atlassian)
  const [mcpStatus, setMcpStatus] = useState<McpConnectionStatus>({
    isConnected: false,
    isConnecting: false,
  });

  // Notion MCP 상태
  const [notionStatus, setNotionStatus] = useState<McpConnectionStatus>({
    isConnected: false,
    isConnecting: false,
  });

  // Notion 토큰 다이얼로그
  const [showNotionDialog, setShowNotionDialog] = useState(false);

  // MCP 상태 구독 (Atlassian)
  useEffect(() => {
    const unsubscribe = mcpClientManager.subscribe((status) => {
      setMcpStatus(status);
      // Atlassian 커넥터 토큰 상태 동기화
      setTokenStatus('atlassian', status.hasStoredToken ?? false);
    });
    return unsubscribe;
  }, [setTokenStatus]);

  // Notion MCP 상태 구독
  useEffect(() => {
    const unsubscribe = mcpClientManager.subscribeNotion((status) => {
      setNotionStatus(status);
      // Notion 커넥터 토큰 상태 동기화
      setTokenStatus('notion', status.hasStoredToken ?? false);
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
      await mcpClientManager.disconnect();
    } catch (error) {
      console.error('[Connectors] Atlassian disconnect failed:', error);
    }
  }, []);

  // Notion MCP 연결 (토큰 입력 다이얼로그 표시)
  const handleNotionConnect = useCallback(() => {
    setShowNotionDialog(true);
  }, []);

  // Notion 토큰 제출 및 연결
  const handleNotionTokenSubmit = useCallback(async (token: string) => {
    try {
      await mcpClientManager.setNotionToken(token);
      await mcpClientManager.connectNotion();
    } catch (error) {
      console.error('[Connectors] Notion connect failed:', error);
    }
  }, []);

  // Notion MCP 연결 해제
  const handleNotionDisconnect = useCallback(async () => {
    try {
      await mcpClientManager.logoutNotion();
    } catch (error) {
      console.error('[Connectors] Notion disconnect failed:', error);
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

  // MCP 커넥터별 상태 및 핸들러 가져오기
  const getMcpConnectorProps = useCallback((connectorId: string) => {
    if (connectorId === 'atlassian') {
      return {
        hasToken: mcpStatus.hasStoredToken ?? false,
        isConnected: mcpStatus.isConnected,
        isConnecting: mcpStatus.isConnecting,
        onConnect: handleAtlassianConnect,
        onDisconnect: handleAtlassianDisconnect,
        comingSoon: false,
      };
    }
    if (connectorId === 'notion') {
      return {
        hasToken: notionStatus.hasStoredToken ?? false,
        isConnected: notionStatus.isConnected,
        isConnecting: notionStatus.isConnecting,
        onConnect: handleNotionConnect,
        onDisconnect: handleNotionDisconnect,
        comingSoon: false,
      };
    }
    return {
      hasToken: false,
      isConnected: false,
      isConnecting: false,
      onConnect: () => {},
      onDisconnect: () => {},
      comingSoon: true,
    };
  }, [mcpStatus, notionStatus, handleAtlassianConnect, handleAtlassianDisconnect, handleNotionConnect, handleNotionDisconnect]);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
        <span className="text-lg">🔌</span>
        <h3 className="font-semibold text-editor-text">{t('appSettings.connectors.title')}</h3>
      </div>
      <p className="text-xs text-editor-muted">
        {t('appSettings.connectors.description')}
      </p>

      {/* 커넥터 목록 (MCP + 빌트인) */}
      <div className="space-y-2">
        {MCP_CONNECTORS.map((connector) => {
          const props = getMcpConnectorProps(connector.id);
          return (
            <ConnectorItem
              key={connector.id}
              icon={connector.icon ?? '🔗'}
              label={connector.label}
              description={connector.description}
              hasToken={props.hasToken}
              isConnected={props.isConnected}
              isConnecting={props.isConnecting}
              onConnect={props.onConnect}
              onDisconnect={props.onDisconnect}
              comingSoon={props.comingSoon}
            />
          );
        })}
        {BUILTIN_CONNECTORS.map((connector) => (
          <ConnectorItem
            key={connector.id}
            icon={connector.icon ?? '📁'}
            label={connector.label}
            description={connector.description}
            hasToken={false} // TODO: 토큰 상태 확인
            isConnected={false}
            onConnect={() => handleBuiltinConnect(connector.id)}
            onDisconnect={() => handleBuiltinDisconnect(connector.id)}
            comingSoon={true} // OAuth 구현 전까지 비활성화
          />
        ))}
      </div>

      {/* Notion 토큰 입력 다이얼로그 */}
      <NotionTokenDialog
        isOpen={showNotionDialog}
        onClose={() => setShowNotionDialog(false)}
        onSubmit={handleNotionTokenSubmit}
      />
    </section>
  );
}
