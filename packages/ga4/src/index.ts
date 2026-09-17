#!/usr/bin/env node
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolvePackageConfig } from "@ohmy-seo/mcp-core/config";
import { registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { confirmField } from "./lib/confirm-gate.js";

import { runListGoogleOauthApps } from "./tools/list-google-oauth-apps.js";
import { runRegisterGoogleOauthApp } from "./tools/register-google-oauth-app.js";
import { runDeleteGoogleOauthApp } from "./tools/delete-google-oauth-app.js";
import { runListGoogleAccounts } from "./tools/list-google-accounts.js";
import { runStartGoogleOauthFlow } from "./tools/start-google-oauth-flow.js";
import { runCompleteGoogleOauthFlow } from "./tools/complete-google-oauth-flow.js";
import { runDeleteGoogleAccount } from "./tools/delete-google-account.js";
import { runSetDefaultGoogleAccount } from "./tools/set-default-google-account.js";
import { runRegisterServiceAccount } from "./tools/register-google-service-account.js";
import { runGa4ListProperties } from "./tools/ga4-list-properties.js";
import { runGa4GetMetadata } from "./tools/ga4-get-metadata.js";
import { runGa4ListCustomDimensions } from "./tools/ga4-list-custom-dimensions.js";
import { runGa4ListConversionEvents } from "./tools/ga4-list-conversion-events.js";
import { runGa4RunReport } from "./tools/ga4-run-report.js";
import { runGa4RunRealtimeReport } from "./tools/ga4-run-realtime-report.js";
import { runGa4BatchRunReports } from "./tools/ga4-batch-run-reports.js";
import { runGa4RunPivotReport } from "./tools/ga4-run-pivot-report.js";
import { runGa4UpdateProperty } from "./tools/ga4-update-property.js";
import { runGa4CreateCustomDimension } from "./tools/ga4-create-custom-dimension.js";
import { runGa4UpdateCustomDimension } from "./tools/ga4-update-custom-dimension.js";
import { runGa4ArchiveCustomDimension } from "./tools/ga4-archive-custom-dimension.js";
import { runGa4CreateKeyEvent } from "./tools/ga4-create-key-event.js";
import { runGa4DeleteKeyEvent } from "./tools/ga4-delete-key-event.js";
import { runGa4UpdateDataRetention } from "./tools/ga4-update-data-retention.js";

// Cache registration — 16 tools are cacheable.
// ga4_run_realtime_report is intentionally excluded (realtime data must not be stale).
const META = { ttlEnvKey: "MCP_GA4_CACHE_TTL_META", ttlDefaultSeconds: 86_400 };
const RPT  = { ttlEnvKey: "MCP_GA4_CACHE_TTL_REPORT", ttlDefaultSeconds: 3600 };
registerCacheableTool("ga4_list_properties", META);
registerCacheableTool("ga4_get_metadata", META);
registerCacheableTool("ga4_list_custom_dimensions", META);
registerCacheableTool("ga4_list_conversion_events", META);
registerCacheableTool("ga4_run_report", RPT);
registerCacheableTool("ga4_batch_run_reports", RPT);
registerCacheableTool("ga4_run_pivot_report", RPT);

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const RO = { readOnlyHint: true, openWorldHint: true, idempotentHint: false };
const WRITE = { readOnlyHint: false, openWorldHint: true, idempotentHint: false };

const server = new McpServer(
  { name: "mcp-ga4", version: pkg.version },
  {
    instructions:
      "mcp-ga4: 24 GA4 tools. " +
      "OAuth (9): list_google_oauth_apps, register_google_oauth_app, delete_google_oauth_app, " +
      "list_google_accounts, start_google_oauth_flow, complete_google_oauth_flow, " +
      "delete_google_account, set_default_google_account, register_google_service_account. " +
      "Read/cached-24h (4): ga4_list_properties, ga4_get_metadata, ga4_list_custom_dimensions, ga4_list_conversion_events. " +
      "Reports/cached-1h (3): ga4_run_report, ga4_batch_run_reports, ga4_run_pivot_report. " +
      "Realtime/not-cached (1): ga4_run_realtime_report. " +
      "Write/analytics.edit (7): ga4_update_property, ga4_create_custom_dimension, ga4_update_custom_dimension, " +
      "ga4_archive_custom_dimension (irreversible), ga4_create_key_event, ga4_delete_key_event (irreversible), " +
      "ga4_update_data_retention. All write tools default to confirm:false (dry-run preview); pass confirm:true to execute.",
  },
);

// Local non-generic wrapper around registerTool to avoid the SDK's expensive
// generic ShapeOutput<> instantiation (zod 3.25 + TS 5.9 => TS2589 / V8 OOM).
type RegToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape;
  outputSchema?: z.ZodRawShape;
  annotations?: Record<string, unknown>;
};
const reg = (
  name: string,
  config: RegToolConfig,
  cb: (args: any, extra: any) => unknown,
): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.registerTool as any)(name, config, cb);
};

