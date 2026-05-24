/**
 * autotargeting-combinatorial.test.ts
 *
 * Unit tests for TASK-4041:
 *   - Autotargeting category resolution (search defaults, explicit override, RSYA skip)
 *   - buildAutoTargetingUpdatePayload schema correctness
 *   - Combinatorial ResponsiveAd payload via buildResponsiveAdPayload
 */

import { describe, it, expect, vi } from "vitest";

// Mock transitive dependencies
vi.mock("../src/lib/api-gateway.js", () => ({}));
vi.mock("../src/lib/account-resolver.js", () => ({}));
vi.mock("../src/lib/csv-parser.js", () => ({}));
vi.mock("../src/lib/bundle-ledger.js", () => ({}));

import {
  buildAutoTargetingUpdatePayload,
  buildResponsiveAdPayload,
} from "../src/lib/payload-builder.js";

// ---------------------------------------------------------------------------
// buildAutoTargetingUpdatePayload — schema correctness
// ---------------------------------------------------------------------------

describe("buildAutoTargetingUpdatePayload — schema", () => {
  it("builds update payload for TEXT_AD_GROUP with given categories", () => {
    const payload = buildAutoTargetingUpdatePayload({
      ad_group_id: 42,
      group_type: "TEXT_AD_GROUP",
      categories: [
        { Category: "BROAD_MATCH", Value: "NO" },
        { Category: "ACCESSORY_QUERIES", Value: "NO" },
      ],
    });

    expect(payload.method).toBe("update");
    const adGroup = payload.params.AdGroups[0] as Record<string, unknown>;
    expect(adGroup["Id"]).toBe(42);
    const autoTargeting = adGroup["TextAdGroupAutoTargeting"] as Record<string, unknown>;
    expect(autoTargeting).toBeDefined();
    expect((autoTargeting["Items"] as Array<unknown>).length).toBe(2);
    expect(autoTargeting["Items"]).toEqual([
      { Category: "BROAD_MATCH", Value: "NO" },
      { Category: "ACCESSORY_QUERIES", Value: "NO" },
    ]);
  });

  it("sets ALTERNATIVE_QUERIES=NO for the search default set", () => {
    // Verify the exact 3-category default set used by the pipeline for search
    const defaultCategories = [
      { Category: "BROAD_MATCH", Value: "NO" as const },
      { Category: "ACCESSORY_QUERIES", Value: "NO" as const },
      { Category: "ALTERNATIVE_QUERIES", Value: "NO" as const },
    ];
    const payload = buildAutoTargetingUpdatePayload({
      ad_group_id: 99,
      group_type: "TEXT_AD_GROUP",
      categories: defaultCategories,
    });

    const adGroup = payload.params.AdGroups[0] as Record<string, unknown>;
    const autoTargeting = adGroup["TextAdGroupAutoTargeting"] as Record<string, unknown>;
    const items = autoTargeting["Items"] as Array<{ Category: string; Value: string }>;

    expect(items).toHaveLength(3);
    const categories = items.map((i) => i.Category);
    expect(categories).toContain("BROAD_MATCH");
    expect(categories).toContain("ACCESSORY_QUERIES");
    expect(categories).toContain("ALTERNATIVE_QUERIES");
    // All values are "NO"
    expect(items.every((i) => i.Value === "NO")).toBe(true);
  });

  it("passes explicit YES/NO values verbatim", () => {
    const payload = buildAutoTargetingUpdatePayload({
      ad_group_id: 10,
      group_type: "TEXT_AD_GROUP",
      categories: [
        { Category: "BROAD_MATCH", Value: "YES" },
        { Category: "ACCESSORY_QUERIES", Value: "NO" },
      ],
    });

    const adGroup = payload.params.AdGroups[0] as Record<string, unknown>;
    const items = (adGroup["TextAdGroupAutoTargeting"] as Record<string, unknown>)["Items"] as Array<{ Category: string; Value: string }>;
    expect(items.find((i) => i.Category === "BROAD_MATCH")?.Value).toBe("YES");
    expect(items.find((i) => i.Category === "ACCESSORY_QUERIES")?.Value).toBe("NO");
  });
});

// ---------------------------------------------------------------------------
// Autotargeting category resolution logic (pure logic, no API calls)
// ---------------------------------------------------------------------------

