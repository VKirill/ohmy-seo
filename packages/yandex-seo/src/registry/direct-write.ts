import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { strategySpecSchema } from "../lib/strategy-schema.js";
import { runDirectUploadImage } from "../tools/direct-upload-image.js";
import { runDirectCreateCampaign } from "../tools/direct-create-campaign.js";
import { runDirectCreateAdGroup } from "../tools/direct-create-adgroup.js";
import { runDirectCreateAdUnified } from "../tools/direct-create-ad-unified.js";
import { runDirectLinkMetrikaGoals } from "../tools/direct-link-metrika-goals.js";
import { runDirectPauseCampaigns } from "../tools/direct-pause-campaigns.js";
import { runDirectResumeCampaigns } from "../tools/direct-resume-campaigns.js";
import { runDirectModerateAds } from "../tools/direct-moderate-ads.js";
import { runDirectDeleteCampaigns } from "../tools/direct-delete-campaigns.js";
import { runDirectNegativeKeywordsAdd } from "../tools/direct-negative-keywords-add.js";
import { runDirectUpdateBudgets } from "../tools/direct-update-budgets.js";
import { runDirectCreateSitelinksSet } from "../tools/direct-create-sitelinks-set.js";
import { runDirectCreatePromoExtension } from "../tools/direct-create-promo-extension.js";
import { runDirectUpdateAdgroupAutotargeting } from "../tools/direct-update-adgroup-autotargeting.js";
import { runDirectSetBidModifiers } from "../tools/direct-set-bid-modifiers.js";
import { runDirectUpdateCampaign } from "../tools/direct-update-campaign.js";
import { runDirectUpdateAdGroup } from "../tools/direct-update-adgroup.js";
import { runDirectUpdateAd } from "../tools/direct-update-ad.js";
import { runDirectFeeds } from "../tools/direct-feeds.js";

