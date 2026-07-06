/**
 * Direct API payload builders — ResponsiveAd create/update.
 */

// ---------------------------------------------------------------------------
// 10. ResponsiveAd create
// ---------------------------------------------------------------------------

/**
 * Build an Ads.add payload for a ResponsiveAd — РСЯ smart ad, v501 endpoint only, verified live.
 *
 * MUST be posted to /json/v501/ads (NOT /json/v5/ads — v5 returns error 3500).
 * Proven-correct schema (live-verified):
 *   - Titles: string[]        — required, 1-7 items
 *   - Texts: string[]         — required, 1-3 items
 *   - Href: string            — singular URL (NOT Hrefs array)
 *   - AdImageHashes: string[] — required when images used, 1-5 items
 *                              (NOT ImageHashes, NOT AdImageHash)
 *   - SitelinkSetId: number   — optional, singular
 *   - AdExtensionIds: number[]— optional, array of IDs directly
 *                              (NOT AdExtensions:{Items})
 *   - No Title2s (not in ResponsiveAd spec)
 */
export function buildResponsiveAdPayload(input: {
  ad_group_id: number;
  Titles: string[];
  Texts: string[];
  Href: string;
  AdImageHashes?: string[];
  VideoExtensionIds?: number[];
  SitelinkSetId?: number;
  AdExtensionIds?: number[];
  BusinessId?: number;                  // Yandex.Business organization id to attach to the ad
}): { method: "add"; params: { Ads: Array<unknown> } } {
  const responsiveAd: Record<string, unknown> = {
    Titles: input.Titles,
    Texts: input.Texts,
    Href: input.Href,
  };
  if (input.AdImageHashes && input.AdImageHashes.length > 0) {
    responsiveAd["AdImageHashes"] = input.AdImageHashes.slice(0, 5);
  }
  if (input.VideoExtensionIds && input.VideoExtensionIds.length > 0) {
    responsiveAd["VideoExtensionIds"] = input.VideoExtensionIds;
  }
  if (input.SitelinkSetId !== undefined) {
    responsiveAd["SitelinkSetId"] = input.SitelinkSetId;
  }
  if (input.AdExtensionIds && input.AdExtensionIds.length > 0) {
    responsiveAd["AdExtensionIds"] = input.AdExtensionIds;
  }
  if (input.BusinessId !== undefined) {
    responsiveAd["BusinessId"] = input.BusinessId;
  }

  return {
    method: "add",
    params: {
      Ads: [{
        AdGroupId: input.ad_group_id,
        ResponsiveAd: responsiveAd,
      }],
    },
  };
}

/**
 * Build an Ads.update payload for a combinatorial RESPONSIVE_AD (v501). The ad Id
 * MUST be passed as a STRING — Yandex ad ids exceed 2^53 and JSON.parse would round
 * them, causing "Ad not found" (8800). Only provided ResponsiveAd fields are emitted.
 */
export function buildResponsiveAdUpdatePayload(input: {
  ad_id: number | string;
  Titles?: string[];
  Texts?: string[];
  Href?: string;
  AdImageHashes?: string[];
  VideoExtensionIds?: number[];
  SitelinkSetId?: number;
  AdExtensionIds?: number[];
  BusinessId?: number;
}): { method: "update"; params: { Ads: Array<unknown> } } {
  const ra: Record<string, unknown> = {};
  if (input.Titles !== undefined) ra["Titles"] = input.Titles;
  if (input.Texts !== undefined) ra["Texts"] = input.Texts;
  if (input.Href !== undefined) ra["Href"] = input.Href;
  if (input.AdImageHashes !== undefined) ra["AdImageHashes"] = input.AdImageHashes;
  if (input.VideoExtensionIds !== undefined) ra["VideoExtensionIds"] = input.VideoExtensionIds;
  if (input.SitelinkSetId !== undefined) ra["SitelinkSetId"] = input.SitelinkSetId;
  if (input.AdExtensionIds !== undefined) ra["AdExtensionIds"] = input.AdExtensionIds;
  if (input.BusinessId !== undefined) ra["BusinessId"] = input.BusinessId;
  return { method: "update", params: { Ads: [{ Id: input.ad_id, ResponsiveAd: ra }] } };
}