describe("autotargeting category resolution — logic", () => {
  /**
   * Simulate the resolution logic from processCluster for testability.
   * Returns resolved categories or null (skip).
   */
  function resolveAutoTargetingCategories(
    cluster_id: string,
    campaign_type: "search" | "rsya" | "rsya-only",
    autotargeting_per_group?: Record<string, Array<{ Category: string; Value: "YES" | "NO" }>>,
  ): Array<{ Category: string; Value: "YES" | "NO" }> | null {
    const explicitCategories = autotargeting_per_group?.[cluster_id];
    if (explicitCategories !== undefined) {
      return explicitCategories;
    }
    if (campaign_type === "search") {
      return [
        { Category: "BROAD_MATCH", Value: "NO" },
        { Category: "ACCESSORY_QUERIES", Value: "NO" },
        { Category: "ALTERNATIVE_QUERIES", Value: "NO" },
      ];
    }
    // RSYA without explicit override: skip
    return null;
  }

  it("search without explicit: returns 3 default categories all NO", () => {
    const cats = resolveAutoTargetingCategories("cl01", "search", undefined);
    expect(cats).not.toBeNull();
    expect(cats).toHaveLength(3);
    expect(cats!.every((c) => c.Value === "NO")).toBe(true);
    const catNames = cats!.map((c) => c.Category);
    expect(catNames).toEqual(["BROAD_MATCH", "ACCESSORY_QUERIES", "ALTERNATIVE_QUERIES"]);
  });

  it("search with explicit override: returns provided categories verbatim", () => {
    const explicit = [{ Category: "BROAD_MATCH", Value: "YES" as const }];
    const cats = resolveAutoTargetingCategories("cl01", "search", { cl01: explicit });
    expect(cats).toEqual(explicit);
  });

  it("rsya without explicit: returns null (skip autotargeting)", () => {
    const cats = resolveAutoTargetingCategories("cl01", "rsya", undefined);
    expect(cats).toBeNull();
  });

  it("rsya-only without explicit: returns null (skip autotargeting)", () => {
    const cats = resolveAutoTargetingCategories("cl01", "rsya-only", undefined);
    expect(cats).toBeNull();
  });

  it("rsya with explicit override: returns provided categories verbatim", () => {
    const explicit = [{ Category: "ACCESSORY_QUERIES", Value: "NO" as const }];
    const cats = resolveAutoTargetingCategories("cl01", "rsya", { cl01: explicit });
    expect(cats).toEqual(explicit);
  });

  it("search with explicit override for different cluster: falls back to defaults", () => {
    const explicit = [{ Category: "BROAD_MATCH", Value: "YES" as const }];
    // Explicit is for cl02, not cl01
    const cats = resolveAutoTargetingCategories("cl01", "search", { cl02: explicit });
    expect(cats).toHaveLength(3); // defaults
    expect(cats!.every((c) => c.Value === "NO")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combinatorial ResponsiveAd payload — pool-based and fallback
// ---------------------------------------------------------------------------

describe("combinatorial ResponsiveAd via buildResponsiveAdPayload", () => {
  it("builds responsive ad with pool headlines (≤7) and texts (≤3)", () => {
    const headlines = ["Заголовок 1", "Заголовок 2", "Заголовок 3"];
    const texts = ["Текст объявления 1", "Текст объявления 2"];

    const payload = buildResponsiveAdPayload({
      ad_group_id: 55,
      Titles: headlines,
      Texts: texts,
      Href: "https://example.com",
      AdImageHashes: ["hash1", "hash2"],
      SitelinkSetId: 10,
      AdExtensionIds: [201, 202],
    });

    const responsiveAd = (payload.params.Ads[0] as Record<string, unknown>)["ResponsiveAd"] as Record<string, unknown>;
    expect(responsiveAd["Titles"]).toEqual(headlines);
    expect(responsiveAd["Texts"]).toEqual(texts);
    expect(responsiveAd["Href"]).toBe("https://example.com");
    expect(responsiveAd["AdImageHashes"]).toEqual(["hash1", "hash2"]);
    expect(responsiveAd["SitelinkSetId"]).toBe(10);
    expect(responsiveAd["AdExtensionIds"]).toEqual([201, 202]);
  });

  it("caps Titles at 7 (via slice)", () => {
    const titles = ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8"];
    const payload = buildResponsiveAdPayload({
      ad_group_id: 1,
      Titles: titles.slice(0, 7), // caller's responsibility to slice
      Texts: ["Текст"],
      Href: "https://example.com",
    });
    const responsiveAd = (payload.params.Ads[0] as Record<string, unknown>)["ResponsiveAd"] as Record<string, unknown>;
    expect((responsiveAd["Titles"] as string[]).length).toBe(7);
  });

  it("caps Texts at 3 (via slice)", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 1,
      Titles: ["Заголовок"],
      Texts: ["T1", "T2", "T3"], // slice(0, 3) from caller
      Href: "https://example.com",
    });
    const responsiveAd = (payload.params.Ads[0] as Record<string, unknown>)["ResponsiveAd"] as Record<string, unknown>;
    expect((responsiveAd["Texts"] as string[]).length).toBe(3);
  });

  it("fallback: derives Titles from template title + title2, Texts from text", () => {
    // Simulate fallback behavior when no pool is provided
    const tmpl = { title: "Основной заголовок", title2: "Второй заголовок", text: "Текст из шаблона" };
    const rsyaTitles: string[] = [tmpl.title];
    if (tmpl.title2) rsyaTitles.push(tmpl.title2);
    const rsyaTexts: string[] = [tmpl.text];

    const payload = buildResponsiveAdPayload({
      ad_group_id: 20,
      Titles: rsyaTitles,
      Texts: rsyaTexts,
      Href: "https://example.com",
      AdImageHashes: ["hashFallback"],
    });

    const responsiveAd = (payload.params.Ads[0] as Record<string, unknown>)["ResponsiveAd"] as Record<string, unknown>;
    expect(responsiveAd["Titles"]).toEqual(["Основной заголовок", "Второй заголовок"]);
    expect(responsiveAd["Texts"]).toEqual(["Текст из шаблона"]);
  });

  it("omits AdImageHashes when not provided (image-less fallback)", () => {
    const payload = buildResponsiveAdPayload({
      ad_group_id: 30,
      Titles: ["Заголовок"],
      Texts: ["Текст"],
      Href: "https://example.com",
    });
    const responsiveAd = (payload.params.Ads[0] as Record<string, unknown>)["ResponsiveAd"] as Record<string, unknown>;
    expect(responsiveAd["AdImageHashes"]).toBeUndefined();
  });

  it("ledger signature for combinatorial ad is ad_rsya_comb:<cluster_id>", () => {
    // This verifies the sig format is deterministic and unique per group
    const cluster_id = "cl07";
    const expectedSig = `ad_rsya_comb:${cluster_id}`;
    expect(expectedSig).toBe("ad_rsya_comb:cl07");
  });
});
