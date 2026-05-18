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
import pkg from "../package.json" with { type: "json" };

// OAuth management tools
import { runListGoogleOauthApps } from "./tools/list-google-oauth-apps.js";
import { runRegisterGoogleOauthApp } from "./tools/register-google-oauth-app.js";
import { runDeleteGoogleOauthApp } from "./tools/delete-google-oauth-app.js";
import { runListGoogleAccounts } from "./tools/list-google-accounts.js";
import { runStartGoogleOauthFlow } from "./tools/start-google-oauth-flow.js";
import { runCompleteGoogleOauthFlow } from "./tools/complete-google-oauth-flow.js";
import { runDeleteGoogleAccount } from "./tools/delete-google-account.js";
import { runSetDefaultGoogleAccount } from "./tools/set-default-google-account.js";
import { runRegisterServiceAccount } from "./tools/register-google-service-account.js";

// Read tools
import { runGscListSites } from "./tools/gsc-list-sites.js";
import { runGscSearchAnalytics } from "./tools/gsc-search-analytics.js";
import { runGscUrlInspection } from "./tools/gsc-url-inspection.js";
import { runGscListSitemaps } from "./tools/gsc-list-sitemaps.js";

// Write tools
import { runGscSubmitSitemap } from "./tools/gsc-submit-sitemap.js";
import { runGscDeleteSitemap } from "./tools/gsc-delete-sitemap.js";
import { runGscIndexingPublish } from "./tools/gsc-indexing-publish.js";

const PKG_VERSION: string = pkg.version;

const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: false };
const WRITE = { readOnlyHint: false, openWorldHint: true, idempotentHint: false };

const server = new McpServer(
  { name: "mcp-gsc", version: PKG_VERSION },
  {
    instructions:
      "You have access to mcp-gsc: 16 tools for Google Search Console and Google Indexing API. " +
      "OAuth management (9 tools): list_google_oauth_apps, register_google_oauth_app, delete_google_oauth_app, " +
      "list_google_accounts, start_google_oauth_flow, complete_google_oauth_flow (deprecated), " +
      "delete_google_account, set_default_google_account, register_google_service_account. " +
      "Read tools (4): gsc_list_sites — list all GSC properties; " +
      "gsc_search_analytics — clicks/impressions/CTR/position data; " +
      "gsc_url_inspection — URL index status; " +
      "gsc_list_sitemaps — submitted sitemaps for a property. " +
      "Write tools (3): gsc_submit_sitemap — submit/re-submit a sitemap; " +
      "gsc_delete_sitemap — remove a sitemap; " +
      "gsc_indexing_publish — Indexing API notification (JobPosting/BroadcastEvent only). " +
      "Read results are cached (search_analytics + url_inspection: 1 h; list_sites + list_sitemaps: 24 h). " +
      "Requires MCP_GSC_MASTER_KEY in .env.",
  },
);

