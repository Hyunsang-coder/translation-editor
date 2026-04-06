/**
 * OddEyes Semantic MCP Tools
 *
 * High-level tools for Claude to interact with OddEyes as a structured
 * translation data layer. These wrap tauri.invoke calls to existing
 * Tauri commands with ergonomic, translation-domain-specific interfaces.
 *
 * Arg format note: Tauri commands that take `args: SomeStruct` require
 * `{ args: { field1, field2 } }` at the IPC level. Commands that take
 * named parameters directly (e.g. `project: IteProject`) use the
 * parameter name as the key.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const errorResult = (message: string) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  isError: true as const,
});

export function registerOddEyesTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  // Helper: invoke a Tauri command through the bridge
  const invoke = (command: string, ipcArgs?: Record<string, unknown>) =>
    callBridge("tauri.invoke", { command, args: ipcArgs });

  // Notify frontend to reload the current project from SQLite
  const notifyProjectChanged = (projectId: string) =>
    callBridge("tauri.emit", {
      event: "oddeyes://project-changed",
      payload: { projectId },
    });

  // ─── 1. project_list ───────────────────────────────────────────────

  server.registerTool(
    "oddeyes_project_list",
    {
      description:
        "List all translation projects in OddEyes. Returns project ID, title, and last updated timestamp for each project.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const result = await invoke("list_recent_projects");
      return textResult(result);
    },
  );

  // ─── 2. project_open ──────────────────────────────────────────────

  server.registerTool(
    "oddeyes_project_open",
    {
      description:
        "Load a translation project by ID. Returns full project structure including metadata (title, domain, languages), segments (source↔target block mappings), and all blocks with their content.",
      inputSchema: {
        projectId: z.string().describe("The project ID to load"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) => {
      const project = await invoke("load_project", { args: { projectId } });
      return textResult(project);
    },
  );

  // ─── 3. document_get_blocks ───────────────────────────────────────

  interface Block {
    id: string;
    blockType: string;
    content: string;
    hash: string;
    metadata: Record<string, unknown>;
  }

  interface Segment {
    groupId: string;
    sourceIds: string[];
    targetIds: string[];
    isAligned: boolean;
    order: number;
  }

  interface Project {
    id: string;
    version: string;
    metadata: Record<string, unknown>;
    segments: Segment[];
    blocks: Record<string, Block>;
  }

  /**
   * Build pre-aligned pairs from segments + blocks.
   * Returns an array sorted by segment order, each containing:
   * - source: { blockId, content } (the text to translate FROM)
   * - target: { blockId, content } (the text to translate INTO — write here)
   *
   * This makes the mapping explicit so the caller never has to
   * figure out which block IDs correspond to which.
   */
  function buildAlignedPairs(project: Project) {
    const sorted = [...project.segments].sort((a, b) => a.order - b.order);
    return sorted.map((seg) => {
      const sourceBlocks = seg.sourceIds
        .map((id) => project.blocks[id])
        .filter(Boolean);
      const targetBlocks = seg.targetIds
        .map((id) => project.blocks[id])
        .filter(Boolean);

      return {
        segmentId: seg.groupId,
        source: sourceBlocks.map((b) => ({
          blockId: b.id,
          content: b.content,
        })),
        target: targetBlocks.map((b) => ({
          blockId: b.id,
          content: b.content,
        })),
      };
    });
  }

  server.registerTool(
    "oddeyes_document_get_blocks",
    {
      description: `Read the translation document as aligned source↔target pairs.

Returns an array of segments, each containing:
- segmentId: unique segment identifier
- source[]: array of {blockId, content} — the original text (DO NOT modify)
- target[]: array of {blockId, content} — the translation (write your translation here)

Content is HTML (TipTap format). When translating:
1. Preserve ALL HTML tags exactly as they appear in the source
2. Only translate the text content between tags
3. Maintain the same number of <p> blocks
4. Write each translated block using oddeyes_document_set_blocks with the target blockId

Example source: "<p>Hello <strong>world</strong></p>"
Correct target: "<p>안녕하세요 <strong>세계</strong></p>"
Wrong target:   "안녕하세요 세계" (missing tags)`,
      inputSchema: {
        projectId: z.string().describe("The project ID"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) => {
      const project = (await invoke("load_project", {
        args: { projectId },
      })) as Project;
      const pairs = buildAlignedPairs(project);
      return textResult(pairs);
    },
  );

  // ─── 4. document_set_blocks ───────────────────────────────────────

  server.registerTool(
    "oddeyes_document_set_blocks",
    {
      description: `Write translated content back to target blocks in OddEyes.

IMPORTANT — structure contract:
- Only write to TARGET block IDs (from oddeyes_document_get_blocks target[].blockId)
- Content MUST be valid HTML matching TipTap format
- Wrap all text in <p> tags: "<p>translated text</p>"
- Preserve inline formatting from source: <strong>, <em>, <code>, <a>, etc.
- Do NOT merge or split blocks — one input blockId = one output content
- Do NOT write to source block IDs

After updating, the OddEyes editor refreshes automatically.`,
      inputSchema: {
        projectId: z.string().describe("The project ID"),
        blocks: z
          .array(
            z.object({
              blockId: z.string().describe("The TARGET block ID to update"),
              content: z
                .string()
                .describe('Translated HTML content (e.g. "<p>번역된 텍스트</p>")'),
            }),
          )
          .describe("Array of target block updates to apply"),
      },
    },
    async ({ projectId, blocks: blockUpdates }) => {
      // Load current project
      const project = (await invoke("load_project", {
        args: { projectId },
      })) as Project;

      // Collect all source block IDs to prevent accidental overwrites
      const sourceBlockIds = new Set<string>();
      for (const seg of project.segments) {
        for (const id of seg.sourceIds) {
          sourceBlockIds.add(id);
        }
      }

      const now = Date.now();
      let updatedCount = 0;
      const warnings: string[] = [];

      for (const { blockId, content } of blockUpdates) {
        // Guard: reject writes to source blocks
        if (sourceBlockIds.has(blockId)) {
          return errorResult(
            `Block "${blockId}" is a SOURCE block — only TARGET blocks can be written. ` +
              `Use the target[].blockId from oddeyes_document_get_blocks.`,
          );
        }

        const existing = project.blocks[blockId];
        if (!existing) {
          return errorResult(`Block "${blockId}" not found in project`);
        }

        // Warn if content doesn't look like valid HTML
        if (!content.includes("<")) {
          warnings.push(
            `Block "${blockId}": content has no HTML tags. ` +
              `Expected TipTap HTML like "<p>text</p>". Got: "${content.slice(0, 50)}"`,
          );
        }

        existing.content = content;
        existing.metadata = { ...existing.metadata, updatedAt: now };
        updatedCount++;
      }

      // Update project timestamp
      project.metadata = { ...project.metadata, updatedAt: now };

      // Save full project
      await invoke("save_project", { project: project as unknown as Record<string, unknown> });

      // Notify frontend to reload from SQLite
      await notifyProjectChanged(projectId).catch(() => undefined);

      return textResult({
        success: true,
        updatedCount,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    },
  );

  // ─── 5. settings_get ──────────────────────────────────────────────

  server.registerTool(
    "oddeyes_settings_get",
    {
      description: `Read translation settings for a project. Returns:
- translatorPersona: system prompt / translator identity description
- translationRules: specific rules for translation (terminology, style, etc.)
- projectContext: background context about the project being translated
- project metadata: domain, target language, glossary paths
Use these to understand how to translate for this project.`,
      inputSchema: {
        projectId: z.string().describe("The project ID"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) => {
      // Load chat project settings (persona, rules, context)
      const chatSettings = await invoke("load_chat_project_settings", {
        args: { projectId },
      });

      // Load project metadata (domain, language, glossary)
      const project = (await invoke("load_project", { args: { projectId } })) as {
        metadata: Record<string, unknown>;
      };

      return textResult({
        chatSettings: chatSettings ?? {
          translatorPersona: "",
          translationRules: "",
          projectContext: "",
        },
        projectMetadata: {
          domain: project.metadata.domain,
          targetLanguage: project.metadata.targetLanguage,
          glossaryPaths: project.metadata.glossaryPaths,
          title: project.metadata.title,
        },
      });
    },
  );

  // ─── 6. glossary_search ───────────────────────────────────────────

  server.registerTool(
    "oddeyes_glossary_search",
    {
      description:
        "Search the project glossary for translation terms. Returns matching entries with source term, target term, notes, and domain. Use this to ensure consistent terminology.",
      inputSchema: {
        projectId: z.string().describe("The project ID"),
        query: z
          .string()
          .describe("Search term (matches against source and target fields)"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max results (default 12, max 50)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, query, limit }) => {
      const result = await invoke("search_glossary", {
        args: { projectId, query, limit: limit ?? 12 },
      });
      return textResult(result);
    },
  );

  // ─── 7. snapshot_create ───────────────────────────────────────────

  server.registerTool(
    "oddeyes_snapshot_create",
    {
      description:
        "Create a named snapshot (version) of the current project state. Use this before and after translation to enable comparison and rollback.",
      inputSchema: {
        projectId: z.string().describe("The project ID"),
        description: z
          .string()
          .describe(
            "Snapshot description (e.g. 'Before translation', 'Claude translation v1')",
          ),
      },
    },
    async ({ projectId, description }) => {
      // Load current project to get blocks
      const project = (await invoke("load_project", { args: { projectId } })) as {
        blocks: Record<string, unknown>;
      };
      const blocksJson = JSON.stringify(project.blocks);

      const snapshotId = await invoke("create_snapshot", {
        args: { projectId, description, blocksJson },
      });

      return textResult({ snapshotId, description });
    },
  );

  // ─── 9. set_source_document ────────────────────────────────────────

  server.registerTool(
    "oddeyes_set_source_document",
    {
      description:
        "Set the source (original) document in the OddEyes editor. " +
        "Supports two input modes: (1) Pass content directly via 'content' parameter, " +
        "or (2) Pass a local file path via 'filePath' for large documents (recommended for ADF). " +
        "Supported formats: 'markdown', 'tiptap_json', 'adf' (Atlassian Document Format).",
      inputSchema: {
        content: z
          .union([z.string(), z.record(z.unknown())])
          .optional()
          .describe("Document content (string for markdown/adf, object for tiptap_json). Use filePath for large documents."),
        filePath: z
          .string()
          .optional()
          .describe("Absolute path to a local file to read. Recommended for large ADF documents to avoid context bloat."),
        format: z
          .enum(["markdown", "tiptap_json", "adf"])
          .optional()
          .describe("Content format. Default: 'markdown'. Use 'adf' for Confluence ADF documents."),
      },
    },
    async ({ content, filePath, format }) => {
      const result = await callBridge("oddeyes.setSourceDocument", { content, filePath, format });
      return textResult(result);
    },
  );

  // ─── 10. load_confluence_page ─────────────────────────────────────

  server.registerTool(
    "oddeyes_load_confluence_page",
    {
      description:
        "Load a Confluence page into the OddEyes source (original) editor panel. " +
        "Fetches the page in ADF format, converts it to TipTap JSON, and sets it as the source document. " +
        "Requires Atlassian OAuth to be connected in OddEyes Settings. " +
        "After loading, use oddeyes_document_get_blocks to read the source content.",
      inputSchema: {
        pageUrl: z
          .string()
          .describe(
            "Full Confluence page URL (e.g. https://your-domain.atlassian.net/wiki/spaces/SPACE/pages/123456/Page+Title)",
          ),
        projectId: z
          .string()
          .optional()
          .describe("Optional: project ID to associate this source with"),
      },
    },
    async ({ pageUrl, projectId }) => {
      const result = await invoke("load_confluence_page_as_source", {
        args: { pageUrl },
      });

      if (projectId) {
        await notifyProjectChanged(projectId).catch(() => undefined);
      }

      return textResult({ success: true, pageUrl, result });
    },
  );

  // ─── 8. snapshot_list ─────────────────────────────────────────────


  server.registerTool(
    "oddeyes_snapshot_list",
    {
      description:
        "List all snapshots (versions) for a project. Returns snapshot ID, description, and creation timestamp for each.",
      inputSchema: {
        projectId: z.string().describe("The project ID"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) => {
      const result = await invoke("list_history", { args: { projectId } });
      return textResult(result);
    },
  );
}
