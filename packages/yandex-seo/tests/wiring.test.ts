/**
 * wiring.test.ts — F6 payload wiring tests for AdImageHash, SitelinksSetId, Callouts.
 *
 * Covers acceptance criteria:
 *   - AdImageHash: TEXT_IMAGE_AD payload has AdImageHash when image_hashes provided
 *   - SitelinksSetId: reaches TextAd and TextImageAd at ad level (per naming map §3.2/§3.3)
 *   - Callouts: AdExtensions.Items wired into TextAd and TextImageAd from callout_ids
 *   - buildCalloutPayload: builds correct AdExtensions.add body
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
// Part (b) — SitelinksSetId at ad level
// ---------------------------------------------------------------------------

describe("buildAdTgoPayload — SitelinksSetId wiring (Ad-level sibling of TextAd, naming map §3.2)", () => {
  it("includes SitelinksSetId at Ad level (not inside TextAd) when sitelinks_set_id is provided", () => {
    const payload = buildAdTgoPayload({
      ad_group_id: 10,
      title: "Заголовок",
      text: "Текст TGO",
      href: "https://example.com",
      sitelinks_set_id: 42,
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    const textAd = ad["TextAd"] as Record<string, unknown>;
    expect(ad["SitelinksSetId"]).toBe(42);
    expect(textAd["SitelinksSetId"]).toBeUndefined();
  });

  it("omits SitelinksSetId from Ad when not provided", () => {
    const payload = buildAdTgoPayload({
      ad_group_id: 10,
      title: "Заголовок",
      text: "Текст TGO",
      href: "https://example.com",
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    const textAd = ad["TextAd"] as Record<string, unknown>;
    expect(ad["SitelinksSetId"]).toBeUndefined();
    expect(textAd["SitelinksSetId"]).toBeUndefined();
  });

  it("wires SitelinksSetId with correct value 555", () => {
    const payload = buildAdTgoPayload({
      ad_group_id: 10,
      title: "Заголовок",
      text: "Текст TGO",
      href: "https://example.com",
      sitelinks_set_id: 555,
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    expect(ad["SitelinksSetId"]).toBe(555);
    expect((ad["TextAd"] as Record<string, unknown>)["SitelinksSetId"]).toBeUndefined();
  });
});

describe("buildAdRsyaPayload — SitelinksSetId wiring (Ad-level sibling of TextImageAd, naming map §3.3)", () => {
  it("includes SitelinksSetId at Ad level (not inside TextImageAd) when sitelinks_set_id is provided", () => {
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
    expect(ad["SitelinksSetId"]).toBe(99);
    expect(textImageAd["SitelinksSetId"]).toBeUndefined();
  });

  it("omits SitelinksSetId from Ad when not provided", () => {
    const payload = buildAdRsyaPayload({
      ad_group_id: 10,
      ad_image_hash: "somehash",
      title: "Заголовок РСЯ",
      text: "Текст РСЯ",
      href: "https://example.com",
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    const textImageAd = ad["TextImageAd"] as Record<string, unknown>;
    expect(ad["SitelinksSetId"]).toBeUndefined();
    expect(textImageAd["SitelinksSetId"]).toBeUndefined();
  });

  it("wires SitelinksSetId with correct value 555", () => {
    const payload = buildAdRsyaPayload({
      ad_group_id: 10,
      ad_image_hash: "somehash",
      title: "Заголовок РСЯ",
      text: "Текст РСЯ",
      href: "https://example.com",
      sitelinks_set_id: 555,
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    expect(ad["SitelinksSetId"]).toBe(555);
    expect((ad["TextImageAd"] as Record<string, unknown>)["SitelinksSetId"]).toBeUndefined();
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

describe("buildAdRsyaPayload — combined AdImageHash + SitelinksSetId + AdExtensions", () => {
  it("wires AdImageHash + AdExtensions into TextImageAd, SitelinksSetId at Ad level", () => {
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
    expect(ad["SitelinksSetId"]).toBe(55);
    expect(textImageAd["SitelinksSetId"]).toBeUndefined();
  });
});
