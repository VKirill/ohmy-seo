// Roistat REST API gateway (read-only by default).
//
// Self-contained on purpose: Roistat does NOT use the Yandex OAuth pipeline.
// Auth is a static `Api-key` header + a `project` query param, so this module
// talks to Roistat directly via the shared http `request` helper instead of
// going through lib/api-gateway (which is OAuth/account-scoped).
//
// Env:
//   ROISTAT_API_KEY              — key from cloud.roistat.com/user/profile/api (required)
//   ROISTAT_PROJECT_ID           — default project id, e.g. 200994 (required unless `project` passed)
//   ROISTAT_ALLOW_LIVE_MUTATIONS — set "true" to permit write-like endpoints (default: blocked)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { request } from "@ohmy-seo/mcp-core/http";
import { AuthError, RateLimitError, ApiError, sanitizeForOutput } from "@ohmy-seo/mcp-core/errors";
import { READ_ONLY } from "./_shared.js";

const ROISTAT_BASE_URL = "https://cloud.roistat.com/api/v1";

// Path segments that mark a mutating (write) Roistat endpoint. Read endpoints
// (list, get, analytics/data, statistics, user/projects, ...) never contain these.
const WRITE_VERBS = new Set<string>([
  "add", "create", "update", "edit", "delete", "remove", "set", "move",
  "import", "upload", "save", "change", "merge", "restore", "archive",
  "unarchive", "register", "attach", "detach", "proxy",
]);

function resolveApiKey(): string {
  const key = (process.env.ROISTAT_API_KEY ?? "").trim();
  if (!key) {
    throw new Error(
      "ROISTAT_API_KEY is not set. Put the key from cloud.roistat.com/user/profile/api " +
        "into packages/yandex-seo/.env (or the mcp-yandex-seo env block in the Claude Desktop config).",
    );
  }
  return key;
}

function resolveProject(explicit?: string): string {
  const p = (explicit ?? process.env.ROISTAT_PROJECT_ID ?? "").toString().trim();
  if (!p) {
    throw new Error(
      "Roistat project id is not set. Pass `project`, or set ROISTAT_PROJECT_ID in .env / the env block.",
    );
  }
  return p;
}

function assertReadOnly(endpoint: string): void {
  if (process.env.ROISTAT_ALLOW_LIVE_MUTATIONS === "true") return;
  const segments = endpoint.toLowerCase().split(/[/?#]/).filter(Boolean);
  const hit = segments.find((s) => WRITE_VERBS.has(s));
  if (hit) {
    throw new Error(
      `Refusing write-like Roistat endpoint (path segment '${hit}'). roistat_api is read-only by default. ` +
        "To allow mutations, set ROISTAT_ALLOW_LIVE_MUTATIONS=true in the env block.",
    );
  }
}

function buildUrl(endpoint: string, project: string, params?: Record<string, unknown>): string {
  const path = endpoint.startsWith("/") ? endpoint : "/" + endpoint;
  const url = new URL(ROISTAT_BASE_URL + path);
  if (!url.searchParams.has("project")) url.searchParams.set("project", project);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

// Normalise the POST payload to a raw JSON string.
// The MCP device bridge may deliver `body` either as a real object OR as an
// already-JSON-encoded string; JSON.stringify-ing the latter would double-encode
// it and Roistat would reject the request. Handle both.
function normalizeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body; // assume caller/bridge already JSON-encoded it
  return JSON.stringify(body);
}

export interface RoistatApiInput {
  endpoint: string;
  method?: "GET" | "POST";
  params?: Record<string, unknown>;
  body?: unknown;
  project?: string;
  debug?: boolean;
}

async function runRoistatApi(input: RoistatApiInput) {
  try {
    const method = input.method ?? "GET";
    assertReadOnly(input.endpoint);
    const apiKey = resolveApiKey();
    const project = resolveProject(input.project);
    const url = buildUrl(input.endpoint, project, input.params);

    const headers: Record<string, string> = { "Api-key": apiKey };
    const init: Parameters<typeof request>[1] = { method, headers };
    let sentBody: string | undefined;
    if (method === "POST") {
      sentBody = normalizeBody(input.body);
      if (sentBody !== undefined) {
        headers["Content-Type"] = "application/json";
        (init as { body?: string }).body = sentBody;
      }
    }

    const response = await request(url, init);
    const result: Record<string, unknown> = {
      ok: true,
      status: response.status,
      project,
      data: response.data,
    };
    if (input.debug) {
      result._sent = {
        method,
        url: url.replace(project, "<project>"),
        bodyType: typeof input.body,
        contentType: headers["Content-Type"] ?? null,
        bodyPreview: sentBody ? sentBody.slice(0, 400) : null,
      };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return formatRoistatError(e);
  }
}

function formatRoistatError(err: unknown) {
  let text: string;
  if (err instanceof AuthError) {
    text =
      "Roistat auth failed (HTTP 401). Check ROISTAT_API_KEY — it must be the key from " +
      "cloud.roistat.com/user/profile/api.";
  } else if (err instanceof RateLimitError) {
    text = "Roistat rate limited. Wait " + err.retryAfterSec + " seconds before retrying.";
  } else if (err instanceof ApiError) {
    text = "Roistat API error " + err.status + ". Body: " + sanitizeForOutput(err.body).slice(0, 800);
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    text = sanitizeForOutput(msg).slice(0, 800);
  }
  return { isError: true as const, content: [{ type: "text" as const, text }] };
}

export function registerRoistat(server: McpServer): void {
  server.registerTool(
    "roistat_api",
    {
      title: "Roistat — Generic API Gateway (read-only)",
      description:
        "Read-only gateway to the Roistat REST API v1 (Роистат — сквозная аналитика). " +
        "Auth is automatic: the Api-key header comes from ROISTAT_API_KEY and the `project` query " +
        "param from ROISTAT_PROJECT_ID (both in the MCP env). Base URL https://cloud.roistat.com/api/v1 — " +
        "pass `endpoint` as the path after /api/v1. GET by default; the analytics report is POST with a " +
        "JSON `body`. Write-like endpoints are blocked unless ROISTAT_ALLOW_LIVE_MUTATIONS=true. " +
        "Examples: {endpoint:'/user/projects'} lists projects with their ids. " +
        "{endpoint:'/project/analytics/data', method:'POST', body:{dimensions:[...], metrics:[...], " +
        "period:{from:'2026-07-01T00:00:00+0300', to:'2026-07-23T23:59:59+0300'}}} returns per-marker " +
        "analytics. IMPORTANT: valid dimension/metric ids depend on the project — discover them from a " +
        "live response, do not assume field names. Pass debug:true to echo the outgoing request shape.",
      inputSchema: {
        endpoint: z
          .string()
          .min(1)
          .describe("Roistat API path after /api/v1, e.g. '/project/analytics/data' or '/user/projects'"),
        method: z
          .enum(["GET", "POST"])
          .optional()
          .describe("HTTP method (default GET). The analytics report uses POST with a JSON body."),
        params: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Query string params. `project` is injected automatically from ROISTAT_PROJECT_ID."),
        body: z
          .unknown()
          .optional()
          .describe("JSON body for POST requests (analytics dimensions / metrics / period)."),
        project: z.string().optional().describe("Override the project id (default: ROISTAT_PROJECT_ID env)."),
        debug: z
          .boolean()
          .optional()
          .describe("If true, include a `_sent` block in the response showing the outgoing request shape."),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runRoistatApi({
        endpoint: args.endpoint,
        method: args.method,
        params: args.params,
        body: args.body,
        project: args.project,
        debug: args.debug,
      }),
  );
}
