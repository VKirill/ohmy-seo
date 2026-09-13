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

import { runListGoogleOauthApps } from "./tools/list-google-oauth-apps.js";
import { runRegisterGoogleOauthApp } from "./tools/register-google-oauth-app.js";
import { runDeleteGoogleOauthApp } from "./tools/delete-google-oauth-app.js";
import { runListGoogleAccounts } from "./tools/list-google-accounts.js";
import { runStartGoogleOauthFlow } from "./tools/start-google-oauth-flow.js";
import { runCompleteGoogleOauthFlow } from "./tools/complete-google-oauth-flow.js";
import { runDeleteGoogleAccount } from "./tools/delete-google-account.js";
import { runSetDefaultGoogleAccount } from "./tools/set-default-google-account.js";
import { runRegisterServiceAccount } from "./tools/register-google-service-account.js";

import { runAdsListAccessibleCustomers } from "./tools/ads-list-accessible-customers.js";
import { runAdsGetCustomer } from "./tools/ads-get-customer.js";
import { runAdsListCampaigns } from "./tools/ads-list-campaigns.js";
import { runAdsListAdGroups } from "./tools/ads-list-ad-groups.js";
import { runAdsListAds } from "./tools/ads-list-ads.js";
import { runAdsListKeywords } from "./tools/ads-list-keywords.js";
import { runAdsListNegativeKeywords } from "./tools/ads-list-negative-keywords.js";
import { runAdsListBudgets } from "./tools/ads-list-budgets.js";
import { runAdsRunQuery } from "./tools/ads-run-query.js";
import { runAdsSearchTermsReport } from "./tools/ads-search-terms-report.js";
import { runAdsKeywordPerformanceReport } from "./tools/ads-keyword-performance-report.js";
import { runAdsCampaignPerformanceReport } from "./tools/ads-campaign-performance-report.js";
import { runAdsChangeHistory } from "./tools/ads-change-history.js";
import { runAdsRecommendations } from "./tools/ads-recommendations.js";
import { runAdsResourceMetadata } from "./tools/ads-resource-metadata.js";
import { runAdsCreateCampaignBudget } from "./tools/ads-create-campaign-budget.js";
import { runAdsCreateCampaign } from "./tools/ads-create-campaign.js";
import { runAdsAddCampaignCriteria } from "./tools/ads-add-campaign-criteria.js";
import { runAdsCreateAdGroup } from "./tools/ads-create-ad-group.js";
import { runAdsAddKeywords } from "./tools/ads-add-keywords.js";
import { runAdsAddNegativeKeywords } from "./tools/ads-add-negative-keywords.js";
import { runAdsApplyRecommendation } from "./tools/ads-apply-recommendation.js";
import { runAdsEnableCampaign } from "./tools/ads-enable-campaign.js";
import { runAdsPauseCampaign } from "./tools/ads-pause-campaign.js";
import { runAdsUpdateBudget } from "./tools/ads-update-budget.js";
import { runAdsRemoveCampaign } from "./tools/ads-remove-campaign.js";
import {
  runAdsRemoveKeywords,
  runAdsRemoveNegativeKeywords,
  runAdsRemoveAds,
} from "./tools/ads-remove-criteria.js";
import { runAdsCreateAd } from "./tools/ads-create-ad.js";
import { runAdsUpdateAdGroup } from "./tools/ads-update-ad-group.js";
import { runAdsUpdateCampaign } from "./tools/ads-update-campaign.js";
import { runAdsListSharedSets } from "./tools/ads-list-shared-sets.js";
import { runAdsAttachSharedSet } from "./tools/ads-attach-shared-set.js";
import { runAdsDetachSharedSet } from "./tools/ads-detach-shared-set.js";