function validateRequiredEnv(): void {
  try { resolvePackageConfig("ga4"); }
  catch (err) { console.error("FATAL: " + (err as Error).message); process.exit(1); }
}

const LBL = z.string().min(1).max(64)
  .regex(/^[a-z0-9_-]+$/i, "label must be alphanumeric, dash or underscore");
const ACCT = z.string().min(1).optional()
  .describe("Account label (optional when a default is set)");
const PROP = z.string().min(1).describe("GA4 property ID or 'properties/NNNNNN'");

// --- OAuth management (9) ---

reg("list_google_oauth_apps",
  { title: "Google OAuth — List Apps",
    description: "List all registered Google OAuth apps. Client secrets are never returned.",
    inputSchema: {}, annotations: RO },
  async () => runListGoogleOauthApps());

reg("register_google_oauth_app",
  { title: "Google OAuth — Register App",
    description: "Register a Google OAuth app. client_secret is AES-256 encrypted at rest. Use a loopback redirect_uri.",
    inputSchema: {
      label: LBL.describe("Unique app label"),
      client_id: z.string().min(8).max(256).describe("Google OAuth client_id"),
      client_secret: z.string().min(8).max(256).describe("Google OAuth client_secret (encrypted)"),
      scopes_declared: z.string().min(1).max(512).describe("Space-delimited OAuth scopes"),
      redirect_uri: z.string().min(1).max(256).describe("Loopback redirect URI, e.g. http://127.0.0.1:8766/oauth/callback"),
    }, annotations: RO },
  async (args) => runRegisterGoogleOauthApp(args));

reg("delete_google_oauth_app",
  { title: "Google OAuth — Delete App",
    description: "Delete an OAuth app by label. Blocked if accounts are attached — delete those first.",
    inputSchema: { app_label: LBL.describe("Label of the app to delete") }, annotations: RO },
  async (args) => runDeleteGoogleOauthApp(args));

reg("list_google_accounts",
  { title: "Google OAuth — List Accounts",
    description: "List all connected Google accounts. Tokens are never returned in plain text.",
    inputSchema: {}, annotations: RO },
  async () => runListGoogleAccounts());

reg("start_google_oauth_flow",
  { title: "Google OAuth — Start Flow",
    description: "Start a Google OAuth loopback flow. Opens a local listener, waits up to 5 min for browser callback, then stores tokens.",
    inputSchema: {
      app_label: LBL.describe("OAuth app label"),
      account_label: LBL.describe("Desired account label"),
      login_hint: z.string().optional().describe("Google email hint (optional)"),
    }, annotations: RO },
  async (args) => runStartGoogleOauthFlow(args));

reg("complete_google_oauth_flow",
  { title: "Google OAuth — Complete Flow (Deprecated)",
    description: "Deprecated — OOB OAuth removed by Google 2023-01-31. Use start_google_oauth_flow instead.",
    inputSchema: {
      app_label: LBL.describe("OAuth app label"),
      account_label: LBL.describe("Account label"),
      code: z.string().min(1).describe("Auth code (OOB, deprecated)"),
      state: z.string().min(1).describe("State from start flow"),
    }, annotations: RO },
  async (args) => runCompleteGoogleOauthFlow(args));

