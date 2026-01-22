/**
 * 커넥터 Tauri IPC 래퍼
 * 
 * OpenAI 빌트인 커넥터의 OAuth 토큰을 Rust 백엔드(OS 키체인)에서 관리합니다.
 */

import { invoke, isTauriRuntime } from '@/tauri/invoke';

/**
 * 커넥터 토큰 정보
 */
export interface ConnectorToken {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
}

/**
 * 커넥터 상태 정보
 */
export interface ConnectorStatus {
  connector_id: string;
  has_token: boolean;
  expires_at?: number;
  is_expired: boolean;
}

/**
 * 커넥터 토큰 저장
 */
export async function setConnectorToken(
  connectorId: string,
  token: ConnectorToken
): Promise<void> {
  if (!isTauriRuntime()) {
    console.warn('[Connector] Not in Tauri runtime, skipping token save');
    return;
  }

  await invoke('connector_set_token', {
    connectorId,
    token,
  });
}

/**
 * 커넥터 액세스 토큰 조회
 */
export async function getConnectorToken(
  connectorId: string
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return await invoke<string | null>('connector_get_token', {
    connectorId,
  });
}

/**
 * 커넥터 토큰 삭제
 */
export async function deleteConnectorToken(
  connectorId: string
): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke('connector_delete_token', {
    connectorId,
  });
}

/**
 * 여러 커넥터의 상태 조회
 */
export async function listConnectorStatus(
  connectorIds: string[]
): Promise<ConnectorStatus[]> {
  if (!isTauriRuntime()) {
    return connectorIds.map((id) => ({
      connector_id: id,
      has_token: false,
      is_expired: false,
    }));
  }

  return await invoke<ConnectorStatus[]>('connector_list_status', {
    connectorIds,
  });
}

/**
 * 커넥터 OAuth 플로우 시작
 * 
 * TODO: Phase 2-oauth에서 구현
 */
export async function startConnectorOAuth(
  connectorId: string
): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error('OAuth flow requires Tauri runtime');
  }

  return await invoke<string>('connector_start_oauth', {
    connectorId,
  });
}

