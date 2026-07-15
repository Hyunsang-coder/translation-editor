import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerGlossaryTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    "oddeyes_list_project_glossaries",
    {
      description:
        "List glossaries linked to the active OddEyes project (and the full glossary library). " +
        "Use this before oddeyes_add_glossary_entry when you need a glossaryId. " +
        "Requires an active project. Returns { ok, projectId, projectGlossaries, glossaries }.",
      inputSchema: {
        projectId: z.string().optional(),
      },
    },
    async ({ projectId }) =>
      textResult(await callBridge("oddeyes.listProjectGlossaries", { projectId })),
  );

  server.registerTool(
    "oddeyes_add_glossary_entry",
    {
      description:
        "Add a glossary term (source → target) to the active OddEyes project. " +
        "If glossaryId is omitted, uses the first linked project glossary; if none exist, " +
        "creates one (name from glossaryName or 'Project glossary') and links it. " +
        "Unlinked glossaryId values are auto-linked to the current project so translation/search can use them. " +
        "Requires an active project. Returns { ok, entry, glossaryId, createdGlossary, linkedToProject }.",
      inputSchema: {
        projectId: z.string().optional(),
        glossaryId: z.string().optional()
          .describe("Target glossary id. Omit to use/create the project's default linked glossary."),
        glossaryName: z.string().optional()
          .describe("Used only when creating a new glossary because none are linked."),
        source: z.string().describe("Source-language term (required)."),
        target: z.string().describe("Preferred translation (required)."),
        notes: z.string().optional(),
        caseSensitive: z.boolean().optional(),
      },
    },
    async ({ projectId, glossaryId, glossaryName, source, target, notes, caseSensitive }) =>
      textResult(await callBridge("oddeyes.addGlossaryEntry", {
        projectId,
        glossaryId,
        glossaryName,
        source,
        target,
        notes,
        caseSensitive,
      })),
  );
}
