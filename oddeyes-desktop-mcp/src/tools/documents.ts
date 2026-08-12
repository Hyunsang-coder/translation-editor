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
      description:
        "Get the current OddEyes project/document status and revisions. " +
        "`targetLanguage` is the *resolved* direction: when the project is set to Auto it is derived " +
        "from the source document (Korean source → English target, and vice versa), and it is null " +
        "only when neither the setting nor the source settles it. " +
        "`projectMemoryRevision` bumps whenever project memory or forbidden terms change — " +
        "re-read oddeyes_get_translation_context when it moves. Memory counts are null until the " +
        "app has loaded project knowledge (not the same as zero).",
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
      description:
        "Get everything OddEyes would put in front of the model for this project: translation rules, " +
        "active project memory items, enabled forbidden terms, and glossary matches for the current " +
        "source document. Read this before translating or reviewing so your output matches what the " +
        "app itself would produce. " +
        "Returns { projectId, projectTitle, targetLanguage, translationRules, projectMemory, " +
        "forbiddenTerms, revision, glossary }.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => textResult(await callBridge("oddeyes.getTranslationContext")),
  );

}
