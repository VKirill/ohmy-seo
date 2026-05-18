#!/usr/bin/env node
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolvePackageConfig } from "@ohmy-seo/mcp-core/config";
import { registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { z } from "zod";
import {
  runXmlstockYandexSerp,
  xmlstockYandexSerpInputSchema,
  xmlstockYandexSerpDescription,
} from "./tools/xmlstock-yandex-serp.js";
import {
  runXmlstockGoogleSerp,
  xmlstockGoogleSerpInputSchema,
  xmlstockGoogleSerpDescription,
} from "./tools/xmlstock-google-serp.js";
import { runXmlstockUsageStats, xmlstockUsageStatsDescription } from "./tools/xmlstock-usage-stats.js";
import { searchArchive, getArchivedXml } from "./lib/xmlstock-archive.js";

const PKG_VERSION = "0.2.0";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: false };

const server = new McpServer(
  { name: "mcp-xmlstock", version: PKG_VERSION },
  {
    instructions:
      "You have access to mcp-xmlstock: 5 tools for SERP data via XMLStock API. " +
      "xmlstock_yandex_serp — fetch Yandex SERP for a query (cached 24 h). " +
      "xmlstock_google_serp — fetch Google SERP for a query (cached 24 h). " +
      "xmlstock_usage_stats — show cumulative XMLStock API call counts. " +
      "xmlstock_archive_search — search metadata of archived raw XML responses. " +
      "xmlstock_archive_get — retrieve full archived raw XML by id. " +
      "Requires XMLSTOCK_USER + XMLSTOCK_KEY in .env for live calls.",
  },
);

function validateRequiredEnv(): void {
  try {
    resolvePackageConfig("xmlstock");
  } catch (err) {
    console.error("FATAL: " + (err as Error).message);
    process.exit(1);
  }
  if (!process.env.XMLSTOCK_USER || !process.env.XMLSTOCK_KEY) {
    console.error(
      "[warn] XMLSTOCK_USER or XMLSTOCK_KEY is not set — xmlstock_yandex_serp and xmlstock_google_serp will return env error at call time",
    );
  }
}

// ---------------------------------------------------------------------------
// Cache policy registration — must run before tool registration
// ---------------------------------------------------------------------------

registerCacheableTool("xmlstock_yandex_serp", {
  ttlEnvKey: "MCP_XMLSTOCK_CACHE_TTL_SERP",
  ttlDefaultSeconds: 86400,
});

registerCacheableTool("xmlstock_google_serp", {
  ttlEnvKey: "MCP_XMLSTOCK_CACHE_TTL_SERP",
  ttlDefaultSeconds: 86400,
});

// usage_stats is NOT cached — always fresh

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = any;

server.registerTool(
  "xmlstock_yandex_serp",
  {
    title: "XMLStock — Yandex SERP",
    description: xmlstockYandexSerpDescription,
    inputSchema: xmlstockYandexSerpInputSchema.shape,
    annotations: READ_ONLY,
  },
  async (args): Promise<AnyResult> =>
    runXmlstockYandexSerp({
      query:         args.query as string,
      lr:            args.lr as number | undefined,
      domain:        args.domain as "ru" | "by" | "kz" | "com" | undefined,
      device:        args.device as "desktop" | "mobile" | undefined,
      page:          args.page as number | undefined,
      groupby:       args.groupby as 10 | 50 | 100 | undefined,
      force_refresh: (args.force_refresh as boolean | undefined) ?? false,
    }),
);

server.registerTool(
  "xmlstock_google_serp",
  {
    title: "XMLStock — Google SERP",
    description: xmlstockGoogleSerpDescription,
    inputSchema: xmlstockGoogleSerpInputSchema.shape,
    annotations: READ_ONLY,
  },
  async (args): Promise<AnyResult> =>
    runXmlstockGoogleSerp({
      query:         args.query as string,
      lr:            args.lr as number | undefined,
      domain:        args.domain as "com" | "ru" | "com.ua" | "143" | undefined,
      device:        args.device as "desktop" | "mobile" | undefined,
      page:          args.page as number | undefined,
      tbs:           args.tbs as string | undefined,
      hl:            args.hl as string | undefined,
      force_refresh: (args.force_refresh as boolean | undefined) ?? false,
    }),
);

server.registerTool(
  "xmlstock_usage_stats",
  {
    title: "XMLStock — Usage Stats",
    description: xmlstockUsageStatsDescription,
    inputSchema: {},
    annotations: READ_ONLY,
  },
  async () => runXmlstockUsageStats(),
);

const archiveSearchSchema = z.object({
  query:     z.string().optional(),
  engine:    z.enum(["yandex", "google"]).optional(),
  date_from: z.string().optional(),
  date_to:   z.string().optional(),
  limit:     z.number().int().min(1).max(500).default(50),
});

server.registerTool(
  "xmlstock_archive_search",
  {
    title: "XMLStock — Archive Search",
    description:
      "Search metadata of previously archived raw XMLStock SERP responses. " +
      "Returns id, engine, query, fetched_at, raw_size_bytes, http_status. " +
      "Use xmlstock_archive_get to retrieve the full XML by id.",
    inputSchema: archiveSearchSchema.shape,
    annotations: READ_ONLY,
  },
  async (args): Promise<AnyResult> => {
    const rows = await searchArchive({
      query:     args.query     as string | undefined,
      engine:    args.engine    as "yandex" | "google" | undefined,
      date_from: args.date_from as string | undefined,
      date_to:   args.date_to   as string | undefined,
      limit:     args.limit     as number | undefined,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
  },
);

const archiveGetSchema = z.object({
  id: z.number().int().positive(),
});

server.registerTool(
  "xmlstock_archive_get",
  {
    title: "XMLStock — Archive Get",
    description:
      "Retrieve a full archived XMLStock SERP response by id (from xmlstock_archive_search). " +
      "Returns decompressed raw_xml plus metadata. No credentials are stored.",
    inputSchema: archiveGetSchema.shape,
    annotations: READ_ONLY,
  },
  async (args): Promise<AnyResult> => {
    const row = await getArchivedXml(args.id as number);
    if (!row) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Archive entry ${args.id} not found` }) }],
      };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(row, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  validateRequiredEnv();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mcp-xmlstock v${PKG_VERSION} running via stdio`);
}

main().catch((err: Error) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