reg("delete_google_account",
  { title: "Google OAuth — Delete Account",
    description: "Delete a connected Google account by label, permanently removing encrypted tokens.",
    inputSchema: { account_label: LBL.describe("Account label to delete") }, annotations: RO },
  async (args) => runDeleteGoogleAccount(args));

reg("set_default_google_account",
  { title: "Google OAuth — Set Default Account",
    description: "Mark an account as default for all GA4 tools. Clears the previous default.",
    inputSchema: { account_label: LBL.describe("Account label to set as default") }, annotations: RO },
  async (args) => runSetDefaultGoogleAccount(args));

reg("register_google_service_account",
  { title: "Google Service Account — Register",
    description: "Register a service account from a JSON key file. Verifies by exchanging JWT for access token before storing.",
    inputSchema: {
      account_label: LBL.describe("Desired account label"),
      json_path: z.string().min(1).describe("Absolute path to service account JSON key file"),
      scopes: z.string().min(1).describe("Space-delimited OAuth scopes"),
    }, annotations: RO },
  async (args) => runRegisterServiceAccount(args));

// --- Read tools (4) — cached 24 h (MCP_GA4_CACHE_TTL_META) ---

reg("ga4_list_properties",
  { title: "GA4 — List Properties",
    description: "List GA4 account summaries and properties via Admin API. Cached 24 h (MCP_GA4_CACHE_TTL_META).",
    inputSchema: { account: ACCT }, annotations: RO },
  async (args) => runGa4ListProperties({ account: args.account }));

reg("ga4_get_metadata",
  { title: "GA4 — Get Metadata",
    description: "Get all dimensions and metrics for a property (Data API v1beta/{property}/metadata). Cached 24 h.",
    inputSchema: { account: ACCT, property: PROP }, annotations: RO },
  async (args) => runGa4GetMetadata({ account: args.account, property: args.property }));

reg("ga4_list_custom_dimensions",
  { title: "GA4 — List Custom Dimensions",
    description: "List custom dimensions for a property (Admin API v1beta/{property}/customDimensions). Cached 24 h.",
    inputSchema: { account: ACCT, property: PROP }, annotations: RO },
  async (args) => runGa4ListCustomDimensions({ account: args.account, property: args.property }));

reg("ga4_list_conversion_events",
  { title: "GA4 — List Key Events (Conversion Events)",
    description: "List key events (formerly conversion events) via Admin API v1beta/{property}/keyEvents. Cached 24 h.",
    inputSchema: { account: ACCT, property: PROP }, annotations: RO },
  async (args) => runGa4ListConversionEvents({ account: args.account, property: args.property }));

// --- Report tools (3) — cached 1 h (MCP_GA4_CACHE_TTL_REPORT) ---

reg("ga4_run_report",
  { title: "GA4 — Run Report",
    description: "Run a standard GA4 report (Data API v1beta/{property}:runReport). Cached 1 h (MCP_GA4_CACHE_TTL_REPORT).",
    inputSchema: {
      account: ACCT, property: PROP,
      dimensions: z.array(z.object({ name: z.string() })).describe("Dimensions, e.g. [{name:'date'}]"),
      metrics: z.array(z.object({ name: z.string(), expression: z.string().optional() })).describe("Metrics, e.g. [{name:'sessions'}]"),
      dateRanges: z.array(z.object({ startDate: z.string(), endDate: z.string(), name: z.string().optional() })).describe("Date ranges"),
      dimensionFilter: z.unknown().optional().describe("Dimension FilterExpression (optional)"),
      metricFilter: z.unknown().optional().describe("Metric FilterExpression (optional)"),
      orderBys: z.array(z.unknown()).optional().describe("OrderBy list (optional)"),
      limit: z.number().int().positive().optional().describe("Max rows (optional)"),
      offset: z.number().int().nonnegative().optional().describe("Row offset (optional)"),
      keepEmptyRows: z.boolean().optional().describe("Include zero-metric rows (optional)"),
      returnPropertyQuota: z.boolean().optional().describe("Include quota info (optional)"),
    }, annotations: RO },
  async (args) => runGa4RunReport({
    account: args.account, property: args.property,
    dimensions: args.dimensions, metrics: args.metrics, dateRanges: args.dateRanges,
    dimensionFilter: args.dimensionFilter as object | undefined,
    metricFilter: args.metricFilter as object | undefined,
    orderBys: args.orderBys as object[] | undefined,
    limit: args.limit, offset: args.offset,
    keepEmptyRows: args.keepEmptyRows, returnPropertyQuota: args.returnPropertyQuota,
  }));

