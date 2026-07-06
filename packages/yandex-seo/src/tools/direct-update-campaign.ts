import { z } from "zod";
import { executeApiCall } from "../lib/api-gateway.js";
import { buildCampaignUpdatePayload, buildEpkBiddingStrategy } from "../lib/payload-builder.js";
import { strategySpecSchema } from "../lib/strategy-schema.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

// Surgical point-edit of a ЕПК (UnifiedCampaign) via /json/v501/campaigns update.
// Only the fields you pass are changed; everything else is left as-is. DANGER-lite
// gate (env flags + confirm) — this can change budget/strategy on a live campaign.
const InputSchema = z.object({
  campaign_id: z.number().int().positive().describe("ЕПК campaign ID to edit"),
  name: z.string().min(1).optional().describe("New campaign name"),
  daily_budget_micros: z.number().int().positive().optional().describe("New daily budget in ACCOUNT-currency micros (× 1e6). Only valid with a manual search strategy."),
  excluded_sites: z.array(z.string().min(1)).max(1000).optional().describe("Площадки-исключения: domains/network sites to block in РСЯ. REPLACES the whole list (pass [] to clear)."),
  negative_keywords: z.array(z.string().min(1)).optional().describe("Campaign-level negative keywords (minus-words). REPLACES the set (pass [] to clear). For append semantics use yandex_direct_negative_keywords_add."),
  notification: z
    .object({
      EmailSettings: z
        .object({
          Email: z.string().optional(),
          SendAccountNews: z.enum(["YES", "NO"]).optional(),
          SendWarnings: z.enum(["YES", "NO"]).optional(),
          WarningBalance: z.number().int().optional(),
          CheckPositionInterval: z.number().int().optional(),
        })
        .optional(),
      SmsSettings: z.record(z.string(), z.unknown()).optional(),
    })
    .optional()
    .describe("Notification settings. Email lives under Notification.EmailSettings (NOT .Email)."),
  time_targeting: z.record(z.string(), z.unknown()).optional().describe("Hourly schedule: { Schedule:{Items:[\"<day>,<c0..c23>\"]}, ConsiderWorkingWeekends:\"YES\"|\"NO\" }"),
  strategy: strategySpecSchema.optional(),
  bidding_strategy: z.record(z.string(), z.unknown()).optional().describe("Raw escape hatch — full { Search, Network } BiddingStrategy verbatim. Prefer the typed `strategy` param."),
  attribution_model: z
    .enum(["LC", "LSC", "FC", "LYDC", "LSCCD", "FCCD", "LYDCCD", "AUTO"])
    .optional()
    .describe("Attribution model (short codes): LC last-click, LSC last-significant-click, FC first-click, LYDC last-Yandex-Direct-click, *CD cross-device, AUTO automatic."),
  settings: z
    .array(z.object({ Option: z.string(), Value: z.enum(["YES", "NO"]) }))
    .optional()
    .describe("ЕПК Settings toggles. ExtendedGeoTargeting = ENABLE_AREA_OF_INTEREST_TARGETING / ENABLE_CURRENT_AREA_TARGETING / ENABLE_REGULAR_AREA_TARGETING. Others: ADD_METRICA_TAG, ENABLE_SITE_MONITORING, ENABLE_COMPANY_INFO, CAMPAIGN_EXACT_PHRASE_MATCHING_ENABLED, ALTERNATIVE_TEXTS_ENABLED, ADD_TO_FAVORITES, REQUIRE_SERVICING."),
  tracking_params: z.string().optional().describe("UTM / tracking params string"),
  counter_ids: z.array(z.number().int()).optional().describe("Metrika counter IDs → CounterIds.Items"),
  goal_ids: z.array(z.number().int()).optional().describe("Metrika goal IDs → PriorityGoals (Value defaults to 100). Use priority_goals for per-goal conversion value."),
  priority_goals: z
    .array(z.object({ goal_id: z.number().int().positive(), value: z.number().int().nonnegative().optional() }))
    .optional()
    .describe("Metrika goals with per-goal conversion Value (ценность конверсии, micros). Takes precedence over goal_ids. Applied with Operation SET."),
  raw_fields: z.record(z.string(), z.unknown()).optional().describe("Escape hatch: extra fields merged verbatim at the Campaign level"),
  raw_unified_fields: z.record(z.string(), z.unknown()).optional().describe("Escape hatch: extra fields merged verbatim inside UnifiedCampaign"),
  confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z.string().min(1).optional().describe("Agency client login (Client-Login header) for sub-client cabinets"),
});

type Input = z.infer<typeof InputSchema>;

const EDITABLE_KEYS = [
  "name", "daily_budget_micros", "excluded_sites", "negative_keywords", "notification", "time_targeting",
  "strategy", "bidding_strategy", "attribution_model", "settings", "tracking_params", "counter_ids", "goal_ids", "priority_goals",
  "raw_fields", "raw_unified_fields",
] as const;

export async function runDirectUpdateCampaign(input: Input) {
  const parsed = InputSchema.parse(input);

  // DANGER-lite gate (env flags + confirm); campaign edits are reversible but affect live serving.
  if (process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS !== "true") throw new Error("OHMY_SEO_ALLOW_LIVE_MUTATIONS=true required");
  if (process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS !== "true") throw new Error("YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true required");
  if (parsed.confirm !== true) throw new Error("confirm: true required");

  const provided = EDITABLE_KEYS.filter((k) => parsed[k] !== undefined);
  if (provided.length === 0) throw new Error("no editable fields provided — pass at least one of: " + EDITABLE_KEYS.join(", "));

  try {
    const body = buildCampaignUpdatePayload({
      campaign_id: parsed.campaign_id,
      name: parsed.name,
      daily_budget_micros: parsed.daily_budget_micros,
      excluded_sites: parsed.excluded_sites,
      negative_keywords: parsed.negative_keywords,
      notification: parsed.notification,
      time_targeting: parsed.time_targeting,
      bidding_strategy: parsed.strategy ? buildEpkBiddingStrategy(parsed.strategy) : parsed.bidding_strategy,
      attribution_model: parsed.attribution_model,
      settings: parsed.settings,
      tracking_params: parsed.tracking_params,
      counter_ids: parsed.counter_ids,
      goal_ids: parsed.goal_ids,
      priority_goals: parsed.priority_goals,
      raw_fields: parsed.raw_fields,
      raw_unified_fields: parsed.raw_unified_fields,
    });

    const result = await executeApiCall({ apiName: "direct", endpoint: "/json/v501/campaigns", method: "POST", body, account: parsed.account, client_login: parsed.client_login });
    if (!result.ok) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Campaigns.update failed", details: result.body }) }] };
    const apiErr = (result.data as { error?: unknown })?.error;
    if (apiErr) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Campaigns.update failed", details: apiErr }) }] };

    const upd = (result.data as { result?: { UpdateResults?: Array<Record<string, unknown>> } })?.result?.UpdateResults ?? [];
    const errors = upd.flatMap((r) => (r.Errors as unknown[]) ?? []);
    const warnings = upd.flatMap((r) => (r.Warnings as unknown[]) ?? []);
    return { content: [{ type: "text" as const, text: JSON.stringify({ updated: errors.length === 0, campaign_id: parsed.campaign_id, fields: provided, errors, warnings, result: result.data }, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
