/**
 * Direct API payload builders — BidModifiers (корректировки ставок).
 */

// ---------------------------------------------------------------------------
// 13. BidModifiers (корректировки ставок) — /json/v5/bidmodifiers (v501 works too)
// ---------------------------------------------------------------------------

/**
 * BidModifiers is a stand-alone Direct service. Each modifier carries ONE typed
 * adjustment object keyed by its type name, scoped to a CampaignId or AdGroupId.
 * Live-verified against a ЕПК (UnifiedCampaign): the API accepts MobileAdjustment,
 * DesktopAdjustment, DesktopOnlyAdjustment (mutually exclusive with Desktop) and
 * VideoAdjustment; Demographics/Regional/Retargeting/AbSegment/Weather/IncomeGrade/
 * InventoryType/SmartAd are rejected as "unknown parameter" for ЕПК (they remain
 * valid for classic campaign types — the builders pass adjustments through verbatim
 * so the API is the source of truth per campaign type).
 *
 * Quirks:
 *   - add returns AddResults[].Ids (an ARRAY), NOT AddResults[].Id like Campaigns/Ads.
 *   - there is NO `toggle` method and NO `Enabled` field — coefficients change via `set`.
 *   - get requires SelectionCriteria.Levels and per-type <Type>AdjustmentFieldNames.
 */

/** Adjustment type → its get() field-name key + default field list. */
export const BID_MODIFIER_GET_FIELDS: Record<string, { key: string; fields: string[] }> = {
  MOBILE:       { key: "MobileAdjustmentFieldNames",        fields: ["BidModifier", "OperatingSystemType"] },
  DESKTOP:      { key: "DesktopAdjustmentFieldNames",       fields: ["BidModifier"] },
  DESKTOP_ONLY: { key: "DesktopOnlyAdjustmentFieldNames",   fields: ["BidModifier"] },
  VIDEO:        { key: "VideoAdjustmentFieldNames",         fields: ["BidModifier"] },
  DEMOGRAPHICS: { key: "DemographicsAdjustmentFieldNames",  fields: ["BidModifier", "Age", "Gender"] },
  REGIONAL:     { key: "RegionalAdjustmentFieldNames",      fields: ["BidModifier", "RegionId"] },
  RETARGETING:  { key: "RetargetingAdjustmentFieldNames",   fields: ["BidModifier", "RetargetingConditionId"] },
};

/** ЕПК-verified adjustment types (the safe default for a get on a UnifiedCampaign). */
export const BID_MODIFIER_EPK_TYPES = ["MOBILE", "DESKTOP", "DESKTOP_ONLY", "VIDEO"];

/**
 * Map a friendly adjustment spec (type + fields) to the API adjustment object
 * scoped to a campaign or ad group. Shared by the set_bid_modifiers tool and the
 * bundle epk-settings applier so both speak the same shape.
 */
export function buildBidModifierAdjustment(a: {
  campaign_id?: number | string;
  ad_group_id?: number | string;
  type: "mobile" | "desktop" | "desktop_only" | "video" | "demographics" | "regional" | "retargeting" | "raw";
  bid_modifier?: number;
  operating_system_type?: string;
  age?: string;
  gender?: string;
  region_id?: number;
  retargeting_condition_id?: number;
  raw_adjustment?: Record<string, unknown>;
}): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  if (a.campaign_id !== undefined) scope["CampaignId"] = a.campaign_id;
  if (a.ad_group_id !== undefined) scope["AdGroupId"] = a.ad_group_id;
  const bm = a.bid_modifier;
  switch (a.type) {
    case "mobile":
      return { ...scope, MobileAdjustment: { BidModifier: bm, ...(a.operating_system_type ? { OperatingSystemType: a.operating_system_type } : {}) } };
    case "desktop":
      return { ...scope, DesktopAdjustment: { BidModifier: bm } };
    case "desktop_only":
      return { ...scope, DesktopOnlyAdjustment: { BidModifier: bm } };
    case "video":
      return { ...scope, VideoAdjustment: { BidModifier: bm } };
    case "demographics":
      return { ...scope, DemographicsAdjustment: { BidModifier: bm, ...(a.age ? { Age: a.age } : {}), ...(a.gender ? { Gender: a.gender } : {}) } };
    case "regional":
      return { ...scope, RegionalAdjustment: { BidModifier: bm, RegionId: a.region_id } };
    case "retargeting":
      return { ...scope, RetargetingAdjustment: { BidModifier: bm, RetargetingConditionId: a.retargeting_condition_id } };
    case "raw":
      return { ...scope, ...(a.raw_adjustment ?? {}) };
  }
}

export function buildBidModifierAddPayload(
  modifiers: Array<Record<string, unknown>>,
): { method: "add"; params: { BidModifiers: Array<unknown> } } {
  return { method: "add", params: { BidModifiers: modifiers } };
}

export function buildBidModifierSetPayload(
  modifiers: Array<{ Id: number | string; BidModifier: number }>,
): { method: "set"; params: { BidModifiers: Array<unknown> } } {
  return { method: "set", params: { BidModifiers: modifiers } };
}

export function buildBidModifierDeletePayload(
  ids: Array<number | string>,
): { method: "delete"; params: { SelectionCriteria: { Ids: Array<number | string> } } } {
  return { method: "delete", params: { SelectionCriteria: { Ids: ids } } };
}

export function buildBidModifierGetPayload(input: {
  campaign_ids?: Array<number | string>;
  ad_group_ids?: Array<number | string>;
  ids?: Array<number | string>;
  levels?: string[];
  types?: string[]; // subset of BID_MODIFIER_GET_FIELDS keys; defaults to the ЕПК-verified set
}): { method: "get"; params: Record<string, unknown> } {
  const sc: Record<string, unknown> = {};
  if (input.ids && input.ids.length) sc["Ids"] = input.ids;
  if (input.campaign_ids && input.campaign_ids.length) sc["CampaignIds"] = input.campaign_ids;
  if (input.ad_group_ids && input.ad_group_ids.length) sc["AdGroupIds"] = input.ad_group_ids;
  sc["Levels"] = input.levels ?? ["CAMPAIGN", "AD_GROUP"];

  const params: Record<string, unknown> = {
    SelectionCriteria: sc,
    FieldNames: ["Id", "CampaignId", "AdGroupId", "Level", "Type"],
  };
  const types = input.types && input.types.length ? input.types : BID_MODIFIER_EPK_TYPES;
  for (const t of types) {
    const spec = BID_MODIFIER_GET_FIELDS[t];
    if (spec) params[spec.key] = spec.fields;
  }
  return { method: "get", params };
}
