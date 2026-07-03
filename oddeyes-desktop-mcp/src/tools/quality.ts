import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

/**
 * 품질 장부 도구 (설계서 §4.7 #1/#2).
 * 에이전트가 mono-review 판정(채택·반려 포함)을 앱 장부에 기록하고, 마이닝을 위해 조회한다.
 */
export function registerQualityTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  // §4.1 quality_record 스키마 (교환 포맷). id·created_at·project_id는 앱이 발급하므로 생략.
  const segmentSchema = z.object({
    source: z.string().nullable(),
    output: z.string(),
    corrected: z.string().nullable(),
    context: z.string().nullable(),
  });
  const findingSchema = z.object({
    type: z.string().describe("통합 오류 유형 (§4.2). 예: accuracy.omission, fluency.collocation"),
    severity: z.enum(["critical", "major", "minor"]),
    description: z.string(),
    suggested_fix: z.string().nullable(),
  });
  const originSchema = z.object({
    stage: z
      .string()
      .describe("s0_preflight | s1_translate | s2_polish | s3_verify | s4_consistency | manual_edit"),
    caught_by: z.string().nullable(),
    executor: z.enum(["app", "claude_agent", "human"]),
    producer_model: z.string().nullable(),
    reviewer_model: z.string().nullable(),
  });
  const promotionSchema = z.object({
    status: z.enum(["candidate", "promoted", "rejected", "not_applicable"]),
    matched_rule: z.string().nullable(),
  });
  const recordSchema = z.object({
    doc_ref: z.string().nullable().optional(),
    route_id: z.string().nullable().optional(),
    direction: z.enum(["ko_to_en", "en_to_ko"]).nullable().optional(),
    content_type: z.string().nullable().optional(),
    segment: segmentSchema,
    finding: findingSchema,
    origin: originSchema,
    disposition: z.enum(["proposed", "accepted", "rejected", "superseded"]),
    promotion: promotionSchema,
  });

  server.registerTool(
    "oddeyes_log_quality_records",
    {
      description:
        "Append quality-ledger records (§4.1) to the OddEyes SQLite ledger. " +
        "Use this to record mono-review verdicts — INCLUDING rejected ones (a rejected finding is data: " +
        "it captures reviewer false-positive patterns). The app issues id/created_at and returns the saved count. " +
        "Map axis→unified type (§4.2) and red/yellow→severity (§4.3) before sending. " +
        "Recording is best-effort — a push failure must not block translation delivery.",
      inputSchema: {
        projectId: z.string().optional(),
        records: z.array(recordSchema),
      },
    },
    async ({ projectId, records }) =>
      textResult(await callBridge("oddeyes.logQualityRecords", { projectId, records })),
  );

  server.registerTool(
    "oddeyes_get_quality_records",
    {
      description:
        "Query the OddEyes quality ledger with filters (since, stage, disposition, promotionStatus, limit). " +
        "Input for mining/promotion analysis (§4.7 #2). Returns { count, records } with full §4.1 records.",
      inputSchema: {
        projectId: z.string().optional(),
        filter: z
          .object({
            since: z.number().optional().describe("epoch ms; only records at/after this time"),
            stage: z.string().optional(),
            disposition: z
              .enum(["proposed", "accepted", "rejected", "superseded"])
              .optional(),
            promotionStatus: z
              .enum(["candidate", "promoted", "rejected", "not_applicable"])
              .optional(),
            limit: z.number().optional(),
          })
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, filter }) =>
      textResult(await callBridge("oddeyes.getQualityRecords", { projectId, filter })),
  );
}
