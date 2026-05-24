/**
 * wiring.test.ts — F6 payload wiring tests for AdImageHash, SitelinkSetId, Callouts,
 * and ResponsiveAd v501 schema.
 *
 * Covers acceptance criteria:
 *   - AdImageHash: TEXT_IMAGE_AD payload has AdImageHash when image_hashes provided
 *   - SitelinkSetId (singular): wired INSIDE TextAd/TextImageAd (not at Ad level) — verified live
 *   - Callouts: AdExtensions.Items wired into TextAd and TextImageAd from callout_ids
 *   - buildCalloutPayload: builds correct AdExtensions.add body
 *   - buildResponsiveAdPayload: proven v501 schema — Titles/Texts/Href/AdImageHashes/
 *     SitelinkSetId/AdExtensionIds (no Hrefs[], no ImageHashes, no AdExtensions{Items})
 */

import { describe, it, expect, vi } from "vitest";

// Mock transitive dependencies that import @ohmy-seo/mcp-core subpaths
vi.mock("../src/lib/api-gateway.js", () => ({}));
vi.mock("../src/lib/account-resolver.js", () => ({}));
vi.mock("../src/lib/csv-parser.js", () => ({}));
vi.mock("../src/lib/bundle-ledger.js", () => ({}));

import {
  buildAdTgoPayload,
  buildAdRsyaPayload,
  buildCalloutPayload,
  buildResponsiveAdPayload,
} from "../src/lib/payload-builder.js";

// ---------------------------------------------------------------------------
// Part (a) — AdImageHash
// ---------------------------------------------------------------------------

