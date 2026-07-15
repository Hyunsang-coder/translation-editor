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
        "Use this before glossary entry tools when you need a glossaryId. " +
        "Requires an active project. Returns { ok, projectId, projectGlossaries, glossaries }.",
      inputSchema: {
        projectId: z.string().optional(),
      },
    },
    async ({ projectId }) =>
      textResult(await callBridge("oddeyes.listProjectGlossaries", { projectId })),
  );

  server.registerTool(
    "oddeyes_list_glossary_entries",
    {
      description:
        "List entries in a glossary (optional text query). " +
        "Defaults to limit=100 (max 500); check `truncated` / `total` if the list is capped. " +
        "Requires glossaryId and an active project. " +
        "Returns { ok, projectId, glossaryId, query, limit, total, truncated, entries }.",
      inputSchema: {
        projectId: z.string().optional(),
        glossaryId: z.string().describe("Glossary to list entries from."),
        query: z.string().optional()
          .describe("Optional search filter (source/target substring, server-side)."),
        limit: z.number().int().positive().optional()
          .describe("Max entries to return (default 100, max 500)."),
      },
    },
    async ({ projectId, glossaryId, query, limit }) =>
      textResult(await callBridge("oddeyes.listGlossaryEntries", {
        projectId,
        glossaryId,
        query,
        limit,
      })),
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

  server.registerTool(
    "oddeyes_update_glossary_entry",
    {
      description:
        "Update an existing glossary entry (source → target). " +
        "Requires glossaryId, entryId, source, and target. Irreversible overwrite of those fields. " +
        "Use oddeyes_list_glossary_entries first to obtain entryId. " +
        "Returns { ok, entry, glossaryId }.",
      inputSchema: {
        projectId: z.string().optional(),
        glossaryId: z.string(),
        entryId: z.string(),
        source: z.string().describe("Updated source-language term."),
        target: z.string().describe("Updated preferred translation."),
        notes: z.string().optional(),
        caseSensitive: z.boolean().optional(),
      },
    },
    async ({ projectId, glossaryId, entryId, source, target, notes, caseSensitive }) =>
      textResult(await callBridge("oddeyes.updateGlossaryEntry", {
        projectId,
        glossaryId,
        entryId,
        source,
        target,
        notes,
        caseSensitive,
      })),
  );

  server.registerTool(
    "oddeyes_delete_glossary_entry",
    {
      description:
        "Permanently delete a glossary entry. No undo. " +
        "Requires glossaryId and entryId. Use oddeyes_list_glossary_entries first. " +
        "Returns { ok, glossaryId, entryId, projectId }.",
      inputSchema: {
        projectId: z.string().optional(),
        glossaryId: z.string(),
        entryId: z.string(),
      },
    },
    async ({ projectId, glossaryId, entryId }) =>
      textResult(await callBridge("oddeyes.deleteGlossaryEntry", {
        projectId,
        glossaryId,
        entryId,
      })),
  );

  server.registerTool(
    "oddeyes_link_project_glossary",
    {
      description:
        "Link an existing library glossary to the active project (incremental; does not replace other links). " +
        "Idempotent if already linked. Use oddeyes_list_project_glossaries to discover glossaryId. " +
        "Returns { ok, projectId, glossaryId, alreadyLinked, projectGlossaries }.",
      inputSchema: {
        projectId: z.string().optional(),
        glossaryId: z.string(),
      },
    },
    async ({ projectId, glossaryId }) =>
      textResult(await callBridge("oddeyes.linkProjectGlossary", { projectId, glossaryId })),
  );

  server.registerTool(
    "oddeyes_unlink_project_glossary",
    {
      description:
        "Unlink a glossary from the active project without deleting the library glossary. " +
        "Idempotent if already unlinked. Returns { ok, projectId, glossaryId, alreadyUnlinked, projectGlossaries }.",
      inputSchema: {
        projectId: z.string().optional(),
        glossaryId: z.string(),
      },
    },
    async ({ projectId, glossaryId }) =>
      textResult(await callBridge("oddeyes.unlinkProjectGlossary", { projectId, glossaryId })),
  );
}
