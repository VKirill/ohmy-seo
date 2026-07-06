/**
 * wiring.test.ts — F6 payload wiring tests for the combinatorial ResponsiveAd (v501),
 * Callouts, and SitelinksSet.
 *
 * The project now builds ONLY UNIFIED_CAMPAIGN + ResponsiveAd. The old TextAd
 * (buildAdTgoPayload) / TextImageAd (buildAdRsyaPayload) builders are gone, so the
 * wiring aspects previously verified on them (SitelinkSetId / AdExtensionIds /
 * image hashes) are now covered here on buildResponsiveAdPayload instead.
 *
 * Covers acceptance criteria:
 *   - buildResponsiveAdPayload: proven v501 schema — Titles/Texts/Href (singular)/
 *     AdImageHashes/VideoExtensionIds/SitelinkSetId (singular)/AdExtensionIds (flat array)
 *   - AdImageHashes wiring (NOT ImageHashes / AdImageHash), capped at 5
 *   - SitelinkSetId wiring (singular, NOT SitelinksSetId, inside ResponsiveAd)
 *   - AdExtensionIds wiring (flat array, NOT AdExtensions:{Items})
 *   - optional fields absent when not provided
 *   - buildCalloutPayload: builds correct AdExtensions.add body
 *   - buildSitelinksSetPayload: normalization
 */

import { describe, it, expect, vi } from "vitest";

// Mock transitive dependencies that import @ohmy-seo/mcp-core subpaths
vi.mock("../src/lib/api-gateway.js", () => ({}));
vi.mock("../src/lib/account-resolver.js", () => ({}));
vi.mock("../src/lib/csv-parser.js", () => ({}));
vi.mock("../src/lib/bundle-ledger.js", () => ({}));

import {
  buildCalloutPayload,
  buildResponsiveAdPayload,
  buildSitelinksSetPayload,
} from "../src/lib/payload-builder.js";

/** Extract the ResponsiveAd object from a buildResponsiveAdPayload result. */
function extractResponsiveAd(payload: ReturnType<typeof buildResponsiveAdPayload>) {
  const ad = payload.params.Ads[0] as Record<string, unknown>;
  return { ad, responsiveAd: ad["ResponsiveAd"] as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Part (a) — core field names: Titles, Texts, Href (singular), AdImageHashes
// ---------------------------------------------------------------------------

describe("buildResponsiveAdPayload — v501 proven schema (field names)", () => {
  it("produces correct field names: Titles, Texts, Href (singular), AdImageHashes", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 100,
      Titles: ["Заголовок один"],
      Texts: ["Текст объявления"],
      Href: "https://example.com",
      AdImageHashes: ["hash_a", "hash_b"],
    });
    const { responsiveAd } = extractResponsiveAd(payload);

    // Correct fields must be present
    expect(responsiveAd["Titles"]).toEqual(["Заголовок один"]);
    expect(responsiveAd["Texts"]).toEqual(["Текст объявления"]);
    expect(responsiveAd["Href"]).toBe("https://example.com");
    expect(responsiveAd["AdImageHashes"]).toEqual(["hash_a", "hash_b"]);

    // Wrong field names from old schema must NOT be present
    expect(responsiveAd["Hrefs"]).toBeUndefined();
    expect(responsiveAd["ImageHashes"]).toBeUndefined();
    expect(responsiveAd["AdImageHash"]).toBeUndefined();
    expect(responsiveAd["Title2s"]).toBeUndefined();
  });

  it("method is 'add' and AdGroupId is set correctly", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 999,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
    });
    expect(payload.method).toBe("add");
    const { ad } = extractResponsiveAd(payload);
    expect(ad["AdGroupId"]).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// Part (b) — AdImageHashes wiring
// ---------------------------------------------------------------------------

