import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TauriShellTransport } from "./TauriShellTransport";
import { Tool } from "@langchain/core/tools";
import { resolveResource } from "@tauri-apps/api/path";

export interface McpConnectionStatus {
  isConnected: boolean;
  isConnecting: boolean;
  error?: string | null;
  serverName?: string | null;
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
   * MCP 프록시 번들 경로를 가져옵니다.
   * 개발 환경과 배포 환경 모두 지원합니다.
   */
  private async getMcpProxyPath(): Promise<string> {
    try {
      // Tauri 리소스 경로 해석 (배포 환경)
      return await resolveResource("resources/mcp-proxy.cjs");
    } catch {
      // 개발 환경: src-tauri/resources/mcp-proxy.cjs
      // resolveResource가 실패하면 개발 환경으로 가정
      console.log("[McpClientManager] Using development path for mcp-proxy");
      return "src-tauri/resources/mcp-proxy.cjs";
    }
  }

  /**
   * Atlassian Rovo MCP 서버에 연결 (OAuth via mcp-remote)
   */
  async connectAtlassian(): Promise<void> {
    if (this._status.isConnected || this._status.isConnecting) {
      console.warn("[McpClientManager] Already connected or connecting");
      return;
    }

    this.updateStatus({ isConnecting: true, error: null });

    try {
      // MCP 프록시 번들 경로 가져오기
      const proxyPath = await this.getMcpProxyPath();
      console.log("[McpClientManager] Using MCP proxy at:", proxyPath);

      // 동적 임포트로 Node.js 의존성 격리 (빌드 에러 방지)
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

      // 1. Transport 생성
      // node 명령어로 번들된 mcp-proxy.cjs 실행
      // 장점: pkg 바이너리화 문제 회피, npx 없이 직접 실행
      this.transport = new TauriShellTransport(
        "node", 
        [proxyPath, "https://mcp.atlassian.com/v1/sse"], 
        {}
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
        serverName: "Atlassian"
      });

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
      this.updateStatus({ isConnected: false, isConnecting: false, serverName: null });
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
      // 동적 임포트
      const { loadMcpTools } = await import("@langchain/mcp-adapters");
      
      // serverName 인자가 필요하며(첫 번째), 반환 타입 캐스팅 필요
      // Atlassian MCP 서버 이름은 보통 'atlassian' 또는 'rovo'로 가정
      const tools = await loadMcpTools("atlassian", this.client);
      return tools as unknown as Tool[];
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
