import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

const MEMORY_CATEGORIES = [
  "domain",
  "audience",
  "product",
  "worldbuilding",
  "character",
  "intent",
  "decision",
  "reference_fact",
  "general",
] as const;

/**
 * Project Memory / 금칙어 도구.
 *
 * OddEyes는 v2.13.0부터 자유 서술형 "project context" 대신 승인된 Project Memory 항목과
 * 금칙어 목록을 프롬프트 근거로 쓴다. 이 도구들이 그 저장소에 대한 외부 접근 경로다.
 * 쓰기는 source='import', status='active'로 즉시 반영되며, 사용자는 앱 Settings의
 * 프로젝트 메모리 목록에서 출처를 확인하고 보관(archive)할 수 있다.
 */
export function registerProjectMemoryTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    "oddeyes_list_project_memory",
    {
      description:
        "List the active project's memory items and forbidden terms. " +
        "Project memory holds durable facts about the project (domain, audience, product, " +
        "worldbuilding, characters, intent, decisions, reference facts) that OddEyes injects into " +
        "translation, review, polishing, and chat. " +
        "Defaults to status='active' (what the app actually uses); pass 'all' to audit archived items. " +
        "Use this before adding memory to avoid duplicates and to obtain ids for replace/archive. " +
        "Returns { ok, projectId, revision, total, truncated, items, forbiddenTerms }.",
      inputSchema: {
        projectId: z.string().optional(),
        status: z.enum(["active", "proposed", "archived", "all"]).optional()
          .describe("Filter by item status. Default 'active'."),
        category: z.enum(MEMORY_CATEGORIES).optional(),
        query: z.string().optional()
          .describe("Case-insensitive substring filter on item content."),
        limit: z.number().int().positive().optional()
          .describe("Max items to return (default 100, max 500)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, status, category, query, limit }) =>
      textResult(await callBridge("oddeyes.listProjectMemory", {
        projectId,
        status,
        category,
        query,
        limit,
      })),
  );

  server.registerTool(
    "oddeyes_add_project_memory_item",
    {
      description:
        "Add a durable project memory item. It takes effect immediately in the app's translation, " +
        "review, polishing, and chat prompts, and is stored with source='import' so the user can see " +
        "where it came from and archive it in Settings → Project Memory. " +
        "Write ONE self-contained fact per item — not a paragraph of mixed notes; items are selected " +
        "and capped per workflow, so a long blob crowds out other knowledge. " +
        "Duplicate content is deduplicated by the app: check `duplicate` in the response. " +
        "Use oddeyes_list_project_memory first to avoid near-duplicates. " +
        "For per-term preferences use the glossary tools; for banned wording use " +
        "oddeyes_upsert_forbidden_term. Returns { ok, item, revision, duplicate }.",
      inputSchema: {
        projectId: z.string().optional(),
        category: z.enum(MEMORY_CATEGORIES).optional()
          .describe("Defaults to 'general'."),
        content: z.string().describe("One self-contained fact (required)."),
      },
    },
    async ({ projectId, category, content }) =>
      textResult(await callBridge("oddeyes.addProjectMemoryItem", {
        projectId,
        category,
        content,
      })),
  );

  server.registerTool(
    "oddeyes_replace_project_memory_item",
    {
      description:
        "Replace an existing project memory item with corrected content. " +
        "The old item is archived (kept for provenance) and a new active item supersedes it. " +
        "Requires targetItemId from oddeyes_list_project_memory. Category defaults to the old item's. " +
        "Returns { ok, archived, item, revision }.",
      inputSchema: {
        projectId: z.string().optional(),
        targetItemId: z.string().describe("Id of the item being superseded."),
        content: z.string().describe("Corrected content (required)."),
        category: z.enum(MEMORY_CATEGORIES).optional(),
      },
    },
    async ({ projectId, targetItemId, content, category }) =>
      textResult(await callBridge("oddeyes.replaceProjectMemoryItem", {
        projectId,
        targetItemId,
        content,
        category,
      })),
  );

  server.registerTool(
    "oddeyes_archive_project_memory_item",
    {
      description:
        "Archive a project memory item so it stops being injected into prompts. " +
        "The item is kept in the ledger (not deleted) and remains visible in Settings. " +
        "Requires itemId from oddeyes_list_project_memory. Returns { ok, item, revision }.",
      inputSchema: {
        projectId: z.string().optional(),
        itemId: z.string(),
      },
    },
    async ({ projectId, itemId }) =>
      textResult(await callBridge("oddeyes.archiveProjectMemoryItem", { projectId, itemId })),
  );

  server.registerTool(
    "oddeyes_upsert_forbidden_term",
    {
      description:
        "Create or update a forbidden term for the active project. Forbidden terms are a global " +
        "constraint: OddEyes applies them to full translation, review, polishing, and partial " +
        "re-translation alike. Provide `replacement` with the wording to use instead whenever one exists — " +
        "a ban without an alternative gives the model nowhere to go. " +
        "Omit `id` to create; pass an id from oddeyes_list_project_memory to update (including " +
        "toggling `enabled` off, which keeps the row but stops applying it). " +
        "Returns { ok, term, revision }.",
      inputSchema: {
        projectId: z.string().optional(),
        id: z.string().optional().describe("Existing term id. Omit to create a new term."),
        term: z.string().describe("The wording to avoid (required)."),
        replacement: z.string().optional().describe("Preferred wording to use instead."),
        note: z.string().optional().describe("Why it is banned — shown to the model."),
        enabled: z.boolean().optional().describe("Default true."),
      },
    },
    async ({ projectId, id, term, replacement, note, enabled }) =>
      textResult(await callBridge("oddeyes.upsertForbiddenTerm", {
        projectId,
        id,
        term,
        replacement,
        note,
        enabled,
      })),
  );

  server.registerTool(
    "oddeyes_delete_forbidden_term",
    {
      description:
        "Permanently delete a forbidden term. No undo — to stop applying a term while keeping it, " +
        "call oddeyes_upsert_forbidden_term with enabled=false instead. " +
        "Requires an id from oddeyes_list_project_memory. Returns { ok, id, revision }.",
      inputSchema: {
        projectId: z.string().optional(),
        id: z.string(),
      },
    },
    async ({ projectId, id }) =>
      textResult(await callBridge("oddeyes.deleteForbiddenTerm", { projectId, id })),
  );
}
