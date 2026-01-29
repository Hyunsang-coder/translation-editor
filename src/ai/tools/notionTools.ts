/**
 * Notion REST API LangChain 도구
 *
 * Notion 페이지 검색, 조회 등을 AI 채팅에서 사용할 수 있게 합니다.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";

// 최대 출력 크기 상수
const MAX_TOOL_OUTPUT_CHARS = 8000;

// 큰 결과 자동 트렁케이션
function truncateToolOutput(content: string, maxChars = MAX_TOOL_OUTPUT_CHARS): string {
  if (content.length <= maxChars) return content;
  
  const marker = '\n...[truncated]...\n';
  const budget = maxChars - marker.length;
  const head = content.slice(0, Math.floor(budget * 0.7));
  const tail = content.slice(-Math.floor(budget * 0.3));
  return `${head}${marker}${tail}`;
}

// Notion API 응답 스키마 정의
const NotionRichTextSchema = z.object({
  plain_text: z.string(),
}).passthrough();

const NotionTitlePropertySchema = z.object({
  type: z.literal("title"),
  title: z.array(NotionRichTextSchema),
}).passthrough();

const NotionSearchResultItemSchema = z.object({
  id: z.string(),
  object: z.enum(["page", "database"]),
  url: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
  title: z.array(NotionRichTextSchema).optional(),
}).passthrough();

const NotionSearchResponseSchema = z.object({
  results: z.array(NotionSearchResultItemSchema),
}).passthrough();

/**
 * 에러 메시지에서 민감한 정보 제거
 * @param error 원본 에러
 * @returns 살균된 에러 메시지
 */
function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // 토큰, 키, 시크릿 관련 정보 제거
    return error.message
      .replace(/token[=:]\s*['"]?[^\s'"]+['"]?/gi, 'token=[REDACTED]')
      .replace(/key[=:]\s*['"]?[^\s'"]+['"]?/gi, 'key=[REDACTED]')
      .replace(/secret[=:]\s*['"]?[^\s'"]+['"]?/gi, 'secret=[REDACTED]')
      .replace(/bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
      .replace(/ntn_[a-zA-Z0-9_]+/g, '[REDACTED_TOKEN]')
      .replace(/secret_[a-zA-Z0-9_]+/g, '[REDACTED_TOKEN]');
  }
  return "알 수 없는 오류가 발생했습니다.";
}

/**
 * Notion 검색 도구 생성
 */
export function createNotionSearchTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "notion_search",
    description:
      "Search for pages and databases in the connected Notion workspace. " +
      "Use this to find Notion content by keywords. " +
      "Returns a list of matching pages/databases with their IDs and titles.",
    schema: z.object({
      query: z.string().describe("Search query (keywords to find)"),
      filter: z
        .enum(["page", "database"])
        .optional()
        .describe("Filter by object type: 'page' for pages only, 'database' for databases only"),
    }),
    func: async ({ query, filter }) => {
      try {
        const result = await invoke<string>("notion_search", {
          query,
          filter,
          pageSize: 10,
        });

        // 결과를 파싱하고 스키마 검증
        const rawParsed = JSON.parse(result);
        const parseResult = NotionSearchResponseSchema.safeParse(rawParsed);

        if (!parseResult.success) {
          console.warn("Notion API 응답 스키마 불일치:", parseResult.error.message);
          return "Notion 응답을 처리할 수 없습니다. 응답 형식이 예상과 다릅니다.";
        }

        const parsed = parseResult.data;
        if (!parsed.results || parsed.results.length === 0) {
          return "No results found in Notion for the given query.";
        }

        const formatted = parsed.results.map((item, index: number) => {
          const title = extractTitle(item);
          const type = item.object === "database" ? "📊 Database" : "📄 Page";
          return `${index + 1}. ${type}: ${title}\n   ID: ${item.id}\n   URL: ${item.url || "N/A"}`;
        });

        return `Found ${parsed.results.length} result(s) in Notion:\n\n${formatted.join("\n\n")}`;
      } catch (error) {
        throw new Error(`Notion 검색 실패: ${sanitizeErrorMessage(error)}`);
      }
    },
  });
}

