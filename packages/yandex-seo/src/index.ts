#!/usr/bin/env node
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getMasterKey } from "@ohmy-seo/mcp-core/crypto";
import { runMutagenCompetition } from "./tools/mutagen-competition.js";
import { runListOauthApps } from "./tools/oauth-list-apps.js";
import { runRegisterOauthApp } from "./tools/oauth-register-app.js";
import { runDeleteOauthApp } from "./tools/oauth-delete-app.js";
import { runListAccounts } from "./tools/oauth-list-accounts.js";
import { runStartOauthFlow } from "./tools/oauth-start-flow.js";
import { runCompleteOauthFlow } from "./tools/oauth-complete-flow.js";
import { runDeleteAccount } from "./tools/oauth-delete-account.js";
import { runSetDefaultAccount } from "./tools/oauth-set-default-account.js";
import { runListSites } from "./tools/list-sites.js";
import { runListCounters } from "./tools/list-counters.js";
import { runFindProperty } from "./tools/find-property.js";
import { runRefreshInventory } from "./tools/refresh-inventory.js";
import { runInvalidateCache } from "./tools/invalidate-cache.js";
import { runCacheStats } from "./tools/cache-stats.js";
import { runYandexMetrikaApi } from "./tools/yandex-metrika-api.js";
import { runYandexWebmasterApi } from "./tools/yandex-webmaster-api.js";
import { runYandexDirectApi } from "./tools/yandex-direct-api.js";
import { runMutagenApi } from "./tools/mutagen-api.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: false };

const server = new McpServer(
  { name: "mcp-yandex-seo", version: "0.6.0" },
  {
    instructions:
      "You have access to mcp-yandex-seo: 19 tools for Russian SEO analytics and Yandex API access. " +
      "Generic API gateways (use these for full API coverage): " +
      "yandex_metrika_api — any Yandex Metrika endpoint; see skill yandex-metrica (cookbook.md) for examples. " +
      "yandex_webmaster_api — any Yandex Webmaster endpoint; see skill yandex-webmaster (cookbook.md). " +
      "yandex_direct_api — any Yandex Direct v5 endpoint (Bearer auth, optional client_login); see skill yandex-direct (cookbook.md). " +
      "mutagen_api — generic Mutagen gateway: SERP reports (serp.report), keyword analytics, balance, projects; see skill mutagen for method catalog. " +
      "mutagen_competition — keyword competition scoring via Mutagen (1-25 scale + cost estimates). " +
      "Inventory tools: list_sites, list_counters, find_property, refresh_inventory. " +
      "OAuth management: list_oauth_apps, register_oauth_app, delete_oauth_app, list_accounts, start_oauth_flow, complete_oauth_flow, delete_account, set_default_account. " +
      "Cache tools: invalidate_cache, cache_stats. " +
      "GET responses are cached (TTL MCP_YANDEX_SEO_CACHE_TTL_API, default 3600 s). " +
      "On rate-limit errors, wait the seconds suggested in the error text before retry. " +
      "Most tools accept an optional 'account' parameter to select a specific connected Yandex account.",
  },
);

function validateRequiredEnv(): void {
  try {
    getMasterKey();
  } catch (err) {
    console.error("FATAL: " + (err as Error).message);
    process.exit(1);
  }
}

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
  "list_oauth_apps",
  {
    title: "OAuth — List Registered Apps",
    description:
      "Returns all OAuth applications currently registered in the local database. Each entry shows " +
      "the app label, client_id, declared scopes, and creation timestamp. Use this tool to discover " +
      "which apps are available before starting an OAuth flow or to audit the registered credentials. " +
      "Client secrets are never returned — they are stored encrypted.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  async () => runListOauthApps(),
);

server.registerTool(
  "register_oauth_app",
  {
    title: "OAuth — Register New App",
    description:
      "Registers a new Yandex OAuth application in the local encrypted database using the provided " +
      "client_id, client_secret, and scope list. The client_secret is AES-256 encrypted before " +
      "storage. After registration, use start_oauth_flow with the returned app label to begin the " +
      "authorization code flow and obtain an account token for a Yandex user.",
    inputSchema: {
      label: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
        .describe("Short unique name for this app, e.g. 'my-seo-app'"),
      client_id: z
        .string()
        .min(8)
        .max(256)
        .describe("Yandex OAuth application client_id from the developer console"),
      client_secret: z
        .string()
        .min(8)
        .max(256)
        .describe("Yandex OAuth application client_secret (stored encrypted)"),
      scopes_declared: z
        .string()
        .min(1)
        .max(512)
        .describe("Space-delimited list of OAuth scopes, e.g. 'webmaster:hostinfo metrika:read'"),
    },
    annotations: READ_ONLY,
  },
  async (args) => runRegisterOauthApp(args),
);