export function registerDirectWrite(server: McpServer): void {
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
      title: "Yandex Direct — Create ЕПК Campaign (DRAFT)",
      description:
        "Creates a Единая перформанс-кампания (ЕПК / UnifiedCampaign) in DRAFT status — the ONLY campaign type that serves combinatorial RESPONSIVE_AD on search. " +
        "Posted to /json/v501/. No ads serve and no money is spent until the campaign is manually activated. " +
        "Budget is currency-agnostic: daily_budget_micros is the amount in the ACCOUNT currency × 1_000_000 (e.g. $10/day = 10000000). " +
        "Read the currency's MinimumDailyBudget from Dictionaries.get{Currencies} first (USD min = 10000000). " +
        "Search strategy must be active (default HIGHEST_POSITION = manual); networks are off (search-only). " +
        "When PHASE_3_5_B_SMOKE_MODE=true the name must start with 'phase-3-5-b-test_'. " +
        "confirm: true is required. Returns { campaign_id, name, type: 'UNIFIED_CAMPAIGN', status: 'DRAFT' }. Does NOT moderate or activate.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe("Campaign name. Must start with 'phase-3-5-b-test_' when PHASE_3_5_B_SMOKE_MODE=true"),
        daily_budget_micros: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Daily budget in ACCOUNT-currency micros (amount × 1_000_000). $10/day = 10000000. Applied ONLY with a manual search strategy (HIGHEST_POSITION); auto strategies use WeeklySpendLimit inside bidding_strategy. ≥ MinimumDailyBudget for the account currency."),
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "start_date must be YYYY-MM-DD" })
          .optional()
          .describe("Campaign start date in YYYY-MM-DD format (default: today Moscow time)"),
        search_strategy: z
          .enum(["HIGHEST_POSITION", "WB_MAXIMUM_CLICKS", "WB_MAXIMUM_CONVERSION_RATE", "AVERAGE_CPC", "AVERAGE_CPA"])
          .default("HIGHEST_POSITION")
          .describe("Simple search strategy (used only when strategy/bidding_strategy are omitted). Default HIGHEST_POSITION = manual."),
        strategy: strategySpecSchema.optional(),
        bidding_strategy: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Raw escape hatch — full BiddingStrategy verbatim: { Search:{...}, Network:{...} }. Prefer the typed `strategy` param. Auto strategies carry WeeklySpendLimit/BidCeiling in their struct (no daily_budget_micros). Search+Network must be compatible."),
        time_targeting: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Hourly schedule (Campaign-level): { Schedule:{ Items:[\"<day>,<c0>,...,<c23>\"] }, ConsiderWorkingWeekends:\"YES\"|\"NO\" }. One item per weekday (1=Mon..7=Sun) = day + 24 hourly bid coefficients (0–200)."),
        counter_ids: z
          .array(z.number())
          .optional()
          .describe("Yandex Metrika counter IDs to attach (optional)"),
        goal_ids: z
          .array(z.number())
          .optional()
          .describe("Metrika goal IDs → PriorityGoals (Value defaults to 100). Use priority_goals for per-goal conversion value."),
        priority_goals: z
          .array(z.object({ goal_id: z.number().int().positive(), value: z.number().int().nonnegative().optional() }))
          .optional()
          .describe("Metrika goals with per-goal conversion Value (ценность конверсии, account-currency micros). Takes precedence over goal_ids."),
        tracking_params: z
          .string()
          .optional()
          .describe("UTM / tracking params string (optional)"),
        confirm: z
          .boolean()
          .describe("Must be true — explicit intent confirmation required to create a campaign"),
        account: z
          .string()
          .min(1)
          .optional()
          .describe("Account label from list_accounts (optional if a default account is configured)"),
        client_login: z
          .string()
          .min(1)
          .optional()
          .describe("Agency client login (Client-Login header) for sub-client cabinets"),
      },
    },
    async (args) =>
      runDirectCreateCampaign({
        name: args.name,
        daily_budget_micros: args.daily_budget_micros,
        start_date: args.start_date,
        search_strategy: args.search_strategy,
        strategy: args.strategy,
        bidding_strategy: args.bidding_strategy,
        time_targeting: args.time_targeting,
        counter_ids: args.counter_ids,
        goal_ids: args.goal_ids,
        priority_goals: args.priority_goals,
        tracking_params: args.tracking_params,
        confirm: args.confirm,
        account: args.account,
        client_login: args.client_login,
      }),
  );

  server.registerTool(
    "yandex_direct_create_adgroup",
    {
      title: "Yandex Direct — Create ЕПК Ad Group",
      description:
        "Creates a new ad group inside a UNIFIED_CAMPAIGN (ЕПК). Posted to /json/v501/adgroups. " +
        "The group type is inherited from the ЕПК campaign — do NOT send Type (v501 errors 8000). Only Name, CampaignId, RegionIds are sent. " +
        "RegionIds lives on the group, not the campaign. confirm: true is required. Returns { ad_group_id, name, campaign_id }.",
      inputSchema: {
        campaign_id: z
          .number()
          .int()
          .positive()
          .describe("Parent ЕПК campaign ID (required)"),
        name: z
          .string()
          .min(1)
          .describe("Ad group name (required)"),
        region_ids: z
          .array(z.number())
          .default([1])
          .describe("Target region IDs (default [1] = Москва+область). Required on the group, not the campaign."),
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
        client_login: z
          .string()
          .min(1)
          .optional()
          .describe("Agency client login (Client-Login header) for sub-client cabinets"),
      },
    },
    async (args) =>
      runDirectCreateAdGroup({
        campaign_id: args.campaign_id,
        name: args.name,
        region_ids: args.region_ids,
        negative_keywords: args.negative_keywords,
        confirm: args.confirm,
        account: args.account,
        client_login: args.client_login,
      }),
  );

  server.registerTool(
    "yandex_direct_create_ad_unified",
    {
      title: "Yandex Direct — Create Combinatorial Ad (RESPONSIVE_AD, DRAFT)",
      description:
        "Creates ONE combinatorial ad (RESPONSIVE_AD) in DRAFT inside a UNIFIED_CAMPAIGN (ЕПК) ad group. " +
        "A combinatorial ad carries a POOL of 1–7 titles and 1–3 texts; Yandex assembles the best combination and serves it on search+networks. " +
        "This is the ONLY ad type we create — classic single-title TextAd (ТГО) and RSYa TextImageAd are retired. " +
        "Posted to /json/v501/ads (v5 returns error 3500). Max 3 non-archived combinatorial ads per group. " +
        "confirm: true is required. Returns { ad_id (exact string), ad_group_id, type: 'RESPONSIVE_AD', status: 'DRAFT' }.",
      inputSchema: {
        ad_group_id: z
          .number()
          .int()
          .positive()
          .describe("Parent ad group ID (must belong to a UNIFIED_CAMPAIGN / ЕПК)"),
        titles: z
          .array(z.string().min(1).max(56))
          .min(1)
          .max(7)
          .describe("Headline pool: 1–7 titles, each ≤56 chars (each word ≤22). Yandex combines them."),
        texts: z
          .array(z.string().min(1).max(81))
          .min(1)
          .max(3)
          .describe("Text pool: 1–3 texts, each ≤81 chars (each word ≤23)."),
        href: z
          .string()
          .min(1)
          .max(1024)
          .describe("Target URL (single Href)"),
        image_hashes: z
          .array(z.string().min(1))
          .max(5)
          .optional()
          .describe("1–5 AdImageHashes from yandex_direct_upload_image (optional; text-only combinatorial ads are allowed)"),
        sitelinks_set_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Sitelinks set ID (optional)"),
        ad_extensions: z
          .array(z.number().int().positive())
          .max(50)
          .optional()
          .describe("Callout extension IDs (≤50, optional)"),
        video_extension_ids: z
          .array(z.number().int().positive())
          .min(1)
          .max(6)
          .optional()
          .describe("1–6 VideoExtension IDs (optional)"),
        business_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Yandex.Business organization ID to attach to the ad (optional)"),
        confirm: z
          .boolean()
          .describe("Must be true — explicit intent confirmation required to create an ad"),
        account: z
          .string()
          .min(1)
          .optional()
          .describe("Account label from list_accounts (optional if a default account is configured)"),
        client_login: z
          .string()
          .min(1)
          .optional()
          .describe("Agency client login (Client-Login header) for sub-client cabinets"),
      },
    },
    async (args) =>
      runDirectCreateAdUnified({
        ad_group_id: args.ad_group_id,
        titles: args.titles,
        texts: args.texts,
        href: args.href,
        image_hashes: args.image_hashes,
        sitelinks_set_id: args.sitelinks_set_id,
        ad_extensions: args.ad_extensions,
        video_extension_ids: args.video_extension_ids,
        business_id: args.business_id,
        confirm: args.confirm,
        account: args.account,
        client_login: args.client_login,
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
        client_login: z
          .string()
          .optional()
          .describe("Yandex Direct agency client login for sub-client access (optional)"),
      },
    },
    async (args) =>
      runDirectPauseCampaigns({
        campaign_ids: args.campaign_ids,
        confirm: args.confirm,
        acknowledge_live: args.acknowledge_live,
        account: args.account,
        client_login: args.client_login,
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
        client_login: z
          .string()
          .optional()
          .describe("Yandex Direct agency client login for sub-client access (optional)"),
      },
    },
    async (args) =>
      runDirectResumeCampaigns({
        campaign_ids: args.campaign_ids,
        confirm: args.confirm,
        acknowledge_live: args.acknowledge_live,
        account: args.account,
        client_login: args.client_login,
      }),
  );

  server.registerTool(
    "yandex_direct_moderate_ads",
    {
      title: "Yandex Direct — Send Ads to Moderation",
      description:
        "Sends DRAFT ads to Yandex moderation (Ads.moderate). Fetches all DRAFT ads of the given campaigns " +
        "automatically (or takes explicit ad_ids), dedupes IDs (the API rejects duplicate IDs), chunks requests. " +
        "Does NOT touch campaign state — an OFF campaign stays OFF; resuming is a separate owner-gated action. " +
        "Requires confirm: true, OHMY_SEO_ALLOW_LIVE_MUTATIONS=true, YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true, " +
        "and acknowledge_live matching exactly: I-UNDERSTAND-MODERATE-LIVE:<account_or_default>:<sorted_campaign_ids_csv>.",
      inputSchema: {
        campaign_ids: z
          .array(z.number().int().positive())
          .min(1)
          .describe("Campaign IDs whose DRAFT ads should be sent to moderation (required, at least 1)"),
        ad_ids: z
          .array(z.union([z.number().int().positive(), z.string().min(1)]))
          .optional()
          .describe("Explicit Ad IDs to moderate (numbers, or exact-string Ids for big-int ad Ids > 2^53); when omitted, all DRAFT ads of the campaigns are fetched automatically"),
        confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
        acknowledge_live: z
          .string()
          .describe("Exact ack: I-UNDERSTAND-MODERATE-LIVE:<account_or_default>:<sorted_campaign_ids_csv>"),
        account: z
          .string()
          .min(1)
          .optional()
          .describe("Account label from list_accounts (optional if a default account is configured)"),
        client_login: z
          .string()
          .optional()
          .describe("Yandex Direct agency client login for sub-client access (optional)"),
      },
    },
    async (args) =>
      runDirectModerateAds({
        campaign_ids: args.campaign_ids,
        ad_ids: args.ad_ids,
        confirm: args.confirm,
        acknowledge_live: args.acknowledge_live,
        account: args.account,
        client_login: args.client_login,
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
      title: "Yandex Direct — Campaign/Group Negative Keywords (DANGER lite)",
      description:
        "Manage negative keywords (минус-фразы) on a Yandex Direct campaign or ad group. " +
        "Target is either { campaign_id } (campaign-level) or { ad_group_id } (ad group-level) — mutually exclusive. " +
        "mode='replace' (default) overwrites the set; mode='append' reads the current set and merges + dedupes; mode='get' is read-only. " +
        "DANGER lite gate for replace/append: requires confirm: true, OHMY_SEO_ALLOW_LIVE_MUTATIONS=true, YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true (no acknowledge_live ack). mode='get' needs no gate.",
      inputSchema: {
        target: z
          .union([
            z.object({ campaign_id: z.number().int().positive().describe("Campaign ID") }),
            z.object({ ad_group_id: z.number().int().positive().describe("Ad group ID") }),
          ])
          .describe("Target: either { campaign_id } or { ad_group_id }"),
        mode: z
          .enum(["replace", "append", "get"])
          .default("replace")
          .describe("replace=overwrite the set, append=merge with existing (dedupe), get=read-only"),
        keywords: z
          .array(z.string().min(1))
          .optional()
          .describe("Negative keywords (minus-words), e.g. ['бесплатно', 'своими руками']. Required for replace/append; ignored for get."),
        confirm: z.boolean().optional().describe("Must be true for replace/append"),
        account: z
          .string()
          .min(1)
          .optional()
          .describe("Account label from list_accounts (optional if a default account is configured)"),
        client_login: z
          .string()
          .min(1)
          .optional()
          .describe("Agency client login (Client-Login header) for sub-client cabinets"),
      },
    },
    async (args) =>
      runDirectNegativeKeywordsAdd({
        target: args.target,
        mode: args.mode,
        keywords: args.keywords,
        confirm: args.confirm,
        account: args.account,
        client_login: args.client_login,
      }),
  );

  server.registerTool(
    "yandex_direct_update_budgets",
    {
      title: "Yandex Direct — DANGER: Update ЕПК Campaign Daily Budgets",
      description:
        "DANGER: Updates the daily budget for one or more ЕПК (UnifiedCampaign) campaigns via /json/v501/. " +
        "Currency-agnostic: daily_budget_micros is ACCOUNT-currency micros — no RUB assumption, works for USD/RUB/EUR. " +
        "DailyBudget applies to MANUAL-strategy campaigns; auto strategies carry WeeklySpendLimit in their bidding strategy " +
        "(Yandex returns an error for those — no silent failures). One API call per campaign. " +
        "Requires confirm: true, OHMY_SEO_ALLOW_LIVE_MUTATIONS=true, YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true, " +
        "and acknowledge_live matching exactly: I-UNDERSTAND-BUDGET-LIVE:<account>:<sorted_ids_csv>:<budget_micros>. " +
        "If account is omitted, use 'default' in the ack string.",
      inputSchema: {
        campaign_ids: z
          .array(z.number().int().positive())
          .min(1)
          .describe("Campaign IDs to update daily budget for (required, at least 1)"),
        daily_budget_micros: z
          .number()
          .int()
          .positive()
          .describe("New daily budget in ACCOUNT-currency micros (amount × 1_000_000). ≥ MinimumDailyBudget for the account currency (Dictionaries.get{Currencies})."),
        confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
        acknowledge_live: z
          .string()
          .describe("Exact ack: I-UNDERSTAND-BUDGET-LIVE:<account_or_default>:<sorted_ids_csv>:<budget_micros>"),
        account: z
          .string()
          .min(1)
          .optional()
          .describe("Account label from list_accounts (optional if a default account is configured)"),
        client_login: z
          .string()
          .min(1)
          .optional()
          .describe("Agency client login (Client-Login header) for sub-client cabinets"),
      },
    },
    async (args) =>
      runDirectUpdateBudgets({
        campaign_ids: args.campaign_ids,
        daily_budget_micros: args.daily_budget_micros,
        confirm: args.confirm,
        acknowledge_live: args.acknowledge_live,
        account: args.account,
        client_login: args.client_login,
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
        "Updates auto-targeting category settings for a TEXT_AD_GROUP via the Keywords.update " +
        "mechanism (live-proven). Looks up the ---autotargeting keyword by ad_group_id, then " +
        "calls Keywords.update with AutotargetingCategories as a direct array. " +
        "Category names (API): EXACT, ALTERNATIVE, COMPETITOR, BROADER, ACCESSORY. " +
        "Legacy names (BROAD_MATCH, ACCESSORY_QUERIES, ALTERNATIVE_QUERIES, COMPETITOR_QUERIES, " +
        "EXACT_MENTION) are mapped automatically; TARGET_QUERIES is dropped (no equivalent). " +
        "confirm: true is required to proceed.",
      inputSchema: {
        ad_group_id: z.number().int().describe("Ad group ID to update auto-targeting for (required)"),
        categories: z
          .array(z.object({
            Category: z
              .string()
              .describe("Auto-targeting category name (API: EXACT/ALTERNATIVE/COMPETITOR/BROADER/ACCESSORY; legacy names are mapped automatically)"),
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
        categories: args.categories,
        confirm: args.confirm,
        account: args.account,
      }),
  );

  server.registerTool(
    "yandex_direct_set_bid_modifiers",
    {
      title: "Yandex Direct — Bid Modifiers / Корректировки ставок (DANGER lite)",
      description:
        "Manage bid adjustments (корректировки ставок) via /json/v5/bidmodifiers. mode: add | set | delete | get. " +
        "ЕПК (UnifiedCampaign) supports types: mobile, desktop, desktop_only (mutually exclusive with desktop), video. " +
        "demographics / regional / retargeting are for classic campaign types (rejected on ЕПК as 'unknown parameter') — passed through so the API decides. " +
        "bid_modifier is a percent coefficient: 100 = no change, 50 = −50%, 130 = +30%. There is NO enable/disable toggle — change coefficients with mode=set. " +
        "Gate: add/set/delete need confirm:true + OHMY_SEO_ALLOW_LIVE_MUTATIONS=true + YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true; delete also needs acknowledge_live = I-UNDERSTAND-BIDMOD-DELETE:<account_or_default>:<sorted_ids_csv>. mode=get is read-only.",
      inputSchema: {
        mode: z.enum(["add", "set", "delete", "get"]).describe("add=create, set=change coefficients, delete=remove, get=read (read-only)"),
        adjustments: z
          .array(
            z.object({
              campaign_id: z.number().int().positive().optional().describe("Scope to a campaign (XOR ad_group_id)"),
              ad_group_id: z.number().int().positive().optional().describe("Scope to an ad group (XOR campaign_id)"),
              type: z.enum(["mobile", "desktop", "desktop_only", "video", "demographics", "regional", "retargeting", "raw"]).describe("Adjustment type"),
              bid_modifier: z.number().int().min(0).max(1300).optional().describe("Percent coefficient (100 = no change)"),
              operating_system_type: z.enum(["ANDROID", "IOS"]).optional().describe("mobile only"),
              age: z.enum(["AGE_0_17", "AGE_18_24", "AGE_25_34", "AGE_35_44", "AGE_45_54", "AGE_55"]).optional().describe("demographics only"),
              gender: z.enum(["GENDER_MALE", "GENDER_FEMALE"]).optional().describe("demographics only"),
              region_id: z.number().int().optional().describe("regional only"),
              retargeting_condition_id: z.number().int().optional().describe("retargeting only"),
              raw_adjustment: z.record(z.string(), z.unknown()).optional().describe("type='raw': full adjustment object verbatim"),
            }),
          )
          .optional()
          .describe("mode=add: adjustments to create (each scoped to exactly one campaign_id or ad_group_id)"),
        updates: z
          .array(z.object({ id: z.union([z.number(), z.string()]), bid_modifier: z.number().int().min(0).max(1300) }))
          .optional()
          .describe("mode=set: [{ id, bid_modifier }] change coefficients of existing modifiers"),
        ids: z.array(z.union([z.number(), z.string()])).optional().describe("mode=delete: modifier IDs to remove; mode=get: filter by IDs"),
        campaign_ids: z.array(z.union([z.number(), z.string()])).optional().describe("mode=get: read modifiers for these campaigns"),
        ad_group_ids: z.array(z.union([z.number(), z.string()])).optional().describe("mode=get: read modifiers for these ad groups"),
        types: z
          .array(z.enum(["MOBILE", "DESKTOP", "DESKTOP_ONLY", "VIDEO", "DEMOGRAPHICS", "REGIONAL", "RETARGETING"]))
          .optional()
          .describe("mode=get: which types' values to return (default: ЕПК set MOBILE/DESKTOP/DESKTOP_ONLY/VIDEO)"),
        confirm: z.boolean().optional().describe("Required true for add/set/delete"),
        acknowledge_live: z.string().optional().describe("mode=delete only — exact ack I-UNDERSTAND-BIDMOD-DELETE:<account_or_default>:<sorted_ids_csv>"),
        account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
        client_login: z.string().min(1).optional().describe("Agency client login (Client-Login header) for sub-client cabinets"),
      },
    },
    async (args) =>
      runDirectSetBidModifiers({
        mode: args.mode,
        adjustments: args.adjustments,
        updates: args.updates,
        ids: args.ids,
        campaign_ids: args.campaign_ids,
        ad_group_ids: args.ad_group_ids,
        types: args.types,
        confirm: args.confirm,
        acknowledge_live: args.acknowledge_live,
        account: args.account,
        client_login: args.client_login,
      }),
  );

  server.registerTool(
    "yandex_direct_update_campaign",
    {
      title: "Yandex Direct — Update ЕПК Campaign / Point Edit (DANGER lite)",
      description:
        "Surgically edit an existing ЕПК (UnifiedCampaign) via /json/v501/campaigns update. Pass only the fields you want to change — the rest are left untouched. " +
        "Covers: name, daily_budget_micros, excluded_sites (площадки-исключения РСЯ), negative_keywords (replace), notification (EmailSettings), time_targeting, bidding_strategy, attribution_model (short codes LC/LSC/FC/LYDC/LSCCD/FCCD/LYDCCD/AUTO), settings (ExtendedGeoTargeting = ENABLE_*_AREA_TARGETING), tracking_params, counter_ids, goal_ids, plus raw_fields / raw_unified_fields escape hatches. " +
        "NOTE: frequency capping (частота показов) is NOT settable via the API for ЕПК. " +
        "Gate: confirm:true + OHMY_SEO_ALLOW_LIVE_MUTATIONS=true + YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true.",
      inputSchema: {
        campaign_id: z.number().int().positive().describe("ЕПК campaign ID to edit"),
        name: z.string().min(1).optional(),
        daily_budget_micros: z.number().int().positive().optional().describe("New daily budget, ACCOUNT-currency micros (× 1e6). Manual strategy only."),
        excluded_sites: z.array(z.string().min(1)).max(1000).optional().describe("REPLACES the excluded-sites list (pass [] to clear)"),
        negative_keywords: z.array(z.string().min(1)).optional().describe("REPLACES campaign negative keywords (pass [] to clear). Append via yandex_direct_negative_keywords_add."),
        notification: z.record(z.string(), z.unknown()).optional().describe("{ EmailSettings:{ Email, SendAccountNews, SendWarnings, WarningBalance, CheckPositionInterval }, SmsSettings:{...} }"),
        time_targeting: z.record(z.string(), z.unknown()).optional().describe("{ Schedule:{Items:[...]}, ConsiderWorkingWeekends }"),
        strategy: strategySpecSchema.optional(),
        bidding_strategy: z.record(z.string(), z.unknown()).optional().describe("Raw escape hatch — full { Search, Network } BiddingStrategy verbatim. Prefer typed `strategy`."),
        attribution_model: z.enum(["LC", "LSC", "FC", "LYDC", "LSCCD", "FCCD", "LYDCCD", "AUTO"]).optional(),
        settings: z.array(z.object({ Option: z.string(), Value: z.enum(["YES", "NO"]) })).optional().describe("ЕПК Settings toggles (ExtendedGeo = ENABLE_AREA_OF_INTEREST_TARGETING etc.)"),
        tracking_params: z.string().optional(),
        counter_ids: z.array(z.number().int()).optional(),
        goal_ids: z.array(z.number().int()).optional(),
        priority_goals: z.array(z.object({ goal_id: z.number().int().positive(), value: z.number().int().nonnegative().optional() })).optional().describe("Metrika goals with per-goal conversion Value (micros); takes precedence over goal_ids (applied Operation SET)"),
        raw_fields: z.record(z.string(), z.unknown()).optional().describe("Escape hatch: fields merged verbatim at Campaign level"),
        raw_unified_fields: z.record(z.string(), z.unknown()).optional().describe("Escape hatch: fields merged verbatim inside UnifiedCampaign"),
        confirm: z.boolean().describe("Must be true"),
        account: z.string().min(1).optional().describe("Account label from list_accounts"),
        client_login: z.string().min(1).optional().describe("Agency client login for sub-client cabinets"),
      },
    },
    async (args) =>
      runDirectUpdateCampaign({
        campaign_id: args.campaign_id,
        name: args.name,
        daily_budget_micros: args.daily_budget_micros,
        excluded_sites: args.excluded_sites,
        negative_keywords: args.negative_keywords,
        notification: args.notification as Record<string, unknown> | undefined,
        time_targeting: args.time_targeting,
        strategy: args.strategy,
        bidding_strategy: args.bidding_strategy,
        attribution_model: args.attribution_model,
        settings: args.settings,
        tracking_params: args.tracking_params,
        counter_ids: args.counter_ids,
        goal_ids: args.goal_ids,
        priority_goals: args.priority_goals,
        raw_fields: args.raw_fields,
        raw_unified_fields: args.raw_unified_fields,
        confirm: args.confirm,
        account: args.account,
        client_login: args.client_login,
      }),
  );

  server.registerTool(
    "yandex_direct_update_adgroup",
    {
      title: "Yandex Direct — Update ЕПК Ad Group / Point Edit (DANGER lite)",
      description:
        "Surgically edit an existing ad group via /json/v501/adgroups update. Pass only the fields to change. " +
        "Covers: name, region_ids (REPLACES geo), negative_keywords (REPLACES), tracking_params, plus raw_fields escape hatch. " +
        "Gate: confirm:true + OHMY_SEO_ALLOW_LIVE_MUTATIONS=true + YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true.",
      inputSchema: {
        ad_group_id: z.number().int().positive().describe("Ad group ID to edit"),
        name: z.string().min(1).optional(),
        region_ids: z.array(z.number().int()).min(1).optional().describe("REPLACES the geo list"),
        negative_keywords: z.array(z.string().min(1)).optional().describe("REPLACES ad-group negative keywords (pass [] to clear)"),
        tracking_params: z.string().optional(),
        raw_fields: z.record(z.string(), z.unknown()).optional().describe("Escape hatch: fields merged verbatim at AdGroup level"),
        confirm: z.boolean().describe("Must be true"),
        account: z.string().min(1).optional().describe("Account label from list_accounts"),
        client_login: z.string().min(1).optional().describe("Agency client login for sub-client cabinets"),
      },
    },
    async (args) =>
      runDirectUpdateAdGroup({
        ad_group_id: args.ad_group_id,
        name: args.name,
        region_ids: args.region_ids,
        negative_keywords: args.negative_keywords,
        tracking_params: args.tracking_params,
        raw_fields: args.raw_fields,
        confirm: args.confirm,
        account: args.account,
        client_login: args.client_login,
      }),
  );

  server.registerTool(
    "yandex_direct_update_ad",
    {
      title: "Yandex Direct — Update Combinatorial Ad / Point Edit (DANGER lite)",
      description:
        "Surgically edit an existing combinatorial RESPONSIVE_AD via /json/v501/ads update. Pass only the fields to change. " +
        "Covers: titles (1–7), texts (1–3), href, image_hashes, video_extension_ids, sitelinks_set_id, ad_extensions, business_id. " +
        "IMPORTANT: pass ad_id as a STRING — Yandex ad IDs exceed 2^53 and a rounded number yields 'Ad not found' (8800). Edited ads may re-enter moderation. " +
        "Gate: confirm:true + OHMY_SEO_ALLOW_LIVE_MUTATIONS=true + YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true.",
      inputSchema: {
        ad_id: z.union([z.string().min(1), z.number()]).describe("Ad ID — pass as STRING to preserve the full big-int"),
        titles: z.array(z.string().min(1).max(56)).min(1).max(7).optional(),
        texts: z.array(z.string().min(1).max(81)).min(1).max(3).optional(),
        href: z.string().min(1).max(1024).optional(),
        image_hashes: z.array(z.string().min(1)).max(5).optional(),
        video_extension_ids: z.array(z.number().int().positive()).min(1).max(6).optional(),
        sitelinks_set_id: z.number().int().positive().optional(),
        ad_extensions: z.array(z.number().int().positive()).max(50).optional(),
        business_id: z.number().int().positive().optional(),
        confirm: z.boolean().describe("Must be true"),
        account: z.string().min(1).optional().describe("Account label from list_accounts"),
        client_login: z.string().min(1).optional().describe("Agency client login for sub-client cabinets"),
      },
    },
    async (args) =>
      runDirectUpdateAd({
        ad_id: args.ad_id,
        titles: args.titles,
        texts: args.texts,
        href: args.href,
        image_hashes: args.image_hashes,
        video_extension_ids: args.video_extension_ids,
        sitelinks_set_id: args.sitelinks_set_id,
        ad_extensions: args.ad_extensions,
        business_id: args.business_id,
        confirm: args.confirm,
        account: args.account,
        client_login: args.client_login,
      }),
  );

  server.registerTool(
    "yandex_direct_feeds",
    {
      title: "Yandex Direct — Product Feeds / Товарные фиды (DANGER lite)",
      description:
        "Manage product feeds (товарные фиды) via /json/v5/feeds. mode: add | get | update | delete. " +
        "A feed sources products from a URL or an uploaded file; Yandex processes + moderates it — moderation/processing state is the `Status` field on get. " +
        "Feeds power dynamic ads / smart campaigns / ЕПК product galleries. " +
        "Gate: add/update/delete need confirm:true + OHMY_SEO_ALLOW_LIVE_MUTATIONS=true + YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true; delete also needs acknowledge_live = I-UNDERSTAND-FEED-DELETE:<account_or_default>:<sorted_ids_csv>. mode=get is read-only.",
      inputSchema: {
        mode: z.enum(["add", "get", "update", "delete"]).describe("add=create, get=read (read-only), update=change, delete=remove"),
        name: z.string().min(1).optional().describe("Feed name (add; optional rename on update)"),
        business_type: z.string().optional().describe("add (required): vertical — RETAIL, AUTO, AUTO_PARTS, REALTY, HOTELS, FLIGHTS, OTHER …"),
        source: z
          .object({
            url: z.string().url().optional().describe("URL feed source"),
            remove_utm: z.enum(["YES", "NO"]).optional(),
            login: z.string().optional(),
            password: z.string().optional(),
            file_base64: z.string().optional().describe("Base64 file feed contents"),
            filename: z.string().optional(),
          })
          .optional()
          .describe("Feed source: `url` for a URL feed, or `file_base64`+`filename` for a file feed"),
        feed_id: z.union([z.number(), z.string()]).optional().describe("update: feed Id to target"),
        ids: z.array(z.union([z.number(), z.string()])).optional().describe("get: filter to these feed Ids (omit to list all)"),
        delete_ids: z.array(z.union([z.number(), z.string()])).optional().describe("delete: feed Ids to remove"),
        confirm: z.boolean().optional().describe("Required true for add/update/delete"),
        acknowledge_live: z.string().optional().describe("delete only — I-UNDERSTAND-FEED-DELETE:<account_or_default>:<sorted_ids_csv>"),
        account: z.string().min(1).optional().describe("Account label from list_accounts"),
        client_login: z.string().min(1).optional().describe("Agency client login for sub-client cabinets"),
      },
    },
    async (args) =>
      runDirectFeeds({
        mode: args.mode,
        name: args.name,
        business_type: args.business_type,
        source: args.source,
        feed_id: args.feed_id,
        ids: args.ids,
        delete_ids: args.delete_ids,
        confirm: args.confirm,
        acknowledge_live: args.acknowledge_live,
        account: args.account,
        client_login: args.client_login,
      }),
  );
}
