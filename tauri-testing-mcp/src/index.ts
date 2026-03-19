import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TauriBridgeClient } from "./client/websocket.js";
import { registerDomTools } from "./tools/dom.js";
import { registerTauriTools } from "./tools/tauri.js";
import { registerWindowTools } from "./tools/window.js";
import { registerAppTools } from "./tools/app.js";
import { registerOddEyesTools } from "./tools/oddeyes.js";

const port = Number(process.env.TAURI_TEST_PORT ?? "9876");
const token = process.env.TAURI_TEST_TOKEN ?? "tauri-testing-token";

const bridge = new TauriBridgeClient(port, token);

async function callBridge(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  await bridge.connect();
  return await bridge.request(method, params);
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "tauri-testing",
    version: "0.1.0",
  });

  registerDomTools(server, callBridge);
  registerTauriTools(server, callBridge);
  registerWindowTools(server, callBridge);
  registerAppTools(server, callBridge);
  registerOddEyesTools(server, callBridge);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await bridge.disconnect().catch(() => undefined);
    await server.close().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch((error) => {
  console.error("[tauri-testing-mcp] failed to start", error);
  process.exit(1);
});
