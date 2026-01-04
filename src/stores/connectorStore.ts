/**
 * 커넥터 상태 관리 스토어
 * 
 * OpenAI 빌트인 커넥터와 Rust 네이티브 MCP 커넥터의 상태를 통합 관리합니다.
 * - 커넥터 활성화/비활성화 토글
 * - OAuth 토큰 상태 추적
 * - 커넥터별 연결 상태
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type ConnectorConfig,
  BUILTIN_CONNECTORS,
  MCP_CONNECTORS,
} from '@/ai/connectors';

interface ConnectorState {
  /** 커넥터별 활성화 상태 (id -> enabled) */
  enabledMap: Record<string, boolean>;
  /** 커넥터별 토큰 존재 여부 (id -> hasToken) */
  tokenMap: Record<string, boolean>;
  /** 커넥터별 토큰 만료 시간 (id -> expiresAt) */
  expiresAtMap: Record<string, number | undefined>;
}

interface ConnectorActions {
  /** 커넥터 활성화/비활성화 토글 */
  setEnabled: (connectorId: string, enabled: boolean) => void;
  /** 토큰 상태 업데이트 */
  setTokenStatus: (connectorId: string, hasToken: boolean, expiresAt?: number) => void;
  /** 토큰 삭제 (로그아웃) */
  clearToken: (connectorId: string) => void;
  /** 전체 커넥터 설정 목록 반환 */
  getConnectorConfigs: () => ConnectorConfig[];
  /** 활성화된 빌트인 커넥터 목록 반환 */
  getEnabledBuiltinConnectors: () => ConnectorConfig[];
  /** 특정 커넥터의 토큰 존재 여부 확인 */
  hasToken: (connectorId: string) => boolean;
}

// 모든 커넥터의 기본 설정 생성
function getDefaultEnabledMap(): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  
  // 빌트인 커넥터: 기본 비활성화
  for (const c of BUILTIN_CONNECTORS) {
    map[c.id] = false;
  }
  
  // MCP 커넥터: 기본 비활성화
  for (const c of MCP_CONNECTORS) {
    map[c.id] = false;
  }
  
  return map;
}

export const useConnectorStore = create<ConnectorState & ConnectorActions>()(
  persist(
    (set, get) => ({
      enabledMap: getDefaultEnabledMap(),
      tokenMap: {},
      expiresAtMap: {},

      setEnabled: (connectorId, enabled) => {
        set((state) => ({
          enabledMap: {
            ...state.enabledMap,
            [connectorId]: enabled,
          },
        }));
      },

      setTokenStatus: (connectorId, hasToken, expiresAt) => {
        set((state) => ({
          tokenMap: {
            ...state.tokenMap,
            [connectorId]: hasToken,
          },
          expiresAtMap: {
            ...state.expiresAtMap,
            [connectorId]: expiresAt,
          },
        }));
      },

      clearToken: (connectorId) => {
        set((state) => {
          const newTokenMap = { ...state.tokenMap };
          const newExpiresAtMap = { ...state.expiresAtMap };
          delete newTokenMap[connectorId];
          delete newExpiresAtMap[connectorId];
          return {
            tokenMap: newTokenMap,
            expiresAtMap: newExpiresAtMap,
          };
        });
      },

      getConnectorConfigs: () => {
        const { enabledMap, tokenMap, expiresAtMap } = get();
        const configs: ConnectorConfig[] = [];

        // 빌트인 커넥터
        for (const base of BUILTIN_CONNECTORS) {
          const expiresAt = expiresAtMap[base.id];
          configs.push({
            ...base,
            enabled: enabledMap[base.id] ?? false,
            hasToken: tokenMap[base.id] ?? false,
            ...(expiresAt !== undefined ? { tokenExpiresAt: expiresAt } : {}),
          });
        }

        // MCP 커넥터
        for (const base of MCP_CONNECTORS) {
          const expiresAt = expiresAtMap[base.id];
          configs.push({
            ...base,
            enabled: enabledMap[base.id] ?? false,
            hasToken: tokenMap[base.id] ?? false,
            ...(expiresAt !== undefined ? { tokenExpiresAt: expiresAt } : {}),
          });
        }

        return configs;
      },

      getEnabledBuiltinConnectors: () => {
        const { enabledMap, tokenMap, expiresAtMap } = get();
        
        return BUILTIN_CONNECTORS
          .filter((c) => enabledMap[c.id] && tokenMap[c.id])
          .map((base) => {
            const expiresAt = expiresAtMap[base.id];
            return {
              ...base,
              enabled: true as const,
              hasToken: true as const,
              ...(expiresAt !== undefined ? { tokenExpiresAt: expiresAt } : {}),
            };
          });
      },

      hasToken: (connectorId) => {
        return get().tokenMap[connectorId] ?? false;
      },
    }),
    {
      name: 'ite-connectors',
      version: 1,
      // enabledMap만 영속화 (토큰 상태는 런타임에 확인)
      partialize: (state) => ({
        enabledMap: state.enabledMap,
      }),
    }
  )
);

/**
 * 커넥터 초기화 (앱 시작 시 호출)
 * - Rust 백엔드에서 토큰 상태 동기화
 * - MCP 연결 상태 확인
 */
export async function initializeConnectors(): Promise<void> {
  // TODO: Phase 2-oauth에서 구현
  // - 각 커넥터별로 저장된 토큰 존재 여부 확인
  // - MCP 커넥터는 mcpClientManager에서 상태 동기화
  console.log('[ConnectorStore] Initialized');
}