// --- cache registration -----------------------------------------------------
const META = { ttlEnvKey: "MCP_GOOGLE_ADS_CACHE_TTL_META", ttlDefaultSeconds: 86_400 };
const RPT = { ttlEnvKey: "MCP_GOOGLE_ADS_CACHE_TTL_REPORT", ttlDefaultSeconds: 3_600 };
registerCacheableTool("ads_list_accessible_customers", META);
registerCacheableTool("ads_get_customer", META);
registerCacheableTool("ads_resource_metadata", META);
registerCacheableTool("ads_list_campaigns", RPT);
registerCacheableTool("ads_list_ad_groups", RPT);
registerCacheableTool("ads_list_ads", RPT);
registerCacheableTool("ads_list_keywords", RPT);
registerCacheableTool("ads_list_negative_keywords", RPT);
registerCacheableTool("ads_list_budgets", RPT);
registerCacheableTool("ads_run_query", RPT);
registerCacheableTool("ads_search_terms_report", RPT);
registerCacheableTool("ads_keyword_performance_report", RPT);
registerCacheableTool("ads_campaign_performance_report", RPT);
registerCacheableTool("ads_change_history", RPT);
registerCacheableTool("ads_recommendations", RPT);
registerCacheableTool("ads_list_shared_sets", RPT);

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const RO = { readOnlyHint: true, openWorldHint: true, idempotentHint: false };
const WRITE = { readOnlyHint: false, openWorldHint: true, destructiveHint: false };
const DANGER = { readOnlyHint: false, openWorldHint: true, destructiveHint: true };

const server = new McpServer(
  { name: "mcp-google-ads", version: pkg.version },
  {
    instructions:
      "mcp-google-ads: Google Ads API v25 через GAQL. " +
      "Читать можно свободно. Любая запись по умолчанию возвращает предпросмотр — " +
      "нужен confirm:true. Опасные операции (включение и пауза кампании, смена бюджета, " +
      "удаление) дополнительно требуют acknowledge_live вида " +
      "I-UNDERSTAND-THIS-IS-LIVE:<customer_id>:<resource> и переменной среды " +
      "GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true. " +
      "Не угадывай поля GAQL — вызывай ads_resource_metadata. " +
      "Порядок работы: ads_list_accessible_customers -> ads_list_campaigns -> отчёты.",
  },
);

// Local non-generic wrapper: avoids the SDK's expensive ShapeOutput<> generic.
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
  try {
    resolvePackageConfig("google-ads");
  } catch (err) {
    console.error("FATAL: " + (err as Error).message);
    process.exit(1);
  }
  if (!(process.env["GOOGLE_ADS_DEVELOPER_TOKEN"] ?? "").trim()) {
    console.error(
      "WARN: GOOGLE_ADS_DEVELOPER_TOKEN is not set — every Ads call will fail until it is.",
    );
  }
}

const LBL = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_-]+$/i, "label must be alphanumeric, dash or underscore");
const ACCT = z.string().min(1).optional().describe("Account label (optional when a default is set)");
const CID = z.string().min(1).describe("Customer ID, dashes allowed: 123-456-7890");
const LOGIN_CID = z
  .string()
  .optional()
  .describe("Manager account for the login-customer-id header (optional)");
const FRESH = z.boolean().optional().describe("Bypass the cache for this call");
const RANGE = z
  .string()
  .optional()
  .describe("LAST_7_DAYS | LAST_14_DAYS | LAST_30_DAYS | THIS_MONTH | LAST_MONTH | YYYY-MM-DD..YYYY-MM-DD");
const CONFIRM = z
  .boolean()
  .optional()
  .describe("false (default) returns a preview and changes nothing");
const ACK = z
  .string()
  .optional()
  .describe("DANGER only: I-UNDERSTAND-THIS-IS-LIVE:<customer_id>:<resource>");
const VALIDATE = z
  .boolean()
  .optional()
  .describe("Ask Google to validate the operation without writing");

// --- OAuth management (9) ---------------------------------------------------

reg("list_google_oauth_apps",
  { title: "Google OAuth — List Apps",
    description: "List registered Google OAuth apps. Client secrets are never returned.",
    inputSchema: {}, annotations: RO },
  async () => runListGoogleOauthApps());

reg("register_google_oauth_app",
  { title: "Google OAuth — Register App",
    description: "Register a Google OAuth app. client_secret is AES-256 encrypted at rest. Use a loopback redirect_uri.",
    inputSchema: {
      label: LBL.describe("Unique app label"),
      client_id: z.string().min(8).max(256).describe("Google OAuth client_id"),
      client_secret: z.string().min(8).max(256).describe("Google OAuth client_secret (encrypted)"),
      scopes_declared: z.string().min(1).max(512).describe("Space-delimited scopes; include https://www.googleapis.com/auth/adwords"),
      redirect_uri: z.string().min(1).max(256).describe("Loopback redirect URI, e.g. http://127.0.0.1:8767/oauth/callback"),
    }, annotations: RO },
  async (args) => runRegisterGoogleOauthApp(args));

