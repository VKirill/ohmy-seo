#!/usr/bin/env node
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getMasterKey } from "./lib/crypto/master-key.js";
import { runWebmasterSiteSummary } from "./tools/webmaster-site-summary.js";
import { runWebmasterTopQueries } from "./tools/webmaster-top-queries.js";
import { runWebmasterIndexingIssues } from "./tools/webmaster-indexing-issues.js";
import { runMetrikaSearchPhrases } from "./tools/metrika-search-phrases.js";
import { runMetrikaTrafficSummary } from "./tools/metrika-traffic-summary.js";
import { runWordstatKeywords } from "./tools/wordstat-keywords.js";
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

const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: false };

const server = new McpServer(
  { name: "mcp-yandex-seo", version: "0.2.0" },
  {
    instructions:
      "You have access to mcp-yandex-seo: 7 read-only tools for Russian SEO analytics. " +
      "- webmaster_site_summary / webmaster_top_queries / webmaster_indexing_issues — Yandex Webmaster diagnostics (SQI, top queries, errors). " +
      "- metrika_search_phrases / metrika_traffic_summary — Yandex Metrika traffic and organic search analytics. " +
      "- wordstat_keywords — Russian keyword research via Yandex Direct Wordstat (volumes, related phrases). " +
      "- mutagen_competition — keyword competition scoring via Mutagen (1-25 scale + cost estimates). " +
      "All tools call external APIs. On rate-limit errors, wait the seconds suggested in the error text before retry. " +
      "Domain tools accept an optional 'account' parameter to select a specific connected Yandex account.",
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
  "webmaster_site_summary",
  {
    title: "Yandex Webmaster — Site Summary",
    description:
      "Returns a diagnostic summary for a Yandex Webmaster host: SQI (Site Quality Index), " +
      "number of pages in the Yandex index, count of active diagnostics issues, and the " +
      "timestamp of the last crawl. Results are cached for 6 hours unless force_refresh:true is passed. " +
      "Use this tool to get a quick health-check of a site's standing in Yandex before diving into specific issues or query data.",
    inputSchema: {
      host_id: z.string().optional().describe('Webmaster host ID, format "https:example.com:443"'),
      site: z.string().min(1).optional().describe("Site domain or URL substring; alternative to host_id for fuzzy lookup"),
      account: z.string().min(1).optional().describe("Account label from list_accounts (optional if exactly one matching account or one is_default)"),
      force_refresh: z.boolean().optional().default(false).describe("If true, bypass cache read and re-fetch from upstream API, overwriting any cached entry."),
    },
    annotations: READ_ONLY,
  },
  async (args) => runWebmasterSiteSummary({ host_id: args.host_id, site: args.site, account: args.account }),
);

server.registerTool(
  "webmaster_top_queries",
  {
    title: "Yandex Webmaster — Top Search Queries",
    description:
      "Returns the top organic search queries for a Yandex Webmaster host over the specified " +
      "date range: impressions, clicks, CTR, and average position in Yandex SERP. Supports " +
      "filtering by query text and limiting result count. Results are cached for 1 hour unless force_refresh:true is passed. " +
      "Use this to analyse keyword performance and identify queries that drive the most (or least) organic traffic.",
    inputSchema: {
      host_id: z.string().optional().describe('Webmaster host ID, format "https:example.com:443"'),
      site: z.string().min(1).optional().describe("Site domain or URL substring; alternative to host_id for fuzzy lookup"),
      date_from: z.string().describe("Start date YYYY-MM-DD"),
      date_to: z.string().describe("End date YYYY-MM-DD"),
      limit: z.number().int().min(1).max(500).default(50).describe("Max rows to return (default 50, max 500)"),
      query_filter: z.string().optional().describe("Optional substring filter applied to query text"),
      account: z.string().min(1).optional().describe("Account label from list_accounts (optional if exactly one matching account or one is_default)"),
      force_refresh: z.boolean().optional().default(false).describe("If true, bypass cache read and re-fetch from upstream API, overwriting any cached entry."),
    },
    annotations: READ_ONLY,
  },
  async (args) => runWebmasterTopQueries({ host_id: args.host_id, site: args.site, date_from: args.date_from, date_to: args.date_to, limit: args.limit, query_filter: args.query_filter, account: args.account }),
);

server.registerTool(
  "webmaster_indexing_issues",
  {
    title: "Yandex Webmaster — Indexing Issues",
    description:
      "Returns the current list of diagnostic issues for a Yandex Webmaster host, including " +
      "critical errors, warnings, and informational notices about crawl and indexing problems. " +
      "Each item includes issue type, severity level, and affected URL count. Results are cached for 1 hour unless force_refresh:true is passed. " +
      "Use this tool to detect and prioritise technical SEO problems that may suppress rankings in Yandex.",
    inputSchema: {
      host_id: z.string().optional().describe('Webmaster host ID, format "https:example.com:443"'),
      site: z.string().min(1).optional().describe("Site domain or URL substring; alternative to host_id for fuzzy lookup"),
      account: z.string().min(1).optional().describe("Account label from list_accounts (optional if exactly one matching account or one is_default)"),
      force_refresh: z.boolean().optional().default(false).describe("If true, bypass cache read and re-fetch from upstream API, overwriting any cached entry."),
    },
    annotations: READ_ONLY,
  },
  async (args) => runWebmasterIndexingIssues({ host_id: args.host_id, site: args.site, account: args.account }),
);

server.registerTool(
  "metrika_search_phrases",
  {
    title: "Yandex Metrika — Top Organic Search Phrases",
    description:
      "Returns the top organic search phrases for a Yandex Metrika counter over the specified " +
      "date range, filtered to organic search traffic only. Metrics per phrase include visits, " +
      "bounce rate, and page depth. Results are cached for 1 hour unless force_refresh:true is passed. " +
      "Use this tool to understand which search queries actually drive engaged users to the site, complementing Webmaster impressions/click data.",
    inputSchema: {
      counter_id: z.string().optional().describe("Metrika counter ID (numeric string)"),
      site: z.string().min(1).optional().describe("Counter name or site substring; alternative to counter_id for fuzzy lookup"),
      date_from: z.string().describe("Start date YYYY-MM-DD"),
      date_to: z.string().describe("End date YYYY-MM-DD"),
      limit: z.number().int().min(1).max(200).default(50).describe("Max rows to return (default 50, max 200)"),
      search_engine: z.enum(["yandex", "google", "all"]).default("all").describe("Filter by search engine"),
      account: z.string().min(1).optional().describe("Account label from list_accounts (optional if exactly one matching account or one is_default)"),
      force_refresh: z.boolean().optional().default(false).describe("If true, bypass cache read and re-fetch from upstream API, overwriting any cached entry."),
    },
    annotations: READ_ONLY,
  },
  async (args) => runMetrikaSearchPhrases({ counter_id: args.counter_id, site: args.site, date_from: args.date_from, date_to: args.date_to, limit: args.limit, search_engine: args.search_engine, account: args.account }),
);

server.registerTool(
  "metrika_traffic_summary",
  {
    title: "Yandex Metrika — Traffic Summary by Source",
    description:
      "Returns aggregated traffic metrics for a Yandex Metrika counter broken down by traffic " +
      "source (organic search, direct, referral, social, ad). Metrics include visits, unique " +
      "visitors, and pageviews per source. Results are cached for 6 hours unless force_refresh:true is passed. " +
      "Use this tool to assess the overall traffic mix and measure how much Yandex organic contributes relative to other channels.",
    inputSchema: {
      counter_id: z.string().optional().describe("Metrika counter ID (numeric string)"),
      site: z.string().min(1).optional().describe("Counter name or site substring; alternative to counter_id for fuzzy lookup"),
      date_from: z.string().describe("Start date YYYY-MM-DD"),
      date_to: z.string().describe("End date YYYY-MM-DD"),
      group_by: z.enum(["day", "week", "month", "none"]).default("none").describe("Group results by time period"),
      account: z.string().min(1).optional().describe("Account label from list_accounts (optional if exactly one matching account or one is_default)"),
      force_refresh: z.boolean().optional().default(false).describe("If true, bypass cache read and re-fetch from upstream API, overwriting any cached entry."),
    },
    annotations: READ_ONLY,
  },
  async (args) => runMetrikaTrafficSummary({ counter_id: args.counter_id, site: args.site, date_from: args.date_from, date_to: args.date_to, group_by: args.group_by, account: args.account }),
);

server.registerTool(
  "wordstat_keywords",
  {
    title: "Yandex Direct Wordstat — Keyword Research",
    description:
      "Returns monthly search volume estimates and related keyword suggestions from Yandex " +
      "Direct Wordstat for one or more seed phrases. Optionally filters by region (geo_id). " +
      "Results include phrase-match and broad-match frequency counts plus a list of associated queries. " +
      "Results are cached for 7 days unless force_refresh:true is passed. " +
      "Use this tool for keyword research, cluster seeding, and demand estimation in the Russian-language search market.",
    inputSchema: {
      phrases: z.array(z.string().min(1)).min(1).max(10).describe("Seed phrases to research (1-10)"),
      geo_id: z.array(z.number().int()).optional().describe("Yandex region IDs to filter by (optional)"),
      poll_timeout_sec: z.number().int().min(30).max(300).default(120).describe("Max seconds to wait for Wordstat report (default 120)"),
      client_login: z.string().optional().describe("Yandex Direct agency client login (optional)"),
      account: z.string().min(1).optional().describe("Account label from list_accounts (optional if exactly one matching account or one is_default)"),
      force_refresh: z.boolean().optional().default(false).describe("If true, bypass cache read and re-fetch from upstream API, overwriting any cached entry."),
    },
    annotations: READ_ONLY,
  },
  async (args) => runWordstatKeywords({ phrases: args.phrases, geo_id: args.geo_id, poll_timeout_sec: args.poll_timeout_sec, client_login: args.client_login, account: args.account }),
);

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
          "wordstat_keywords",
          "mutagen_competition",
          "webmaster_top_queries",
          "metrika_search_phrases",
          "webmaster_indexing_issues",
          "webmaster_site_summary",
          "metrika_traffic_summary",
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

async function main(): Promise<void> {
  validateRequiredEnv();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-yandex-seo v0.2.0 running via stdio");
}

main().catch((err: Error) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
