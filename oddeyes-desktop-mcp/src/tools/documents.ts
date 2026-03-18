import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerDocumentTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    "oddeyes_get_status",
    {
      description: "Get the current OddEyes project/document status and revisions.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => textResult(await callBridge("oddeyes.getStatus")),
  );

  server.registerTool(
    "oddeyes_get_source_document",
    {
      description: "Read the current source document from OddEyes.",
      inputSchema: {
        format: z.enum(["markdown", "tiptap_json"]).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ format }) => textResult(await callBridge("oddeyes.getSource", { format })),
  );

  server.registerTool(
    "oddeyes_get_target_document",
    {
      description: "Read the current target document from OddEyes.",
      inputSchema: {
        format: z.enum(["markdown", "tiptap_json"]).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ format }) => textResult(await callBridge("oddeyes.getTarget", { format })),
  );

  server.registerTool(
    "oddeyes_get_translation_context",
    {
      description: "Get translation rules, glossary, persona, and project context from OddEyes.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => textResult(await callBridge("oddeyes.getTranslationContext")),
  );
}