reg("delete_google_oauth_app",
  { title: "Google OAuth — Delete App",
    description: "Delete an OAuth app by label. Blocked while accounts are attached.",
    inputSchema: { app_label: LBL.describe("Label of the app to delete") }, annotations: RO },
  async (args) => runDeleteGoogleOauthApp(args));

reg("list_google_accounts",
  { title: "Google OAuth — List Accounts",
    description: "List connected Google accounts. Tokens are never returned in plain text.",
    inputSchema: {}, annotations: RO },
  async () => runListGoogleAccounts());

reg("start_google_oauth_flow",
  { title: "Google OAuth — Start Flow",
    description: "Start a loopback OAuth flow, wait up to 5 min for the browser callback, store tokens.",
    inputSchema: {
      app_label: LBL.describe("OAuth app label"),
      account_label: LBL.describe("Desired account label"),
      login_hint: z.string().optional().describe("Google email hint (optional)"),
    }, annotations: RO },
  async (args) => runStartGoogleOauthFlow(args));

reg("complete_google_oauth_flow",
  { title: "Google OAuth — Complete Flow (Deprecated)",
    description: "Deprecated — OOB OAuth was removed by Google in 2023. Use start_google_oauth_flow.",
    inputSchema: {
      app_label: LBL, account_label: LBL,
      code: z.string().min(1).describe("Auth code (OOB, deprecated)"),
      state: z.string().min(1).describe("State from start flow"),
    }, annotations: RO },
  async (args) => runCompleteGoogleOauthFlow(args));

reg("delete_google_account",
  { title: "Google OAuth — Delete Account",
    description: "Delete a connected Google account, permanently removing its encrypted tokens.",
    inputSchema: { account_label: LBL }, annotations: RO },
  async (args) => runDeleteGoogleAccount(args));

reg("set_default_google_account",
  { title: "Google OAuth — Set Default Account",
    description: "Mark an account as default for every Ads tool.",
    inputSchema: { account_label: LBL }, annotations: RO },
  async (args) => runSetDefaultGoogleAccount(args));

reg("register_google_service_account",
  { title: "Google Service Account — Register",
    description: "Register a service account from a JSON key file, verifying it before storing.",
    inputSchema: {
      account_label: LBL,
      json_path: z.string().min(1).describe("Absolute path to the JSON key file"),
      scopes: z.string().min(1).describe("Space-delimited scopes"),
    }, annotations: RO },
  async (args) => runRegisterServiceAccount(args));

// --- Read (8) ---------------------------------------------------------------

reg("ads_list_accessible_customers",
  { title: "Ads — List Accounts",
    description: "Every customer this Google account can reach, plus the manager account tree with names, currency and status. Cached 24 h. Start here.",
    inputSchema: { account: ACCT, force_refresh: FRESH }, annotations: RO },
  async (args) => runAdsListAccessibleCustomers(args));

reg("ads_get_customer",
  { title: "Ads — Account Details",
    description: "Currency, time zone, manager flag, auto-tagging. Read this before interpreting any cost figure. Cached 24 h.",
    inputSchema: { account: ACCT, customer_id: CID, login_customer_id: LOGIN_CID, force_refresh: FRESH },
    annotations: RO },
  async (args) => runAdsGetCustomer(args));

reg("ads_list_campaigns",
  { title: "Ads — List Campaigns",
    description: "Campaigns with budget, channel type and bidding strategy. No metrics — use ads_campaign_performance_report for those. Cached 1 h.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      status_filter: z.string().optional().describe("ENABLED | PAUSED | REMOVED"),
      login_customer_id: LOGIN_CID, force_refresh: FRESH,
    }, annotations: RO },
  async (args) => runAdsListCampaigns(args));

reg("ads_list_ad_groups",
  { title: "Ads — List Ad Groups",
    description: "Ad groups, optionally narrowed to one campaign. Cached 1 h.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      campaign_id: z.string().optional(), login_customer_id: LOGIN_CID, force_refresh: FRESH,
    }, annotations: RO },
  async (args) => runAdsListAdGroups(args));

reg("ads_list_ads",
  { title: "Ads — List Ads",
    description: "Ads with headlines, descriptions, ad strength and approval status. Cached 1 h.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      ad_group_id: z.string().optional(), campaign_id: z.string().optional(),
      login_customer_id: LOGIN_CID, force_refresh: FRESH,
    }, annotations: RO },
  async (args) => runAdsListAds(args));