server.registerTool(
  "delete_oauth_app",
  {
    title: "OAuth — Delete App",
    description:
      "Deletes a registered OAuth application by its label. The operation is blocked if any accounts " +
      "are still linked to this app — delete those accounts first with delete_account. Once deleted, " +
      "any tokens obtained via this app become unrefreshable (the credentials are gone). This action " +
      "is irreversible; double-check the label with list_oauth_apps before proceeding.",
    inputSchema: {
      label: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
        .describe("Label of the OAuth app to delete"),
    },
    annotations: READ_ONLY,
  },
  async (args) => runDeleteOauthApp(args),
);

server.registerTool(
  "list_accounts",
  {
    title: "OAuth — List Connected Accounts",
    description:
      "Returns all Yandex accounts connected via OAuth and stored in the local database. Each entry " +
      "includes the account label, linked yandex_login, granted scopes, token expiry timestamp, and " +
      "whether the account is set as default. Access and refresh tokens are never returned — they " +
      "remain encrypted at rest. Use this to audit available accounts before calling domain tools.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  async () => runListAccounts(),
);

server.registerTool(
  "start_oauth_flow",
  {
    title: "OAuth — Start Authorization Flow",
    description:
      "Begins a Yandex OAuth authorization code flow for a registered app. Returns an authorize_url " +
      "to open in a browser and an account_label to use in the subsequent complete_oauth_flow call. " +
      "The server is stateless — no pending session is stored. You must pass both account_label and " +
      "app_label again when completing the flow. The account_label must be free (not already taken).",
    inputSchema: {
      app_label: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
        .describe("Label of the registered OAuth app to use for this flow"),
      account_label: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
        .describe("Desired label for the new account, e.g. 'main' or 'client-site'"),
    },
    annotations: READ_ONLY,
  },
  async (args) => runStartOauthFlow(args),
);

server.registerTool(
  "complete_oauth_flow",
  {
    title: "OAuth — Complete Authorization Flow",
    description:
      "Completes a Yandex OAuth authorization code flow by exchanging the user-provided code for " +
      "access and refresh tokens. Probes the Yandex Login API and Webmaster API to resolve the " +
      "yandex_login and webmaster_user_id automatically. Tokens are AES-256 encrypted before storage. " +
      "Requires app_label (which app to use), account_label (desired name), and the 7-character code " +
      "copied from the Yandex confirmation page after the user approved the app in the browser.",
    inputSchema: {
      app_label: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
        .describe("Label of the registered OAuth app used in start_oauth_flow"),
      account_label: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
        .describe("Desired label for the new account (same value as passed to start_oauth_flow)"),
      code: z
        .string()
        .min(6)
        .max(16)
        .describe("Authorization code shown on the Yandex confirmation page (typically 7 characters)"),
    },
    annotations: READ_ONLY,
  },
  async (args) => runCompleteOauthFlow(args),
);

server.registerTool(
  "delete_account",
  {
    title: "OAuth — Delete Connected Account",
    description:
      "Removes a connected Yandex account from the local database by its label, permanently deleting " +
      "the encrypted access and refresh tokens. After deletion the account cannot be used for any " +
      "domain tools. To reconnect, run start_oauth_flow again. Use list_accounts to verify the label " +
      "before deleting. If the account was the default, another account must be set as default manually.",
    inputSchema: {
      label: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
        .describe("Label of the account to delete"),
    },
    annotations: READ_ONLY,
  },
  async (args) => runDeleteAccount(args),
);

server.registerTool(
  "set_default_account",
  {
    title: "OAuth — Set Default Account",
    description:
      "Marks the specified account as the default for all domain tools that accept an optional account " +
      "parameter. Only one account can be default at a time — the previous default is automatically " +
      "cleared. Domain tools fall back to the default account when no explicit account label is passed. " +
      "Use list_accounts to see current accounts and which one is already set as default.",
    inputSchema: {
      label: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
        .describe("Label of the account to mark as default"),
    },
    annotations: READ_ONLY,
  },
  async (args) => runSetDefaultAccount(args),
);

server.registerTool(
  "list_sites",
  {
    title: "Inventory — List Webmaster Sites",
    description:
      "Returns all Yandex Webmaster sites cached in the local inventory for every connected account " +
      "that has the webmaster:hostinfo scope. Each row includes host_id, ascii_host_url, unicode_host_url, " +
      "verified flag, main_mirror flag, indexed_pages count, fetched_at timestamp, and cache_age_seconds " +
      "(null if never refreshed). On a cold cache the tool triggers a live Yandex API fetch before returning. " +
      "Optionally filter to a single account by label.",
    inputSchema: {
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional; omit to list sites across all eligible accounts)"),
    },
    annotations: READ_ONLY,
  },
  async (args) => runListSites({ account: args.account }),
);

