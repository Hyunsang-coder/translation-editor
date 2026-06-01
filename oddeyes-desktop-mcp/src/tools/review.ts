import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerReviewTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    "oddeyes_set_review_issues",
    {
      description:
        "Push an external translation review (issue list) into the OddEyes review panel. " +
        "Each issue is shown in the review table AND highlighted in the editor. " +
        "CRITICAL for highlighting: `targetExcerpt` MUST be copied VERBATIM (character-for-character) " +
        "from the current target document — do NOT paraphrase, summarize, translate, or reformat it. " +
        "Prefer a short, unique span of ~20-40 characters that appears exactly once. " +
        "If unsure, first read the target via oddeyes_get_target_document. " +
        "The tool returns { count, dropped }: `dropped` counts issues skipped due to empty/unmatchable excerpts — " +
        "if dropped > 0, re-extract those excerpts verbatim and call again.",
      inputSchema: {
        projectId: z.string().optional(),
        issues: z.array(z.object({
          segmentOrder: z.number().optional(),
          segmentGroupId: z.string().optional(),
          sourceExcerpt: z.string(),
          targetExcerpt: z.string()
            .describe("VERBATIM span copied from the target document — used as the highlight search key. No paraphrasing."),
          suggestedFix: z.string().optional(),
          type: z.string(),
          severity: z.string(),
          description: z.string(),
        })),
      },
    },
    async ({ projectId, issues }) =>
      textResult(await callBridge("oddeyes.setReviewIssues", { projectId, issues })),
  );
}
