import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runDirectGetCampaignDetails } from "../tools/direct-get-campaign-details.js";
import { READ_ONLY } from "./_shared.js";

/**
 * Extra read-only Direct tools kept in their own registry module so the large
 * direct-read.ts stays untouched.
 */
export function registerDirectReadExtra(server: McpServer): void {
  server.registerTool(
    "yandex_direct_get_campaign_details",
    {
      title: "Yandex Direct — Campaign Details (strategy, counters, goals)",
      description:
        "Read the campaign settings that yandex_direct_list_campaigns does not return: " +
        "BiddingStrategy (Search + Network: strategy type, weekly budget, target CPA/CRR, bid ceiling, " +
        "pay-for-conversion), CounterIds (linked Metrika counters), PriorityGoals (which Metrika goals the " +
        "strategy optimises for, with conversion Value), AttributionModel, Settings, DailyBudget, " +
        "TimeTargeting, ExcludedSites and NegativeKeywords. " +
        "Use 'ids' to fetch specific campaigns, or 'states'/'types' to filter. " +
        "api_version='v5' (default) uses TextCampaignFieldNames; api_version='v501' uses " +
        "UnifiedCampaignFieldNames for ЕПК-shaped reads. Override the requested fields with " +
        "'field_names' (campaign-level) and 'typed_field_names' (type-specific) if Direct rejects a name. " +
        "Pass client_login to read a sub-client cabinet from a manager/agency account. Read-only.",
      inputSchema: {
        ids: z
          .array(z.number())
          .optional()
          .describe("Campaign IDs to read (optional; omit to read all matching campaigns)"),
        states: z
          .array(z.enum(["ON", "OFF", "SUSPENDED", "ENDED", "CONVERTED", "ARCHIVED"]))
          .optional()
          .describe("Filter by campaign state (optional)"),
        types: z
          .array(z.string())
          .optional()
          .describe("Filter by campaign type, e.g. TEXT_CAMPAIGN (optional)"),
        limit: z
          .number()
          .int()
          .positive()
          .max(1000)
          .default(100)
          .describe("Maximum number of campaigns to return (default 100, max 1000)"),
        api_version: z
          .enum(["v5", "v501"])
          .default("v5")
          .describe("v5 → TextCampaignFieldNames (default); v501 → UnifiedCampaignFieldNames (ЕПК)"),
        field_names: z
          .array(z.string())
          .optional()
          .describe("Override campaign-level FieldNames (optional)"),
        typed_field_names: z
          .array(z.string())
          .optional()
          .describe("Override type-specific field names, e.g. ['BiddingStrategy'] (optional)"),
        account: z
          .string()
          .min(1)
          .optional()
          .describe("Account label from list_accounts (optional if a default account is configured)"),
        client_login: z
          .string()
          .min(1)
          .optional()
          .describe("Yandex Direct sub-client login, sent as the Client-Login header (optional)"),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runDirectGetCampaignDetails({
        ids: args.ids,
        states: args.states,
        types: args.types,
        limit: args.limit,
        api_version: args.api_version,
        field_names: args.field_names,
        typed_field_names: args.typed_field_names,
        account: args.account,
        client_login: args.client_login,
      }),
  );
}
