import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerPreviewTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    "oddeyes_set_translation_preview",
    {
      description: "Save a translation or revision into OddEyes preview without applying it.",
      inputSchema: {
        content: z.union([z.string(), z.record(z.unknown())]),
        format: z.enum(["markdown", "tiptap_json"]).optional(),
        sourceRevision: z.string().optional(),
        targetRevision: z.string().optional(),
        title: z.string().optional(),
        summary: z.string().optional(),
        intent: z.enum(["translate", "revise", "review_fix", "external"]).optional(),
      },
    },
    async ({ content, format, sourceRevision, targetRevision, title, summary, intent }) =>
      textResult(await callBridge("oddeyes.setTranslationPreview", {
        content,
        format,
        sourceRevision,
        targetRevision,
        title,
        summary,
        intent,
      })),
  );

  server.registerTool(
    "oddeyes_get_translation_preview",
    {
      description: "Get the current OddEyes translation preview.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => textResult(await callBridge("oddeyes.getTranslationPreview")),
  );

  server.registerTool(
    "oddeyes_apply_translation_preview",
    {
      description: "Apply the current OddEyes translation preview to the target document.",
      inputSchema: {},
    },
    async () => textResult(await callBridge("oddeyes.applyTranslationPreview")),
  );

  server.registerTool(
    "oddeyes_discard_translation_preview",
    {
      description: "Discard the current OddEyes translation preview.",
      inputSchema: {},
    },
    async () => textResult(await callBridge("oddeyes.discardTranslationPreview")),
  );
}
