import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OddEyesBridgeClient } from "./client/websocket.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerPreviewTools } from "./tools/preview.js";

const port = Number(process.env.ODDEYES_BRIDGE_PORT ?? "9966");
const token = process.env.ODDEYES_BRIDGE_TOKEN ?? "oddeyes-bridge-token";

const bridge = new OddEyesBridgeClient(port, token);

async function callBridge(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  await bridge.connect();
  return await bridge.request(method, params);
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "oddeyes-desktop",
    version: "0.1.0",
  });

  registerDocumentTools(server, callBridge);
  registerPreviewTools(server, callBridge);

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
  console.error("[oddeyes-desktop-mcp] failed to start", error);
  process.exit(1);
});
