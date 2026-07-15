#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OddEyesBridgeRuntime } from "./bridgeRuntime.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerPreviewTools } from "./tools/preview.js";
import { registerReviewTools } from "./tools/review.js";
import { registerContextTools } from "./tools/context.js";
import { registerQualityTools } from "./tools/quality.js";
import { registerGlossaryTools } from "./tools/glossary.js";

const transportMode = process.env.ODDEYES_DESKTOP_MCP_TRANSPORT === "http" ? "http" : "stdio";
const httpPort = Number(process.env.ODDEYES_DESKTOP_MCP_PORT ?? "9977");
const httpAuthToken = process.env.ODDEYES_DESKTOP_MCP_AUTH_TOKEN ?? "";
const httpHost = process.env.ODDEYES_DESKTOP_MCP_HOST ?? "127.0.0.1";
const mcpPath = process.env.ODDEYES_DESKTOP_MCP_PATH ?? "/mcp";
const healthPath = process.env.ODDEYES_DESKTOP_MCP_HEALTH_PATH ?? "/health";

const bridgeRuntime = new OddEyesBridgeRuntime();

async function callBridge(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return await bridgeRuntime.call(method, params);
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "oddeyes-desktop",
    version: "0.7.0",
  });

  registerDocumentTools(server, callBridge);
  registerPreviewTools(server, callBridge);
  registerReviewTools(server, callBridge);
  registerContextTools(server, callBridge);
  registerQualityTools(server, callBridge);
  registerGlossaryTools(server, callBridge);

  return server;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    return undefined;
  }

  return JSON.parse(raw) as unknown;
}

function isAuthorized(req: IncomingMessage): boolean {
  if (httpAuthToken.length === 0) {
    return true;
  }

  const header = req.headers.authorization;
  if (!header) {
    return false;
  }

  const [scheme, token] = header.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token === httpAuthToken;
}

async function buildHealthPayload(): Promise<Record<string, unknown>> {
  try {
    const status = await callBridge("oddeyes.getStatus");
    return {
      ok: true,
      transport: transportMode,
      bridgeInfoPath: bridgeRuntime.getBridgeInfoPath(),
      mcpPort: transportMode === "http" ? httpPort : null,
      status,
    };
  } catch (error) {
    return {
      ok: false,
      transport: transportMode,
      bridgeInfoPath: bridgeRuntime.getBridgeInfoPath(),
      mcpPort: transportMode === "http" ? httpPort : null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function startStdioServer(): Promise<() => Promise<void>> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  return async () => {
    await bridgeRuntime.disconnect().catch(() => undefined);
    await server.close().catch(() => undefined);
  };
}

async function startHttpServer(): Promise<() => Promise<void>> {
  const httpServer = createServer(async (req, res) => {
    if (!req.url) {
      sendJson(res, 400, { error: "Missing request URL" });
      return;
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host ?? `${httpHost}:${httpPort}`}`);

    if (requestUrl.pathname === healthPath) {
      const payload = await buildHealthPayload();
      sendJson(res, payload.ok === true ? 200 : 503, payload);
      return;
    }

    if (requestUrl.pathname !== mcpPath) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      });
      return;
    }

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      const parsedBody = await readJsonBody(req);
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      console.error("[oddeyes-desktop-mcp] HTTP transport error", error);
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal server error",
          },
          id: null,
        });
      }
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(httpPort, httpHost, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  console.error(`[oddeyes-desktop-mcp] HTTP helper listening on http://${httpHost}:${httpPort}${mcpPath}`);

  return async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }).catch(() => undefined);
    await bridgeRuntime.disconnect().catch(() => undefined);
  };
}

async function main(): Promise<void> {
  const shutdown = transportMode === "http"
    ? await startHttpServer()
    : await startStdioServer();

  const exit = async () => {
    await shutdown().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void exit();
  });

  process.on("SIGTERM", () => {
    void exit();
  });
}

void main().catch((error) => {
  console.error("[oddeyes-desktop-mcp] failed to start", error);
  process.exit(1);
});
