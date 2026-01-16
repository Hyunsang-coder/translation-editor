import { invoke } from "@tauri-apps/api/core";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createNotionTools, hasNotionToken, setNotionToken, clearNotionToken } from "../tools/notionTools";
import { clearAllMcpServer } from "@/tauri/mcpRegistry";

export interface McpConnectionStatus {
  isConnected: boolean;
  isConnecting: boolean;
  error?: string | null;
  serverName?: string | null;
  /** 키체인에 저장된 유효한 토큰이 있는지 여부 */
  hasStoredToken?: boolean;
  /** 토큰 만료까지 남은 시간 (초), 토큰이 없으면 undefined */
  tokenExpiresIn?: number | null;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface McpContent {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
}

interface McpToolResult {
  content: McpContent[];
  isError: boolean;
}

/**
 * MCP 도구를 LangChain DynamicStructuredTool로 변환
 */
function createLangChainTool(mcpTool: McpTool): DynamicStructuredTool {
  // inputSchema를 zod 스키마로 변환
  const zodSchema = jsonSchemaToZod(mcpTool.inputSchema);

  return new DynamicStructuredTool({
    name: mcpTool.name,
    description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
    schema: zodSchema,
    func: async (args: Record<string, unknown>) => {
      try {
        const result = await invoke<McpToolResult>("mcp_call_tool", {
          name: mcpTool.name,
          arguments: args,
        });

        if (result.isError) {
          throw new Error(result.content.map(c => c.text || "").join("\n"));
        }

        // 결과를 텍스트로 변환
        return result.content
          .map(c => {
            if (c.type === "text") return c.text || "";
            if (c.type === "image") return `[Image: ${c.mimeType}]`;
            return JSON.stringify(c);
          })
          .join("\n");
      } catch (error) {
        throw new Error(`MCP tool call failed: ${error}`);
      }
    },
  });
}

/**
 * JSON Schema를 Zod 스키마로 변환
 */
function jsonSchemaToZod(schema: unknown): z.ZodObject<Record<string, z.ZodTypeAny>> {
  if (typeof schema !== "object" || schema === null) {
    return z.object({});
  }

  const s = schema as Record<string, unknown>;

  if (s.type === "object" && typeof s.properties === "object") {
    const props = s.properties as Record<string, { type?: string; description?: string }>;
    const required = (s.required as string[]) || [];
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, prop] of Object.entries(props)) {
      let fieldSchema: z.ZodTypeAny;

      if (prop.type === "string") {
        fieldSchema = z.string();
      } else if (prop.type === "number" || prop.type === "integer") {
        fieldSchema = z.number();
      } else if (prop.type === "boolean") {
        fieldSchema = z.boolean();
      } else if (prop.type === "array") {
        // z.any() would drop "items" in JSON schema; use unknown to keep it valid.
        fieldSchema = z.array(z.unknown());
      } else {
        fieldSchema = z.any();
      }

      if (prop.description) {
        fieldSchema = fieldSchema.describe(prop.description);
      }

      // required가 아니면 optional로
      if (!required.includes(key)) {
        fieldSchema = fieldSchema.optional();
      }

      shape[key] = fieldSchema;
    }

    return z.object(shape);
  }

  return z.object({});
}

/** MCP 서버 ID */
export type McpServerId = 'atlassian' | 'notion';

/**
 * MCP 클라이언트 매니저
 * 
 * Rust 네이티브 MCP 클라이언트를 사용합니다.
 * Node.js 의존성 없이 MCP 서버에 직접 연결합니다.
 * - Atlassian: SSE transport + OAuth 2.1 PKCE
 * - Notion: REST API 직접 호출 (MCP 대신)
 * 
 * 토큰은 OS 키체인에 영속화되어 앱 재시작 후에도 유지됩니다.
 */
class McpClientManager {
  private _status: McpConnectionStatus = { isConnected: false, isConnecting: false };
  private _notionStatus: McpConnectionStatus = { isConnected: false, isConnecting: false };
  private statusListeners: ((status: McpConnectionStatus) => void)[] = [];
  private notionStatusListeners: ((status: McpConnectionStatus) => void)[] = [];
  private toolsCache: DynamicStructuredTool[] = [];
  private notionToolsCache: DynamicStructuredTool[] = [];
  private initialized = false;
  private isAtlassianStatusPolling = false;
  private lastAtlassianConnectAttemptAt: number | null = null;

