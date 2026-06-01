import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerContextTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    "oddeyes_set_translation_context",
    {
      description:
        "Update the OddEyes translation context: translatorPersona, translationRules, and/or projectContext. " +
        "Only the fields you provide are changed (omit a field to leave it untouched). " +
        "mode='replace' (default) overwrites the field; mode='append' adds your text to the end " +
        "(semicolon-separated items become bullet points). " +
        "Requires an active project. To read the current values first, use oddeyes_get_translation_context. " +
        "Returns { ok, mode, updated } where `updated` lists the fields actually changed.",
      inputSchema: {
        projectId: z.string().optional(),
        translatorPersona: z.string().optional(),
        translationRules: z.string().optional(),
        projectContext: z.string().optional(),
        mode: z.enum(["replace", "append"]).optional(),
      },
    },
    async ({ projectId, translatorPersona, translationRules, projectContext, mode }) =>
      textResult(await callBridge("oddeyes.setTranslationContext", {
        projectId, translatorPersona, translationRules, projectContext, mode,
      })),
  );
}
