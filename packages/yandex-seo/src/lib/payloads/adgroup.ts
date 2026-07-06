/**
 * Direct API payload builders — AdGroup create/update, Keywords, auto-targeting.
 */

// ---------------------------------------------------------------------------
// 2. AdGroup create
// ---------------------------------------------------------------------------

/**
 * Build an AdGroups.add payload for Yandex Direct v5.
 *
 * Quirks addressed:
 *   - Quirk 1: RegionIds is set HERE at AdGroup level, not at Campaign level.
 *              The API ignores RegionIds on campaigns and requires it here.
 */
export function buildAdGroupPayload(input: {
  campaign_id: number;
  name: string;
  region_ids: number[];
}): { method: "add"; params: { AdGroups: [unknown] } } {
  return {
    method: "add",
    params: {
      AdGroups: [
        {
          CampaignId: input.campaign_id,
          Name: input.name,
          RegionIds: input.region_ids, // Quirk 1: lives here, not on Campaign
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Keyword add
// ---------------------------------------------------------------------------

/**
 * Build a Keywords.add payload for a single keyword.
 *
 * No quirks specific to this endpoint; it follows the standard v5 contract.
 * Pipeline calls this once per keyword.
 */
export function buildKeywordPayload(input: {
  ad_group_id: number;
  keyword_text: string;
}): { method: "add"; params: { Keywords: [unknown] } } {
  return {
    method: "add",
    params: {
      Keywords: [
        {
          AdGroupId: input.ad_group_id,
          Keyword: input.keyword_text,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// 11. Auto-targeting update on AdGroup
// ---------------------------------------------------------------------------

/**
 * Map legacy / bundle category names to Yandex Direct API category names for
 * the ---autotargeting keyword's AutotargetingCategories field.
 *
 * Returns null for names that have no API equivalent (TARGET_QUERIES) so
 * callers can drop them with a simple filter.
 *
 * API category names: EXACT, ALTERNATIVE, COMPETITOR, BROADER, ACCESSORY
 */
export function mapAutotargetingCategoryName(name: string): string | null {
  switch (name) {
    case "BROAD_MATCH":          return "BROADER";
    case "ACCESSORY_QUERIES":    return "ACCESSORY";
    case "ALTERNATIVE_QUERIES":  return "ALTERNATIVE";
    case "COMPETITOR_QUERIES":   return "COMPETITOR";
    case "EXACT_MENTION":        return "EXACT";
    // Already-canonical names pass through
    case "BROADER":              return "BROADER";
    case "ACCESSORY":            return "ACCESSORY";
    case "ALTERNATIVE":          return "ALTERNATIVE";
    case "COMPETITOR":           return "COMPETITOR";
    case "EXACT":                return "EXACT";
    // TARGET_QUERIES has no keyword-category equivalent
    case "TARGET_QUERIES":       return null;
    default:                     return null;
  }
}

/**
 * Sanitize autotargeting categories before sending to Yandex Direct.
 *
 * Yandex Direct Code 5005: "Запрещено выключать все категории в автотаргетинге"
 * — at least one category must remain ON. Additionally, EXACT (целевые) is the
 * safest category to keep enabled; disabling it is almost never desired and
 * causes confusing rejections when other categories are also disabled.
 *
 * Rules applied:
 *   1. Drop any entry where Category === "EXACT" and Value === "NO"
 *      (never send a request to disable EXACT targeting).
 *   2. If an EXACT:NO entry WAS present (and was dropped), AND the resulting
 *      list has no Value === "YES" entry, append { Category: "EXACT", Value: "YES" }
 *      as a guard so the update never leaves all categories OFF.
 *
 * The search default [BROADER:NO, ACCESSORY:NO, ALTERNATIVE:NO] passes through
 * unchanged because it has no EXACT:NO entry — EXACT/COMPETITOR implicitly
 * stay ON (not listed = remain at their current Direct state).
 *
 * @see Yandex Direct API error Code 5005
 */
export function sanitizeAutotargetingCategories(
  categories: Array<{ Category: string; Value: "YES" | "NO" }>,
): Array<{ Category: string; Value: "YES" | "NO" }> {
  // Rule 1: drop {EXACT, NO} — never disable EXACT targeting
  const hadExactNo = categories.some(
    (c) => c.Category === "EXACT" && c.Value === "NO",
  );
  const filtered = categories.filter(
    (c) => !(c.Category === "EXACT" && c.Value === "NO"),
  );

  // Rule 2: if EXACT:NO was removed AND nothing else is YES, append EXACT:YES
  // to prevent Code 5005 (all categories disabled). Only fires when EXACT was
  // explicitly in the input — the 3-default (BROADER/ACCESSORY/ALTERNATIVE all NO)
  // is unaffected because it never includes EXACT:NO.
  if (hadExactNo && filtered.length > 0 && !filtered.some((c) => c.Value === "YES")) {
    filtered.push({ Category: "EXACT", Value: "YES" });
  }

  return filtered;
}

/**
 * Build a Keywords.update payload to configure auto-targeting categories on
 * the special "---autotargeting" keyword in a TEXT_AD_GROUP.
 *
 * LIVE-PROVEN mechanism (canary on ki.vech):
 *   - Endpoint: /json/v5/keywords, method "update"
 *   - AutotargetingCategories is a DIRECT ARRAY on write (NOT wrapped in Items).
 *     On GET the API returns { Items: [...] } — the asymmetry is intentional.
 *
 * Category names: EXACT, ALTERNATIVE, COMPETITOR, BROADER, ACCESSORY
 */
export function buildAutoTargetingUpdatePayload(input: {
  autotargeting_keyword_id: number;
  categories: Array<{ Category: string; Value: "YES" | "NO" }>;
}): { method: "update"; params: { Keywords: Array<unknown> } } {
  return {
    method: "update",
    params: {
      Keywords: [
        {
          Id: input.autotargeting_keyword_id,
          AutotargetingCategories: input.categories,
        },
      ],
    },
  };
}

/** Build an AdGroups.update payload (v501). Only provided fields are emitted. */
export function buildAdGroupUpdatePayload(input: {
  ad_group_id: number | string;
  name?: string;
  region_ids?: number[];
  negative_keywords?: string[];
  tracking_params?: string;
  raw_fields?: Record<string, unknown>;
}): { method: "update"; params: { AdGroups: Array<unknown> } } {
  const g: Record<string, unknown> = { Id: input.ad_group_id };
  if (input.name !== undefined) g["Name"] = input.name;
  if (input.region_ids !== undefined) g["RegionIds"] = input.region_ids;
  if (input.negative_keywords !== undefined) g["NegativeKeywords"] = { Items: input.negative_keywords };
  if (input.tracking_params !== undefined) g["TrackingParams"] = input.tracking_params;
  if (input.raw_fields) Object.assign(g, input.raw_fields);
  return { method: "update", params: { AdGroups: [g] } };
}