  // Singleton Instance
  private static instance: McpClientManager;

  private constructor() {
    // 생성 시에는 상태 동기화만 수행 (자동 연결은 별도 호출)
  }

  public static getInstance(): McpClientManager {
    if (!McpClientManager.instance) {
      McpClientManager.instance = new McpClientManager();
    }
    return McpClientManager.instance;
  }

  /**
   * 앱 시작 시 호출: 저장된 인증 정보 확인 및 자동 연결
   * 키체인에 유효한 토큰이 있으면 자동으로 MCP 서버에 연결합니다.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    try {
      // Atlassian: 저장된 토큰 상태 확인
      const status = await invoke<McpConnectionStatus>("mcp_check_auth");
      this.updateStatus(status);

      console.log("[McpClientManager] Auth check:", {
        hasStoredToken: status.hasStoredToken,
        tokenExpiresIn: status.tokenExpiresIn,
      });

      // 유효한 토큰이 있으면 자동 연결
      if (status.hasStoredToken && !status.isConnected) {
        console.log("[McpClientManager] Found stored token, auto-connecting...");
        await this.connectAtlassian();
      }

      // Notion: 토큰 존재 여부 확인 및 자동 연결
      const notionHasToken = await hasNotionToken();
      console.log("[McpClientManager] Notion token check:", { hasStoredToken: notionHasToken });

      if (notionHasToken) {
        // Notion은 REST API이므로 토큰이 있으면 바로 사용 가능
        // 자동으로 "연결됨" 상태로 설정
        this.notionToolsCache = createNotionTools();
        this.updateNotionStatus({
          isConnected: true,
          isConnecting: false,
          hasStoredToken: true,
          serverName: "Notion",
        });
        console.log("[McpClientManager] Notion auto-connected (token found in vault)");
      } else {
        this.updateNotionStatus({ hasStoredToken: false });
      }

    } catch (error) {
      console.error("[McpClientManager] Initialize failed:", error);
      // 초기화 실패해도 앱은 계속 동작
    }
  }

  /**
   * Rust 백엔드에서 현재 상태 동기화
   */
  private async syncStatus(): Promise<void> {
    try {
      const status = await invoke<McpConnectionStatus>("mcp_get_status");
      this.updateStatus(status);
    } catch (error) {
      console.error("[McpClientManager] Failed to sync status:", error);
    }
  }

  private async pollAtlassianStatusUntilSettled(): Promise<void> {
    if (this.isAtlassianStatusPolling) {
      return;
    }
    this.isAtlassianStatusPolling = true;

    const timeoutMs = 60000;
    const intervalMs = 1000;
    const startedAt = Date.now();

    try {
      while (Date.now() - startedAt < timeoutMs) {
        await this.syncStatus();
        if (!this._status.isConnecting) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }

      await this.syncStatus();
      if (this._status.isConnecting) {
        this.updateStatus({ isConnecting: false });
      }
    } finally {
      this.isAtlassianStatusPolling = false;
    }
  }

