import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { loadMcpTools } from "@langchain/mcp-adapters";
import { TauriShellTransport } from "./TauriShellTransport";
import { Tool } from "@langchain/core/tools";
import { invoke } from "@tauri-apps/api/core";

export interface AtlassianConfig {
  email: string;
  apiToken: string;
  instanceUrl: string;
}

export interface McpServerRow {
  id: string;
  name: string;
  server_type: string;
  config_json: string;
  is_enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface McpConnectionStatus {
  isConnected: boolean;
  isConnecting: boolean;
  error?: string;
  serverName?: string;
  config?: AtlassianConfig; // 현재 연결된 설정 정보 (UI 복원용)
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
   * 저장된 서버 목록을 로드하고, 활성화된 Atlassian 서버가 있으면 자동 연결 시도
   */
  async loadAndConnectSavedServers(): Promise<void> {
    try {
      const servers = await invoke<McpServerRow[]>("list_mcp_servers");
      const atlassianServer = servers.find(s => s.name === "Atlassian" && s.is_enabled);

      if (atlassianServer) {
        try {
          const config = JSON.parse(atlassianServer.config_json) as AtlassianConfig;
          if (config.email && config.apiToken && config.instanceUrl) {
            console.log("[McpClientManager] Auto-connecting to saved Atlassian server...");
            await this.connectAtlassian(config, false); // false = DB 저장은 하지 않음 (이미 있으니까)
          }
        } catch (e) {
          console.error("[McpClientManager] Failed to parse saved config:", e);
        }
      }
    } catch (error) {
      console.error("[McpClientManager] Failed to load saved servers:", error);
    }
  }

  /**
   * Atlassian MCP 서버에 연결
   * @param saveToDb 연결 성공 시 DB에 설정 저장 여부
   */
  async connectAtlassian(config: AtlassianConfig, saveToDb: boolean = true): Promise<void> {
    if (this._status.isConnected || this._status.isConnecting) {
      console.warn("[McpClientManager] Already connected or connecting");
      return;
    }

    this.updateStatus({ isConnecting: true, error: undefined });

    try {
      // 1. Transport 생성 (atlassian-mcp 패키지 사용)
      this.transport = new TauriShellTransport(
        "npx", 
        ["-y", "atlassian-mcp"], 
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

      this.updateStatus({ 
        isConnected: true, 
        isConnecting: false, 
        serverName: "Atlassian",
        config: config
      });

      // 4. DB 저장 (옵션)
      if (saveToDb) {
        await this.saveServerToDb("Atlassian", "stdio", config);
      }

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
      
      // DB에서 비활성화 처리 (선택 사항: 연결 해제 시 설정을 삭제할지, 비활성화할지. 여기서는 비활성화 업데이트)
      // 하지만 MVP에서는 단순히 현재 세션만 끊는 것으로 처리하고, 
      // 명시적으로 "설정 삭제" 버튼을 두는 것이 나을 수도 있음.
      // 일단은 연결만 끊습니다.
      
    } catch (error) {
      console.error("[McpClientManager] Disconnect error:", error);
    } finally {
      this.client = null;
      this.transport = null;
      this.updateStatus({ isConnected: false, isConnecting: false, serverName: undefined });
    }
  }

  /**
   * 서버 설정을 DB에 저장
   */
  private async saveServerToDb(name: string, type: string, config: any): Promise<void> {
    try {
      // 기존 서버 ID 확인을 위해 목록 조회
      const servers = await invoke<McpServerRow[]>("list_mcp_servers");
      const existing = servers.find(s => s.name === name);

      await invoke("save_mcp_server", {
        name,
        serverType: type,
        configJson: JSON.stringify(config),
        isEnabled: true,
        id: existing?.id // 기존 ID가 있으면 업데이트
      });
      console.log("[McpClientManager] Server config saved to DB");
    } catch (error) {
      console.error("[McpClientManager] Failed to save server config:", error);
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
      const tools = await loadMcpTools(this.client);
      return tools;
    } catch (error) {
      console.error("[McpClientManager] Failed to load tools:", error);
      return [];
    }
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
