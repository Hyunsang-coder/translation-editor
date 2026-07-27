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
        "Update the OddEyes translation rules — the standing style/tone/format instructions applied " +
        "to every translation, review, and polish. " +
        "mode='replace' (default) overwrites the field; mode='append' adds your text to the end " +
        "(semicolon-separated items become bullet points). " +
        "Requires an active project. To read the current value first, use oddeyes_get_translation_context. " +
        "For project facts (domain, audience, worldbuilding, decisions) use " +
        "oddeyes_add_project_memory_item instead — the legacy free-text `projectContext` field is no " +
        "longer injected into prompts and is not accepted here. " +
        "Returns { ok, mode, updated } where `updated` lists the fields actually changed.",
      inputSchema: {
        projectId: z.string().optional(),
        translationRules: z.string().optional(),
        mode: z.enum(["replace", "append"]).optional(),
      },
    },
    async ({ projectId, translationRules, mode }) =>
      textResult(await callBridge("oddeyes.setTranslationContext", {
        projectId, translationRules, mode,
      })),
  );
}
