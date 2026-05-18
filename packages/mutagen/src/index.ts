#!/usr/bin/env node
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolvePackageConfig } from "@ohmy-seo/mcp-core/config";
import { registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { runMutagenCompetition } from "./tools/mutagen-competition.js";
import { runMutagenApi } from "./tools/mutagen-api.js";

const PKG_VERSION = "0.1.0";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: false };

const server = new McpServer(
  { name: "mcp-mutagen", version: PKG_VERSION },
  {
    instructions:
      "You have access to mcp-mutagen: 2 tools for Mutagen.ru keyword competition analysis and SERP data. " +
      "mutagen_competition — keyword competition scoring (1-25 scale + Wordstat frequency + Yandex Direct cost estimates). " +
      "mutagen_api — generic Mutagen API gateway: SERP reports (serp.report), keyword analytics, balance, projects. " +
      "Results are cached for 30 days per unique call. Requires MUTAGEN_API_KEY in .env.",
  },
);

function validateRequiredEnv(): void {
  try {
    resolvePackageConfig("mutagen");
  } catch (err) {
    console.error("FATAL: " + (err as Error).message);
    process.exit(1);
  }
  if (!process.env.MUTAGEN_API_KEY) {
    console.error("[warn] MUTAGEN_API_KEY is not set — mutagen_competition and mutagen_api will fail at call time");
  }
}

// ---------------------------------------------------------------------------
// Cache policy registration — before server.registerTool
// ---------------------------------------------------------------------------

registerCacheableTool("mutagen_competition", {
  ttlEnvKey: "MCP_MUTAGEN_CACHE_TTL",
  ttlDefaultSeconds: 2592000, // 30 days
});

registerCacheableTool("mutagen_api", {
  ttlEnvKey: "MCP_MUTAGEN_CACHE_TTL",
  ttlDefaultSeconds: 2592000, // 30 days
});

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

server.registerTool(
  "mutagen_competition",
  {
    title: "Mutagen — Keyword Competition Score",
    description:
      "Returns competition scores for a list of keywords using the Mutagen service. Each keyword " +
      "receives a competition level (strong: 1-25 scale), Wordstat frequency, and Yandex Direct " +
      "cost estimates (spec, first, garant positions). Requires MUTAGEN_API_KEY in .env. " +
      "Results are cached for 30 days unless force_refresh:true is passed. " +
      "Use this tool to prioritise which keywords are worth targeting based on actual SERP competition.",
    inputSchema: {
      phrases: z.array(z.string().min(1)).min(1).max(25).describe("Keywords to check (1-25)"),
      poll_timeout_sec: z.number().int().min(10).max(300).default(60).optional().describe("Max seconds to wait per keyword (default 60)"),
      force_refresh: z.boolean().optional().default(false).describe("If true, bypass cache read and re-fetch from upstream API, overwriting any cached entry."),
    },
    annotations: READ_ONLY,
  },
  async (args) => runMutagenCompetition({ phrases: args.phrases, poll_timeout_sec: args.poll_timeout_sec }),
);

server.registerTool(
  "mutagen_api",
  {
    title: "Mutagen API — Generic Gateway (SERP Reports, Keyword Analytics)",
    description:
      "Generic gateway to the Mutagen.ru API (api.mutagen.ru). Covers the full method surface: " +
      "SERP reports (method='serp.report', params include region + report type + keyword/domain/page element), " +
      "keyword competition (method='check_key', async with polling), parser jobs (method='parser.mass'), " +
      "balance check (method='balance'), projects (method='progects'), and all 22+ serp.report types. " +
      "Async methods (check_key, parser.mass) are automatically polled until completion — use poll_timeout_sec to control max wait. " +
      "Results are cached for 30 days per unique method+params combination; pass force_refresh:true to bypass cache. " +
      "IMPORTANT: SERP reports and paid methods consume Mutagen balance — check balance with method='balance' before running large reports. " +
      "See skill 'mutagen' for full method catalog, report types, region codes, filter syntax, and pricing guidance.",
    inputSchema: {
      method: z.string().min(1).describe(
        "Mutagen method name without 'mutagen.' prefix, e.g. 'balance', 'serp.report', 'check_key', 'progects', 'parser.mass'"
      ),
      params: z.record(z.string(), z.unknown()).optional().describe(
        "Method parameters as key-value object. For serp.report: {region, report, keyword/domain/page, filter?, sort?, limit?, count?}"
      ),
      poll_timeout_sec: z.number().int().min(10).max(300).default(60).optional().describe(
        "Max seconds to wait for async methods (check_key, parser.mass). Default 60."
      ),
      force_refresh: z.boolean().optional().default(false).describe(
        "If true, bypass 30-day cache and re-fetch from Mutagen API, overwriting any cached entry."
      ),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runMutagenApi({
      method: args.method,
      params: args.params,
      poll_timeout_sec: args.poll_timeout_sec,
      force_refresh: args.force_refresh,
    }),
);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  validateRequiredEnv();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mcp-mutagen v${PKG_VERSION} running via stdio`);
}

main().catch((err: Error) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