// --- Realtime report — NOT cached ---

reg("ga4_run_realtime_report",
  { title: "GA4 — Run Realtime Report",
    description: "Run a GA4 realtime report (Data API v1beta/{property}:runRealtimeReport, last 30 min). Not cached.",
    inputSchema: {
      account: ACCT, property: PROP,
      metrics: z.array(z.object({ name: z.string() })).describe("Metrics, e.g. [{name:'activeUsers'}]"),
      dimensions: z.array(z.object({ name: z.string() })).optional().describe("Dimensions (optional)"),
      dimensionFilter: z.unknown().optional().describe("Dimension FilterExpression (optional)"),
      metricFilter: z.unknown().optional().describe("Metric FilterExpression (optional)"),
      orderBys: z.array(z.unknown()).optional().describe("OrderBy list (optional)"),
      limit: z.number().int().positive().optional().describe("Max rows (optional)"),
      minuteRanges: z.array(z.object({
        name: z.string().optional(),
        startMinutesAgo: z.number().int().nonnegative().optional(),
        endMinutesAgo: z.number().int().nonnegative().optional(),
      })).optional().describe("Minute ranges within last 30 min (optional)"),
      returnPropertyQuota: z.boolean().optional().describe("Include quota info (optional)"),
    }, annotations: RO },
  async (args) => runGa4RunRealtimeReport({
    account: args.account, property: args.property,
    metrics: args.metrics, dimensions: args.dimensions,
    dimensionFilter: args.dimensionFilter as object | undefined,
    metricFilter: args.metricFilter as object | undefined,
    orderBys: args.orderBys as object[] | undefined,
    limit: args.limit, minuteRanges: args.minuteRanges,
    returnPropertyQuota: args.returnPropertyQuota,
  }));

reg("ga4_batch_run_reports",
  { title: "GA4 — Batch Run Reports",
    description: "Run up to 5 GA4 reports in one call (Data API v1beta/{property}:batchRunReports). Cached 1 h.",
    inputSchema: {
      account: ACCT, property: PROP,
      requests: z.array(z.unknown()).min(1).max(5).describe("Up to 5 RunReport bodies (without 'property')"),
    }, annotations: RO },
  async (args) => runGa4BatchRunReports({
    account: args.account, property: args.property, requests: args.requests as object[],
  }));

