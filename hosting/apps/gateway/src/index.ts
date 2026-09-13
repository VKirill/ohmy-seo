import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { authenticate, pool } from "./tenant.js";
import { callTool, getRuntime, shutdownAll } from "./runtime.js";

const PORT = Number(process.env.PORT ?? 3301);

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "8mb" }));

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

function bearer(req: express.Request): string | null {
  const h = req.headers.authorization ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (m) return m[1];
  const x = req.headers["x-api-key"];
  return typeof x === "string" ? x : null;
}

/**
 * Stateless Streamable HTTP: a fresh Server and transport per request, while
 * the expensive part — the tenant's child MCP processes — is cached by user in
 * runtime.ts. That keeps horizontal scaling trivial and means a client
 * reconnect never strands a session.
 */
app.post("/mcp", async (req, res) => {
  const key = bearer(req);
  if (!key) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Missing API key. Send Authorization: Bearer ohmy_..." },
      id: null,
    });
    return;
  }

  let userId: number | null;
  try {
    userId = await authenticate(key);
  } catch (e) {
    console.error("[mcp] auth backend unavailable:", e);
    res.status(503).json({
      jsonrpc: "2.0",
      error: { code: -32002, message: "Authentication backend unavailable" },
      id: null,
    });
    return;
  }
  if (userId === null) {
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32003, message: "Invalid or revoked API key" },
      id: null,
    });
    return;
  }

  const server = new Server(
    { name: "ohmy-seo", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const rt = await getRuntime(userId);
    return { tools: rt.tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await callTool(userId, request.params.name, request.params.arguments);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text" as const, text: `Ошибка: ${message}` }], isError: true };
    }
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("[mcp] request failed:", e);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Streamable HTTP clients probe these; stateless mode has nothing to resume.
app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed; this endpoint is stateless" },
    id: null,
  });
});
app.delete("/mcp", (_req, res) => res.status(204).end());

/** Blocks startup until the web app has created the shared schema. */
async function waitForSchema(): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await pool.query("SELECT 1 FROM api_keys LIMIT 1");
      console.log("[gateway] schema is ready");
      return;
    } catch {
      if (attempt === 1) console.log("[gateway] waiting for schema from web…");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error("[gateway] schema never appeared; requests will fail with 503");
}

await waitForSchema();

const httpServer = app.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT}`);
});

async function stop(signal: string): Promise<void> {
  console.log(`[gateway] ${signal} received, draining`);
  httpServer.close();
  await shutdownAll();
  await pool.end().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
