/**
 * OpenAI Responses API 커넥터 모듈
 * 
 * OpenAI 빌트인 커넥터를 통합하여 외부 서비스(Google, Dropbox, Microsoft 등)에 연결합니다.
 * 커넥터는 OpenAI 서버가 직접 연결하므로, 우리는 OAuth 토큰만 제공하면 됩니다.
 */

/**
 * 커넥터 타입
 * - builtin: OpenAI 빌트인 커넥터 (connector_googledrive 등)
 * - mcp: Rust 네이티브 MCP (Atlassian, Notion 등)
 */
export type ConnectorType = 'builtin' | 'mcp';

/**
 * 빌트인 커넥터 ID (OpenAI Responses API)
 */
export type BuiltinConnectorId =
  | 'googledrive'
  | 'googlecalendar'
  | 'gmail'
  | 'dropbox'
  | 'sharepoint'
  | 'microsoftteams';

/**
 * 커넥터 설정
 */
export interface ConnectorConfig {
  /** 고유 ID */
  id: string;
  /** 커넥터 타입 */
  type: ConnectorType;
  /** OpenAI 빌트인 커넥터 ID (type === 'builtin'일 때) */
  builtinId?: BuiltinConnectorId;
  /** 표시 이름 */
  label: string;
  /** 설명 */
  description?: string;
  /** 서비스 아이콘 (emoji 또는 URL) */
  icon?: string;
  /** 활성화 여부 (사용자 토글) */
  enabled: boolean;
  /** 인증 토큰 존재 여부 */
  hasToken: boolean;
  /** 토큰 만료 시간 (Unix timestamp, 있는 경우) */
  tokenExpiresAt?: number;
}

/**
 * 지원되는 빌트인 커넥터 목록
 */
export const BUILTIN_CONNECTORS: Omit<ConnectorConfig, 'enabled' | 'hasToken'>[] = [
  {
    id: 'googledrive',
    type: 'builtin',
    builtinId: 'googledrive',
    label: 'Google Drive',
    description: 'Google Drive 파일 검색 및 접근',
    icon: '📁',
  },
  {
    id: 'googlecalendar',
    type: 'builtin',
    builtinId: 'googlecalendar',
    label: 'Google Calendar',
    description: 'Google Calendar 일정 조회',
    icon: '📅',
  },
  {
    id: 'gmail',
    type: 'builtin',
    builtinId: 'gmail',
    label: 'Gmail',
    description: 'Gmail 이메일 검색 및 읽기',
    icon: '✉️',
  },
  {
    id: 'dropbox',
    type: 'builtin',
    builtinId: 'dropbox',
    label: 'Dropbox',
    description: 'Dropbox 파일 검색 및 접근',
    icon: '📦',
  },
  {
    id: 'sharepoint',
    type: 'builtin',
    builtinId: 'sharepoint',
    label: 'SharePoint',
    description: 'Microsoft SharePoint 문서 검색',
    icon: '📊',
  },
  {
    id: 'microsoftteams',
    type: 'builtin',
    builtinId: 'microsoftteams',
    label: 'Microsoft Teams',
    description: 'Teams 채널 및 메시지 검색',
    icon: '💬',
  },
];

/**
 * MCP 커넥터 목록 (Rust 네이티브)
 */
export const MCP_CONNECTORS: Omit<ConnectorConfig, 'enabled' | 'hasToken'>[] = [
  {
    id: 'atlassian',
    type: 'mcp',
    label: 'Atlassian Confluence',
    description: 'Confluence 페이지 검색 및 조회',
    icon: '🔗',
  },
  {
    id: 'notion',
    type: 'mcp',
    label: 'Notion',
    description: 'Notion 페이지 및 데이터베이스 검색',
    icon: '📝',
  },
];

/**
 * OpenAI Responses API tools 배열에 추가할 빌트인 커넥터 도구 생성
 * 
 * @param connectorId - 커넥터 ID (예: 'googledrive')
 * @param accessToken - OAuth 액세스 토큰
 * @returns OpenAI tools 배열에 추가할 객체
 */
export function buildBuiltinConnectorTool(
  connectorId: BuiltinConnectorId,
  accessToken: string
): Record<string, unknown> {
  return {
    type: 'connector',
    connector_id: `connector_${connectorId}`,
    authorization: {
      type: 'bearer',
      token: accessToken,
    },
  };
}

/**
 * 활성화된 빌트인 커넥터 목록에서 OpenAI tools 배열 생성
 * 
 * @param configs - 커넥터 설정 목록
 * @param getToken - 커넥터 ID로 토큰을 가져오는 함수
 * @returns OpenAI tools 배열에 추가할 객체 배열
 */
export async function buildConnectorTools(
  configs: ConnectorConfig[],
  getToken: (connectorId: string) => Promise<string | null>
): Promise<Record<string, unknown>[]> {
  const tools: Record<string, unknown>[] = [];

  for (const config of configs) {
    // 빌트인 커넥터만 처리 (MCP는 별도 처리)
    if (config.type !== 'builtin' || !config.enabled || !config.hasToken) {
      continue;
    }

    const token = await getToken(config.id);
    if (!token) {
      console.warn(`[Connector] No token for ${config.id}, skipping`);
      continue;
    }

    if (config.builtinId) {
      tools.push(buildBuiltinConnectorTool(config.builtinId, token));
    }
  }

  return tools;
}

/**
 * 커넥터 상태 요약 정보
 */
export interface ConnectorSummary {
  /** 활성화된 커넥터 수 */
  enabledCount: number;
  /** 인증된 커넥터 수 */
  authenticatedCount: number;
  /** 사용 가능한 커넥터 (활성화 + 인증됨) */
  availableConnectors: string[];
}

/**
 * 커넥터 상태 요약 생성
 */
export function getConnectorSummary(configs: ConnectorConfig[]): ConnectorSummary {
  const enabled = configs.filter(c => c.enabled);
  const authenticated = configs.filter(c => c.hasToken);
  const available = configs.filter(c => c.enabled && c.hasToken);

  return {
    enabledCount: enabled.length,
    authenticatedCount: authenticated.length,
    availableConnectors: available.map(c => c.id),
  };
}

