import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OddEyesBridgeClient } from "./client/websocket.js";

const BRIDGE_INFO_PATH_ENV = "ODDEYES_BRIDGE_INFO_PATH";

interface BridgeRuntimeInfo {
  bridgePort: number;
  bridgeToken: string;
  updatedAt?: string;
}

function defaultBridgeInfoPath(): string {
  const home = os.homedir();

  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "com.oddeyes.desktop", "desktop-mcp", "runtime", "bridge.json");
    case "win32":
      return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "com.oddeyes.desktop", "desktop-mcp", "runtime", "bridge.json");
    default:
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "com.oddeyes.desktop", "desktop-mcp", "runtime", "bridge.json");
  }
}

function fallbackBridgeRuntimeInfo(): BridgeRuntimeInfo | null {
  const bridgePort = Number(process.env.ODDEYES_BRIDGE_PORT ?? "");
  const bridgeToken = process.env.ODDEYES_BRIDGE_TOKEN ?? "";

  if (!Number.isFinite(bridgePort) || bridgePort <= 0 || bridgeToken.length === 0) {
    return null;
  }

  return {
    bridgePort,
    bridgeToken,
  };
}

export class OddEyesBridgeRuntime {
  private bridgeClient: OddEyesBridgeClient | null = null;
  private bridgeKey: string | null = null;
  private readonly bridgeInfoPath: string;

  constructor() {
    this.bridgeInfoPath = process.env[BRIDGE_INFO_PATH_ENV] ?? defaultBridgeInfoPath();
  }

  getBridgeInfoPath(): string {
    return this.bridgeInfoPath;
  }

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    try {
      const client = await this.ensureClient();
      await client.connect();
      return await client.request(method, params);
    } catch (error) {
      await this.resetClient();
      const client = await this.ensureClient();
      await client.connect();
      return await client.request(method, params);
    }
  }

  async disconnect(): Promise<void> {
    await this.resetClient();
  }

  private async ensureClient(): Promise<OddEyesBridgeClient> {
    const runtimeInfo = await this.loadBridgeRuntimeInfo();
    const nextBridgeKey = `${runtimeInfo.bridgePort}:${runtimeInfo.bridgeToken}`;

    if (this.bridgeClient && this.bridgeKey === nextBridgeKey) {
      return this.bridgeClient;
    }

    await this.resetClient();

    this.bridgeClient = new OddEyesBridgeClient(runtimeInfo.bridgePort, runtimeInfo.bridgeToken);
    this.bridgeKey = nextBridgeKey;

    return this.bridgeClient;
  }

  private async resetClient(): Promise<void> {
    if (this.bridgeClient) {
      await this.bridgeClient.disconnect().catch(() => undefined);
    }

    this.bridgeClient = null;
    this.bridgeKey = null;
  }

  private async loadBridgeRuntimeInfo(): Promise<BridgeRuntimeInfo> {
    try {
      const raw = await fs.readFile(this.bridgeInfoPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<BridgeRuntimeInfo>;
      const bridgePort = parsed.bridgePort;
      const bridgeToken = parsed.bridgeToken;

      if (!Number.isFinite(bridgePort) || (bridgePort ?? 0) <= 0) {
        throw new Error("bridgePort is missing or invalid");
      }

      if (typeof bridgeToken !== "string" || bridgeToken.length === 0) {
        throw new Error("bridgeToken is missing or invalid");
      }

      return {
        bridgePort: bridgePort as number,
        bridgeToken,
        updatedAt: parsed.updatedAt,
      };
    } catch (error) {
      const fallback = fallbackBridgeRuntimeInfo();
      if (fallback) {
        return fallback;
      }

      throw new Error(
        `OddEyes bridge metadata is unavailable at ${this.bridgeInfoPath}. Start OddEyes before using the extension.`,
      );
    }
  }
}