reg("ads_list_keywords",
  { title: "Ads — List Keywords",
    description: "Positive keywords with match type, bid and quality score. Cached 1 h.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      ad_group_id: z.string().optional(), campaign_id: z.string().optional(),
      login_customer_id: LOGIN_CID, force_refresh: FRESH,
    }, annotations: RO },
  async (args) => runAdsListKeywords(args));

reg("ads_list_negative_keywords",
  { title: "Ads — List Negative Keywords",
    description: "Negative keywords at campaign or ad-group level. Cached 1 h.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      level: z.string().optional().describe("campaign (default) | ad_group"),
      campaign_id: z.string().optional(), ad_group_id: z.string().optional(),
      login_customer_id: LOGIN_CID, force_refresh: FRESH,
    }, annotations: RO },
  async (args) => runAdsListNegativeKeywords(args));

reg("ads_list_budgets",
  { title: "Ads — List Budgets",
    description: "Campaign budgets with amounts and how many campaigns share each. Cached 1 h.",
    inputSchema: { account: ACCT, customer_id: CID, login_customer_id: LOGIN_CID, force_refresh: FRESH },
    annotations: RO },
  async (args) => runAdsListBudgets(args));
reg("ads_list_shared_sets",
  { title: "Ads — Shared Negative Lists",
    description: "Shared negative keyword lists in the account, with member counts. Pass campaign_id to see which lists are attached to one campaign instead. Cached 1 h.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      campaign_id: z.string().optional().describe("Show lists attached to this campaign"),
      login_customer_id: LOGIN_CID, force_refresh: FRESH,
    }, annotations: RO },
  async (args) => runAdsListSharedSets(args));


// --- GAQL and reports (7) ---------------------------------------------------

reg("ads_run_query",
  { title: "Ads — Run GAQL",
    description: "Raw GAQL. Validated before sending: single SELECT statement, required primary field, LIMIT, date range. Do not guess field names — call ads_resource_metadata first. Cached 1 h.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      query: z.string().min(10).describe("GAQL, e.g. SELECT campaign.id, campaign.name FROM campaign"),
      limit: z.number().int().positive().optional().describe("LIMIT appended when the query has none (default 500)"),
      login_customer_id: LOGIN_CID, force_refresh: FRESH,
    }, annotations: RO },
  async (args) => runAdsRunQuery(args));

reg("ads_resource_metadata",
  { title: "Ads — Resource Metadata",
    description: "Which fields a GAQL resource has and which metrics and segments may be selected with it. Call this instead of guessing field names. Cached 24 h.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      resource: z.string().min(2).describe("Resource name, e.g. campaign, search_term_view, keyword_view"),
      login_customer_id: LOGIN_CID, force_refresh: FRESH,
    }, annotations: RO },
  async (args) => runAdsResourceMetadata(args));

reg("ads_search_terms_report",
  { title: "Ads — Search Terms",
    description: "What people actually typed. Set zero_conversions_only to find spend that bought nothing — the input for negative keywords. Cached 1 h.",
    inputSchema: {
      account: ACCT, customer_id: CID, date_range: RANGE,
      min_impressions: z.number().int().nonnegative().optional().describe("Default 10"),
      campaign_id: z.string().optional(),
      zero_conversions_only: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
      login_customer_id: LOGIN_CID, force_refresh: FRESH,
    }, annotations: RO },
  async (args) => runAdsSearchTermsReport(args));

reg("ads_keyword_performance_report",
  { title: "Ads — Keyword Performance",
    description: "Keyword metrics with all three quality-score components — the number alone does not say what to fix. Cached 1 h.",
    inputSchema: {
      account: ACCT, customer_id: CID, date_range: RANGE,
      campaign_id: z.string().optional(), limit: z.number().int().positive().optional(),
      login_customer_id: LOGIN_CID, force_refresh: FRESH,
    }, annotations: RO },
  async (args) => runAdsKeywordPerformanceReport(args));

reg("ads_campaign_performance_report",
  { title: "Ads — Campaign Performance",
    description: "Campaign metrics with impression share split into budget-lost and rank-lost, which says whether money or quality is the constraint. Cached 1 h.",
    inputSchema: {
      account: ACCT, customer_id: CID, date_range: RANGE,
      only_active: z.boolean().optional(), limit: z.number().int().positive().optional(),
      login_customer_id: LOGIN_CID, force_refresh: FRESH,
    }, annotations: RO },
  async (args) => runAdsCampaignPerformanceReport(args));