describe("buildAdRsyaPayload — AdImageHash wiring", () => {
  it("sets AdImageHash from provided ad_image_hash", () => {
    const payload = buildAdRsyaPayload({
      ad_group_id: 1,
      ad_image_hash: "abc123hash",
      title: "Тест",
      text: "Текст объявления",
      href: "https://example.com",
    });
    const ad = (payload.params.Ads[0] as Record<string, unknown>);
    const textImageAd = ad["TextImageAd"] as Record<string, unknown>;
    expect(textImageAd["AdImageHash"]).toBe("abc123hash");
  });

  it("does not include AdImageHash=null when hash is provided (non-null)", () => {
    const payload = buildAdRsyaPayload({
      ad_group_id: 1,
      ad_image_hash: "hashvalue",
      title: "Тест",
      text: "Текст",
      href: "https://example.com",
    });
    const textImageAd = (payload.params.Ads[0] as Record<string, unknown>)["TextImageAd"] as Record<string, unknown>;
    expect(textImageAd["AdImageHash"]).toBeDefined();
    expect(textImageAd["AdImageHash"]).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Part (b) — SitelinkSetId (singular) inside TextAd/TextImageAd — verified live
// ---------------------------------------------------------------------------

describe("buildAdTgoPayload — SitelinkSetId wiring (singular, inside TextAd per Direct v5 API)", () => {
  it("includes SitelinkSetId inside TextAd (not at Ad level) when sitelinks_set_id is provided", () => {
    const payload = buildAdTgoPayload({
      ad_group_id: 10,
      title: "Заголовок",
      text: "Текст TGO",
      href: "https://example.com",
      sitelinks_set_id: 42,
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    const textAd = ad["TextAd"] as Record<string, unknown>;
    // SitelinkSetId (singular) must be INSIDE TextAd
    expect(textAd["SitelinkSetId"]).toBe(42);
    // Must NOT appear at Ad level or with plural spelling
    expect(ad["SitelinkSetId"]).toBeUndefined();
    expect(ad["SitelinksSetId"]).toBeUndefined();
    expect(textAd["SitelinksSetId"]).toBeUndefined();
  });

  it("omits SitelinkSetId from TextAd when not provided", () => {
    const payload = buildAdTgoPayload({
      ad_group_id: 10,
      title: "Заголовок",
      text: "Текст TGO",
      href: "https://example.com",
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    const textAd = ad["TextAd"] as Record<string, unknown>;
    expect(ad["SitelinkSetId"]).toBeUndefined();
    expect(ad["SitelinksSetId"]).toBeUndefined();
    expect(textAd["SitelinkSetId"]).toBeUndefined();
    expect(textAd["SitelinksSetId"]).toBeUndefined();
  });

  it("wires SitelinkSetId (singular) inside TextAd with correct value 555", () => {
    const payload = buildAdTgoPayload({
      ad_group_id: 10,
      title: "Заголовок",
      text: "Текст TGO",
      href: "https://example.com",
      sitelinks_set_id: 555,
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    const textAd = ad["TextAd"] as Record<string, unknown>;
    expect(textAd["SitelinkSetId"]).toBe(555);
    expect(ad["SitelinkSetId"]).toBeUndefined();
    expect(ad["SitelinksSetId"]).toBeUndefined();
  });
});

describe("buildAdRsyaPayload — SitelinkSetId wiring (singular, inside TextImageAd per Direct v5 API)", () => {
  it("includes SitelinkSetId inside TextImageAd (not at Ad level) when sitelinks_set_id is provided", () => {
    const payload = buildAdRsyaPayload({
      ad_group_id: 10,
      ad_image_hash: "somehash",
      title: "Заголовок РСЯ",
      text: "Текст РСЯ",
      href: "https://example.com",
      sitelinks_set_id: 99,
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    const textImageAd = ad["TextImageAd"] as Record<string, unknown>;
    // SitelinkSetId (singular) must be INSIDE TextImageAd
    expect(textImageAd["SitelinkSetId"]).toBe(99);
    // Must NOT appear at Ad level or with plural spelling
    expect(ad["SitelinkSetId"]).toBeUndefined();
    expect(ad["SitelinksSetId"]).toBeUndefined();
    expect(textImageAd["SitelinksSetId"]).toBeUndefined();
  });

  it("omits SitelinkSetId from TextImageAd when not provided", () => {
    const payload = buildAdRsyaPayload({
      ad_group_id: 10,
      ad_image_hash: "somehash",
      title: "Заголовок РСЯ",
      text: "Текст РСЯ",
      href: "https://example.com",
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    const textImageAd = ad["TextImageAd"] as Record<string, unknown>;
    expect(ad["SitelinkSetId"]).toBeUndefined();
    expect(ad["SitelinksSetId"]).toBeUndefined();
    expect(textImageAd["SitelinkSetId"]).toBeUndefined();
    expect(textImageAd["SitelinksSetId"]).toBeUndefined();
  });

  it("wires SitelinkSetId (singular) inside TextImageAd with correct value 555", () => {
    const payload = buildAdRsyaPayload({
      ad_group_id: 10,
      ad_image_hash: "somehash",
      title: "Заголовок РСЯ",
      text: "Текст РСЯ",
      href: "https://example.com",
      sitelinks_set_id: 555,
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    const textImageAd = ad["TextImageAd"] as Record<string, unknown>;
    expect(textImageAd["SitelinkSetId"]).toBe(555);
    expect(ad["SitelinkSetId"]).toBeUndefined();
    expect(ad["SitelinksSetId"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Part (c) — Callouts
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

describe("buildAdTgoPayload — AdExtensions (callout IDs) wiring", () => {
  it("sets AdExtensions.Items in TextAd when ad_extensions provided", () => {
    const payload = buildAdTgoPayload({
      ad_group_id: 5,
      title: "Заголовок",
      text: "Текст",
      href: "https://example.com",
      ad_extensions: [101, 102, 103],
    });
    const textAd = (payload.params.Ads[0] as Record<string, unknown>)["TextAd"] as Record<string, unknown>;
    expect(textAd["AdExtensions"]).toEqual({ Items: [101, 102, 103] });
  });

  it("omits AdExtensions from TextAd when not provided", () => {
    const payload = buildAdTgoPayload({
      ad_group_id: 5,
      title: "Заголовок",
      text: "Текст",
      href: "https://example.com",
    });
    const textAd = (payload.params.Ads[0] as Record<string, unknown>)["TextAd"] as Record<string, unknown>;
    expect(textAd["AdExtensions"]).toBeUndefined();
  });
});

describe("buildAdRsyaPayload — AdExtensions (callout IDs) wiring", () => {
  it("sets AdExtensions.Items in TextImageAd when ad_extensions provided", () => {
    const payload = buildAdRsyaPayload({
      ad_group_id: 5,
      ad_image_hash: "hashxyz",
      title: "Заголовок РСЯ",
      text: "Текст РСЯ",
      href: "https://example.com",
      ad_extensions: [201, 202],
    });
    const textImageAd = (payload.params.Ads[0] as Record<string, unknown>)["TextImageAd"] as Record<string, unknown>;
    expect(textImageAd["AdExtensions"]).toEqual({ Items: [201, 202] });
  });

  it("omits AdExtensions from TextImageAd when empty array provided", () => {
    const payload = buildAdRsyaPayload({
      ad_group_id: 5,
      ad_image_hash: "hashxyz",
      title: "Заголовок РСЯ",
      text: "Текст РСЯ",
      href: "https://example.com",
      ad_extensions: [],
    });
    const textImageAd = (payload.params.Ads[0] as Record<string, unknown>)["TextImageAd"] as Record<string, unknown>;
    expect(textImageAd["AdExtensions"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Combined — all 3 fields in one TextImageAd payload
// ---------------------------------------------------------------------------

describe("buildAdRsyaPayload — combined AdImageHash + SitelinkSetId + AdExtensions", () => {
  it("wires AdImageHash + SitelinkSetId (singular) + AdExtensions all inside TextImageAd", () => {
    const payload = buildAdRsyaPayload({
      ad_group_id: 7,
      ad_image_hash: "fullhash_xyz",
      title: "Комплексное объявление",
      text: "Все расширения",
      href: "https://example.com/full",
      sitelinks_set_id: 55,
      ad_extensions: [301, 302],
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    const textImageAd = ad["TextImageAd"] as Record<string, unknown>;
    expect(textImageAd["AdImageHash"]).toBe("fullhash_xyz");
    expect(textImageAd["AdExtensions"]).toEqual({ Items: [301, 302] });
    // SitelinkSetId (singular) is INSIDE TextImageAd — verified live
    expect(textImageAd["SitelinkSetId"]).toBe(55);
    // Must NOT appear at Ad level or with plural spelling
    expect(ad["SitelinkSetId"]).toBeUndefined();
    expect(ad["SitelinksSetId"]).toBeUndefined();
    expect(textImageAd["SitelinksSetId"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ResponsiveAd v501 schema — proven live schema tests
// ---------------------------------------------------------------------------

describe("buildResponsiveAdPayload — v501 proven schema", () => {
  it("produces correct field names: Titles, Texts, Href (singular), AdImageHashes", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 100,
      Titles: ["Заголовок один"],
      Texts: ["Текст объявления"],
      Href: "https://example.com",
      AdImageHashes: ["hash_a", "hash_b"],
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    const responsiveAd = ad["ResponsiveAd"] as Record<string, unknown>;

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

  it("wires AdExtensionIds as direct array (NOT AdExtensions:{Items})", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 100,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
      AdExtensionIds: [501, 502, 503],
    });
    const responsiveAd = (payload.params.Ads[0] as Record<string, unknown>)["ResponsiveAd"] as Record<string, unknown>;

    // Must be a direct array, NOT {Items: [...]}
    expect(responsiveAd["AdExtensionIds"]).toEqual([501, 502, 503]);
    expect(responsiveAd["AdExtensions"]).toBeUndefined();
  });

  it("wires SitelinkSetId as singular number inside ResponsiveAd", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 100,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
      SitelinkSetId: 77,
    });
    const responsiveAd = (payload.params.Ads[0] as Record<string, unknown>)["ResponsiveAd"] as Record<string, unknown>;

    expect(responsiveAd["SitelinkSetId"]).toBe(77);
    // Must NOT use plural form
    expect(responsiveAd["SitelinksSetId"]).toBeUndefined();
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
    const responsiveAd = (payload.params.Ads[0] as Record<string, unknown>)["ResponsiveAd"] as Record<string, unknown>;
    expect((responsiveAd["AdImageHashes"] as string[]).length).toBe(5);
  });

  it("omits AdImageHashes when not provided", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 100,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
    });
    const responsiveAd = (payload.params.Ads[0] as Record<string, unknown>)["ResponsiveAd"] as Record<string, unknown>;
    expect(responsiveAd["AdImageHashes"]).toBeUndefined();
  });

  it("omits optional fields when not provided", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 100,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
    });
    const responsiveAd = (payload.params.Ads[0] as Record<string, unknown>)["ResponsiveAd"] as Record<string, unknown>;
    expect(responsiveAd["SitelinkSetId"]).toBeUndefined();
    expect(responsiveAd["AdExtensionIds"]).toBeUndefined();
    expect(responsiveAd["VideoHashes"]).toBeUndefined();
  });

  it("method is 'add' and AdGroupId is set correctly", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 999,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
    });
    expect(payload.method).toBe("add");
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    expect(ad["AdGroupId"]).toBe(999);
  });
});
