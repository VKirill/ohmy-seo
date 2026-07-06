/**
 * Direct API payload builders — image upload, sitelinks, callouts, promo extensions.
 */

import { randomHex } from "./_helpers.js";

// ---------------------------------------------------------------------------
// 6. Image upload
// ---------------------------------------------------------------------------

/**
 * Build an AdImages.add payload with a unique Name field.
 *
 * Quirks addressed:
 *   - Quirk 3: The Name field is REQUIRED by the API. Omitting it causes
 *              immediate rejection. A unique name is generated using
 *              Date.now() + random hex to prevent collision across pipeline runs.
 */
export function buildImageUploadPayload(input: {
  base64: string;
  format: "JPEG" | "PNG";
}): { method: "add"; params: { AdImages: [{ ImageData: string; Name: string }] } } {
  const name = `phase-${Date.now()}-${randomHex(4)}`;

  return {
    method: "add",
    params: {
      AdImages: [
        {
          ImageData: input.base64,
          Name: name,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// 8. Sitelinks set create
// ---------------------------------------------------------------------------

/**
 * Build a Sitelinks.add payload for Yandex Direct v5.
 *
 * Direct v5 API requires sitelinks wrapped in a SitelinksSets array:
 *   { method: "add", params: { SitelinksSets: [{ Sitelinks: [...] }] } }
 *
 * Each sitelink requires at minimum a Title and Href; Description is optional.
 */
/**
 * Normalize sitelink text (Title or Description) by replacing invalid characters,
 * collapsing repeated spaces, trimming, and ensuring it fits within maxLength.
 */
export function normalizeSitelinkText(text: string, maxLength: number): string {
  let normalized = text
    .replace(/~/g, "около")
    .replace(/\+/g, " плюс ")
    .replace(/=/g, " ");

  normalized = normalized.replace(/\s+/g, " ");
  normalized = normalized.trim();

  if (normalized.length > maxLength) {
    normalized = normalized.slice(0, maxLength);
    // Trim trailing punctuation/spaces
    normalized = normalized.replace(/[\s.,;:!\?\-\+=\~]+$/, "");
  }

  return normalized;
}

export function buildSitelinksSetPayload(input: {
  Sitelinks: Array<{ Title: string; Description?: string; Href: string }>;
}): { method: "add"; params: { SitelinksSets: Array<{ Sitelinks: Array<{ Title: string; Description?: string; Href: string }> }> } } {
  const normalizedSitelinks = input.Sitelinks.map((s) => ({
    Title: normalizeSitelinkText(s.Title, 30),
    Description: s.Description !== undefined ? normalizeSitelinkText(s.Description, 60) : undefined,
    Href: s.Href,
  }));
  return { method: "add", params: { SitelinksSets: [{ Sitelinks: normalizedSitelinks }] } };
}

// ---------------------------------------------------------------------------
// 9a. Callout (Уточнение) create
// ---------------------------------------------------------------------------

/**
 * Build an AdExtensions.add payload for one or more Callout extensions.
 *
 * Per naming-map §5.2:
 *   Endpoint: POST /json/v5/adextensions (type: CALLOUT)
 *   Each callout text ≤ 25 chars. IDs returned are wired via AdExtensions.Items on TextAd/TextImageAd.
 */
export function buildCalloutPayload(input: {
  callout_texts: string[];
}): { method: "add"; params: { AdExtensions: Array<{ Callout: { CalloutText: string } }> } } {
  return {
    method: "add",
    params: {
      AdExtensions: input.callout_texts.map((text) => ({
        Callout: { CalloutText: text },
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// 9. Promo extension create
// ---------------------------------------------------------------------------

/**
 * Build an AdExtensions.add payload for a PromoExtension in Yandex Direct v5.
 *
 * PromoExtension surfaces a promotional offer (discount, promo code, etc.)
 * alongside the ad. EndDate is required; all other fields are optional.
 */
export function buildPromoExtensionPayload(input: {
  PromoExtension: {
    PromotionType: string;
    Discount?: number;
    DiscountUnit?: string;
    StartDate?: string;
    EndDate: string;
    PromoCode?: string;
    Href?: string;
  };
}): { method: "add"; params: { AdExtensions: Array<{ PromoExtension: typeof input.PromoExtension }> } } {
  return {
    method: "add",
    params: { AdExtensions: [{ PromoExtension: input.PromoExtension }] },
  };
}
