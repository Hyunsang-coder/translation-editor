import { invoke } from "@tauri-apps/api/core";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

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
        fieldSchema = z.array(z.any());
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

/**
 * MCP 클라이언트 매니저
 * 
 * Rust 네이티브 MCP SSE 클라이언트를 사용합니다.
 * Node.js 의존성 없이 Atlassian MCP 서버에 직접 연결합니다.
 * 
 * OAuth 토큰은 OS 키체인에 영속화되어 앱 재시작 후에도 유지됩니다.
 */
class McpClientManager {
  private _status: McpConnectionStatus = { isConnected: false, isConnecting: false };
  private statusListeners: ((status: McpConnectionStatus) => void)[] = [];
  private toolsCache: DynamicStructuredTool[] = [];
  private initialized = false;

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
      // 저장된 토큰 상태 확인
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

  /**
   * Atlassian MCP 서버에 연결 (Rust 네이티브)
   * OAuth 2.1 인증이 필요한 경우 브라우저에서 인증 플로우를 시작합니다.
   */
  async connectAtlassian(): Promise<void> {
    if (this._status.isConnected || this._status.isConnecting) {
      console.warn("[McpClientManager] Already connected or connecting");
      return;
    }

    this.updateStatus({ isConnecting: true, error: null });

    try {
      await invoke("mcp_connect");
      
      // 도구 목록 미리 로드
      await this.loadTools();
      
      await this.syncStatus();
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
}

export const mcpClientManager = McpClientManager.getInstance();