  /**
   * Atlassian MCP 서버에 연결 (Rust 네이티브)
   * OAuth 2.1 인증이 필요한 경우 브라우저에서 인증 플로우를 시작합니다.
   */
  async connectAtlassian(): Promise<void> {
    await this.syncStatus();
    if (this._status.isConnected) {
      console.warn("[McpClientManager] Already connected");
      return;
    }
    if (this._status.isConnecting) {
      const now = Date.now();
      if (this.lastAtlassianConnectAttemptAt && now - this.lastAtlassianConnectAttemptAt < 10000) {
        void this.pollAtlassianStatusUntilSettled();
        return;
      }
      // Stale connecting state; allow a fresh attempt.
      this.updateStatus({ isConnecting: false });
    }

    this.lastAtlassianConnectAttemptAt = Date.now();
    this.updateStatus({ isConnecting: true, error: null });

    try {
      await invoke("mcp_connect");

      // 도구 목록 미리 로드
      await this.loadTools();

      await this.syncStatus();
      if (this._status.isConnecting) {
        void this.pollAtlassianStatusUntilSettled();
      }
      console.log("[McpClientManager] Connected to Atlassian MCP (Rust native)");

    } catch (error) {
      console.error("[McpClientManager] Connection failed:", error);
      this.updateStatus({
        isConnected: false,
        isConnecting: false,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * 연결 해제
   */
  async disconnect(): Promise<void> {
    try {
      await invoke("mcp_disconnect");
      this.toolsCache = [];
      this.lastAtlassianConnectAttemptAt = null;
      await this.syncStatus();
    } catch (error) {
      console.error("[McpClientManager] Disconnect error:", error);
    }
  }

  /**
   * 로그아웃 (토큰 삭제 포함)
   * 키체인에서 저장된 토큰을 삭제하고 연결을 해제합니다.
   */
  async logout(): Promise<void> {
    try {
      await invoke("mcp_logout");
      this.toolsCache = [];
      await this.syncStatus();
      console.log("[McpClientManager] Logged out, token deleted from keychain");
    } catch (error) {
      console.error("[McpClientManager] Logout error:", error);
    }
  }

  /**
   * Atlassian 완전 초기화 (토큰 + 클라이언트 정보 모두 삭제)
   * Client ID mismatch 등 복구 불가능한 상태일 때 사용합니다.
   */
  async clearAllAtlassian(): Promise<void> {
    try {
      await this.disconnect();
      await clearAllMcpServer("atlassian");
      await this.syncStatus();
      console.log("[McpClientManager] Atlassian cleared all credentials");
    } catch (error) {
      console.error("[McpClientManager] Clear all Atlassian failed:", error);
    }
  }

  /**
   * 저장된 토큰이 있는지 확인
   */
  hasStoredToken(): boolean {
    return this._status.hasStoredToken ?? false;
  }

  /**
   * 토큰 만료까지 남은 시간 (초)
   */
  getTokenExpiresIn(): number | null {
    return this._status.tokenExpiresIn ?? null;
  }

  /**
   * 도구 목록 로드
   */
  private async loadTools(): Promise<void> {
    try {
      const mcpTools = await invoke<McpTool[]>("mcp_get_tools");
      this.toolsCache = mcpTools.map(tool => createLangChainTool(tool));
      console.log(`[McpClientManager] Loaded ${this.toolsCache.length} tools`);
    } catch (error) {
      console.error("[McpClientManager] Failed to load tools:", error);
      this.toolsCache = [];
    }
  }

  /**
   * LangChain 호환 도구 목록 가져오기
   */
  async getTools(): Promise<DynamicStructuredTool[]> {
    if (!this._status.isConnected) {
      return [];
    }

    // 캐시가 비어있으면 다시 로드
    if (this.toolsCache.length === 0) {
      await this.loadTools();
    }

    return this.toolsCache;
  }

  subscribe(listener: (status: McpConnectionStatus) => void): () => void {
    this.statusListeners.push(listener);
    listener(this._status);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== listener);
    };
  }

  getStatus(): McpConnectionStatus {
    return { ...this._status };
  }

  private updateStatus(newStatus: Partial<McpConnectionStatus>) {
    this._status = { ...this._status, ...newStatus };
    this.statusListeners.forEach(listener => listener(this._status));
  }

  // ============================================================================
  // Notion REST API 관련 메서드 (MCP 대신 직접 API 호출)
  // ============================================================================

  /**
   * Notion Integration Token 저장
   */
  async setNotionToken(token: string): Promise<void> {
    try {
      await setNotionToken(token);
      this.updateNotionStatus({ hasStoredToken: true, error: null });
      console.log("[McpClientManager] Notion token saved");
    } catch (error) {
      console.error("[McpClientManager] Failed to set Notion token:", error);
      throw error;
    }
  }

  /**
   * Notion "연결" - 실제로는 토큰 검증만 수행
   * REST API 방식이므로 별도의 연결 과정이 없음
   */
  async connectNotion(): Promise<void> {
    if (this._notionStatus.isConnected || this._notionStatus.isConnecting) {
      console.warn("[McpClientManager] Notion already connected or connecting");
      return;
    }

    this.updateNotionStatus({ isConnecting: true, error: null });

    try {
      // 토큰 존재 여부 확인
      const hasToken = await hasNotionToken();
      if (!hasToken) {
        throw new Error("No Notion token. Please set your Integration Token first.");
      }

      // 도구 생성
      this.notionToolsCache = createNotionTools();

      this.updateNotionStatus({
        isConnected: true,
        isConnecting: false,
        hasStoredToken: true,
        serverName: "Notion",
      });
      console.log("[McpClientManager] Notion connected (REST API mode)");

    } catch (error) {
      console.error("[McpClientManager] Notion connection failed:", error);
      this.updateNotionStatus({
        isConnected: false,
        isConnecting: false,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Notion 연결 해제
   */
  async disconnectNotion(): Promise<void> {
    this.notionToolsCache = [];
    this.updateNotionStatus({
      isConnected: false,
      isConnecting: false,
      serverName: null,
    });
    console.log("[McpClientManager] Notion disconnected");
  }

  /**
   * Notion 로그아웃 (토큰 삭제 포함)
   */
  async logoutNotion(): Promise<void> {
    try {
      await clearNotionToken();
      this.notionToolsCache = [];
      this.updateNotionStatus({
        isConnected: false,
        isConnecting: false,
        hasStoredToken: false,
        serverName: null,
      });
      console.log("[McpClientManager] Notion logged out, token deleted from keychain");
    } catch (error) {
      console.error("[McpClientManager] Notion logout error:", error);
    }
  }

  /**
   * Notion 완전 초기화 (토큰 + 클라이언트 정보 모두 삭제)
   */
  async clearAllNotion(): Promise<void> {
    try {
      await this.disconnectNotion();
      await clearAllMcpServer("notion");
      // Notion은 REST API 방식이므로 syncStatus 대신 직접 상태 업데이트
      this.updateNotionStatus({
        isConnected: false,
        isConnecting: false,
        hasStoredToken: false,
        serverName: null,
        error: null,
      });
      console.log("[McpClientManager] Notion cleared all credentials");
    } catch (error) {
      console.error("[McpClientManager] Clear all Notion failed:", error);
    }
  }

  /**
   * Notion LangChain 호환 도구 목록 가져오기
   */
  async getNotionTools(): Promise<DynamicStructuredTool[]> {
    // 토큰이 있으면 도구 사용 가능
    const hasToken = await hasNotionToken();
    if (!hasToken) {
      return [];
    }

    // 캐시가 비어있으면 생성
    if (this.notionToolsCache.length === 0) {
      this.notionToolsCache = createNotionTools();
    }

    return this.notionToolsCache;
  }

  /**
   * 모든 연결된 MCP 서버의 도구 목록 가져오기
   */
  async getAllTools(): Promise<DynamicStructuredTool[]> {
    const atlassianTools = await this.getTools();
    const notionTools = await this.getNotionTools();
    return [...atlassianTools, ...notionTools];
  }

  /**
   * Notion 상태 구독
   */
  subscribeNotion(listener: (status: McpConnectionStatus) => void): () => void {
    this.notionStatusListeners.push(listener);
    listener(this._notionStatus);
    return () => {
      this.notionStatusListeners = this.notionStatusListeners.filter(l => l !== listener);
    };
  }

  /**
   * Notion 상태 조회
   */
  getNotionStatus(): McpConnectionStatus {
    return { ...this._notionStatus };
  }

  /**
   * Notion 저장된 토큰이 있는지 확인
   */
  hasNotionStoredToken(): boolean {
    return this._notionStatus.hasStoredToken ?? false;
  }

  private updateNotionStatus(newStatus: Partial<McpConnectionStatus>) {
    this._notionStatus = { ...this._notionStatus, ...newStatus };
    this.notionStatusListeners.forEach(listener => listener(this._notionStatus));
  }
}

export const mcpClientManager = McpClientManager.getInstance();