server.registerTool(
  "list_counters",
  {
    title: "Inventory — List Metrika Counters",
    description:
      "Returns all Yandex Metrika counters cached in the local inventory for every connected account " +
      "that has the metrika:read scope. Each row includes counter_id, name, site, status, permission, " +
      "fetched_at timestamp, and cache_age_seconds (null if the cache was never populated). On a cold " +
      "cache the tool triggers a live Yandex API fetch before returning results. " +
      "Optionally filter to a single account by label.",
    inputSchema: {
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional; omit to list counters across all eligible accounts)"),
    },
    annotations: READ_ONLY,
  },
  async (args) => runListCounters({ account: args.account }),
);

server.registerTool(
  "find_property",
  {
    title: "Inventory — Find Property by Query",
    description:
      "Searches the local inventory for Webmaster sites and/or Metrika counters matching the query " +
      "string using case-insensitive substring scoring: exact match = 100, starts-with = 80, contains = 50. " +
      "Returns up to 25 results sorted by score descending. On a cold cache the tool fetches from Yandex " +
      "before searching. Use kind='site' or kind='counter' to restrict the search. Ideal for resolving a " +
      "domain name or counter name to its canonical id before calling domain tools.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe("Search string; matched case-insensitively against site URLs, counter names, and counter IDs"),
      kind: z
        .enum(["site", "counter"])
        .optional()
        .describe("Restrict results to 'site' (Webmaster) or 'counter' (Metrika); omit to search both"),
    },
    annotations: READ_ONLY,
  },
  async (args) => runFindProperty({ query: args.query, kind: args.kind }),
);

server.registerTool(
  "refresh_inventory",
  {
    title: "Inventory — Force Refresh",
    description:
      "Triggers an explicit refresh of the local inventory by fetching the latest sites or counters " +
      "from Yandex APIs and upserting the results into the database. Returns a per-(account, kind) report " +
      "with fetched, inserted, updated, removed counts, duration_ms, and any error message. Skips " +
      "account/kind pairs that lack the required OAuth scope. Use without arguments to refresh everything, " +
      "or pass account and/or kind to narrow the scope.",
    inputSchema: {
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional; omit to refresh all eligible accounts)"),
      kind: z
        .enum(["sites", "counters"])
        .optional()
        .describe("Which inventory kind to refresh: 'sites' (Webmaster) or 'counters' (Metrika); omit for both"),
    },
    annotations: READ_ONLY,
  },
  async (args) => runRefreshInventory({ account: args.account, kind: args.kind }),
);