reg("ads_change_history",
  { title: "Ads — Change History",
    description: "Who changed what and when. Google keeps only the last 30 days. Cached 1 h.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      days: z.number().int().positive().optional().describe("1-30, default 30"),
      limit: z.number().int().positive().optional(),
      login_customer_id: LOGIN_CID, force_refresh: FRESH,
    }, annotations: RO },
  async (args) => runAdsChangeHistory(args));

reg("ads_recommendations",
  { title: "Ads — Recommendations",
    description: "Google's own suggestions with projected impact. Feed resource_name into ads_apply_recommendation. Cached 1 h.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      type_filter: z.string().optional().describe("e.g. KEYWORD, CAMPAIGN_BUDGET"),
      limit: z.number().int().positive().optional(),
      login_customer_id: LOGIN_CID, force_refresh: FRESH,
    }, annotations: RO },
  async (args) => runAdsRecommendations(args));

// --- Write, non-destructive (7) ---------------------------------------------

reg("ads_create_campaign_budget",
  { title: "Ads — Create Budget",
    description: "Creates a daily budget. Amount in account currency, not micros. Preview unless confirm:true.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      name: z.string().min(1).max(255),
      daily_amount: z.number().positive().describe("Daily amount in account currency"),
      explicitly_shared: z.boolean().optional(),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, validate_only: VALIDATE,
    }, annotations: WRITE },
  async (args) => runAdsCreateCampaignBudget(args));

reg("ads_create_campaign",
  { title: "Ads — Create Campaign",
    description: "Creates a campaign. Status is forced to PAUSED whatever you pass — enable it later with ads_enable_campaign. SEARCH campaigns get Google Search only: search partners and display expansion stay OFF unless asked for. Geo and language are set afterwards with ads_add_campaign_criteria. Preview unless confirm:true.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      name: z.string().min(1).max(255),
      budget_id: z.string().min(1).describe("From ads_create_campaign_budget or ads_list_budgets"),
      channel_type: z.string().optional().describe("SEARCH (default) | DISPLAY | PERFORMANCE_MAX | VIDEO | DEMAND_GEN"),
      bidding_strategy: z.string().optional().describe("MAXIMIZE_CONVERSIONS (default) | MAXIMIZE_CONVERSION_VALUE | MAXIMIZE_CLICKS | TARGET_CPA | TARGET_ROAS"),
      target_cpa: z.number().positive().optional(),
      target_roas: z.number().positive().optional(),
      cpc_ceiling: z.number().positive().optional().describe("Max CPC for MAXIMIZE_CLICKS, in account currency"),
      search_partners: z.boolean().optional().describe("SEARCH only — search partner network, default false"),
      display_network: z.boolean().optional().describe("SEARCH only — display expansion, default false"),
      geo_target_type: z.string().optional().describe("PRESENCE_OR_INTEREST (default) | PRESENCE"),
      eu_political_advertising: z.boolean().optional().describe("Declares EU political advertising, default false"),
      start_date: z.string().optional().describe("YYYY-MM-DD"),
      end_date: z.string().optional().describe("YYYY-MM-DD"),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, validate_only: VALIDATE,
    }, annotations: WRITE },
  async (args) => runAdsCreateCampaign(args));

reg("ads_add_campaign_criteria",
  { title: "Ads — Add Campaign Criteria",
    description: "Adds location and language targeting to a campaign. Geo and language live in campaign_criterion, so they cannot be set at create time. Ids come from GAQL: SELECT geo_target_constant.id, geo_target_constant.canonical_name FROM geo_target_constant WHERE geo_target_constant.name = 'Alanya'. Preview unless confirm:true.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      campaign_id: z.string().min(1),
      locations: z.array(z.string().min(1)).optional().describe("geo target constant ids, e.g. [\"2792\"] for Turkey"),
      negative_locations: z.array(z.string().min(1)).optional().describe("geo target constant ids to exclude"),
      languages: z.array(z.string().min(1)).optional().describe("language constant ids, e.g. [\"1031\"] for Russian"),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, validate_only: VALIDATE,
    }, annotations: WRITE },
  async (args) => runAdsAddCampaignCriteria(args));


