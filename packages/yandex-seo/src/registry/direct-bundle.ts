import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runDirectUploadCampaignBundle } from "../tools/direct-upload-campaign-bundle.js";
import { runDirectUploadFromYaml } from "../tools/direct-upload-from-yaml.js";

export function registerDirectBundle(server: McpServer): void {
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

        daily_budget_amount: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Daily budget per campaign in ACCOUNT-currency micros (amount × 1_000_000) — currency-agnostic, preferred. ≥ MinimumDailyBudget for the account currency."),
        daily_budget_rub: z
          .number()
          .int()
          .min(100)
          .optional()
          .describe("DEPRECATED RUB fallback (× 1e6 internally). Use daily_budget_amount for non-RUB accounts."),

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
    "yandex_direct_upload_from_yaml",
    {
      title: "Yandex Direct — Upload Campaign Bundle from YAML Folder",
      description:
        "Orchestrator that reads a campaigns-draft/<folder>/ YAML bundle, creates dependencies " +
        "(SitelinksSet, PromoExtension, Callouts, AdImages), resolves template refs, and calls the campaign " +
        "upload pipeline. Groups may override campaign-level sitelinks_set/callouts; each unique per-group " +
        "set is created once (deduped by content) and wired into that group's ads. " +
        "Three-stage flow mirrors yandex_direct_upload_campaign_bundle: " +
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
        client_login: z
          .string()
          .optional()
          .describe("Yandex Direct agency client login for sub-client access"),
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
}
