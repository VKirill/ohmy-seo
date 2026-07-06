import { executeApiCall } from "./api-gateway.js";
import {
  buildCampaignUpdatePayload,
  buildBidModifierAddPayload,
  buildBidModifierAdjustment,
  buildEpkBiddingStrategy,
  type StrategySpec,
} from "./payload-builder.js";

/**
 * ЕПК campaign settings carried in a bundle's `_campaign.yaml` (`epk_settings:` block)
 * and applied POST-CREATE — after the combinatorial upload pipeline has created the
 * campaign(s). Kept out of the create pipeline so the plan_hash and dependency logic
 * stay untouched; this is a pure "then also configure it" step.
 *
 * Everything except `bid_modifiers` goes through one `Campaigns.update` (v501);
 * `bid_modifiers` go through one `bidmodifiers.add` scoped to the campaign.
 * On ЕПК only device (mobile/desktop/desktop_only) + video adjustments apply.
 */
export interface EpkBidModifierSpec {
  type: "mobile" | "desktop" | "desktop_only" | "video" | "demographics" | "regional" | "retargeting" | "raw";
  bid_modifier?: number;
  operating_system_type?: string;
  age?: string;
  gender?: string;
  region_id?: number;
  retargeting_condition_id?: number;
  raw_adjustment?: Record<string, unknown>;
}

export interface EpkSettings {
  excluded_sites?: string[];
  negative_keywords?: string[];
  attribution_model?: string;
  time_targeting?: Record<string, unknown>;
  notification?: Record<string, unknown>;
  settings?: Array<{ Option: string; Value: string }>;
  tracking_params?: string;
  counter_ids?: number[];
  priority_goals?: Array<{ goal_id: number; value?: number }>;
  strategy?: StrategySpec;
  bid_modifiers?: EpkBidModifierSpec[];
}

export interface ApplyEpkResult {
  campaign_id: number;
  updated_fields: string[];
  bid_modifiers_created: string[];
  errors: string[];
  warnings: unknown[];
}

/** Which EpkSettings keys map to a Campaigns.update (everything except bid_modifiers). */
const CAMPAIGN_UPDATE_KEYS: Array<keyof EpkSettings> = [
  "excluded_sites", "negative_keywords", "attribution_model", "time_targeting", "notification", "settings", "tracking_params", "counter_ids", "priority_goals", "strategy",
];

export function hasEpkSettings(s: EpkSettings | undefined | null): boolean {
  if (!s) return false;
  return (
    CAMPAIGN_UPDATE_KEYS.some((k) => s[k] !== undefined) ||
    (Array.isArray(s.bid_modifiers) && s.bid_modifiers.length > 0)
  );
}

export async function applyEpkCampaignSettings(opts: {
  campaign_id: number;
  settings: EpkSettings;
  account?: string;
  client_login?: string;
}): Promise<ApplyEpkResult> {
  const { campaign_id, settings, account, client_login } = opts;
  const out: ApplyEpkResult = { campaign_id, updated_fields: [], bid_modifiers_created: [], errors: [], warnings: [] };

  // ---- 1. Campaigns.update for the non-bidmodifier fields ----
  const updateKeys = CAMPAIGN_UPDATE_KEYS.filter((k) => settings[k] !== undefined);
  if (updateKeys.length > 0) {
    const body = buildCampaignUpdatePayload({
      campaign_id,
      excluded_sites: settings.excluded_sites,
      negative_keywords: settings.negative_keywords,
      attribution_model: settings.attribution_model,
      time_targeting: settings.time_targeting,
      notification: settings.notification,
      settings: settings.settings,
      tracking_params: settings.tracking_params,
      counter_ids: settings.counter_ids,
      priority_goals: settings.priority_goals,
      bidding_strategy: settings.strategy ? buildEpkBiddingStrategy(settings.strategy) : undefined,
    });
    const r = await executeApiCall({ apiName: "direct", endpoint: "/json/v501/campaigns", method: "POST", body, account, client_login });
    if (!r.ok) {
      out.errors.push(`Campaigns.update failed: ${JSON.stringify(r.body)}`);
    } else {
      const apiErr = (r.data as { error?: unknown })?.error;
      if (apiErr) {
        out.errors.push(`Campaigns.update error: ${JSON.stringify(apiErr)}`);
      } else {
        const upd = (r.data as { result?: { UpdateResults?: Array<Record<string, unknown>> } })?.result?.UpdateResults ?? [];
        const errs = upd.flatMap((u) => (u.Errors as unknown[]) ?? []);
        if (errs.length > 0) out.errors.push(`Campaigns.update item errors: ${JSON.stringify(errs)}`);
        else out.updated_fields = updateKeys as string[];
        out.warnings.push(...upd.flatMap((u) => (u.Warnings as unknown[]) ?? []));
      }
    }
  }

  // ---- 2. bidmodifiers.add scoped to this campaign ----
  if (Array.isArray(settings.bid_modifiers) && settings.bid_modifiers.length > 0) {
    const body = buildBidModifierAddPayload(
      settings.bid_modifiers.map((m) => buildBidModifierAdjustment({ ...m, campaign_id })),
    );
    const r = await executeApiCall({ apiName: "direct", endpoint: "/json/v5/bidmodifiers", method: "POST", body, account, client_login });
    if (!r.ok) {
      out.errors.push(`bidmodifiers.add failed: ${JSON.stringify(r.body)}`);
    } else {
      const apiErr = (r.data as { error?: unknown })?.error;
      if (apiErr) {
        out.errors.push(`bidmodifiers.add error: ${JSON.stringify(apiErr)}`);
      } else {
        const addResults = (r.data as { result?: { AddResults?: Array<Record<string, unknown>> } })?.result?.AddResults ?? [];
        out.bid_modifiers_created = addResults.flatMap((a) => (a.Ids as unknown[]) ?? []).map(String);
        const errs = addResults.flatMap((a) => (a.Errors as unknown[]) ?? []);
        if (errs.length > 0) out.errors.push(`bidmodifiers.add item errors: ${JSON.stringify(errs)}`);
      }
    }
  }

  return out;
}
