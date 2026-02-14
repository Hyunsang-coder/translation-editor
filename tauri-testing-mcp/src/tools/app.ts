import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerAppTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    "tauri_app_ping",
    {
      description: "Ping the testing bridge.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => textResult(await callBridge("app.ping")),
  );

  server.registerTool(
    "tauri_app_quit",
    {
      description: "Quit the running Tauri app.",
      inputSchema: {},
    },
    async () => textResult(await callBridge("app.quit")),
  );
}