function validateRequiredEnv(): void {
  try {
    resolvePackageConfig("google-search-console");
  } catch (err) {
    console.error("FATAL: " + (err as Error).message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Cache policy registration — must run before tool registration
// (tools self-register on import; these calls satisfy the explicit contract
//  requirement to call registerCacheableTool in index.ts)
// ---------------------------------------------------------------------------

registerCacheableTool("gsc_search_analytics", {
  ttlEnvKey: "MCP_GSC_CACHE_TTL_SEARCH",
  ttlDefaultSeconds: 3600, // 1 h
});

registerCacheableTool("gsc_url_inspection", {
  ttlEnvKey: "MCP_GSC_CACHE_TTL_INSPECT",
  ttlDefaultSeconds: 3600, // 1 h
});

registerCacheableTool("gsc_list_sites", {
  ttlEnvKey: "MCP_GSC_CACHE_TTL_META",
  ttlDefaultSeconds: 86400, // 24 h
});

registerCacheableTool("gsc_list_sitemaps", {
  ttlEnvKey: "MCP_GSC_CACHE_TTL_META",
  ttlDefaultSeconds: 86400, // 24 h
});

// ---------------------------------------------------------------------------
// OAuth management tools (9)
// ---------------------------------------------------------------------------

server.registerTool(
  "list_google_oauth_apps",
  {
    title: "Google OAuth — List Registered Apps",
    description:
      "Returns all Google OAuth applications registered in the local encrypted database. " +
      "Each entry shows label, client_id, declared scopes, and created_at. " +
      "Client secrets are never returned — stored encrypted. " +
      "Use before starting an OAuth flow or to audit registered credentials.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  async () => runListGoogleOauthApps(),
);

server.registerTool(
  "register_google_oauth_app",
  {
    title: "Google OAuth — Register New App",
    description:
      "Registers a new Google OAuth application in the local encrypted database. " +
      "client_secret is AES-256 encrypted before storage. " +
      "redirect_uri must be a loopback URI (http://127.0.0.1:PORT/oauth/callback) — " +
      "OOB redirect is not supported (Google deprecated it 2023-01-31). " +
      "After registration, use start_google_oauth_flow to connect an account.",
    inputSchema: {
      label: z.string().min(1).max(64).describe("Short unique name for this app, e.g. 'my-gsc-app'"),
      client_id: z.string().min(8).max(256).describe("Google OAuth client_id from Google Cloud Console"),
      client_secret: z.string().min(8).max(256).describe("Google OAuth client_secret (stored encrypted)"),
      scopes_declared: z.string().min(1).max(512).describe("Space-delimited OAuth scopes"),
      redirect_uri: z.string().min(1).describe("Loopback redirect URI, e.g. http://127.0.0.1:8765/oauth/callback"),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runRegisterGoogleOauthApp({
      label: args.label as string,
      client_id: args.client_id as string,
      client_secret: args.client_secret as string,
      scopes_declared: args.scopes_declared as string,
      redirect_uri: args.redirect_uri as string,
    }),
);

server.registerTool(
  "delete_google_oauth_app",
  {
    title: "Google OAuth — Delete App",
    description:
      "Deletes a registered Google OAuth application by label. Blocked if accounts are linked to it — " +
      "delete those first with delete_google_account. Action is irreversible.",
    inputSchema: {
      app_label: z.string().min(1).max(64).describe("Label of the OAuth app to delete"),
    },
    annotations: WRITE,
  },
  async (args) => runDeleteGoogleOauthApp({ app_label: args.app_label as string }),
);

server.registerTool(
  "list_google_accounts",
  {
    title: "Google OAuth — List Connected Accounts",
    description:
      "Returns all Google accounts connected via OAuth or Service Account stored in the local database. " +
      "Shows label, google_email, auth_method, scopes_granted, expires_at, and is_default. " +
      "Tokens are never returned — stored encrypted.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  async () => runListGoogleAccounts(),
);

server.registerTool(
  "start_google_oauth_flow",
  {
    title: "Google OAuth — Start Authorization Flow",
    description:
      "Begins a Google OAuth authorization code flow with automatic loopback callback. " +
      "Opens a local HTTP listener, returns an authorize_url to open in a browser. " +
      "Waits up to 5 minutes for the user to complete authorization, then saves the account. " +
      "account_label must be free (not already taken — check list_google_accounts).",
    inputSchema: {
      app_label: z.string().min(1).max(64).describe("Label of the registered OAuth app to use"),
      account_label: z.string().min(1).max(64).describe("Desired label for the new account"),
      login_hint: z.string().optional().describe("Google email to pre-fill in consent screen (optional)"),
    },
    annotations: WRITE,
  },
  async (args) =>
    runStartGoogleOauthFlow({
      app_label: args.app_label as string,
      account_label: args.account_label as string,
      login_hint: args.login_hint as string | undefined,
    }),
);

server.registerTool(
  "complete_google_oauth_flow",
  {
    title: "Google OAuth — Complete Authorization Flow (Deprecated)",
    description:
      "Deprecated. Use start_google_oauth_flow which auto-completes via loopback. " +
      "OOB flow no longer supported since Google deprecated it on 2023-01-31.",
    inputSchema: {
      app_label: z.string().min(1).describe("Label of the registered OAuth app"),
      account_label: z.string().min(1).describe("Desired label for the account"),
      code: z.string().min(1).describe("Authorization code from Google"),
      state: z.string().min(1).describe("State token from start_google_oauth_flow"),
    },
    annotations: WRITE,
  },
  async (args) =>
    runCompleteGoogleOauthFlow({
      app_label: args.app_label as string,
      account_label: args.account_label as string,
      code: args.code as string,
      state: args.state as string,
    }),
);

server.registerTool(
  "delete_google_account",
  {
    title: "Google OAuth — Delete Account",
    description:
      "Deletes a connected Google account by label. Removes tokens from the database. " +
      "Does not revoke tokens on Google's side. To reconnect, run start_google_oauth_flow again.",
    inputSchema: {
      account_label: z.string().min(1).max(64).describe("Label of the account to delete"),
    },
    annotations: WRITE,
  },
  async (args) => runDeleteGoogleAccount({ account_label: args.account_label as string }),
);

server.registerTool(
  "set_default_google_account",
  {
    title: "Google OAuth — Set Default Account",
    description:
      "Marks a Google account as the default. Tools that accept an optional 'account' parameter " +
      "will use this account when none is specified. Use list_google_accounts to see available labels.",
    inputSchema: {
      account_label: z.string().min(1).max(64).describe("Label of the account to set as default"),
    },
    annotations: WRITE,
  },
  async (args) => runSetDefaultGoogleAccount({ account_label: args.account_label as string }),
);

server.registerTool(
  "register_google_service_account",
  {
    title: "Google — Register Service Account",
    description:
      "Registers a Google Service Account from a JSON key file. Validates the key by obtaining an " +
      "access token before saving. Required for gsc_indexing_publish (Indexing API) which needs " +
      "OWNER-level Service Account on the GSC property. Provide scopes as space-delimited string.",
    inputSchema: {
      account_label: z.string().min(1).max(64).describe("Label for this service account, e.g. 'indexing-sa'"),
      json_path: z.string().min(1).describe("Absolute path to the service account JSON key file"),
      scopes: z.string().min(1).describe("Space-delimited OAuth scopes, e.g. 'https://www.googleapis.com/auth/indexing'"),
    },
    annotations: WRITE,
  },
  async (args) =>
    runRegisterServiceAccount({
      account_label: args.account_label as string,
      json_path: args.json_path as string,
      scopes: args.scopes as string,
    }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMcpContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Read tools (4) — cacheable
// ---------------------------------------------------------------------------

server.registerTool(
  "gsc_list_sites",
  {
    title: "GSC — List Sites",
    description: "Lists all sites (properties) accessible in Google Search Console for the resolved account.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
    },
    annotations: READ_ONLY,
  },
  async (args) => toMcpContent(await runGscListSites({ account: args.account })),
);

server.registerTool(
  "gsc_search_analytics",
  {
    title: "GSC — Search Analytics",
    description: "Queries GSC Search Analytics (clicks, impressions, CTR, position) for a site property.",
    inputSchema: {
      account: z.string().optional().describe("Registered Google account label (uses default if omitted)."),
      siteUrl: z.string().describe("Property URL, e.g. 'sc-domain:example.com' or 'https://example.com/'."),
      startDate: z.string().describe("Start date YYYY-MM-DD (Pacific Time)."),
      endDate: z.string().describe("End date YYYY-MM-DD (Pacific Time)."),
      dimensions: z.array(z.enum(["query", "page", "country", "device", "searchAppearance", "date"])).optional().describe("Dimensions to group results by."),
      dimensionFilterGroups: z.array(z.record(z.string(), z.unknown())).optional().describe("Array of dimension filter groups (groupType: 'and')."),
      type: z.enum(["web", "image", "video", "news", "discover", "googleNews"]).optional().describe("Search type filter."),
      dataState: z.enum(["final", "all"]).optional().describe("'final' (default) for stable data; 'all' includes recent rows."),
      rowLimit: z.number().optional().describe("Max rows (1–25000, default 1000)."),
      startRow: z.number().optional().describe("Pagination offset (default 0)."),
      aggregationType: z.enum(["auto", "byPage", "byProperty"]).optional().describe("Impression aggregation mode."),
      force_refresh: z.boolean().optional().describe("Bypass cache and fetch fresh data."),
    },
    annotations: READ_ONLY,
  },
  async (args) => toMcpContent(await runGscSearchAnalytics(args)),
);

server.registerTool(
  "gsc_url_inspection",
  {
    title: "GSC — URL Inspection",
    description: "Inspects a URL against the Google Search Console index for the given site property.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      siteUrl: z.string().describe("The site property URL (e.g. https://example.com/ or sc-domain:example.com)."),
      inspectionUrl: z.string().describe("The URL to inspect (must be under siteUrl)."),
      languageCode: z.string().optional().describe("BCP-47 language code for the inspection result (optional; e.g. 'en-US')."),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    toMcpContent(
      await runGscUrlInspection({
        account: args.account,
        siteUrl: args.siteUrl,
        inspectionUrl: args.inspectionUrl,
        languageCode: args.languageCode,
      }),
    ),
);

server.registerTool(
  "gsc_list_sitemaps",
  {
    title: "GSC — List Sitemaps",
    description: "Lists all sitemaps submitted for a site property in Google Search Console.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      siteUrl: z.string().describe("The site property URL (e.g. https://example.com/ or sc-domain:example.com)."),
    },
    annotations: READ_ONLY,
  },
  async (args) => toMcpContent(await runGscListSitemaps({ account: args.account, siteUrl: args.siteUrl })),
);

// ---------------------------------------------------------------------------
// Write tools (3)
// ---------------------------------------------------------------------------

server.registerTool(
  "gsc_submit_sitemap",
  {
    title: "GSC — Submit Sitemap",
    description: "Submits (or re-submits) a sitemap to Google Search Console via PUT request. Requires SCOPE_GSC_FULL.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      siteUrl: z.string().describe("The site URL as registered in Search Console (e.g. https://example.com/)."),
      feedpath: z.string().describe("Full URL of the sitemap (e.g. https://example.com/sitemap.xml)."),
    },
    annotations: WRITE,
  },
  async (args) =>
    toMcpContent(
      await runGscSubmitSitemap({ account: args.account, siteUrl: args.siteUrl, feedpath: args.feedpath }),
    ),
);

server.registerTool(
  "gsc_delete_sitemap",
  {
    title: "GSC — Delete Sitemap",
    description: "Deletes a sitemap from Google Search Console via DELETE request. Requires SCOPE_GSC_FULL.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      siteUrl: z.string().describe("The site URL as registered in Search Console (e.g. https://example.com/)."),
      feedpath: z.string().describe("Full URL of the sitemap to delete (e.g. https://example.com/sitemap.xml)."),
    },
    annotations: WRITE,
  },
  async (args) =>
    toMcpContent(
      await runGscDeleteSitemap({ account: args.account, siteUrl: args.siteUrl, feedpath: args.feedpath }),
    ),
);

server.registerTool(
  "gsc_indexing_publish",
  {
    title: "GSC — Indexing API Publish",
    description:
      "Sends a URL notification to the Google Indexing API (POST /v3/urlNotifications:publish). " +
      "WARNING: works ONLY for JobPosting / BroadcastEvent / LivestreamEvent URLs. " +
      "Requires Service Account with OWNER role on the GSC property. Default quota: 200 calls/day.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      url: z.string().describe("Fully-qualified URL of the page to notify (must contain JobPosting or BroadcastEvent schema)."),
      type: z.enum(["URL_UPDATED", "URL_DELETED"]).describe("URL_UPDATED for new/changed pages; URL_DELETED for removed pages."),
    },
    annotations: WRITE,
  },
  async (args) =>
    toMcpContent(
      await runGscIndexingPublish({ account: args.account, url: args.url, type: args.type }),
    ),
);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  validateRequiredEnv();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mcp-gsc v${PKG_VERSION} running via stdio`);
}

main().catch((err: Error) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
