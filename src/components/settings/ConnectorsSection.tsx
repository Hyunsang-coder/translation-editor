/**
 * 커넥터 설정 섹션
 * 
 * OpenAI 빌트인 커넥터와 MCP 커넥터의 연결 상태를 표시하고 관리합니다.
 */

import { useEffect, useState, useCallback } from 'react';
import { Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConnectorStore } from '@/stores/connectorStore';
import { BUILTIN_CONNECTORS, MCP_CONNECTORS } from '@/ai/connectors';
import { mcpClientManager, type McpConnectionStatus } from '@/ai/mcp/McpClientManager';
import { CollapsibleSection } from './CollapsibleSection';

interface ConnectorItemProps {
  icon: string;
  label: string;
  description: string | undefined;
  hasToken: boolean;
  isConnected: boolean;
  isConnecting?: boolean;
  error?: string | null | undefined;
  elapsedSeconds?: number;
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
  elapsedSeconds,
  onConnect,
  onDisconnect,
  onClearAll,
  comingSoon,
}: ConnectorItemProps): JSX.Element {
  const { t } = useTranslation();

  const statusText = error
    ? t('appSettings.connectors.error')
    : isConnecting && elapsedSeconds !== undefined
      ? `${t('appSettings.connectors.connecting')} (${elapsedSeconds}초...)`
      : isConnecting
        ? t('appSettings.connectors.connecting')
        : isConnected
          ? t('appSettings.connectors.connected')
          : hasToken
            ? t('appSettings.connectors.authenticated')
            : t('appSettings.connectors.notConnected');

  const statusColor = error
    ? 'text-severity-critical'
    : isConnecting
      ? 'text-severity-major'
      : isConnected
        ? 'text-diff-insertion'
        : hasToken
          ? 'text-primary-500'
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
                  className="px-2 py-1 text-xs rounded bg-editor-border hover:bg-severity-critical/20 hover:text-severity-critical transition-colors disabled:opacity-50"
                >
                  {t('appSettings.connectors.disconnect')}
                </button>
              ) : error ? (
                <>
                  <button
                    onClick={onConnect}
                    disabled={isConnecting}
                    className="px-2 py-1 text-xs rounded bg-severity-major/20 text-severity-major hover:bg-severity-major/30 transition-colors disabled:opacity-50"
                  >
                    {isConnecting ? '...' : t('appSettings.connectors.retry')}
                  </button>
                  {onClearAll && (
                    <button
                      onClick={onClearAll}
                      disabled={isConnecting}
                      className="px-2 py-1 text-xs rounded bg-severity-critical/10 text-severity-critical hover:bg-severity-critical/20 transition-colors disabled:opacity-50"
                      title={t('appSettings.connectors.clearAllTooltip')}
                    >
                      {t('appSettings.connectors.clearAll')}
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={onConnect}
                  disabled={isConnecting}
                  className="px-2 py-1 text-xs rounded bg-primary-500/10 text-primary-600 dark:text-primary-400 hover:bg-primary-500/20 transition-colors disabled:opacity-50"
                >
                  {isConnecting ? '...' : t('appSettings.connectors.connect')}
                </button>
              )}
              {/* 미연결 상태(에러 아님)에서 토큰이 있을 때 초기화 버튼 표시 */}
              {!isConnected && !error && hasToken && onClearAll && (
                <button
                  onClick={onClearAll}
                  disabled={isConnecting}
                  className="px-2 py-1 text-xs rounded bg-severity-critical/10 text-severity-critical hover:bg-severity-critical/20 transition-colors disabled:opacity-50"
                  title={t('appSettings.connectors.clearAllTooltip')}
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
        <p className="mt-2 text-xs text-severity-critical truncate" title={error}>
          {error}
        </p>
      )}
      {/* 연결 지연 경고 */}
      {isConnecting && elapsedSeconds !== undefined && (
        <p className={`mt-2 text-xs ${
          elapsedSeconds >= 60
            ? 'text-severity-critical'
            : elapsedSeconds >= 30
              ? 'text-severity-major'
              : 'text-editor-muted'
        }`}>
          {elapsedSeconds >= 60
            ? `⏱️ 연결이 오래 걸리고 있습니다 (${elapsedSeconds}초). 문제가 지속되면 '초기화'를 시도하세요.`
            : elapsedSeconds >= 30
              ? `⏳ 연결이 지연 중입니다 (${elapsedSeconds}초...). 최대 60초까지 기다릴 수 있습니다.`
              : `연결 중... (${elapsedSeconds}초)`}
        </p>
      )}
    </div>
  );
}

