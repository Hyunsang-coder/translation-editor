import WebSocket from "ws";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface RpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class TauriBridgeClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(
    private readonly port: number,
    private readonly token: string,
  ) {}

  async connect(timeoutMs = 10_000): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
      this.ws = ws;
      let settled = false;

      const timeout = setTimeout(() => {
        settled = true;
        ws.close();
        reject(new Error("WebSocket connection timeout"));
      }, timeoutMs);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", token: this.token }));
      };

      ws.onmessage = (event: { data: unknown }) => {
        const data = event.data;
        const raw = String(data);
        try {
          const parsed = JSON.parse(raw) as RpcResponse | { type: string; message?: string };

          if ((parsed as { type?: string }).type === "auth_ok") {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve();
            return;
          }

          if ((parsed as { type?: string }).type === "error") {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(new Error((parsed as { message?: string }).message ?? "auth failed"));
            return;
          }

          this.handleRpcResponse(parsed as RpcResponse);
        } catch {
          // Ignore non-JSON payloads.
        }
      };

      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error("WebSocket error"));
      };

      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
        }
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error("WebSocket closed during connect"));
        }
        this.rejectAllPending(new Error("WebSocket closed"));
      };
    });
  }

  async request(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Bridge is not connected");
    }

    const id = this.nextId++;

    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout for method: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      this.ws?.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        }),
      );
    });
  }

  async disconnect(): Promise<void> {
    if (!this.ws) {
      return;
    }

    const ws = this.ws;
    this.ws = null;

    await new Promise<void>((resolve) => {
      ws.onclose = () => resolve();
      ws.close();
    });

    this.rejectAllPending(new Error("Bridge disconnected"));
  }

  private handleRpcResponse(msg: RpcResponse): void {
    if (typeof msg.id !== "number") {
      return;
    }

    const pending = this.pending.get(msg.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(`RPC ${msg.error.code}: ${msg.error.message}`));
      return;
    }

    pending.resolve(msg.result);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