/**
 * Notion 페이지 내용 조회 도구 생성
 */
export function createNotionGetPageTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "notion_get_page",
    description:
      "Get the content of a specific Notion page. " +
      "Use this after searching to read the full content of a page. " +
      "Accepts either a page ID or a Notion URL.",
    schema: z.object({
      pageId: z.string().describe("Notion page ID or URL (e.g., 'abc123...' or 'https://notion.so/...')"),
    }),
    func: async ({ pageId }) => {
      try {
        const content = await invoke<string>("notion_get_page_content", {
          pageId,
          asText: true,
        });

        if (!content || content.trim() === "") {
          return "The page appears to be empty or the content could not be retrieved.";
        }

        return truncateToolOutput(`Notion Page Content:\n\n${content}`);
      } catch (error) {
        throw new Error(`Notion 페이지 조회 실패: ${sanitizeErrorMessage(error)}`);
      }
    },
  });
}

/**
 * Notion 데이터베이스 쿼리 도구 생성
 */
export function createNotionQueryDatabaseTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "notion_query_database",
    description:
      "Query a Notion database to get its entries. " +
      "Use this to retrieve items from a Notion database. " +
      "Accepts a database ID or URL.",
    schema: z.object({
      databaseId: z.string().describe("Notion database ID or URL"),
    }),
    func: async ({ databaseId }) => {
      try {
        const result = await invoke<string>("notion_query_database", {
          databaseId,
          filter: null,
          pageSize: 20,
        });

        // 결과를 파싱하고 스키마 검증
        const rawParsed = JSON.parse(result);
        const parseResult = NotionSearchResponseSchema.safeParse(rawParsed);

        if (!parseResult.success) {
          console.warn("Notion API 응답 스키마 불일치:", parseResult.error.message);
          return "Notion 응답을 처리할 수 없습니다. 응답 형식이 예상과 다릅니다.";
        }

        const parsed = parseResult.data;
        if (!parsed.results || parsed.results.length === 0) {
          return "The database is empty or no entries match the query.";
        }

        const formatted = parsed.results.map((item, index: number) => {
          const title = extractTitle(item);
          return `${index + 1}. ${title}\n   ID: ${item.id}`;
        });

        return `Database entries (${parsed.results.length} items):\n\n${formatted.join("\n\n")}`;
      } catch (error) {
        throw new Error(`Notion 데이터베이스 쿼리 실패: ${sanitizeErrorMessage(error)}`);
      }
    },
  });
}

/**
 * Notion 검색 결과에서 제목 추출
 */
function extractTitle(item: z.infer<typeof NotionSearchResultItemSchema>): string {
  // 페이지 properties에서 Title 타입 속성 찾기
  if (item.properties) {
    for (const [, value] of Object.entries(item.properties)) {
      // 안전한 타입 검증
      const propResult = NotionTitlePropertySchema.safeParse(value);
      if (propResult.success && propResult.data.title.length > 0) {
        return propResult.data.title.map((t) => t.plain_text).join("");
      }
    }
  }

  // 데이터베이스의 경우 title 필드 확인
  if (item.title && item.title.length > 0) {
    return item.title.map((t) => t.plain_text).join("");
  }

  return "(Untitled)";
}

/**
 * 모든 Notion 도구 생성
 */
export function createNotionTools(): DynamicStructuredTool[] {
  return [
    createNotionSearchTool(),
    createNotionGetPageTool(),
    createNotionQueryDatabaseTool(),
  ];
}

/**
 * Notion 토큰 존재 여부 확인
 */
export async function hasNotionToken(): Promise<boolean> {
  try {
    return await invoke<boolean>("notion_has_token");
  } catch {
    return false;
  }
}

/**
 * Notion 토큰 설정
 */
export async function setNotionToken(token: string): Promise<void> {
  await invoke("notion_set_token", { token });
}

/**
 * Notion 토큰 삭제
 */
export async function clearNotionToken(): Promise<void> {
  await invoke("notion_clear_token");
}