describe("buildResponsiveAdPayload — AdImageHashes wiring", () => {
  it("sets AdImageHashes from provided hashes (NOT ImageHashes / AdImageHash)", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 1,
      Titles: ["Тест"],
      Texts: ["Текст объявления"],
      Href: "https://example.com",
      AdImageHashes: ["abc123hash"],
    });
    const { responsiveAd } = extractResponsiveAd(payload);
    expect(responsiveAd["AdImageHashes"]).toEqual(["abc123hash"]);
    expect(responsiveAd["ImageHashes"]).toBeUndefined();
    expect(responsiveAd["AdImageHash"]).toBeUndefined();
  });

  it("slices AdImageHashes to max 5", () => {
    const hashes = ["h1", "h2", "h3", "h4", "h5", "h6", "h7"];
    const payload = buildResponsiveAdPayload({
      ad_group_id: 100,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
      AdImageHashes: hashes,
    });
    const { responsiveAd } = extractResponsiveAd(payload);
    expect((responsiveAd["AdImageHashes"] as string[]).length).toBe(5);
  });

  it("omits AdImageHashes when not provided", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 100,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
    });
    const { responsiveAd } = extractResponsiveAd(payload);
    expect(responsiveAd["AdImageHashes"]).toBeUndefined();
  });

  it("omits AdImageHashes when an empty array is provided", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 100,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
      AdImageHashes: [],
    });
    const { responsiveAd } = extractResponsiveAd(payload);
    expect(responsiveAd["AdImageHashes"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Part (c) — SitelinkSetId (singular) wiring inside ResponsiveAd
// ---------------------------------------------------------------------------

describe("buildResponsiveAdPayload — SitelinkSetId wiring (singular, inside ResponsiveAd)", () => {
  it("includes SitelinkSetId inside ResponsiveAd (not at Ad level) when provided", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 10,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
      SitelinkSetId: 42,
    });
    const { ad, responsiveAd } = extractResponsiveAd(payload);
    // SitelinkSetId (singular) must be INSIDE ResponsiveAd
    expect(responsiveAd["SitelinkSetId"]).toBe(42);
    // Must NOT appear at Ad level or with plural spelling
    expect(ad["SitelinkSetId"]).toBeUndefined();
    expect(ad["SitelinksSetId"]).toBeUndefined();
    expect(responsiveAd["SitelinksSetId"]).toBeUndefined();
  });

  it("wires SitelinkSetId (singular) with correct value 555", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 10,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
      SitelinkSetId: 555,
    });
    const { responsiveAd } = extractResponsiveAd(payload);
    expect(responsiveAd["SitelinkSetId"]).toBe(555);
    expect(responsiveAd["SitelinksSetId"]).toBeUndefined();
  });

  it("omits SitelinkSetId from ResponsiveAd when not provided", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 10,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
    });
    const { ad, responsiveAd } = extractResponsiveAd(payload);
    expect(ad["SitelinkSetId"]).toBeUndefined();
    expect(ad["SitelinksSetId"]).toBeUndefined();
    expect(responsiveAd["SitelinkSetId"]).toBeUndefined();
    expect(responsiveAd["SitelinksSetId"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Part (d) — AdExtensionIds (callout IDs) wiring — flat array
// ---------------------------------------------------------------------------

describe("buildResponsiveAdPayload — AdExtensionIds wiring (flat array)", () => {
  it("wires AdExtensionIds as direct array (NOT AdExtensions:{Items})", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 5,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
      AdExtensionIds: [101, 102, 103],
    });
    const { responsiveAd } = extractResponsiveAd(payload);
    // Must be a direct array, NOT {Items: [...]}
    expect(responsiveAd["AdExtensionIds"]).toEqual([101, 102, 103]);
    expect(responsiveAd["AdExtensions"]).toBeUndefined();
  });

  it("omits AdExtensionIds when not provided", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 5,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
    });
    const { responsiveAd } = extractResponsiveAd(payload);
    expect(responsiveAd["AdExtensionIds"]).toBeUndefined();
    expect(responsiveAd["AdExtensions"]).toBeUndefined();
  });

  it("omits AdExtensionIds when an empty array is provided", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 5,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
      AdExtensionIds: [],
    });
    const { responsiveAd } = extractResponsiveAd(payload);
    expect(responsiveAd["AdExtensionIds"]).toBeUndefined();
    expect(responsiveAd["AdExtensions"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Part (e) — VideoExtensionIds wiring + all-optionals-absent
// ---------------------------------------------------------------------------

describe("buildResponsiveAdPayload — VideoExtensionIds + optional fields", () => {
  it("wires VideoExtensionIds when provided", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 8,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
      VideoExtensionIds: [9001, 9002],
    });
    const { responsiveAd } = extractResponsiveAd(payload);
    expect(responsiveAd["VideoExtensionIds"]).toEqual([9001, 9002]);
  });

  it("omits every optional field when none are provided", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 100,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
    });
    const { responsiveAd } = extractResponsiveAd(payload);
    expect(responsiveAd["AdImageHashes"]).toBeUndefined();
    expect(responsiveAd["VideoExtensionIds"]).toBeUndefined();
    expect(responsiveAd["SitelinkSetId"]).toBeUndefined();
    expect(responsiveAd["AdExtensionIds"]).toBeUndefined();
    // only the three required fields remain
    expect(Object.keys(responsiveAd).sort()).toEqual(["Href", "Texts", "Titles"]);
  });
});

