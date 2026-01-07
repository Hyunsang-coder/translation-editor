/**
 * MCP 레지스트리 Tauri IPC 래퍼
 * 
 * 여러 MCP 서버(Atlassian, Notion 등)를 통합 관리합니다.
 */

import { invoke, isTauriRuntime } from '@/tauri/invoke';

/**
 * MCP 서버 ID
 */
export type McpServerId = 'atlassian' | 'notion';

/**
 * MCP 연결 상태
 */
export interface McpConnectionStatus {
  isConnected: boolean;
  isConnecting: boolean;
  error?: string | null;
  serverName?: string | null;
  hasStoredToken?: boolean;
  tokenExpiresIn?: number | null;
}

/**
 * MCP 서버 정보
 */
export interface McpServerInfo {
  id: McpServerId;
  displayName: string;
  description: string;
  icon: string;
  status: McpConnectionStatus;
}

/**
 * MCP 레지스트리 상태
 */
export interface McpRegistryStatus {
  servers: McpServerInfo[];
  connectedCount: number;
  hasAnyToken: boolean;
}

/**
 * MCP 도구 정의
 */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * MCP 도구 호출 결과
 */
export interface McpToolResult {
  content: McpContent[];
  isError: boolean;
}

export interface McpContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

/**
 * 전체 MCP 레지스트리 상태 조회
 */
export async function getRegistryStatus(): Promise<McpRegistryStatus> {
  if (!isTauriRuntime()) {
    return {
      servers: [],
      connectedCount: 0,
      hasAnyToken: false,
    };
  }

  const result = await invoke<{
    servers: Array<{
      id: string;
      display_name: string;
      description: string;
      icon: string;
      status: {
        is_connected: boolean;
        is_connecting: boolean;
        error?: string | null;
        server_name?: string | null;
        has_stored_token?: boolean;
        token_expires_in?: number | null;
      };
    }>;
    connected_count: number;
    has_any_token: boolean;
  }>('mcp_registry_status');

  return {
    servers: result.servers.map((s) => {
      const status: McpConnectionStatus = {
        isConnected: s.status.is_connected,
        isConnecting: s.status.is_connecting,
      };
      if (s.status.error !== undefined) status.error = s.status.error;
      if (s.status.server_name !== undefined) status.serverName = s.status.server_name;
      if (s.status.has_stored_token !== undefined) status.hasStoredToken = s.status.has_stored_token;
      if (s.status.token_expires_in !== undefined) status.tokenExpiresIn = s.status.token_expires_in;

      return {
        id: s.id as McpServerId,
        displayName: s.display_name,
        description: s.description,
        icon: s.icon,
        status,
      };
    }),
    connectedCount: result.connected_count,
    hasAnyToken: result.has_any_token,
  };
}

/**
 * 특정 MCP 서버에 연결
 */
export async function connectMcpServer(serverId: McpServerId): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('MCP connection requires Tauri runtime');
  }

  await invoke('mcp_registry_connect', { serverId });
}

/**
 * 특정 MCP 서버 연결 해제
 */
export async function disconnectMcpServer(serverId: McpServerId): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke('mcp_registry_disconnect', { serverId });
}

/**
 * 특정 MCP 서버 로그아웃
 */
export async function logoutMcpServer(serverId: McpServerId): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke('mcp_registry_logout', { serverId });
}

/**
 * 특정 MCP 서버 완전 초기화 (토큰 + 클라이언트 정보 모두 삭제)
 * Client ID mismatch 등 복구 불가능한 상태일 때 사용
 */
export async function clearAllMcpServer(serverId: McpServerId): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke('mcp_registry_clear_all', { serverId });
}

/**
 * 특정 MCP 서버의 도구 목록 조회
 */
export async function getMcpTools(serverId: McpServerId): Promise<McpTool[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  return await invoke<McpTool[]>('mcp_registry_get_tools', { serverId });
}

/**
 * MCP 도구 호출
 */
export async function callMcpTool(
  serverId: McpServerId,
  name: string,
  args?: Record<string, unknown>
): Promise<McpToolResult> {
  if (!isTauriRuntime()) {
    throw new Error('MCP tool call requires Tauri runtime');
  }

  return await invoke<McpToolResult>('mcp_registry_call_tool', {
    serverId,
    name,
    arguments: args,
  });
}

