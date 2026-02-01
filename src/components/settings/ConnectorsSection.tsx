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
  hasStoredToken: boolean;
  onClose: () => void;
  onSubmit: (token: string | null) => void; // null = 기존 토큰 사용
}

function NotionTokenDialog({ isOpen, hasStoredToken, onClose, onSubmit }: NotionTokenDialogProps): JSX.Element | null {
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
    
    // 기존 토큰이 있고 새 토큰 입력 안 했으면 기존 토큰 사용
    if (!token.trim() && hasStoredToken) {
      onSubmit(null); // null = 기존 토큰 사용
      onClose();
      return;
    }
    
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
              placeholder={hasStoredToken ? "••••••••••••••••" : "ntn_xxx... or secret_xxx..."}
              className="w-full px-3 py-2 bg-editor-bg border border-editor-border rounded text-sm text-editor-text focus:outline-none focus:border-primary-500"
            />
            {hasStoredToken && !token && (
              <p className="text-xs text-editor-muted mt-1">
                {t('appSettings.connectors.notion.useExistingToken')}
              </p>
            )}
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
  error?: string | null | undefined;
  onConnect: () => void;
  onDisconnect: () => void | Promise<void>;
  onClearAll?: (() => void | Promise<void>) | undefined;
  comingSoon?: boolean;
}

function ConnectorItem({
  icon,
  label,
  description,
  hasToken,
  isConnected,
  isConnecting,
  error,
  onConnect,
  onDisconnect,
  onClearAll,
  comingSoon,
}: ConnectorItemProps): JSX.Element {
  const { t } = useTranslation();

  const statusText = error
    ? t('appSettings.connectors.error')
    : isConnecting
      ? t('appSettings.connectors.connecting')
      : isConnected
        ? t('appSettings.connectors.connected')
        : hasToken
          ? t('appSettings.connectors.authenticated')
          : t('appSettings.connectors.notConnected');

  const statusColor = error
    ? 'text-red-500'
    : isConnecting
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
            <>
              {isConnected ? (
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
              )}
              {/* 연결 해제 상태에서 에러가 있거나 토큰이 있을 때 초기화 버튼 표시 */}
              {!isConnected && (error || hasToken) && onClearAll && (
                <button
                  onClick={onClearAll}
                  disabled={isConnecting}
                  className="px-2 py-1 text-xs rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  title={error || t('appSettings.connectors.clearAllTooltip')}
                >
                  {t('appSettings.connectors.clearAll')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {/* 에러 메시지 표시 */}
      {error && (
        <p className="mt-2 text-xs text-red-400 truncate" title={error}>
          {error}
        </p>
      )}
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

  // MCP 상태 구독 (Atlassian + Notion 통합)
  useEffect(() => {
    const unsubAtlassian = mcpClientManager.subscribe((status) => {
      setMcpStatus(status);
      setTokenStatus('atlassian', status.hasStoredToken ?? false);
    });
    const unsubNotion = mcpClientManager.subscribeNotion((status) => {
      setNotionStatus(status);
      setTokenStatus('notion', status.hasStoredToken ?? false);
    });
    return () => {
      unsubAtlassian();
      unsubNotion();
    };
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
  const handleNotionTokenSubmit = useCallback(async (token: string | null) => {
    try {
      // token이 null이면 기존 토큰 사용 (setNotionToken 스킵)
      if (token) {
        await mcpClientManager.setNotionToken(token);
      }
      await mcpClientManager.connectNotion();
    } catch (error) {
      console.error('[Connectors] Notion connect failed:', error);
    }
  }, []);

  // Notion MCP 연결 해제 (토큰은 유지)
  const handleNotionDisconnect = useCallback(async () => {
    try {
      await mcpClientManager.disconnectNotion();
    } catch (error) {
      console.error('[Connectors] Notion disconnect failed:', error);
    }
  }, []);

  // Atlassian 완전 초기화 (토큰 + 클라이언트 정보 모두 삭제)
  const handleAtlassianClearAll = useCallback(async () => {
    try {
      await mcpClientManager.clearAllAtlassian();
    } catch (error) {
      console.error('[Connectors] Atlassian clear all failed:', error);
    }
  }, []);

  // Notion 완전 초기화
  const handleNotionClearAll = useCallback(async () => {
    try {
      await mcpClientManager.clearAllNotion();
    } catch (error) {
      console.error('[Connectors] Notion clear all failed:', error);
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
        error: mcpStatus.error,
        onConnect: handleAtlassianConnect,
        onDisconnect: handleAtlassianDisconnect,
        onClearAll: handleAtlassianClearAll,
        comingSoon: false,
      };
    }
    if (connectorId === 'notion') {
      return {
        hasToken: notionStatus.hasStoredToken ?? false,
        isConnected: notionStatus.isConnected,
        isConnecting: notionStatus.isConnecting,
        error: notionStatus.error,
        onConnect: handleNotionConnect,
        onDisconnect: handleNotionDisconnect,
        onClearAll: handleNotionClearAll,
        comingSoon: false,
      };
    }
    return {
      hasToken: false,
      isConnected: false,
      isConnecting: false,
      error: null,
      onConnect: () => {},
      onDisconnect: () => {},
      onClearAll: undefined,
      comingSoon: true,
    };
  }, [mcpStatus, notionStatus, handleAtlassianConnect, handleAtlassianDisconnect, handleAtlassianClearAll, handleNotionConnect, handleNotionDisconnect, handleNotionClearAll]);

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
              error={props.error}
              onConnect={props.onConnect}
              onDisconnect={props.onDisconnect}
              onClearAll={props.onClearAll}
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
        hasStoredToken={notionStatus.hasStoredToken ?? false}
        onClose={() => setShowNotionDialog(false)}
        onSubmit={handleNotionTokenSubmit}
      />
    </section>
  );
}
