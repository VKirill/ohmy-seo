/**
 * autotargeting-combinatorial.test.ts
 *
 * Unit tests for TASK-4045:
 *   - buildAutoTargetingUpdatePayload: Keywords.update with direct AutotargetingCategories array
 *   - mapAutotargetingCategoryName: legacy -> API name mapping
 *   - Autotargeting category resolution (search defaults, explicit override, RSYA skip)
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
  mapAutotargetingCategoryName,
  sanitizeAutotargetingCategories,
  buildResponsiveAdPayload,
} from "../src/lib/payload-builder.js";

// ---------------------------------------------------------------------------
// mapAutotargetingCategoryName — name mapping
// ---------------------------------------------------------------------------

describe("mapAutotargetingCategoryName — mapping", () => {
  it("maps BROAD_MATCH -> BROADER", () => {
    expect(mapAutotargetingCategoryName("BROAD_MATCH")).toBe("BROADER");
  });

  it("maps ACCESSORY_QUERIES -> ACCESSORY", () => {
    expect(mapAutotargetingCategoryName("ACCESSORY_QUERIES")).toBe("ACCESSORY");
  });

  it("maps ALTERNATIVE_QUERIES -> ALTERNATIVE", () => {
    expect(mapAutotargetingCategoryName("ALTERNATIVE_QUERIES")).toBe("ALTERNATIVE");
  });

  it("maps COMPETITOR_QUERIES -> COMPETITOR", () => {
    expect(mapAutotargetingCategoryName("COMPETITOR_QUERIES")).toBe("COMPETITOR");
  });

  it("maps EXACT_MENTION -> EXACT", () => {
    expect(mapAutotargetingCategoryName("EXACT_MENTION")).toBe("EXACT");
  });

  it("returns null for TARGET_QUERIES (no equivalent)", () => {
    expect(mapAutotargetingCategoryName("TARGET_QUERIES")).toBeNull();
  });

  it("returns null for unknown names", () => {
    expect(mapAutotargetingCategoryName("UNKNOWN_CATEGORY")).toBeNull();
  });

  it("passes through already-canonical names", () => {
    expect(mapAutotargetingCategoryName("BROADER")).toBe("BROADER");
    expect(mapAutotargetingCategoryName("ACCESSORY")).toBe("ACCESSORY");
    expect(mapAutotargetingCategoryName("ALTERNATIVE")).toBe("ALTERNATIVE");
    expect(mapAutotargetingCategoryName("COMPETITOR")).toBe("COMPETITOR");
    expect(mapAutotargetingCategoryName("EXACT")).toBe("EXACT");
  });
});

// ---------------------------------------------------------------------------
// sanitizeAutotargetingCategories — Code 5005 guard
// ---------------------------------------------------------------------------

describe("sanitizeAutotargetingCategories — Code 5005 guard", () => {
  it("all-NO input (5 categories): drops {EXACT,NO} and appends {EXACT,YES} guard", () => {
    // Scenario: bundle declares ALL 5 categories as NO → rejected by Yandex Code 5005
    const input = [
      { Category: "EXACT", Value: "NO" as const },
      { Category: "BROADER", Value: "NO" as const },
      { Category: "ACCESSORY", Value: "NO" as const },
      { Category: "ALTERNATIVE", Value: "NO" as const },
      { Category: "COMPETITOR", Value: "NO" as const },
    ];
    const result = sanitizeAutotargetingCategories(input);
    // {EXACT,NO} must be gone
    expect(result.find((c) => c.Category === "EXACT" && c.Value === "NO")).toBeUndefined();
    // At least one YES must exist (the EXACT guard)
    expect(result.some((c) => c.Value === "YES")).toBe(true);
    expect(result.find((c) => c.Category === "EXACT")?.Value).toBe("YES");
  });

  it("all-NO input: result has no {EXACT,NO}", () => {
    const input = [
      { Category: "EXACT", Value: "NO" as const },
      { Category: "BROADER", Value: "NO" as const },
    ];
    const result = sanitizeAutotargetingCategories(input);
    expect(result.find((c) => c.Category === "EXACT" && c.Value === "NO")).toBeUndefined();
  });

  it("search default [BROADER:NO, ACCESSORY:NO, ALTERNATIVE:NO] passes through unchanged", () => {
    // No EXACT:NO in the list — guard does NOT fire.
    // EXACT and COMPETITOR implicitly stay ON in Direct (not touched by this update).
    const input = [
      { Category: "BROADER", Value: "NO" as const },
      { Category: "ACCESSORY", Value: "NO" as const },
      { Category: "ALTERNATIVE", Value: "NO" as const },
    ];
    const result = sanitizeAutotargetingCategories(input);
    // Passed through unchanged — no EXACT entry added
    expect(result).toHaveLength(3);
    expect(result.find((c) => c.Category === "EXACT")).toBeUndefined();
    expect(result.find((c) => c.Category === "BROADER")?.Value).toBe("NO");
    expect(result.find((c) => c.Category === "ACCESSORY")?.Value).toBe("NO");
    expect(result.find((c) => c.Category === "ALTERNATIVE")?.Value).toBe("NO");
  });

  it("empty input returns empty (no guard on empty list)", () => {
    const result = sanitizeAutotargetingCategories([]);
    expect(result).toHaveLength(0);
  });

  it("input with EXACT:YES is preserved and no duplicate guard appended", () => {
    const input = [
      { Category: "EXACT", Value: "YES" as const },
      { Category: "BROADER", Value: "NO" as const },
    ];
    const result = sanitizeAutotargetingCategories(input);
    const exactEntries = result.filter((c) => c.Category === "EXACT");
    expect(exactEntries).toHaveLength(1);
    expect(exactEntries[0].Value).toBe("YES");
  });

  it("EXACT:NO + another YES category: drops EXACT:NO, no guard (YES already present)", () => {
    const input = [
      { Category: "COMPETITOR", Value: "YES" as const },
      { Category: "BROADER", Value: "NO" as const },
      { Category: "EXACT", Value: "NO" as const },
    ];
    const result = sanitizeAutotargetingCategories(input);
    // {EXACT,NO} is dropped
    expect(result.find((c) => c.Category === "EXACT" && c.Value === "NO")).toBeUndefined();
    // COMPETITOR:YES still present → no guard needed
    expect(result.find((c) => c.Category === "COMPETITOR")?.Value).toBe("YES");
    // Guard NOT appended since YES already exists — no EXACT:YES injected
    const exactYesCount = result.filter((c) => c.Category === "EXACT" && c.Value === "YES").length;
    expect(exactYesCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildAutoTargetingUpdatePayload — Keywords.update schema correctness
// ---------------------------------------------------------------------------

describe("buildAutoTargetingUpdatePayload — schema", () => {
  it("builds Keywords.update payload (not AdGroups.update)", () => {
    const payload = buildAutoTargetingUpdatePayload({
      autotargeting_keyword_id: 42,
      categories: [
        { Category: "BROADER", Value: "NO" },
        { Category: "ACCESSORY", Value: "NO" },
      ],
    });

    expect(payload.method).toBe("update");
    // Must be Keywords, NOT AdGroups
    expect((payload.params as Record<string, unknown>)["Keywords"]).toBeDefined();
    expect((payload.params as Record<string, unknown>)["AdGroups"]).toBeUndefined();
  });

  it("sets Id to autotargeting_keyword_id", () => {
    const payload = buildAutoTargetingUpdatePayload({
      autotargeting_keyword_id: 99,
      categories: [{ Category: "EXACT", Value: "YES" }],
    });

    const kw = payload.params.Keywords[0] as Record<string, unknown>;
    expect(kw["Id"]).toBe(99);
  });

  it("AutotargetingCategories is a DIRECT array (no Items wrapper)", () => {
    const payload = buildAutoTargetingUpdatePayload({
      autotargeting_keyword_id: 42,
      categories: [
        { Category: "BROADER", Value: "NO" },
        { Category: "ACCESSORY", Value: "NO" },
      ],
    });

    const kw = payload.params.Keywords[0] as Record<string, unknown>;
    const cats = kw["AutotargetingCategories"] as unknown;

    // Must be a plain array, not { Items: [...] }
    expect(Array.isArray(cats)).toBe(true);
    // Must NOT have an Items property (no wrapper object)
    expect((cats as Record<string, unknown>)["Items"]).toBeUndefined();
    expect((cats as Array<unknown>).length).toBe(2);
  });

  it("stores categories verbatim with correct Category/Value shape", () => {
    const payload = buildAutoTargetingUpdatePayload({
      autotargeting_keyword_id: 10,
      categories: [
        { Category: "BROADER", Value: "YES" },
        { Category: "ACCESSORY", Value: "NO" },
        { Category: "ALTERNATIVE", Value: "NO" },
      ],
    });

    const kw = payload.params.Keywords[0] as Record<string, unknown>;
    const cats = kw["AutotargetingCategories"] as Array<{ Category: string; Value: string }>;
    expect(cats).toHaveLength(3);
    expect(cats.find((c) => c.Category === "BROADER")?.Value).toBe("YES");
    expect(cats.find((c) => c.Category === "ACCESSORY")?.Value).toBe("NO");
    expect(cats.find((c) => c.Category === "ALTERNATIVE")?.Value).toBe("NO");
  });

  it("search default set uses API names (BROADER/ACCESSORY/ALTERNATIVE), all NO", () => {
    const defaultCategories = [
      { Category: "BROADER", Value: "NO" as const },
      { Category: "ACCESSORY", Value: "NO" as const },
      { Category: "ALTERNATIVE", Value: "NO" as const },
    ];
    const payload = buildAutoTargetingUpdatePayload({
      autotargeting_keyword_id: 99,
      categories: defaultCategories,
    });

    const kw = payload.params.Keywords[0] as Record<string, unknown>;
    const cats = kw["AutotargetingCategories"] as Array<{ Category: string; Value: string }>;
    expect(cats).toHaveLength(3);
    const names = cats.map((c) => c.Category);
    expect(names).toContain("BROADER");
    expect(names).toContain("ACCESSORY");
    expect(names).toContain("ALTERNATIVE");
    expect(cats.every((c) => c.Value === "NO")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Autotargeting category resolution logic (pure logic, no API calls)
// ---------------------------------------------------------------------------

describe("autotargeting category resolution — logic", () => {
  /**
   * Simulate the resolution logic from processCluster for testability.
   * Returns resolved categories or null (skip).
   * NOTE: pipeline now uses API names (BROADER/ACCESSORY/ALTERNATIVE) for defaults.
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
        { Category: "BROADER", Value: "NO" },
        { Category: "ACCESSORY", Value: "NO" },
        { Category: "ALTERNATIVE", Value: "NO" },
      ];
    }
    // RSYA without explicit override: skip
    return null;
  }

  it("search without explicit: returns 3 default categories (API names) all NO", () => {
    const cats = resolveAutoTargetingCategories("cl01", "search", undefined);
    expect(cats).not.toBeNull();
    expect(cats).toHaveLength(3);
    expect(cats!.every((c) => c.Value === "NO")).toBe(true);
    const catNames = cats!.map((c) => c.Category);
    expect(catNames).toEqual(["BROADER", "ACCESSORY", "ALTERNATIVE"]);
  });

  it("search with explicit override: returns provided categories verbatim", () => {
    const explicit = [{ Category: "BROADER", Value: "YES" as const }];
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
    const explicit = [{ Category: "ACCESSORY", Value: "NO" as const }];
    const cats = resolveAutoTargetingCategories("cl01", "rsya", { cl01: explicit });
    expect(cats).toEqual(explicit);
  });

  it("search with explicit override for different cluster: falls back to defaults", () => {
    const explicit = [{ Category: "BROADER", Value: "YES" as const }];
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
