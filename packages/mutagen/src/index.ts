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
import { runMutagenParserGet } from "./tools/mutagen-parser-get.js";
import { runMutagenParserMass } from "./tools/mutagen-parser-mass.js";
import { runMutagenSerpReport } from "./tools/mutagen-serp-report.js";

const PKG_VERSION = "0.1.0";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: false };

const server = new McpServer(
  { name: "mcp-mutagen", version: PKG_VERSION },
  {
    instructions:
      "You have access to mcp-mutagen: 5 tools for Mutagen.ru keyword competition analysis and SERP data. " +
      "mutagen_competition — keyword competition scoring (1-25 scale + Wordstat frequency + Yandex Direct cost estimates). " +
      "mutagen_api — generic Mutagen API gateway: SERP reports (serp.report), keyword analytics, balance, projects. " +
      "mutagen_parser_get — typed wrapper for single-keyword parser.get. " +
      "mutagen_parser_mass — typed wrapper for batch parser.mass with correct async polling via parser.mass.id. " +
      "mutagen_serp_report — typed wrapper for serp.report, always uses POST. " +
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
// Parser type enum — shared across typed wrappers
// ---------------------------------------------------------------------------

const PARSER_TYPE_ENUM = z.enum([
  "wordstat_key",
  "wordstat_key_50",
  "wordstat_n",
  "wordstat_q",
  "wordstat_qs",
  "wordstat_no",
  "wordstat_qo",
  "wordstat_qso",
  "direct",
]);

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

server.registerTool(
  "mutagen_parser_get",
  {
    title: "Mutagen — Parser Get (single keyword)",
    description:
      "Typed wrapper for mutagen.parser.get — fetches Wordstat frequency or Direct bid data for a single keyword. " +
      "Parameter 'parser' selects the data source: wordstat_q/wordstat_qs/wordstat_qso for frequency variants, " +
      "wordstat_key/wordstat_key_50 for related-keyword expansion, 'direct' for Yandex Direct bids. " +
      "IMPORTANT: parameter is named 'parser', NOT 'parser_type'. " +
      "Results are cached 30 days.",
    inputSchema: {
      key: z.string().min(1).describe("The search phrase to parse"),
      parser: PARSER_TYPE_ENUM.describe(
        "Parser type: wordstat_q (phrase match), wordstat_qs (exact form), wordstat_qso (exact+order — SEO standard), " +
        "wordstat_n (broad), wordstat_no (order-locked), wordstat_qo (phrase+order), " +
        "wordstat_key (left column, up to 2000 keys), wordstat_key_50 (first 200), direct (Yandex Direct bids)"
      ),
      region_id: z.string().optional().default("0").describe("Region code(s). Default '0' = global RU. Comma-separated, prefix '-' excludes."),
      force_refresh: z.boolean().optional().default(false).describe("Bypass 30-day cache if true"),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runMutagenParserGet({
      key: args.key,
      parser: args.parser,
      region_id: args.region_id,
      force_refresh: args.force_refresh,
    }),
);

server.registerTool(
  "mutagen_parser_mass",
  {
    title: "Mutagen — Parser Mass (batch keyword job)",
    description:
      "Typed wrapper for mutagen.parser.mass — submits a batch keyword parsing job and polls until completion. " +
      "Polls via parser.mass.id (NOT parser.mass.get — those are different endpoints). " +
      "Keys are passed as an array (joined with newline internally) or as a newline-separated string. " +
      "IMPORTANT: parameter is named 'parser', NOT 'parser_type'. Keywords list is 'keys_list', NOT 'keys'. " +
      "Default poll timeout is 300s for batch jobs (mass jobs take longer than single checks). " +
      "Results are cached 30 days.",
    inputSchema: {
      keys_list: z.union([
        z.array(z.string().min(1)).min(1),
        z.string().min(1),
      ]).describe("Keywords to parse — array of strings, or newline-separated string"),
      name: z.string().min(1).describe("Label for the batch job (for tracking in Mutagen UI)"),
      parser: PARSER_TYPE_ENUM.describe(
        "Parser type: wordstat_q (phrase match), wordstat_qs (exact form), wordstat_qso (exact+order — SEO standard), " +
        "wordstat_n (broad), wordstat_no (order-locked), wordstat_qo (phrase+order), " +
        "wordstat_key (left column, up to 2000 keys), wordstat_key_50 (first 200), direct (Yandex Direct bids)"
      ),
      region_id: z.string().optional().default("0").describe("Region code(s). Default '0' = global RU."),
      poll_timeout_sec: z.number().int().min(30).max(1800).default(300).optional().describe(
        "Max seconds to wait for job completion (default 300 — mass jobs take longer than single checks)"
      ),
      force_refresh: z.boolean().optional().default(false).describe("Bypass 30-day cache if true"),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runMutagenParserMass({
      keys_list: args.keys_list,
      name: args.name,
      parser: args.parser,
      region_id: args.region_id,
      poll_timeout_sec: args.poll_timeout_sec,
      force_refresh: args.force_refresh,
    }),
);

server.registerTool(
  "mutagen_serp_report",
  {
    title: "Mutagen — SERP Report",
    description:
      "Typed wrapper for mutagen.serp.report — always sent as POST to correctly handle filter[] arrays. " +
      "22+ report types via 'report' parameter. " +
      "IMPORTANT: parameter is 'report', NOT 'report_type'. " +
      "Provide exactly ONE of: keyword, keywords (CSV), domain, domain_with_subdomains, or page. " +
      "Results are cached 30 days.",
    inputSchema: {
      region: z.enum([
        "yandex_ru", "yandex_msk", "yandex_spb", "yandex_minsk",
        "yandex_nsk", "yandex_ekb", "yandex_rostov", "yandex_kazan", "yandex_nn",
      ]).describe("Yandex region for the report"),
      report: z.string().min(1).describe(
        "Report type, e.g. 'report_keyword_positions_organic', 'report_keywords_organic', " +
        "'report_domain_competitors', 'report_keyword_info', 'report_page_recommended_keywords'. " +
        "See mutagen skill cookbook.md for full list of 23 report types."
      ),
      keyword: z.string().optional().describe("Single search phrase"),
      keywords: z.string().optional().describe("Comma-separated phrases, max 1000"),
      domain: z.string().optional().describe("Domain (without protocol), e.g. 'example.ru'"),
      domain_with_subdomains: z.string().optional().describe("Domain including subdomains"),
      page: z.string().optional().describe("Full page URL"),
      filter: z.array(z.unknown()).optional().describe(
        "Array of filter objects. Each: {column, filter_type, val}. " +
        "17 filter types: gr, gr_or_eq, less, less_or_eq, eq, not_eq, range, in, not_in, like, not_like, like_any, not_like_any, like_start, like_finish, is. " +
        "Add {or:1} marker to start OR-block."
      ),
      sort: z.string().optional().describe("Sort column, prefix '-' for descending, e.g. '-region_wsqso'"),
      limit: z.number().int().positive().optional().describe("Max rows to return"),
      count: z.union([z.number(), z.boolean()]).optional().describe("Pass 1 or true to return only {count: N} row-count probe"),
      force_refresh: z.boolean().optional().default(false).describe("Bypass 30-day cache if true"),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runMutagenSerpReport({
      region: args.region,
      report: args.report,
      keyword: args.keyword,
      keywords: args.keywords,
      domain: args.domain,
      domain_with_subdomains: args.domain_with_subdomains,
      page: args.page,
      filter: args.filter,
      sort: args.sort,
      limit: args.limit,
      count: args.count,
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