reg("ads_create_ad_group",
  { title: "Ads — Create Ad Group",
    description: "Creates an ad group, paused by default. Preview unless confirm:true.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      campaign_id: z.string().min(1), name: z.string().min(1).max(255),
      cpc_bid: z.number().positive().optional().describe("In account currency"),
      enabled: z.boolean().optional(),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, validate_only: VALIDATE,
    }, annotations: WRITE },
  async (args) => runAdsCreateAdGroup(args));

reg("ads_add_keywords",
  { title: "Ads — Add Keywords",
    description: "Adds positive keywords to an ad group, paused by default. Preview unless confirm:true.",
    inputSchema: {
      account: ACCT, customer_id: CID, ad_group_id: z.string().min(1),
      keywords: z.array(z.object({ text: z.string().min(1), match_type: z.string().optional() })).min(1),
      enabled: z.boolean().optional(),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, validate_only: VALIDATE,
    }, annotations: WRITE },
  async (args) => runAdsAddKeywords(args));

reg("ads_add_negative_keywords",
  { title: "Ads — Add Negative Keywords",
    description: "Adds negative keywords at campaign or ad-group level. The safe way to cut wasted spend. Preview unless confirm:true.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      level: z.string().optional().describe("campaign (default) | ad_group"),
      campaign_id: z.string().optional(), ad_group_id: z.string().optional(),
      keywords: z.array(z.string().min(1)).min(1),
      match_type: z.string().optional().describe("EXACT | PHRASE (default) | BROAD"),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, validate_only: VALIDATE,
    }, annotations: WRITE },
  async (args) => runAdsAddNegativeKeywords(args));

reg("ads_apply_recommendation",
  { title: "Ads — Apply Recommendation",
    description: "Applies one recommendation by resource_name. Preview unless confirm:true.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      resource_name: z.string().min(10).describe("customers/<id>/recommendations/<id>"),
      login_customer_id: LOGIN_CID, confirm: CONFIRM,
    }, annotations: WRITE },
  async (args) => runAdsApplyRecommendation(args));
reg("ads_create_ad",
  { title: "Ads — Create Responsive Search Ad",
    description: "Creates a responsive search ad in an ad group, paused by default. Headlines and descriptions are checked here first — length, duplicates, pinning, 3-15 headlines and 2-4 descriptions — so Google's generic policy error never has to be decoded. Preview unless confirm:true.",
    inputSchema: {
      account: ACCT, customer_id: CID, ad_group_id: z.string().min(1),
      final_url: z.string().min(8).describe("Landing page, must start with http:// or https://"),
      headlines: z.array(z.union([
        z.string().min(1),
        z.object({ text: z.string().min(1), pinned: z.string().optional().describe("HEADLINE_1 | HEADLINE_2 | HEADLINE_3") }),
      ])).min(3).max(15).describe("3-15 headlines, up to 30 characters each"),
      descriptions: z.array(z.union([
        z.string().min(1),
        z.object({ text: z.string().min(1), pinned: z.string().optional().describe("DESCRIPTION_1 | DESCRIPTION_2") }),
      ])).min(2).max(4).describe("2-4 descriptions, up to 90 characters each"),
      path1: z.string().optional().describe("Display path after the domain, up to 15 characters"),
      path2: z.string().optional().describe("Second display path, requires path1"),
      enabled: z.boolean().optional(),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, validate_only: VALIDATE,
    }, annotations: WRITE },
  async (args) => runAdsCreateAd(args));

reg("ads_update_ad_group",
  { title: "Ads — Update Ad Group",
    description: "Renames an ad group and optionally changes its status or default bid. Only the fields you pass are written, so a rename never resets a hand-tuned bid. Preview unless confirm:true.",
    inputSchema: {
      account: ACCT, customer_id: CID, ad_group_id: z.string().min(1),
      name: z.string().max(255).optional(),
      status: z.string().optional().describe("ENABLED | PAUSED"),
      cpc_bid: z.number().positive().optional().describe("In account currency"),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, validate_only: VALIDATE,
    }, annotations: WRITE },
  async (args) => runAdsUpdateAdGroup(args));

reg("ads_update_campaign",
  { title: "Ads — Rename Campaign",
    description: "Renames a campaign. Name only — status and budget have their own DANGER tools, so renaming can never start or stop spending. Preview unless confirm:true.",
    inputSchema: {
      account: ACCT, customer_id: CID, campaign_id: z.string().min(1),
      name: z.string().min(1).max(255),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, validate_only: VALIDATE,
    }, annotations: WRITE },
  async (args) => runAdsUpdateCampaign(args));

