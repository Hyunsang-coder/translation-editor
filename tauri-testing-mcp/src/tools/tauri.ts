import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerTauriTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    "tauri_invoke",
    {
      description: "Call a registered Tauri command via invoke.",
      inputSchema: {
        command: z.string(),
        args: z.record(z.unknown()).optional(),
        label: z.string().optional(),
      },
    },
    async ({ command, args, label }) => textResult(await callBridge("tauri.invoke", { command, args, label })),
  );

  server.registerTool(
    "tauri_emit",
    {
      description: "Emit an event in the Tauri app from WebView context.",
      inputSchema: {
        event: z.string(),
        payload: z.unknown().optional(),
        label: z.string().optional(),
      },
    },
    async ({ event, payload, label }) => textResult(await callBridge("tauri.emit", { event, payload, label })),
  );
}