server.registerTool(
  "invalidate_cache",
  {
    title: "Cache — Invalidate Entries",
    description:
      "Deletes cached query results from the local SQLite cache. Filters are optional and combine with AND: " +
      "pass 'tool' to clear entries for a specific cacheable tool, 'account' to clear all entries for a connected " +
      "Yandex account, 'older_than_hours' to purge entries fetched more than N hours ago. Omit all filters to wipe " +
      "the entire query cache. Returns the count of deleted rows and the applied filters. Use this tool after " +
      "a site change or known Yandex data refresh to force the next call to fetch live results.",
    inputSchema: {
      tool: z
        .enum([
          "yandex_metrika_api",
          "yandex_webmaster_api",
          "yandex_direct_api",
          "mutagen_competition",
          "mutagen_api",
        ])
        .optional()
        .describe("Restrict invalidation to a specific cacheable tool (optional)"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Restrict invalidation to entries for this account label (optional)"),
      older_than_hours: z
        .number()
        .positive()
        .optional()
        .describe("Delete only entries fetched more than this many hours ago (optional)"),
    },
    annotations: READ_ONLY,
  },
  async (args) => runInvalidateCache({ tool: args.tool, account: args.account, older_than_hours: args.older_than_hours }),
);

server.registerTool(
  "cache_stats",
  {
    title: "Cache — Statistics",
    description:
      "Returns aggregate statistics about the local query result cache: total_entries (all rows), " +
      "db_size_bytes (SQLite file size on disk), top_tools (top-10 tools by entry count with hit totals), " +
      "and recent_24h (entries fetched within the last 24 hours). Use this tool to monitor cache growth " +
      "and determine whether a periodic invalidate_cache call is needed to free disk space.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  async () => runCacheStats(),
);

const GENERIC_API_INPUT = {
  endpoint: z.string().min(1).describe("API endpoint path, e.g. '/user/2/hosts' or '/stat/v1/data'"),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().describe("HTTP method (default: GET)"),
  params: z.record(z.string(), z.unknown()).optional().describe("Query string parameters as key-value object (GET requests)"),
  body: z.unknown().optional().describe("Request body for POST/PUT requests (will be JSON-serialised)"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if one default account is configured)"),
  force_refresh: z.boolean().optional().describe("If true, bypass cache read and re-fetch from upstream API, overwriting any cached entry"),
};

server.registerTool(
  "yandex_metrika_api",
  {
    title: "Yandex Metrika — Generic API Gateway",
    description:
      "Direct gateway to Yandex Metrika (Яндекс.Метрика) REST API. Pass any endpoint path, " +
      "HTTP method, query params, and optional body — the tool handles OAuth, caching (TTL " +
      "MCP_YANDEX_SEO_CACHE_TTL_API, default 3600 s), and error normalisation. " +
      "GET responses are cached; POST/PUT/DELETE bypass cache and invalidate related GET entries. " +
      "Endpoint catalog and usage examples: see skill yandex-metrica (cookbook.md). " +
      "Example: endpoint='/stat/v1/data', params={id:'12345', metrics:'ym:s:visits', date1:'2024-01-01', date2:'2024-01-31'}.",
    inputSchema: GENERIC_API_INPUT,
    annotations: READ_ONLY,
  },
  async (args) =>
    runYandexMetrikaApi({
      endpoint: args.endpoint,
      method: args.method,
      params: args.params,
      body: args.body,
      account: args.account,
      force_refresh: args.force_refresh,
    }),
);

server.registerTool(
  "yandex_webmaster_api",
  {
    title: "Yandex Webmaster — Generic API Gateway",
    description:
      "Direct gateway to Yandex Webmaster REST API. Pass any endpoint path, HTTP method, " +
      "query params, and optional body — the tool handles OAuth, caching (TTL " +
      "MCP_YANDEX_SEO_CACHE_TTL_API, default 3600 s), and error normalisation. " +
      "GET responses are cached; POST/PUT/DELETE bypass cache and invalidate related GET entries. " +
      "Endpoint catalog and usage examples: see skill yandex-webmaster (cookbook.md). " +
      "Example: endpoint='/user/2/hosts', method='GET' to list all verified sites in Yandex Webmaster.",
    inputSchema: GENERIC_API_INPUT,
    annotations: READ_ONLY,
  },
  async (args) =>
    runYandexWebmasterApi({
      endpoint: args.endpoint,
      method: args.method,
      params: args.params,
      body: args.body,
      account: args.account,
      force_refresh: args.force_refresh,
    }),
);

server.registerTool(
  "yandex_direct_api",
  {
    title: "Yandex Direct — Generic API Gateway",
    description:
      "Direct gateway to Yandex Direct API v5 (Яндекс.Директ). Pass any endpoint path, " +
      "HTTP method, query params, and optional body — the tool handles Bearer OAuth auth, " +
      "optional Client-Login header for agency accounts, caching (TTL " +
      "MCP_YANDEX_SEO_CACHE_TTL_API, default 3600 s), and error normalisation. " +
      "GET responses are cached; POST/PUT/DELETE bypass cache and invalidate related GET entries. " +
      "Endpoint catalog and usage examples: see skill yandex-direct (cookbook.md). " +
      "Pass client_login for agency sub-client access.",
    inputSchema: {
      ...GENERIC_API_INPUT,
      client_login: z.string().optional().describe("Yandex Direct agency client login for sub-client access (optional)"),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runYandexDirectApi({
      endpoint: args.endpoint,
      method: args.method,
      params: args.params,
      body: args.body,
      account: args.account,
      client_login: args.client_login,
      force_refresh: args.force_refresh,
    }),
);

async function main(): Promise<void> {
  validateRequiredEnv();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-yandex-seo v0.6.0 running via stdio");
}

main().catch((err: Error) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