reg("ads_attach_shared_set",
  { title: "Ads — Attach Shared Negative List",
    description: "Attaches an existing shared negative keyword list to a campaign. Can only narrow matching, so no acknowledge_live needed. Get shared_set_id from ads_list_shared_sets. Preview unless confirm:true.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      campaign_id: z.string().min(1), shared_set_id: z.string().min(1),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, validate_only: VALIDATE,
    }, annotations: WRITE },
  async (args) => runAdsAttachSharedSet(args));


// --- DANGER (7) -------------------------------------------------------------

reg("ads_enable_campaign",
  { title: "Ads — Enable Campaign (DANGER)",
    description: "Starts a campaign spending money. Needs confirm:true, acknowledge_live and GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true.",
    inputSchema: {
      account: ACCT, customer_id: CID, campaign_id: z.string().min(1),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, acknowledge_live: ACK,
    }, annotations: DANGER },
  async (args) => runAdsEnableCampaign(args));

reg("ads_pause_campaign",
  { title: "Ads — Pause Campaign (DANGER)",
    description: "Stops a live campaign. Needs confirm:true, acknowledge_live and GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true.",
    inputSchema: {
      account: ACCT, customer_id: CID, campaign_id: z.string().min(1),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, acknowledge_live: ACK,
    }, annotations: DANGER },
  async (args) => runAdsPauseCampaign(args));

reg("ads_update_budget",
  { title: "Ads — Update Budget (DANGER)",
    description: "Changes daily spend of a live budget. Needs confirm:true, acknowledge_live and GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true.",
    inputSchema: {
      account: ACCT, customer_id: CID, budget_id: z.string().min(1),
      daily_amount: z.number().positive().describe("In account currency"),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, acknowledge_live: ACK,
    }, annotations: DANGER },
  async (args) => runAdsUpdateBudget(args));

reg("ads_remove_keywords",
  { title: "Ads — Remove Keywords (DANGER)",
    description: "Removes positive keywords from an ad group. Irreversible.",
    inputSchema: {
      account: ACCT, customer_id: CID, ad_group_id: z.string().min(1),
      criterion_ids: z.array(z.string().min(1)).min(1),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, acknowledge_live: ACK,
    }, annotations: DANGER },
  async (args) => runAdsRemoveKeywords(args));

reg("ads_remove_negative_keywords",
  { title: "Ads — Remove Negative Keywords (DANGER)",
    description: "Removes negative keywords from a campaign (campaign_id) or an ad group (ad_group_id). Irreversible.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      campaign_id: z.string().optional(), ad_group_id: z.string().optional(),
      criterion_ids: z.array(z.string().min(1)).min(1),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, acknowledge_live: ACK,
    }, annotations: DANGER },
  async (args) => runAdsRemoveNegativeKeywords(args));

reg("ads_remove_ads",
  { title: "Ads — Remove Ads (DANGER)",
    description: "Removes ads from an ad group. Irreversible — pausing keeps the history.",
    inputSchema: {
      account: ACCT, customer_id: CID, ad_group_id: z.string().min(1),
      ad_ids: z.array(z.string().min(1)).min(1),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, acknowledge_live: ACK,
    }, annotations: DANGER },
  async (args) => runAdsRemoveAds(args));

reg("ads_remove_campaign",
  { title: "Ads — Remove Campaign (DANGER)",
    description: "Removes a campaign permanently. Prefer ads_pause_campaign — it stops delivery and keeps the history.",
    inputSchema: {
      account: ACCT, customer_id: CID, campaign_id: z.string().min(1),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, acknowledge_live: ACK,
    }, annotations: DANGER },
  async (args) => runAdsRemoveCampaign(args));
reg("ads_detach_shared_set",
  { title: "Ads — Detach Shared Negative List (DANGER)",
    description: "Detaches a shared negative list from a campaign. The only direction that widens matching — needs confirm:true, acknowledge_live and GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true.",
    inputSchema: {
      account: ACCT, customer_id: CID,
      campaign_id: z.string().min(1), shared_set_id: z.string().min(1),
      login_customer_id: LOGIN_CID, confirm: CONFIRM, acknowledge_live: ACK,
    }, annotations: DANGER },
  async (args) => runAdsDetachSharedSet(args));


async function main(): Promise<void> {
  validateRequiredEnv();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mcp-google-ads v${pkg.version} running via stdio`);
}

main().catch((err: Error) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