reg("ga4_run_pivot_report",
  { title: "GA4 — Run Pivot Report",
    description: "Run a GA4 pivot report (Data API v1beta/{property}:runPivotReport). Cached 1 h. Requires at least one pivot.",
    inputSchema: {
      account: ACCT, property: PROP,
      dimensions: z.array(z.object({ name: z.string() })).describe("Dimensions"),
      metrics: z.array(z.object({ name: z.string(), expression: z.string().optional() })).describe("Metrics"),
      dateRanges: z.array(z.object({ startDate: z.string(), endDate: z.string(), name: z.string().optional() })).describe("Date ranges"),
      pivots: z.array(z.object({
        fieldNames: z.array(z.string()),
        orderBys: z.array(z.unknown()).optional(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional(),
        metricAggregations: z.array(z.string()).optional(),
      })).min(1).describe("Pivot definitions — at least one required"),
      dimensionFilter: z.unknown().optional().describe("Dimension FilterExpression (optional)"),
      metricFilter: z.unknown().optional().describe("Metric FilterExpression (optional)"),
      keepEmptyRows: z.boolean().optional().describe("Include zero-metric rows (optional)"),
      returnPropertyQuota: z.boolean().optional().describe("Include quota info (optional)"),
    }, annotations: RO },
  async (args) => runGa4RunPivotReport({
    account: args.account, property: args.property,
    dimensions: args.dimensions, metrics: args.metrics, dateRanges: args.dateRanges,
    pivots: args.pivots as Array<{ fieldNames: string[]; orderBys?: object[]; offset?: number; limit?: number; metricAggregations?: string[] }>,
    dimensionFilter: args.dimensionFilter as object | undefined,
    metricFilter: args.metricFilter as object | undefined,
    keepEmptyRows: args.keepEmptyRows, returnPropertyQuota: args.returnPropertyQuota,
  }));

// --- Write tools (7) — Admin API, require analytics.edit (SCOPE_GA4_EDIT) ---
// All default confirm:false (dry-run preview, no API call, no token fetch).

reg("ga4_update_property",
  { title: "GA4 — Update Property",
    description: "WRITE — updates a GA4 property's displayName, timeZone, currencyCode and/or " +
      "industryCategory (Admin API PATCH v1beta/{property}). " +
      "confirm:false returns a dry-run preview; confirm:true executes the update.",
    inputSchema: {
      account: ACCT, property: PROP,
      displayName: z.string().optional().describe("New display name (optional)"),
      timeZone: z.string().optional().describe("IANA time zone, e.g. 'America/Los_Angeles' (optional)"),
      currencyCode: z.string().optional().describe("ISO 4217 currency code, e.g. 'USD' (optional)"),
      industryCategory: z.string().optional().describe("Industry category enum, e.g. 'TECHNOLOGY' (optional)"),
      confirm: confirmField,
    }, annotations: WRITE },
  async (args) => runGa4UpdateProperty({
    account: args.account, property: args.property,
    displayName: args.displayName, timeZone: args.timeZone,
    currencyCode: args.currencyCode, industryCategory: args.industryCategory,
    confirm: args.confirm,
  }));

reg("ga4_create_custom_dimension",
  { title: "GA4 — Create Custom Dimension",
    description: "WRITE — creates a custom dimension (Admin API POST v1beta/{property}/customDimensions). " +
      "confirm:false returns a dry-run preview; confirm:true executes the create.",
    inputSchema: {
      account: ACCT, property: PROP,
      parameterName: z.string().min(1).describe("Tagging parameter name (immutable once created)"),
      displayName: z.string().min(1).describe("Display name shown in Analytics UI"),
      scope: z.enum(["EVENT", "USER", "ITEM"]).describe("Dimension scope (immutable once created)"),
      description: z.string().optional().describe("Description (optional)"),
      disallowAdsPersonalization: z.boolean().optional()
        .describe("Disable ads personalization for this dimension. Only valid when scope is USER (optional)"),
      confirm: confirmField,
    }, annotations: WRITE },
  async (args) => runGa4CreateCustomDimension({
    account: args.account, property: args.property,
    parameterName: args.parameterName, displayName: args.displayName, scope: args.scope,
    description: args.description, disallowAdsPersonalization: args.disallowAdsPersonalization,
    confirm: args.confirm,
  }));

reg("ga4_update_custom_dimension",
  { title: "GA4 — Update Custom Dimension",
    description: "WRITE — updates a custom dimension's displayName, description and/or " +
      "disallowAdsPersonalization (Admin API PATCH v1beta/{property}/customDimensions/{id}). " +
      "confirm:false returns a dry-run preview; confirm:true executes the update.",
    inputSchema: {
      account: ACCT, property: PROP,
      customDimension: z.string().min(1).describe("Custom dimension ID or full 'properties/.../customDimensions/...' name"),
      displayName: z.string().optional().describe("New display name (optional)"),
      description: z.string().optional().describe("New description (optional)"),
      disallowAdsPersonalization: z.boolean().optional().describe("Disable ads personalization (optional)"),
      confirm: confirmField,
    }, annotations: WRITE },
  async (args) => runGa4UpdateCustomDimension({
    account: args.account, property: args.property, customDimension: args.customDimension,
    displayName: args.displayName, description: args.description,
    disallowAdsPersonalization: args.disallowAdsPersonalization,
    confirm: args.confirm,
  }));

reg("ga4_archive_custom_dimension",
  { title: "GA4 — Archive Custom Dimension (irreversible)",
    description: "WRITE, IRREVERSIBLE — archives a custom dimension (Admin API POST " +
      "v1beta/{property}/customDimensions/{id}:archive). The parameterName cannot be reused afterwards. " +
      "confirm:false returns a dry-run preview; confirm:true executes the archive.",
    inputSchema: {
      account: ACCT, property: PROP,
      customDimension: z.string().min(1).describe("Custom dimension ID or full 'properties/.../customDimensions/...' name"),
      confirm: confirmField,
    }, annotations: WRITE },
  async (args) => runGa4ArchiveCustomDimension({
    account: args.account, property: args.property, customDimension: args.customDimension,
    confirm: args.confirm,
  }));

reg("ga4_create_key_event",
  { title: "GA4 — Create Key Event",
    description: "WRITE — creates a key event (formerly conversion event) via Admin API " +
      "POST v1beta/{property}/keyEvents. " +
      "confirm:false returns a dry-run preview; confirm:true executes the create.",
    inputSchema: {
      account: ACCT, property: PROP,
      eventName: z.string().min(1).describe("Event name to mark as a key event (immutable once created)"),
      countingMethod: z.enum(["ONCE_PER_EVENT", "ONCE_PER_SESSION"])
        .describe("How this key event is counted across a session"),
      confirm: confirmField,
    }, annotations: WRITE },
  async (args) => runGa4CreateKeyEvent({
    account: args.account, property: args.property,
    eventName: args.eventName, countingMethod: args.countingMethod,
    confirm: args.confirm,
  }));

reg("ga4_delete_key_event",
  { title: "GA4 — Delete Key Event (irreversible)",
    description: "WRITE, IRREVERSIBLE — deletes a key event via Admin API DELETE v1beta/{property}/keyEvents/{id}. " +
      "confirm:false returns a dry-run preview; confirm:true executes the delete.",
    inputSchema: {
      account: ACCT, property: PROP,
      keyEvent: z.string().min(1).describe("Key event ID or full 'properties/.../keyEvents/...' name"),
      confirm: confirmField,
    }, annotations: WRITE },
  async (args) => runGa4DeleteKeyEvent({
    account: args.account, property: args.property, keyEvent: args.keyEvent,
    confirm: args.confirm,
  }));

reg("ga4_update_data_retention",
  { title: "GA4 — Update Data Retention Settings",
    description: "WRITE — updates event/user data retention settings (Admin API PATCH " +
      "v1beta/{property}/dataRetentionSettings). " +
      "confirm:false returns a dry-run preview; confirm:true executes the update.",
    inputSchema: {
      account: ACCT, property: PROP,
      eventDataRetention: z.enum(["TWO_MONTHS", "FOURTEEN_MONTHS", "TWENTY_SIX_MONTHS", "THIRTY_EIGHT_MONTHS", "FIFTY_MONTHS"])
        .optional().describe("Event-level data retention duration (optional)"),
      userDataRetention: z.enum(["TWO_MONTHS", "FOURTEEN_MONTHS", "TWENTY_SIX_MONTHS", "THIRTY_EIGHT_MONTHS", "FIFTY_MONTHS"])
        .optional().describe("User-level data retention duration (optional)"),
      resetUserDataOnNewActivity: z.boolean().optional()
        .describe("Reset the user retention period on each new user activity (optional)"),
      confirm: confirmField,
    }, annotations: WRITE },
  async (args) => runGa4UpdateDataRetention({
    account: args.account, property: args.property,
    eventDataRetention: args.eventDataRetention, userDataRetention: args.userDataRetention,
    resetUserDataOnNewActivity: args.resetUserDataOnNewActivity,
    confirm: args.confirm,
  }));

async function main(): Promise<void> {
  validateRequiredEnv();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mcp-ga4 v${pkg.version} running via stdio`);
}

main().catch((err: Error) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
