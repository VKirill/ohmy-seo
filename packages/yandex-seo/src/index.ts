#!/usr/bin/env node
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getMasterKey } from "@ohmy-seo/mcp-core/crypto";
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
import { runDirectListCampaigns } from "./tools/direct-list-campaigns.js";
import { runDirectListAdGroups } from "./tools/direct-list-adgroups.js";
import { runDirectListAds } from "./tools/direct-list-ads.js";
import { runDirectListKeywords } from "./tools/direct-list-keywords.js";
import { runDirectGetStats } from "./tools/direct-get-stats.js";
import { runDirectGetChangeHistory } from "./tools/direct-get-change-history.js";
import { runDirectGetSearchTerms } from "./tools/direct-get-search-terms.js";
import { runDirectUploadImage } from "./tools/direct-upload-image.js";
import { runDirectCreateCampaign } from "./tools/direct-create-campaign.js";
import { runDirectCreateAdGroup } from "./tools/direct-create-adgroup.js";
import { runDirectCreateAdTgo } from "./tools/direct-create-ad-tgo.js";
import { runDirectCreateAdRsya } from "./tools/direct-create-ad-rsya.js";
import { runDirectCreateAdUnified } from "./tools/direct-create-ad-unified.js";
import { runDirectLinkMetrikaGoals } from "./tools/direct-link-metrika-goals.js";
import { runDirectPauseCampaigns } from "./tools/direct-pause-campaigns.js";
import { runDirectResumeCampaigns } from "./tools/direct-resume-campaigns.js";
import { runDirectDeleteCampaigns } from "./tools/direct-delete-campaigns.js";
import { runDirectNegativeKeywordsAdd } from "./tools/direct-negative-keywords-add.js";
import { runDirectUpdateBudgets } from "./tools/direct-update-budgets.js";
import { runDirectUploadCampaignBundle } from "./tools/direct-upload-campaign-bundle.js";
import { runDirectRenderToXlsx } from "./tools/direct-render-to-xlsx.js";
import { runDirectCreateSitelinksSet } from "./tools/direct-create-sitelinks-set.js";
import { runDirectCreatePromoExtension } from "./tools/direct-create-promo-extension.js";
import { runDirectUpdateAdgroupAutotargeting } from "./tools/direct-update-adgroup-autotargeting.js";
import { runDirectUploadFromYaml } from "./tools/direct-upload-from-yaml.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: false };

