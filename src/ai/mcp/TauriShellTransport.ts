import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { Command, Child } from "@tauri-apps/plugin-shell";

/**
 * Tauri Shell Plugin을 사용하여 로컬 프로세스(npx 등)와 통신하는 MCP Transport 구현체
 */
export class TauriShellTransport implements Transport {
  private child: Child | null = null;
  private buffer: string = "";
  
  public onmessage?: (message: JSONRPCMessage) => void;
  public onclose?: () => void;
  public onerror?: (error: Error) => void;

  constructor(
    private command: string,
    private args: string[] = [],
    private env: Record<string, string> = {}
  ) {}

  async start(): Promise<void> {
    try {
      // Command 생성 및 환경변수 설정
      const cmd = Command.create(this.command, this.args, {
        env: this.env,
        encoding: 'utf-8', // 텍스트 모드
      });

      // 자식 프로세스 stdout 이벤트 리스너
      cmd.stdout.on('data', (line: string) => {
        this.handleData(line);
      });

      // 자식 프로세스 stderr 이벤트 리스너 (로그용)
      cmd.stderr.on('data', (line: string) => {
        console.warn(`[MCP Stderr] ${line}`);
      });

      // 자식 프로세스 종료 이벤트 리스너
      cmd.on('close', (data: { code: number; signal: number }) => {
        console.log(`[MCP] Process exited with code ${data.code}`);
        if (this.onclose) {
          this.onclose();
        }
      });

      // 자식 프로세스 에러 이벤트 리스너
      cmd.on('error', (error: unknown) => {
        console.error(`[MCP] Process error:`, error);
        if (this.onerror) {
          this.onerror(error instanceof Error ? error : new Error(String(error)));
        }
      });

      // 프로세스 실행
      this.child = await cmd.spawn();
      console.log(`[MCP] Process spawned: ${this.command} ${this.args.join(' ')}`);

    } catch (error) {
      console.error("[MCP] Failed to spawn process:", error);
      throw error;
    }
  }

  /**
   * JSON-RPC 메시지 전송 (stdin)
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.child) {
      throw new Error("Transport not started");
    }

    try {
      const json = JSON.stringify(message);
      // Tauri Shell의 write는 기본적으로 newline을 추가하지 않으므로 명시적으로 추가
      await this.child.write(json + "\n");
    } catch (error) {
      console.error("[MCP] Failed to send message:", error);
      if (this.onerror) {
        this.onerror(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * 연결 종료 및 프로세스 Kill
   */
  async close(): Promise<void> {
    if (this.child) {
      try {
        await this.child.kill();
        console.log("[MCP] Process killed");
      } catch (error) {
        console.error("[MCP] Failed to kill process:", error);
      } finally {
        this.child = null;
        if (this.onclose) {
          this.onclose();
        }
      }
    }
  }

  /**
   * stdout 데이터 처리 (JSON-RPC 메시지 파싱)
   * Tauri Shell은 라인 단위로 데이터를 줄 수도 있고, 조각낼 수도 있음.
   * 하지만 `Command`의 `stdout.on`은 기본적으로 라인 단위 처리를 보장하지 않을 수 있으므로
   * 버퍼링을 통해 완전한 JSON 객체를 추출해야 함.
   * 
   * (단, MCP stdio는 보통 라인 단위 JSON-RPC를 사용)
   */
  private handleData(chunk: string) {
    this.buffer += chunk;

    // 라인 단위로 분리 (Windows \r\n 대응)
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line) {
        try {
          const message = JSON.parse(line) as JSONRPCMessage;
          if (this.onmessage) {
            this.onmessage(message);
          }
        } catch (error) {
          // JSON 파싱 실패 시, 아직 완전한 메시지가 아니거나 로그일 수 있음
          // MCP 프로토콜은 엄격한 JSON-RPC 형식을 따르므로, 파싱 에러는 무시하거나 경고
          console.debug("[MCP] Non-JSON output received:", line);
        }
      }
    }
  }
}

