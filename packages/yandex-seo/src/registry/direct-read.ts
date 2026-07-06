import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runDirectListCampaigns } from "../tools/direct-list-campaigns.js";
import { runDirectListAdGroups } from "../tools/direct-list-adgroups.js";
import { runDirectListAds } from "../tools/direct-list-ads.js";
import { runDirectListKeywords } from "../tools/direct-list-keywords.js";
import { runDirectGetStats } from "../tools/direct-get-stats.js";
import { runDirectGetChangeHistory } from "../tools/direct-get-change-history.js";
import { runDirectGetSearchTerms } from "../tools/direct-get-search-terms.js";
import { runDirectRenderToXlsx } from "../tools/direct-render-to-xlsx.js";
import { READ_ONLY } from "./_shared.js";

export function registerDirectRead(server: McpServer): void {
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
    "yandex_direct_render_to_xlsx",
    {
      title: "Yandex Direct — Render Campaign YAML Folder to Excel",
      description:
        "Renders a campaign YAML folder to the canonical 5-sheet workbook (.xlsx) — единый формат отчёта " +
        "владельцу для всех клиентов (CombinatorialAds / canonical-build-preview / commander-import / " +
        "design-assets / QA). Reads _campaign.yaml and all group-*.yaml files, validates them, and produces: " +
        "CombinatorialAds — one row per ad (headlines/texts/images, sitelinks+callouts joined with ' || ', " +
        "group-level overrides win over campaign-level, image refs resolved to url/path); " +
        "canonical-build-preview — one row per group (service type / audience / intent / wordstat keys / headline+text pools); " +
        "commander-import — per group one ad row then one row per phrase; " +
        "design-assets — one row per group image with file_exists check; " +
        "QA — deterministic render checks (renderer version, counts, sitelinks/callouts completeness, image refs, 56/81 limits). " +
        "Red fill marks violations: headline > 56, text > 81; sitelinks: <8 links, title > 30, missing or >60-char Description; " +
        "callouts: <4 items or >25 chars. " +
        "Returns xlsx_path, row count (CombinatorialAds rows), warnings list, and any YAML validation_errors. " +
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
}