// ---------------------------------------------------------------------------
// Combined — all wiring fields in one ResponsiveAd payload
// ---------------------------------------------------------------------------

describe("buildResponsiveAdPayload — combined AdImageHashes + SitelinkSetId + AdExtensionIds", () => {
  it("wires AdImageHashes + SitelinkSetId (singular) + AdExtensionIds (flat) all inside ResponsiveAd", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 7,
      Titles: ["Комплексное объявление"],
      Texts: ["Все расширения"],
      Href: "https://example.com/full",
      AdImageHashes: ["fullhash_xyz"],
      SitelinkSetId: 55,
      AdExtensionIds: [301, 302],
    });
    const { ad, responsiveAd } = extractResponsiveAd(payload);
    expect(responsiveAd["AdImageHashes"]).toEqual(["fullhash_xyz"]);
    expect(responsiveAd["AdExtensionIds"]).toEqual([301, 302]);
    expect(responsiveAd["AdExtensions"]).toBeUndefined();
    // SitelinkSetId (singular) is INSIDE ResponsiveAd — verified live
    expect(responsiveAd["SitelinkSetId"]).toBe(55);
    // Must NOT appear at Ad level or with plural spelling
    expect(ad["SitelinkSetId"]).toBeUndefined();
    expect(ad["SitelinksSetId"]).toBeUndefined();
    expect(responsiveAd["SitelinksSetId"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Callouts
// ---------------------------------------------------------------------------

describe("buildCalloutPayload — CALLOUT extension body (naming map §5.2)", () => {
  it("builds correct AdExtensions.add body for single callout", () => {
    const payload = buildCalloutPayload({ callout_texts: ["Доставка бесплатно"] });
    expect(payload.method).toBe("add");
    expect(payload.params.AdExtensions).toHaveLength(1);
    expect(payload.params.AdExtensions[0]).toEqual({
      Callout: { CalloutText: "Доставка бесплатно" },
    });
  });

  it("builds multiple callouts in one request", () => {
    const payload = buildCalloutPayload({
      callout_texts: ["Бесплатная доставка", "Гарантия 2 года", "Скидка 20%"],
    });
    expect(payload.params.AdExtensions).toHaveLength(3);
    expect(payload.params.AdExtensions[1]).toEqual({
      Callout: { CalloutText: "Гарантия 2 года" },
    });
  });
});

// ---------------------------------------------------------------------------
// SitelinksSet — normalization
// ---------------------------------------------------------------------------

describe("buildSitelinksSetPayload — normalization", () => {
  it("normalizes sitelinks Title and Description for AndySpark cases", () => {
    const payload = buildSitelinksSetPayload({
      Sitelinks: [
        {
          Title: "Домокомплект ~2 мес + сборка ~2 мес",
          Description: "R=1,47 при норме 0,52",
          Href: "https://example.com/1",
        },
        {
          Title: "REHAU, Roto, Akzo Nobel, REMMERS",
          Href: "https://example.com/2",
        },
      ],
    });
    expect(payload.method).toBe("add");
    const sitelinks = payload.params.SitelinksSets[0].Sitelinks;
    expect(sitelinks).toHaveLength(2);

    // Title limit <= 30: "Домокомплект около2 мес плюс с"
    expect(sitelinks[0].Title).toBe("Домокомплект около2 мес плюс с");
    // Description limit <= 60: "R 1,47 при норме 0,52"
    expect(sitelinks[0].Description).toBe("R 1,47 при норме 0,52");
    expect(sitelinks[0].Href).toBe("https://example.com/1");

    // Title limit <= 30: "REHAU, Roto, Akzo Nobel, REMMERS" length is 32 -> trimmed to 30
    expect(sitelinks[1].Title).toBe("REHAU, Roto, Akzo Nobel, REMME");
  });
});
