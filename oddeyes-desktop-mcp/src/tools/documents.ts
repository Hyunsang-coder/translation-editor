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
    async ({ content, filePath, format }) =>
      textResult(await callBridge("oddeyes.setSourceDocument", { content, filePath, format })),
  );

  server.registerTool(
    "oddeyes_load_confluence_page",
    {
      description:
        "Load a Confluence page into the OddEyes source (original) editor panel. " +
        "Fetches the page in ADF format, converts it to TipTap JSON, and sets it as the source document. " +
        "Requires Atlassian OAuth to be connected in OddEyes Settings. " +
        "After loading, use oddeyes_get_source_document to read the loaded content.",
      inputSchema: {
        pageUrl: z
          .string()
          .describe(
            "Full Confluence page URL (e.g. https://your-domain.atlassian.net/wiki/spaces/SPACE/pages/123456/Page+Title)",
          ),
      },
    },
    async ({ pageUrl }) => textResult(await callBridge("oddeyes.loadConfluencePage", { pageUrl })),
  );
}
