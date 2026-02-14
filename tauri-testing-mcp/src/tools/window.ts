import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerWindowTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    "tauri_window_get_title",
    {
      description: "Get window title.",
      inputSchema: { label: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ label }) => textResult(await callBridge("window.getTitle", { label })),
  );

  server.registerTool(
    "tauri_window_get_size",
    {
      description: "Get window size.",
      inputSchema: { label: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ label }) => textResult(await callBridge("window.getSize", { label })),
  );

  server.registerTool(
    "tauri_window_set_size",
    {
      description: "Set window size.",
      inputSchema: {
        width: z.number().positive(),
        height: z.number().positive(),
        label: z.string().optional(),
      },
    },
    async ({ width, height, label }) => textResult(await callBridge("window.setSize", { width, height, label })),
  );

  server.registerTool(
    "tauri_window_list",
    {
      description: "List current webview windows.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => textResult(await callBridge("window.list")),
  );

  server.registerTool(
    "tauri_window_maximize",
    {
      description: "Maximize a window.",
      inputSchema: { label: z.string().optional() },
    },
    async ({ label }) => textResult(await callBridge("window.maximize", { label })),
  );

  server.registerTool(
    "tauri_window_minimize",
    {
      description: "Minimize a window.",
      inputSchema: { label: z.string().optional() },
    },
    async ({ label }) => textResult(await callBridge("window.minimize", { label })),
  );

  server.registerTool(
    "tauri_window_close",
    {
      description: "Close a window.",
      inputSchema: { label: z.string().optional() },
    },
    async ({ label }) => textResult(await callBridge("window.close", { label })),
  );

  server.registerTool(
    "tauri_window_screenshot",
    {
      description: "Take screenshot using local screencapture (macOS).",
      inputSchema: {
        path: z.string().optional(),
      },
    },
    async ({ path }) => textResult(await callBridge("window.screenshot", { path })),
  );
}
