import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { loadMcpTools } from "@langchain/mcp-adapters";
import { TauriShellTransport } from "./TauriShellTransport";
import { Tool } from "@langchain/core/tools";

export interface AtlassianConfig {
  email: string;
  apiToken: string;
  instanceUrl: string;
}

export interface McpConnectionStatus {
  isConnected: boolean;
  isConnecting: boolean;
  error?: string;
  serverName?: string;
}

class McpClientManager {
  private client: Client | null = null;
  private transport: TauriShellTransport | null = null;
  private _status: McpConnectionStatus = { isConnected: false, isConnecting: false };
  private statusListeners: ((status: McpConnectionStatus) => void)[] = [];

  // Singleton Instance
  private static instance: McpClientManager;

  private constructor() {}

  public static getInstance(): McpClientManager {
    if (!McpClientManager.instance) {
      McpClientManager.instance = new McpClientManager();
    }
    return McpClientManager.instance;
  }

  /**
   * Atlassian MCP 서버에 연결
   */
  async connectAtlassian(config: AtlassianConfig): Promise<void> {
    if (this._status.isConnected || this._status.isConnecting) {
      console.warn("[McpClientManager] Already connected or connecting");
      return;
    }

    this.updateStatus({ isConnecting: true, error: undefined });

    try {
      // 1. Transport 생성 (npx @modelcontextprotocol/server-atlassian)
      // 주의: Windows에서는 npx.cmd 일 수 있으나, Tauri Shell scope에서 npx로 설정했으므로 npx로 시도
      this.transport = new TauriShellTransport(
        "npx", 
        ["-y", "@modelcontextprotocol/server-atlassian"], 
        {
          ATLASSIAN_EMAIL: config.email,
          ATLASSIAN_API_TOKEN: config.apiToken,
          ATLASSIAN_INSTANCE_URL: config.instanceUrl
        }
      );

      // 2. Client 초기화
      this.client = new Client(
        {
          name: "ite-atlassian-client",
          version: "0.1.0",
        },
        {
          capabilities: {
            sampling: {},
          },
        }
      );

      // 3. 연결 시작
      await this.client.connect(this.transport);
      console.log("[McpClientManager] Connected to Atlassian MCP");

      this.updateStatus({ isConnected: true, isConnecting: false, serverName: "Atlassian" });

    } catch (error) {
      console.error("[McpClientManager] Connection failed:", error);
      this.disconnect(); // 정리
      this.updateStatus({ 
        isConnected: false, 
        isConnecting: false, 
        error: error instanceof Error ? error.message : "Failed to connect to MCP server" 
      });
      throw error;
    }
  }

  /**
   * 연결 해제
   */
  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
      }
      if (this.transport) {
        await this.transport.close();
      }
    } catch (error) {
      console.error("[McpClientManager] Disconnect error:", error);
    } finally {
      this.client = null;
      this.transport = null;
      this.updateStatus({ isConnected: false, isConnecting: false, serverName: undefined });
    }
  }

  /**
   * LangChain 호환 도구 목록 가져오기
   */
  async getTools(): Promise<Tool[]> {
    if (!this.client || !this._status.isConnected) {
      return [];
    }

    try {
      // @langchain/mcp-adapters의 loadMcpTools 사용
      // Client 인스턴스를 그대로 넘겨서 도구 변환
      // 참고: loadMcpTools의 첫 번째 인자는 ClientSession 인터페이스를 기대함.
      // @modelcontextprotocol/sdk의 Client 클래스는 내부적으로 세션을 관리하지만,
      // loadMcpTools가 요구하는 타입과 Client 타입이 정확히 일치하는지 확인 필요.
      // 
      // 만약 타입 불일치가 발생하면 수동 변환 로직이 필요할 수 있음.
      // 일단 시도해보고, 안되면 listTools() 결과를 직접 변환.
      
      const tools = await loadMcpTools(this.client);
      return tools;

    } catch (error) {
      console.error("[McpClientManager] Failed to load tools:", error);
      return [];
    }
  }

  /**
   * 상태 구독
   */
  subscribe(listener: (status: McpConnectionStatus) => void): () => void {
    this.statusListeners.push(listener);
    listener(this._status); // 초기 상태 전달
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== listener);
    };
  }

  /**
   * 현재 상태 반환
   */
  getStatus(): McpConnectionStatus {
    return { ...this._status };
  }

  private updateStatus(newStatus: Partial<McpConnectionStatus>) {
    this._status = { ...this._status, ...newStatus };
    this.statusListeners.forEach(listener => listener(this._status));
  }
}

export const mcpClientManager = McpClientManager.getInstance();