export function ConnectorsSection(): JSX.Element {
  const { t } = useTranslation();
  const setTokenStatus = useConnectorStore((s) => s.setTokenStatus);

  // MCP 상태 (Atlassian)
  const [mcpStatus, setMcpStatus] = useState<McpConnectionStatus>({
    isConnected: false,
    isConnecting: false,
  });

  // 연결 시작 시점 추적 (타이머용)
  const [connectionStartedAt, setConnectionStartedAt] = useState<{
    atlassian: number | null;
  }>({ atlassian: null });

  // 경과 시간 (초)
  const [elapsedSeconds, setElapsedSeconds] = useState<{
    atlassian: number;
  }>({ atlassian: 0 });

  // 연결 중일 때 타이머
  useEffect(() => {
    if (!mcpStatus.isConnecting) return;

    const interval = setInterval(() => {
      setElapsedSeconds({
        atlassian: connectionStartedAt.atlassian
          ? Math.floor((Date.now() - connectionStartedAt.atlassian) / 1000)
          : 0,
      });
    }, 500);

    return () => clearInterval(interval);
  }, [mcpStatus.isConnecting, connectionStartedAt]);

  // Atlassian 연결 완료/실패 → 타이머 초기화
  useEffect(() => {
    if (!mcpStatus.isConnecting) {
      setConnectionStartedAt((prev) => ({ ...prev, atlassian: null }));
      setElapsedSeconds((prev) => ({ ...prev, atlassian: 0 }));
    }
  }, [mcpStatus.isConnecting]);

  // MCP 상태 구독
  useEffect(() => mcpClientManager.subscribe((status) => {
    setMcpStatus(status);
    setTokenStatus('atlassian', status.hasStoredToken ?? false);
  }), [setTokenStatus]);

  // Atlassian MCP 연결
  const handleAtlassianConnect = useCallback(async () => {
    setConnectionStartedAt((prev) => ({ ...prev, atlassian: Date.now() }));
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

  // Atlassian 완전 초기화 (토큰 + 클라이언트 정보 모두 삭제)
  const handleAtlassianClearAll = useCallback(async () => {
    try {
      await mcpClientManager.clearAllAtlassian();
    } catch (error) {
      console.error('[Connectors] Atlassian clear all failed:', error);
    }
  }, []);

  // 빌트인 커넥터 연결 (TODO: OAuth 구현 후 활성화)
  const handleBuiltinConnect = useCallback((connectorId: string) => {
    console.warn(`[Connectors] Connect ${connectorId} - OAuth not implemented yet`);
    // TODO: startConnectorOAuth(connectorId)
  }, []);

  const handleBuiltinDisconnect = useCallback((connectorId: string) => {
    console.warn(`[Connectors] Disconnect ${connectorId}`);
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
        elapsedSeconds: elapsedSeconds.atlassian,
        onConnect: handleAtlassianConnect,
        onDisconnect: handleAtlassianDisconnect,
        onClearAll: handleAtlassianClearAll,
        comingSoon: false,
      };
    }
    return {
      hasToken: false,
      isConnected: false,
      isConnecting: false,
      error: null,
      elapsedSeconds: 0,
      onConnect: () => {},
      onDisconnect: () => {},
      onClearAll: undefined,
      comingSoon: true,
    };
  }, [mcpStatus, elapsedSeconds, handleAtlassianConnect, handleAtlassianDisconnect, handleAtlassianClearAll]);

  return (
    <CollapsibleSection
      icon={<Plug size={16} />}
      title={t('appSettings.connectors.title')}
      summary={
        mcpStatus.isConnected
          ? t('appSettings.connectors.connected')
          : t('appSettings.connectors.notConnected')
      }
      testId="app-settings-connectors-toggle"
    >
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
    </CollapsibleSection>
  );
}