const server = new McpServer(
  { name: "mcp-yandex-seo", version: "0.7.0" },
  {
    instructions:
      "You have access to mcp-yandex-seo: 17 tools for Russian SEO analytics and Yandex API access. " +
      "Generic API gateways (use these for full API coverage): " +
      "yandex_metrika_api — any Yandex Metrika endpoint; see skill yandex-metrica (cookbook.md) for examples. " +
      "yandex_webmaster_api — any Yandex Webmaster endpoint; see skill yandex-webmaster (cookbook.md). " +
      "yandex_direct_api — any Yandex Direct v5 endpoint (Bearer auth, optional client_login); see skill yandex-direct (cookbook.md). " +
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

server.registerTool(
  "yandex_direct_list_campaigns",
  {
    title: "Yandex Direct — List Campaigns",
    description:
      "List Yandex Direct campaigns with optional filters by state/type/status/id. " +
      "Returns Id, Name, Type, Status, State, StartDate, and DailyBudget for each matching campaign. " +
      "Use 'states' to filter by campaign state (ON, OFF, SUSPENDED, ENDED, CONVERTED, ARCHIVED), " +
      "'statuses' for moderation status (DRAFT, MODERATION, ACCEPTED, REJECTED), " +
      "'ids' for specific campaign IDs, 'types' for campaign types, and 'limit' to cap the result set (default 100, max 10000).",
    inputSchema: {
      states: z
        .array(z.enum(["ON", "OFF", "SUSPENDED", "ENDED", "CONVERTED", "ARCHIVED"]))
        .optional()
        .describe("Filter by campaign state (optional)"),
      types: z
        .array(z.string())
        .optional()
        .describe("Filter by campaign type, e.g. TEXT_CAMPAIGN, MOBILE_APP_CAMPAIGN (optional)"),
      statuses: z
        .array(z.enum(["DRAFT", "MODERATION", "ACCEPTED", "REJECTED"]))
        .optional()
        .describe("Filter by moderation status (optional)"),
      ids: z
        .array(z.number())
        .optional()
        .describe("Filter by specific campaign IDs (optional)"),
      limit: z
        .number()
        .int()
        .positive()
        .max(10000)
        .default(100)
        .describe("Maximum number of campaigns to return (default 100, max 10000)"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runDirectListCampaigns({
      states: args.states,
      types: args.types,
      statuses: args.statuses,
      ids: args.ids,
      limit: args.limit,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_list_adgroups",
  {
    title: "Yandex Direct — List Ad Groups",
    description:
      "List Yandex Direct ad groups within campaigns (requires campaign_ids). " +
      "Returns Id, Name, CampaignId, Status, Type, and RegionIds for each matching ad group. " +
      "Use 'campaign_ids' (required) to specify parent campaigns, 'states' to filter by state " +
      "(ON, OFF, SUSPENDED, ENDED, CONVERTED, ARCHIVED), 'statuses' for moderation status " +
      "(DRAFT, MODERATION, ACCEPTED, REJECTED), 'ids' for specific ad group IDs, " +
      "'types' for ad group types, and 'limit' to cap the result set (default 100, max 10000).",
    inputSchema: {
      campaign_ids: z
        .array(z.number())
        .min(1)
        .describe("Parent campaign IDs to filter ad groups by (required)"),
      states: z
        .array(z.enum(["ON", "OFF", "SUSPENDED", "ENDED", "CONVERTED", "ARCHIVED"]))
        .optional()
        .describe("Filter by ad group state (optional)"),
      types: z
        .array(z.string())
        .optional()
        .describe("Filter by ad group type (optional)"),
      statuses: z
        .array(z.enum(["DRAFT", "MODERATION", "ACCEPTED", "REJECTED"]))
        .optional()
        .describe("Filter by moderation status (optional)"),
      ids: z
        .array(z.number())
        .optional()
        .describe("Filter by specific ad group IDs (optional)"),
      limit: z
        .number()
        .int()
        .positive()
        .max(10000)
        .default(100)
        .describe("Maximum number of ad groups to return (default 100, max 10000)"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runDirectListAdGroups({
      campaign_ids: args.campaign_ids,
      states: args.states,
      types: args.types,
      statuses: args.statuses,
      ids: args.ids,
      limit: args.limit,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_list_ads",
  {
    title: "Yandex Direct — List Ads",
    description:
      "List Yandex Direct ads within ad groups (TGO and RSYa types). " +
      "Returns Id, AdGroupId, CampaignId, Status, State, Type, and ad-type-specific fields " +
      "(Title, Title2, Text, Href, DisplayUrlPath for text ads; Title, Title2, Text, Href, AdImageHash for text-image ads). " +
      "Use 'ad_group_ids' (required) to specify parent ad groups, 'campaign_ids' as an optional alternative filter, " +
      "'states' to filter by ad state, 'statuses' for moderation status " +
      "(DRAFT, MODERATION, ACCEPTED, REJECTED), 'ids' for specific ad IDs, " +
      "'types' for ad types (TEXT_AD, TEXT_IMAGE_AD, etc.), and 'limit' to cap the result set (default 100, max 10000).",
    inputSchema: {
      ad_group_ids: z
        .array(z.number())
        .min(1)
        .describe("Parent ad group IDs to filter ads by (required)"),
      campaign_ids: z
        .array(z.number())
        .optional()
        .describe("Parent campaign IDs as an optional additional filter (optional)"),
      states: z
        .array(z.string())
        .optional()
        .describe("Filter by ad state (optional)"),
      statuses: z
        .array(z.enum(["DRAFT", "MODERATION", "ACCEPTED", "REJECTED"]))
        .optional()
        .describe("Filter by moderation status (optional)"),
      types: z
        .array(z.string())
        .optional()
        .describe("Filter by ad type, e.g. TEXT_AD, TEXT_IMAGE_AD (optional)"),
      ids: z
        .array(z.number())
        .optional()
        .describe("Filter by specific ad IDs (optional)"),
      limit: z
        .number()
        .int()
        .positive()
        .max(10000)
        .default(100)
        .describe("Maximum number of ads to return (default 100, max 10000)"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runDirectListAds({
      ad_group_ids: args.ad_group_ids,
      campaign_ids: args.campaign_ids,
      states: args.states,
      statuses: args.statuses,
      types: args.types,
      ids: args.ids,
      limit: args.limit,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_list_keywords",
  {
    title: "Yandex Direct — List Keywords",
    description:
      "List Yandex Direct keywords (active phrases) within ad groups. " +
      "Returns Id, AdGroupId, CampaignId, Keyword, State, Status, and ServingStatus for each matching keyword. " +
      "Use 'ad_group_ids' (required) to specify parent ad groups, 'campaign_ids' as an optional additional filter, " +
      "'states' to filter by keyword state (ON, OFF, SUSPENDED, ARCHIVED), 'statuses' for moderation status " +
      "(DRAFT, MODERATION, ACCEPTED, REJECTED), 'ids' for specific keyword IDs, " +
      "'keyword_text' for exact phrase match, and 'limit' to cap the result set (default 100, max 10000).",
    inputSchema: {
      ad_group_ids: z
        .array(z.number())
        .min(1)
        .describe("Parent ad group IDs to filter keywords by (required)"),
      campaign_ids: z
        .array(z.number())
        .optional()
        .describe("Parent campaign IDs as an optional additional filter (optional)"),
      states: z
        .array(z.enum(["ON", "OFF", "SUSPENDED", "ARCHIVED"]))
        .optional()
        .describe("Filter by keyword state (optional)"),
      statuses: z
        .array(z.enum(["DRAFT", "MODERATION", "ACCEPTED", "REJECTED"]))
        .optional()
        .describe("Filter by moderation status (optional)"),
      ids: z
        .array(z.number())
        .optional()
        .describe("Filter by specific keyword IDs (optional)"),
      keyword_text: z
        .array(z.string())
        .optional()
        .describe("Filter by exact keyword phrase text (optional)"),
      limit: z
        .number()
        .int()
        .positive()
        .max(10000)
        .default(100)
        .describe("Maximum number of keywords to return (default 100, max 10000)"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runDirectListKeywords({
      ad_group_ids: args.ad_group_ids,
      campaign_ids: args.campaign_ids,
      states: args.states,
      statuses: args.statuses,
      ids: args.ids,
      keyword_text: args.keyword_text,
      limit: args.limit,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_get_stats",
  {
    title: "Yandex Direct — Get Stats Report (Reports v5)",
    description:
      "Fetches performance statistics from Yandex Direct using the Reports v5 API (POST with polling). " +
      "The API may respond with 201/202 while the report is being built server-side — this tool polls " +
      "automatically until the report is ready (up to 60 seconds by default). " +
      "Returns parsed rows (one object per row) plus raw TSV, attempt count, and total wait time. " +
      "Use field_names to select metrics (Date, CampaignId, Impressions, Clicks, Cost, Conversions, Ctr, AvgCpc, etc.). " +
      "Use selection_criteria to filter by CampaignIds, AdGroupIds, or add Filter arrays. " +
      "For custom date ranges pass date_range_type='CUSTOM_DATE' with date_from and date_to (YYYY-MM-DD).",
    inputSchema: {
      report_name: z
        .string()
        .min(1)
        .describe("Unique report name (used by Yandex to cache results server-side)"),
      date_range_type: z
        .enum(["TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_30_DAYS", "CUSTOM_DATE"])
        .default("LAST_7_DAYS")
        .describe("Predefined date range or CUSTOM_DATE (requires date_from and date_to)"),
      date_from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "date_from must be YYYY-MM-DD" })
        .optional()
        .describe("Start date (YYYY-MM-DD), required when date_range_type is CUSTOM_DATE"),
      date_to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "date_to must be YYYY-MM-DD" })
        .optional()
        .describe("End date (YYYY-MM-DD), required when date_range_type is CUSTOM_DATE"),
      field_names: z
        .array(z.string())
        .default(["Date", "CampaignId", "Impressions", "Clicks", "Cost", "Conversions", "Ctr", "AvgCpc"])
        .describe("List of field names to include in the report"),
      report_type: z
        .string()
        .default("CUSTOM_REPORT")
        .describe("Report type, e.g. CUSTOM_REPORT, CAMPAIGN_PERFORMANCE_REPORT"),
      include_vat: z
        .enum(["YES", "NO"])
        .default("YES")
        .describe("Whether to include VAT in monetary metrics"),
      selection_criteria: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Optional selection criteria, e.g. { CampaignIds: [123], Filter: [...] }"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runDirectGetStats({
      report_name: args.report_name,
      date_range_type: args.date_range_type,
      date_from: args.date_from,
      date_to: args.date_to,
      field_names: args.field_names,
      report_type: args.report_type,
      include_vat: args.include_vat,
      selection_criteria: args.selection_criteria,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_get_change_history",
  {
    title: "Yandex Direct — Get Change History",
    description:
      "Check Yandex Direct change history (use mode=checkDictionaries first to know dictionary versions, then mode=check with timestamp). " +
      "mode='checkDictionaries' returns current dictionary versions (no timestamp required). " +
      "mode='check' (default) returns which campaigns, ad groups, or ads have changed since the given timestamp — requires since_timestamp in ISO 8601 format. " +
      "Use campaign_ids, ad_group_ids, ad_ids to narrow the scope. Use field_names to limit which fields are checked.",
    inputSchema: {
      mode: z
        .enum(["check", "checkDictionaries"])
        .default("check")
        .describe("'checkDictionaries' to get dictionary versions (no timestamp needed); 'check' to detect changes since a timestamp (default)"),
      since_timestamp: z
        .string()
        .optional()
        .describe("ISO 8601 timestamp marking the start of the change window (required for mode='check'), e.g. '2024-01-01T00:00:00Z'"),
      campaign_ids: z
        .array(z.number())
        .optional()
        .describe("Limit change check to these campaign IDs (optional)"),
      ad_group_ids: z
        .array(z.number())
        .optional()
        .describe("Limit change check to these ad group IDs (optional)"),
      ad_ids: z
        .array(z.number())
        .optional()
        .describe("Limit change check to these ad IDs (optional)"),
      field_names: z
        .array(z.string())
        .optional()
        .describe("Specific field names to check for changes (optional; omit to check all fields)"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runDirectGetChangeHistory({
      mode: args.mode,
      since_timestamp: args.since_timestamp,
      campaign_ids: args.campaign_ids,
      ad_group_ids: args.ad_group_ids,
      ad_ids: args.ad_ids,
      field_names: args.field_names,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_get_search_terms",
  {
    title: "Yandex Direct — Get Search Terms (Search Query Performance)",
    description:
      "Get actual search queries that triggered ads — critical for negative-keyword cleanup. Uses Reports v5 with polling. " +
      "Fetches SEARCH_QUERY_PERFORMANCE_REPORT for the given campaign IDs, returning the real user queries that matched your keywords. " +
      "The API may respond with 201/202 while the report is being built — this tool polls automatically until ready (up to 60 s). " +
      "Use the results to identify irrelevant queries and add them as negative keywords. " +
      "For custom date ranges pass date_range_type='CUSTOM_DATE' with date_from and date_to (YYYY-MM-DD).",
    inputSchema: {
      campaign_ids: z
        .array(z.number())
        .min(1)
        .describe("Campaign IDs to filter search query performance by (required)"),
      date_range_type: z
        .enum(["TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_30_DAYS", "CUSTOM_DATE"])
        .default("LAST_7_DAYS")
        .describe("Predefined date range or CUSTOM_DATE (requires date_from and date_to)"),
      date_from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "date_from must be YYYY-MM-DD" })
        .optional()
        .describe("Start date (YYYY-MM-DD), required when date_range_type is CUSTOM_DATE"),
      date_to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "date_to must be YYYY-MM-DD" })
        .optional()
        .describe("End date (YYYY-MM-DD), required when date_range_type is CUSTOM_DATE"),
      field_names: z
        .array(z.string())
        .default(["Query", "CampaignId", "AdGroupId", "Impressions", "Clicks", "Cost", "Conversions", "Ctr", "AvgCpc"])
        .describe("List of field names to include in the report"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runDirectGetSearchTerms({
      campaign_ids: args.campaign_ids,
      date_range_type: args.date_range_type,
      date_from: args.date_from,
      date_to: args.date_to,
      field_names: args.field_names,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_upload_image",
  {
    title: "Yandex Direct — Upload Image to AdImages Library",
    description:
      "Upload an image to Yandex Direct AdImages library. Accepts URL, local file path, or base64. Returns AdImageHash for use in RSYa ad creation.",
    inputSchema: {
      url: z
        .string()
        .url()
        .optional()
        .describe("Public image URL to fetch and upload (JPEG or PNG, ≤ 10 MB)"),
      file_path: z
        .string()
        .optional()
        .describe("Absolute path to a local image file (JPEG or PNG, ≤ 10 MB)"),
      base64: z
        .string()
        .optional()
        .describe("Base64-encoded image data (JPEG or PNG, ≤ 10 MB decoded)"),
      account: z
        .string()
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectUploadImage({
      url: args.url,
      file_path: args.file_path,
      base64: args.base64,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_create_campaign",
  {
    title: "Yandex Direct — Create Campaign (DRAFT)",
    description:
      "Creates a new Yandex Direct campaign in DRAFT status — no ads are served, no money is spent until the campaign is manually activated. " +
      "Supports three campaign types: 'search' (search network only), 'rsya' (both search off + RSYa network), " +
      "and 'rsya-only' (RSYa network only, no search). " +
      "The daily_budget_rub must be ≥ 100 RUB (Direct minimum). " +
      "When PHASE_3_5_B_SMOKE_MODE=true the name must start with 'phase-3-5-b-test_'. " +
      "confirm: true is required to proceed. Returns { campaign_id, name, type, status: 'DRAFT' }. " +
      "Does NOT call any moderation endpoint — the campaign stays in DRAFT until explicitly activated.",
    inputSchema: {
      type: z
        .enum(["search", "rsya", "rsya-only"])
        .describe("Campaign type: 'search' (search network only), 'rsya' (RSYa network only), 'rsya-only' (RSYa network only, no search serving)"),
      name: z
        .string()
        .min(1)
        .describe("Campaign name. Must start with 'phase-3-5-b-test_' when PHASE_3_5_B_SMOKE_MODE=true"),
      daily_budget_rub: z
        .number()
        .min(100)
        .default(100)
        .describe("Daily budget in RUB (minimum 100 — Direct platform minimum)"),
      region_ids: z
        .array(z.number())
        .default([213])
        .describe("Target region IDs (default [213] = Moscow)"),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "start_date must be YYYY-MM-DD" })
        .optional()
        .describe("Campaign start date in YYYY-MM-DD format (default: today)"),
      strategy: z
        .enum(["WB_DAILY_BUDGET", "AVERAGE_CPC", "AVERAGE_CPA", "AVERAGE_ROI", "WEEKLY_CLICK_PACKAGE", "MANUAL_CPM"])
        .default("WB_DAILY_BUDGET")
        .describe("Bidding strategy (default: WB_DAILY_BUDGET)"),
      counter_ids: z
        .array(z.number())
        .optional()
        .describe("Yandex Metrika counter IDs to attach to the campaign (optional)"),
      confirm: z
        .boolean()
        .describe("Must be true — explicit intent confirmation required to create a campaign"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectCreateCampaign({
      type: args.type,
      name: args.name,
      daily_budget_rub: args.daily_budget_rub,
      region_ids: args.region_ids,
      start_date: args.start_date ?? new Date().toISOString().slice(0, 10),
      strategy: args.strategy,
      counter_ids: args.counter_ids,
      confirm: args.confirm,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_create_adgroup",
  {
    title: "Yandex Direct — Create Ad Group",
    description:
      "Creates a new Yandex Direct ad group inside an existing campaign. " +
      "The ad group type is implied by the parent campaign type — only Name, CampaignId, and RegionIds are sent to the API. " +
      "Supports TEXT_AD_GROUP, MOBILE_APP_AD_GROUP, and DYNAMIC_TEXT_AD_GROUP selection for documentation purposes. " +
      "confirm: true is required to proceed. Returns { ad_group_id, name, campaign_id }.",
    inputSchema: {
      campaign_id: z
        .number()
        .int()
        .positive()
        .describe("Parent campaign ID (required)"),
      name: z
        .string()
        .min(1)
        .describe("Ad group name (required)"),
      region_ids: z
        .array(z.number())
        .default([213])
        .describe("Target region IDs (default [213] = Moscow)"),
      type: z
        .enum(["TEXT_AD_GROUP", "MOBILE_APP_AD_GROUP", "DYNAMIC_TEXT_AD_GROUP"])
        .default("TEXT_AD_GROUP")
        .describe("Ad group type for documentation purposes (default TEXT_AD_GROUP; implied by the parent campaign type)"),
      negative_keywords: z
        .object({ Items: z.array(z.string()) })
        .optional()
        .describe("Negative keywords to attach to the ad group (optional)"),
      confirm: z
        .boolean()
        .describe("Must be true — explicit intent confirmation required to create an ad group"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectCreateAdGroup({
      campaign_id: args.campaign_id,
      name: args.name,
      region_ids: args.region_ids,
      type: args.type,
      negative_keywords: args.negative_keywords,
      confirm: args.confirm,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_create_ad_tgo",
  {
    title: "Yandex Direct — Create TGO Ad (DRAFT)",
    description:
      "Creates a new Yandex Direct text ad (TGO / TextAd) in DRAFT status inside an existing ad group. " +
      "The ad is created via Ads.add with method='add' — no moderation call is made, the ad stays in DRAFT. " +
      "Supports all standard TextAd fields: title (main headline ≤56 chars), optional title2 (secondary headline ≤30 chars), " +
      "text (≤81 chars), href (target URL), optional display_url_path (≤20 chars), optional sitelinks_set_id, " +
      "optional vcard_id, and optional ad_extensions (callout IDs). " +
      "confirm: true is required. Returns { ad_id, ad_group_id, status: 'DRAFT' }.",
    inputSchema: {
      ad_group_id: z
        .number()
        .int()
        .positive()
        .describe("Parent ad group ID (required)"),
      title: z
        .string()
        .min(1)
        .max(56)
        .describe("Main headline (≤56 chars including punctuation — Direct main headline rule)"),
      title2: z
        .string()
        .max(30)
        .optional()
        .describe("Secondary headline (≤30 chars, optional)"),
      text: z
        .string()
        .min(1)
        .max(81)
        .describe("Ad text (≤81 chars including punctuation)"),
      href: z
        .string()
        .min(1)
        .describe("Target URL"),
      display_url_path: z
        .string()
        .max(20)
        .optional()
        .describe("Display URL path (≤20 chars, optional)"),
      sitelinks_set_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Sitelinks set ID from Direct Sitelinks API (optional)"),
      vcard_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("VCard ID (optional)"),
      ad_extensions: z
        .array(z.number().int().positive())
        .optional()
        .describe("Callout extension IDs (optional)"),
      confirm: z
        .boolean()
        .describe("Must be true — explicit intent confirmation required to create an ad"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectCreateAdTgo({
      ad_group_id: args.ad_group_id,
      title: args.title,
      title2: args.title2,
      text: args.text,
      href: args.href,
      display_url_path: args.display_url_path,
      sitelinks_set_id: args.sitelinks_set_id,
      vcard_id: args.vcard_id,
      ad_extensions: args.ad_extensions,
      confirm: args.confirm,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_create_ad_rsya",
  {
    title: "Yandex Direct — Create RSYa Banner Ad (DRAFT)",
    description:
      "Creates a new Yandex Direct RSYa image banner ad (TextImageAd) in DRAFT status inside an existing ad group. " +
      "The ad is created via Ads.add with method='add' — no moderation call is made, the ad stays in DRAFT. " +
      "Requires an AdImageHash obtained from the direct_upload_image tool. " +
      "Supports title (main headline ≤56 chars), optional title2 (≤30 chars), text (≤81 chars), href (target URL), " +
      "optional sitelinks_set_id, and optional vcard_id. " +
      "confirm: true is required. Returns { ad_id, ad_group_id, ad_image_hash, status: 'DRAFT' }.",
    inputSchema: {
      ad_group_id: z
        .number()
        .int()
        .positive()
        .describe("Parent ad group ID (required)"),
      ad_image_hash: z
        .string()
        .min(1)
        .describe("AdImageHash from the Direct AdImages library — use yandex_direct_upload_image to obtain (required)"),
      title: z
        .string()
        .min(1)
        .max(56)
        .describe("Main headline (≤56 chars including punctuation)"),
      title2: z
        .string()
        .max(30)
        .optional()
        .describe("Secondary headline (≤30 chars, optional)"),
      text: z
        .string()
        .min(1)
        .max(81)
        .describe("Ad text (≤81 chars including punctuation)"),
      href: z
        .string()
        .min(1)
        .describe("Target URL"),
      sitelinks_set_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Sitelinks set ID from Direct Sitelinks API (optional)"),
      vcard_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("VCard ID (optional)"),
      confirm: z
        .boolean()
        .describe("Must be true — explicit intent confirmation required to create an ad"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectCreateAdRsya({
      ad_group_id: args.ad_group_id,
      ad_image_hash: args.ad_image_hash,
      title: args.title,
      title2: args.title2,
      text: args.text,
      href: args.href,
      sitelinks_set_id: args.sitelinks_set_id,
      vcard_id: args.vcard_id,
      confirm: args.confirm,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_create_ad_unified",
  {
    title: "Yandex Direct — Create Universal/Combined Ad (DRAFT)",
    description:
      "Create universal/combined Yandex Direct ad — TextImageAd with extended assets (image + optional video + sitelinks + callouts), auto-adapts to search/network placement. DRAFT-only.",
    inputSchema: {
      ad_group_id: z
        .number()
        .int()
        .positive()
        .describe("Parent ad group ID (required)"),
      title: z
        .string()
        .min(1)
        .max(56)
        .describe("Main headline (≤56 chars including punctuation)"),
      title2: z
        .string()
        .max(30)
        .optional()
        .describe("Secondary headline (≤30 chars, optional)"),
      text: z
        .string()
        .min(1)
        .max(81)
        .describe("Ad text (≤81 chars including punctuation)"),
      href: z
        .string()
        .min(1)
        .describe("Target URL"),
      ad_image_hash: z
        .string()
        .min(1)
        .describe("AdImageHash from the Direct AdImages library — use yandex_direct_upload_image to obtain (required)"),
      display_url_path: z
        .string()
        .max(20)
        .optional()
        .describe("Display URL path (≤20 chars, optional)"),
      sitelinks_set_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Sitelinks set ID from Direct Sitelinks API (optional)"),
      vcard_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("VCard ID (optional)"),
      ad_extensions: z
        .array(z.number().int().positive())
        .optional()
        .describe("Callout extension IDs (optional)"),
      video_extension_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Video creative ID for VideoExtension (optional)"),
      confirm: z
        .boolean()
        .describe("Must be true — explicit intent confirmation required to create an ad"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectCreateAdUnified({
      ad_group_id: args.ad_group_id,
      title: args.title,
      title2: args.title2,
      text: args.text,
      href: args.href,
      ad_image_hash: args.ad_image_hash,
      display_url_path: args.display_url_path,
      sitelinks_set_id: args.sitelinks_set_id,
      vcard_id: args.vcard_id,
      ad_extensions: args.ad_extensions,
      video_extension_id: args.video_extension_id,
      confirm: args.confirm,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_link_metrika_goals",
  {
    title: "Yandex Direct — Link Metrika Counter & Goals to Campaign",
    description:
      "Links a Yandex Metrika counter and goals to an existing Yandex Direct campaign. " +
      "Strategy-aware: WB_DAILY_BUDGET campaigns use CounterIds + PriorityGoals; " +
      "AVERAGE_CPA / AVERAGE_ROI / PAY_FOR_CONVERSION campaigns use CounterIds + BiddingStrategy.GoalId. " +
      "Pre-checks that every requested goal_id exists in the Metrika counter before calling Direct. " +
      "Verifies persistence after update and returns warnings if counters or goals did not stick. " +
      "confirm: true is required. Returns { campaign_id, linked_counter_ids, linked_goal_ids, strategy_type, persisted_in_direct, warnings }.",
    inputSchema: {
      campaign_id: z
        .number()
        .int()
        .positive()
        .describe("Yandex Direct campaign ID to link Metrika goals to"),
      counter_ids: z
        .array(z.number().int().positive())
        .min(1)
        .describe("Yandex Metrika counter IDs, e.g. [54918634]"),
      goal_ids: z
        .array(z.number().int().positive())
        .min(1)
        .describe("Metrika goal IDs to link, e.g. [254644847]"),
      strategy_type: z
        .enum(["WB_DAILY_BUDGET", "AVERAGE_CPA", "AVERAGE_ROI", "PAY_FOR_CONVERSION"])
        .describe("Current campaign bidding strategy — determines which Direct fields are updated"),
      priority: z
        .enum(["LOW", "NORMAL", "HIGH"])
        .default("NORMAL")
        .describe("Goal priority for WB_DAILY_BUDGET PriorityGoals (default NORMAL)"),
      confirm: z
        .boolean()
        .describe("Must be true — confirms intent to modify the campaign"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectLinkMetrikaGoals({
      campaign_id: args.campaign_id,
      counter_ids: args.counter_ids,
      goal_ids: args.goal_ids,
      strategy_type: args.strategy_type,
      priority: args.priority,
      confirm: args.confirm,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_pause_campaigns",
  {
    title: "Yandex Direct — DANGER: Pause Campaigns",
    description:
      "DANGER: Pauses one or more live Yandex Direct campaigns by ID (Campaigns.suspend). " +
      "Requires confirm: true, OHMY_SEO_ALLOW_LIVE_MUTATIONS=true, YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true, " +
      "and acknowledge_live matching exactly: I-UNDERSTAND-PAUSE-LIVE:<account>:<sorted_campaign_ids_csv>. " +
      "If account is omitted, use 'default' in the ack string. Sort campaign IDs ascending before joining with comma.",
    inputSchema: {
      campaign_ids: z
        .array(z.number().int().positive())
        .min(1)
        .describe("Campaign IDs to pause (required, at least 1)"),
      confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
      acknowledge_live: z
        .string()
        .describe("Exact ack: I-UNDERSTAND-PAUSE-LIVE:<account_or_default>:<sorted_ids_csv>"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectPauseCampaigns({
      campaign_ids: args.campaign_ids,
      confirm: args.confirm,
      acknowledge_live: args.acknowledge_live,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_resume_campaigns",
  {
    title: "Yandex Direct — DANGER: Resume Campaigns",
    description:
      "DANGER: Resumes one or more suspended Yandex Direct campaigns by ID (Campaigns.resume). " +
      "Requires confirm: true, OHMY_SEO_ALLOW_LIVE_MUTATIONS=true, YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true, " +
      "and acknowledge_live matching exactly: I-UNDERSTAND-RESUME-LIVE:<account>:<sorted_campaign_ids_csv>. " +
      "If account is omitted, use 'default' in the ack string. Sort campaign IDs ascending before joining with comma.",
    inputSchema: {
      campaign_ids: z
        .array(z.number().int().positive())
        .min(1)
        .describe("Campaign IDs to resume (required, at least 1)"),
      confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
      acknowledge_live: z
        .string()
        .describe("Exact ack: I-UNDERSTAND-RESUME-LIVE:<account_or_default>:<sorted_ids_csv>"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectResumeCampaigns({
      campaign_ids: args.campaign_ids,
      confirm: args.confirm,
      acknowledge_live: args.acknowledge_live,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_delete_campaigns",
  {
    title: "Yandex Direct — DANGER: Delete Campaigns",
    description:
      "DANGER: Permanently deletes one or more Yandex Direct campaigns by ID (Campaigns.delete). IRREVERSIBLE. " +
      "Requires confirm: true, OHMY_SEO_ALLOW_LIVE_MUTATIONS=true, YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true, " +
      "YANDEX_DIRECT_ALLOW_DELETE=true, " +
      "and acknowledge_live matching exactly: I-UNDERSTAND-DELETE-LIVE:<account>:<sorted_campaign_ids_csv>. " +
      "If account is omitted, use 'default' in the ack string. Sort campaign IDs ascending before joining with comma.",
    inputSchema: {
      campaign_ids: z
        .array(z.number().int().positive())
        .min(1)
        .describe("Campaign IDs to delete permanently (required, at least 1)"),
      confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
      acknowledge_live: z
        .string()
        .describe("Exact ack: I-UNDERSTAND-DELETE-LIVE:<account_or_default>:<sorted_ids_csv>"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectDeleteCampaigns({
      campaign_ids: args.campaign_ids,
      confirm: args.confirm,
      acknowledge_live: args.acknowledge_live,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_negative_keywords_add",
  {
    title: "Yandex Direct — Add Negative Keywords (DANGER lite)",
    description:
      "Adds negative keywords (minus-words) to a Yandex Direct campaign or ad group. " +
      "Target is either { campaign_id } (campaign-level) or { ad_group_id } (ad group-level) — mutually exclusive. " +
      "Campaign-level: overwrites NegativeKeywords.Items for the campaign (NegativeKeywordSharedSetIds is cleared). " +
      "Ad group-level: overwrites NegativeKeywords.Items for the ad group. " +
      "DANGER lite gate: requires confirm: true, OHMY_SEO_ALLOW_LIVE_MUTATIONS=true, YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true. " +
      "No acknowledge_live ack required (minus-words are lower-risk than pause/delete/budget).",
    inputSchema: {
      target: z
        .union([
          z.object({ campaign_id: z.number().int().positive().describe("Campaign ID to add negative keywords to") }),
          z.object({ ad_group_id: z.number().int().positive().describe("Ad group ID to add negative keywords to") }),
        ])
        .describe("Target: either { campaign_id } or { ad_group_id }"),
      keywords: z
        .array(z.string().min(1))
        .min(1)
        .describe("Negative keywords to add (minus-words), e.g. ['бесплатно', 'своими руками']"),
      confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectNegativeKeywordsAdd({
      target: args.target,
      keywords: args.keywords,
      confirm: args.confirm,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_update_budgets",
  {
    title: "Yandex Direct — DANGER: Update Campaign Daily Budgets",
    description:
      "DANGER: Updates the daily budget for one or more Yandex Direct campaigns. " +
      "Assumes WB_DAILY_BUDGET strategy on the Search network — if a campaign uses a different strategy, " +
      "Yandex Direct will return an error for that campaign (no silent failures). " +
      "One API call per campaign to avoid batch strategy conflicts; results are collected per campaign. " +
      "Requires confirm: true, OHMY_SEO_ALLOW_LIVE_MUTATIONS=true, YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true, " +
      "and acknowledge_live matching exactly: I-UNDERSTAND-BUDGET-LIVE:<account>:<sorted_ids_csv>:<budget_rub>. " +
      "If account is omitted, use 'default' in the ack string.",
    inputSchema: {
      campaign_ids: z
        .array(z.number().int().positive())
        .min(1)
        .describe("Campaign IDs to update daily budget for (required, at least 1)"),
      daily_budget_rub: z
        .number()
        .min(100)
        .describe("New daily budget in RUB (minimum 100 — Direct platform minimum)"),
      confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
      acknowledge_live: z
        .string()
        .describe("Exact ack: I-UNDERSTAND-BUDGET-LIVE:<account_or_default>:<sorted_ids_csv>:<budget_rub>"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectUpdateBudgets({
      campaign_ids: args.campaign_ids,
      daily_budget_rub: args.daily_budget_rub,
      confirm: args.confirm,
      acknowledge_live: args.acknowledge_live,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_upload_campaign_bundle",
  {
    title: "Yandex Direct — Bulk Upload Campaign Bundle from CSV",
    description:
      "High-level bulk Direct campaign upload from Key Collector CSV. Creates campaigns/groups/keywords/ads as DRAFTS (no Ads.moderate). " +
      "Three-stage flow: dry_run=true (default) generates plan_hash → live call with plan_hash+acknowledge_live runs canary → continuation call with continuation_ack completes bulk. " +
      "Includes ledger-based crash recovery. Use packages/yandex-seo/scripts/bundle-recovery.ts to clean up after crashes.",
    inputSchema: {
      csv_path: z
        .string()
        .describe("Absolute path to the Key Collector CSV file with keywords and cluster data"),

      campaign_strategy: z
        .discriminatedUnion("mode", [
          z.object({ mode: z.literal("one-per-cluster") }),
          z.object({ mode: z.literal("one-per-intent"), intent_to_campaign: z.record(z.string(), z.string()) }),
          z.object({ mode: z.literal("single-campaign"), campaign_name: z.string() }),
        ])
        .describe(
          "Campaign grouping strategy: 'one-per-cluster' creates one campaign per cluster, " +
          "'one-per-intent' maps intent labels to campaign names, " +
          "'single-campaign' places all clusters under one named campaign"
        ),

      campaign_type: z
        .enum(["search", "rsya", "rsya-only"])
        .describe("Campaign type: 'search' (search network only), 'rsya' (both networks), 'rsya-only' (RSYa network only)"),

      site_url: z
        .string()
        .describe("Target site URL used as the default href for all ads"),

      daily_budget_rub: z
        .number()
        .int()
        .min(100)
        .describe("Daily budget in RUB per campaign (minimum 100 — Direct platform minimum)"),

      region_ids: z
        .array(z.number().int())
        .min(1)
        .describe("Target region IDs, e.g. [213] for Moscow"),

      bidding_strategy_type: z
        .enum(["WB_DAILY_BUDGET", "HIGHEST_POSITION", "AVERAGE_CPC"])
        .describe("Bidding strategy type applied to all created campaigns"),

      metrika_counter_ids: z
        .array(z.number().int())
        .optional()
        .describe("Yandex Metrika counter IDs to link after bulk upload (optional)"),

      metrika_goal_ids: z
        .array(z.number().int())
        .optional()
        .describe("Metrika goal IDs to link as priority goals (optional)"),

      rsya_image_urls: z
        .array(z.string())
        .optional()
        .describe("Public image URLs to upload and attach as RSYa banner images (optional)"),

      ads_per_group: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(3)
        .describe("Number of ad variants to create per ad group (default 3, max 50)"),

      ad_template_strategy: z
        .enum(["agent-provided", "fallback-template"])
        .default("fallback-template")
        .describe(
          "'fallback-template' generates generic ads from cluster IDs; " +
          "'agent-provided' uses the ad_templates array (required when chosen)"
        ),

      ad_templates: z
        .array(z.any())
        .optional()
        .describe("Ad template objects used when ad_template_strategy='agent-provided' (optional)"),

      dry_run: z
        .boolean()
        .default(true)
        .describe(
          "If true (default), returns plan_hash + expected_ack_live without making any Direct API calls. " +
          "Set to false with plan_hash + acknowledge_live to execute Stage 1 (canary)."
        ),

      canary_percent: z
        .number()
        .min(1)
        .max(100)
        .default(10)
        .describe("Percentage of clusters to process in the canary stage before pausing for confirmation (default 10%)"),

      max_clusters: z
        .number()
        .int()
        .positive()
        .default(50)
        .describe("Maximum number of clusters to process across all stages (default 50)"),

      abort_on_error_rate: z
        .number()
        .min(0)
        .max(1)
        .default(0.3)
        .describe("Abort canary if the error rate exceeds this fraction (default 0.3 = 30%)"),

      plan_hash: z
        .string()
        .optional()
        .describe("Plan hash returned by dry_run=true; required when dry_run=false to bind the live run to the plan"),

      confirm: z
        .boolean()
        .optional()
        .describe("Must be true when dry_run=false — explicit intent confirmation required for live API calls"),

      acknowledge_live: z
        .string()
        .optional()
        .describe(
          "Acknowledgement string from dry-run output (I-UNDERSTAND-BUNDLE-LIVE:<login>:<hash_prefix>); " +
          "required when dry_run=false"
        ),

      canary_passed: z
        .boolean()
        .optional()
        .describe("Set to true in Stage 2 continuation call after reviewing the canary results"),

      continuation_ack: z
        .string()
        .optional()
        .describe(
          "Acknowledgement string from Stage 1 output (I-UNDERSTAND-CONTINUE-LIVE:<login>:<hash_prefix>:<committed_count>); " +
          "required for Stage 2 continuation"
        ),

      account: z
        .string()
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) => runDirectUploadCampaignBundle(args),
);

server.registerTool(
  "yandex_direct_render_to_xlsx",
  {
    title: "Yandex Direct — Render Campaign YAML Folder to Excel",
    description:
      "Renders a campaign YAML folder (Direct Commander-style flat table) to an Excel file (.xlsx). " +
      "Reads _campaign.yaml and all group-*.yaml files from the specified folder, validates them, " +
      "and produces a flat-column spreadsheet with one row per ad (~43 columns). " +
      "Columns cover campaign, sitelinks, promo, group, autotargeting, and ad fields. " +
      "Applies conditional formatting (red fill) on cells that exceed character limits: " +
      "title > 56, title2 > 30, text > 81 chars (for non-RESPONSIVE_AD types). " +
      "Returns xlsx_path, row count, warnings list, and any YAML validation_errors. " +
      "Use this tool to review ad content before live upload via yandex_direct_upload_from_yaml.",
    inputSchema: {
      folder: z
        .string()
        .min(1)
        .describe(
          "Absolute path to the campaign folder containing _campaign.yaml and group-*.yaml files"
        ),
      output_path: z
        .string()
        .optional()
        .describe(
          "Absolute path for the output .xlsx file (default: <folder>/<basename>.xlsx)"
        ),
    },
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  },
  async (args) =>
    runDirectRenderToXlsx({
      folder: args.folder,
      output_path: args.output_path,
    }),
);

server.registerTool(
  "yandex_direct_create_sitelinks_set",
  {
    title: "Yandex Direct — Create Sitelinks Set",
    description:
      "Creates a sitelinks set in Yandex Direct via Sitelinks.add. " +
      "Each sitelink requires a Title (≤30 chars) and Href; Description (≤60 chars) is optional. " +
      "Accepts 1–8 sitelinks per set. Returns the API response with the new SitelinkSetId. " +
      "confirm: true is required to proceed.",
    inputSchema: {
      sitelinks: z
        .array(z.object({
          Title: z.string().min(1).max(30).describe("Sitelink title (≤30 chars, required)"),
          Description: z.string().max(60).optional().describe("Sitelink description (≤60 chars, optional)"),
          Href: z.string().describe("Sitelink URL (required)"),
        }))
        .min(1)
        .max(8)
        .describe("Array of sitelinks (1–8 items)"),
      confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectCreateSitelinksSet({
      sitelinks: args.sitelinks,
      confirm: args.confirm,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_create_promo_extension",
  {
    title: "Yandex Direct — Create Promo Extension (AdExtension)",
    description:
      "Creates a promotional ad extension in Yandex Direct via AdExtensions.add. " +
      "PromotionType is required (DISCOUNT, BONUS, FREE_DELIVERY, SALE, EVENT, BUNDLE). " +
      "EndDate is required; Discount, DiscountUnit, StartDate, PromoCode, and Href are optional. " +
      "Returns the API response with the new AdExtensionId. " +
      "confirm: true is required to proceed.",
    inputSchema: {
      promo: z
        .object({
          PromotionType: z
            .enum(["DISCOUNT", "BONUS", "FREE_DELIVERY", "SALE", "EVENT", "BUNDLE"])
            .describe("Promotion type (required)"),
          Discount: z.number().optional().describe("Discount amount (optional)"),
          DiscountUnit: z
            .enum(["PERCENT", "RUB", "USD", "EUR"])
            .optional()
            .describe("Unit for the discount amount (optional)"),
          StartDate: z.string().optional().describe("Promotion start date YYYY-MM-DD (optional)"),
          EndDate: z.string().describe("Promotion end date YYYY-MM-DD (required)"),
          PromoCode: z.string().optional().describe("Promo code string (optional)"),
          Href: z.string().optional().describe("Promo landing page URL (optional)"),
        })
        .describe("Promo extension fields"),
      confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectCreatePromoExtension({
      promo: args.promo,
      confirm: args.confirm,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_update_adgroup_autotargeting",
  {
    title: "Yandex Direct — Update Ad Group Auto-Targeting Categories",
    description:
      "Updates auto-targeting category settings for a Yandex Direct ad group via AdGroups.update. " +
      "Supports TEXT_AD_GROUP, UNIFIED_AD_GROUP, and MOBILE_APP_AD_GROUP — the correct sub-object " +
      "(TextAdGroupAutoTargeting, UnifiedAdGroupAutoTargeting, MobileAppAdGroupAutoTargeting) is " +
      "selected automatically based on group_type. " +
      "Each category entry has a Category (TARGET_QUERIES, ALTERNATIVE_QUERIES, COMPETITOR_QUERIES, " +
      "ACCESSORY_QUERIES, BROAD_MATCH, EXACT_MENTION) and a Value (YES or NO). " +
      "confirm: true is required to proceed.",
    inputSchema: {
      ad_group_id: z.number().int().describe("Ad group ID to update auto-targeting for (required)"),
      group_type: z
        .enum(["TEXT_AD_GROUP", "UNIFIED_AD_GROUP", "MOBILE_APP_AD_GROUP"])
        .describe("Ad group type — determines which auto-targeting sub-object is set"),
      categories: z
        .array(z.object({
          Category: z
            .enum(["TARGET_QUERIES", "ALTERNATIVE_QUERIES", "COMPETITOR_QUERIES", "ACCESSORY_QUERIES", "BROAD_MATCH", "EXACT_MENTION"])
            .describe("Auto-targeting category name"),
          Value: z.enum(["YES", "NO"]).describe("Enable (YES) or disable (NO) this category"),
        }))
        .describe("Array of auto-targeting category settings"),
      confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
    },
  },
  async (args) =>
    runDirectUpdateAdgroupAutotargeting({
      ad_group_id: args.ad_group_id,
      group_type: args.group_type,
      categories: args.categories,
      confirm: args.confirm,
      account: args.account,
    }),
);

server.registerTool(
  "yandex_direct_upload_from_yaml",
  {
    title: "Yandex Direct — Upload Campaign Bundle from YAML Folder",
    description:
      "Orchestrator that reads a campaigns-draft/<folder>/ YAML bundle, creates dependencies " +
      "(SitelinksSet, PromoExtension, AdImages), resolves template refs, and calls the campaign " +
      "upload pipeline. Three-stage flow mirrors yandex_direct_upload_campaign_bundle: " +
      "dry_run=true (default) validates YAML and returns a plan_hash preview without any API calls; " +
      "dry_run=false with plan_hash+acknowledge_live runs the canary stage; " +
      "continuation with canary_passed+continuation_ack completes the bulk upload. " +
      "Use yandex_direct_render_to_xlsx first to review ad content before uploading.",
    inputSchema: {
      folder: z
        .string()
        .min(1)
        .describe("Absolute path to the campaign folder containing _campaign.yaml and group-*.yaml files"),
      dry_run: z
        .boolean()
        .default(true)
        .describe("If true (default), validates YAML and returns plan preview without any API calls"),
      plan_hash: z
        .string()
        .optional()
        .describe("Plan hash returned by dry_run=true; required when dry_run=false"),
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true when dry_run=false — explicit intent confirmation required"),
      acknowledge_live: z
        .string()
        .optional()
        .describe("Acknowledgement string from dry-run output; required when dry_run=false"),
      canary_passed: z
        .boolean()
        .optional()
        .describe("Set to true in Stage 2 continuation call after reviewing canary results"),
      continuation_ack: z
        .string()
        .optional()
        .describe("Continuation ack from Stage 1 output; required for Stage 2"),
      account: z
        .string()
        .optional()
        .describe("Account label from list_accounts (optional if a default account is configured)"),
      csv_path: z
        .string()
        .optional()
        .describe("Absolute path to a Key Collector CSV; if omitted, a synthetic CSV is derived from YAML group keywords"),
      site_url: z
        .string()
        .optional()
        .describe("Default site URL for ads; if omitted, derived from the first ad's Href in the YAML bundle"),
    },
  },
  async (args) => runDirectUploadFromYaml(args),
);

async function main(): Promise<void> {
  validateRequiredEnv();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-yandex-seo v0.7.0 running via stdio");
}

main().catch((err: Error) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
