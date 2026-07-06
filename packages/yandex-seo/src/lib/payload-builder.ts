/**
 * Direct API payload builder — embeds 4 quirks discovered in b3-live-smoke.
 *
 * Quirks:
 *   1. RegionIds lives on AdGroup level, NOT on Campaign level.
 *   2. Search campaigns must use HIGHEST_POSITION or AVERAGE_CPC (not WB_DAILY_BUDGET)
 *      for the Search strategy; WB_DAILY_BUDGET is Network-only.
 *   3. AdImages.add requires a unique Name field; omitting it causes API rejection.
 *   4. StartDate must be in Moscow time (UTC+3); using UTC date can cause past-date
 *      rejection near midnight.
 *
 * Each builder function returns a ready-to-post JSON body for the generic
 * executeApiCall gateway. No typed wrappers — raw payload objects only.
 *
 * This module is a thin barrel: the builders live under ./payloads/ and are
 * re-exported here so existing consumers keep importing from
 * "../lib/payload-builder.js" unchanged. The internal helpers (getMoscowDate,
 * randomHex) stay private to ./payloads/ and are intentionally NOT re-exported.
 */

export * from "./payloads/campaign.js";
export * from "./payloads/adgroup.js";
export * from "./payloads/ad.js";
export * from "./payloads/extensions.js";
export * from "./payloads/bid-modifiers.js";
export * from "./payloads/bidding-strategy.js";
