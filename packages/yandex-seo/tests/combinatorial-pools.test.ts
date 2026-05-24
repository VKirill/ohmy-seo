import { describe, it, expect, vi } from "vitest";

// Mock transitive dependencies that import @ohmy-seo/mcp-core subpaths
vi.mock("../src/lib/api-gateway.js", () => ({}));
vi.mock("../src/lib/account-resolver.js", () => ({}));
vi.mock("../src/lib/csv-parser.js", () => ({}));
vi.mock("../src/lib/bundle-ledger.js", () => ({}));
vi.mock("../src/lib/payload-builder.js", () => ({}));
vi.mock("../src/lib/yaml-loader.js", () => ({}));
vi.mock("../src/tools/direct-upload-image.js", () => ({}));
vi.mock("@ohmy-seo/mcp-core/errors", () => ({
  errorToMcpContent: (e: unknown) => ({ content: [{ type: "text", text: String(e) }] }),
}));

import { extractCombinatorialPools } from "../src/tools/direct-upload-from-yaml.js";

type Bundle = ReturnType<typeof import("../src/lib/yaml-loader.js").loadCampaignFolder>;

function makeBundle(groups: unknown[]): Bundle {
  return {
    campaign: {
      campaign: {
        Name: "Test",
        Type: "TEXT_CAMPAIGN",
        StartDate: "2026-01-01",
        DailyBudget: { Amount: 300_000_000, Currency: "RUB" },
      },
      validation_errors: [],
    },
    groups,
    validation_errors: [],
  } as unknown as Bundle;
}

describe("extractCombinatorialPools", () => {
  it("derives headlines (Title+Title2) and texts (Text) from TEXT_AD ads", () => {
    const bundle = makeBundle([
      {
        group: { Name: "cl01_test", Type: "TEXT_AD_GROUP", RegionIds: [213] },
        keywords: [{ Keyword: "тест" }],
        ads: [
          {
            Type: "TEXT_AD" as const,
            TextAd: {
              Title: "Заголовок 1",
              Title2: "Заголовок 2",
              Text: "Текст объявления",
              Href: "https://example.com",
            },
          },
        ],
        _meta: { cluster_id: "cl01" },
      },
    ]);

    const pools = extractCombinatorialPools(bundle);
    expect(pools["cl01"]).toBeDefined();
    expect(pools["cl01"].headlines).toEqual(["Заголовок 1", "Заголовок 2"]);
    expect(pools["cl01"].texts).toEqual(["Текст объявления"]);
  });

  it("deduplicates headlines and texts across multiple ads", () => {
    const bundle = makeBundle([
      {
        group: { Name: "cl02_test", Type: "TEXT_AD_GROUP", RegionIds: [213] },
        keywords: [{ Keyword: "тест" }],
        ads: [
          {
            Type: "TEXT_AD" as const,
            TextAd: { Title: "Одинаковый", Title2: "Разный 1", Text: "Текст А", Href: "https://a.com" },
          },
          {
            Type: "TEXT_AD" as const,
            TextAd: { Title: "Одинаковый", Title2: "Разный 2", Text: "Текст А", Href: "https://b.com" },
          },
        ],
        _meta: { cluster_id: "cl02" },
      },
    ]);

    const pools = extractCombinatorialPools(bundle);
    // "Одинаковый" appears twice in Title — deduped to once
    expect(pools["cl02"].headlines).toEqual(["Одинаковый", "Разный 1", "Разный 2"]);
    // "Текст А" appears twice — deduped to once
    expect(pools["cl02"].texts).toEqual(["Текст А"]);
  });

  it("caps derived headlines at 7", () => {
    // 8 distinct titles — should be capped to 7
    const ads = Array.from({ length: 8 }, (_, i) => ({
      Type: "TEXT_AD" as const,
      TextAd: { Title: `Заголовок ${i + 1}`, Text: "Текст", Href: "https://example.com" },
    }));

    const bundle = makeBundle([
      {
        group: { Name: "cl03_test", Type: "TEXT_AD_GROUP", RegionIds: [213] },
        keywords: [{ Keyword: "тест" }],
        ads,
        _meta: { cluster_id: "cl03" },
      },
    ]);

    const pools = extractCombinatorialPools(bundle);
    expect(pools["cl03"].headlines.length).toBe(7);
  });

  it("caps derived texts at 3", () => {
    // 4 distinct texts — should be capped to 3
    const ads = Array.from({ length: 4 }, (_, i) => ({
      Type: "TEXT_AD" as const,
      TextAd: { Title: `Заголовок ${i + 1}`, Text: `Текст ${i + 1}`, Href: "https://example.com" },
    }));

    const bundle = makeBundle([
      {
        group: { Name: "cl04_test", Type: "TEXT_AD_GROUP", RegionIds: [213] },
        keywords: [{ Keyword: "тест" }],
        ads,
        _meta: { cluster_id: "cl04" },
      },
    ]);

    const pools = extractCombinatorialPools(bundle);
    expect(pools["cl04"].texts.length).toBe(3);
  });

  it("uses explicit combinatorial field when present", () => {
    const bundle = makeBundle([
      {
        group: { Name: "cl05_test", Type: "TEXT_AD_GROUP", RegionIds: [213] },
        keywords: [{ Keyword: "тест" }],
        combinatorial: {
          headlines: ["Явный 1", "Явный 2", "Явный 3"],
          texts: ["Явный текст"],
        },
        ads: [
          {
            Type: "TEXT_AD" as const,
            TextAd: { Title: "Игнорируемый", Text: "Тоже игнорируется", Href: "https://example.com" },
          },
        ],
        _meta: { cluster_id: "cl05" },
      },
    ]);

    const pools = extractCombinatorialPools(bundle);
    expect(pools["cl05"].headlines).toEqual(["Явный 1", "Явный 2", "Явный 3"]);
    expect(pools["cl05"].texts).toEqual(["Явный текст"]);
  });

  it("uses cluster_id from _meta as key; falls back to Name prefix if absent", () => {
    const bundle = makeBundle([
      {
        group: { Name: "abc_product", Type: "TEXT_AD_GROUP", RegionIds: [213] },
        keywords: [{ Keyword: "продукт" }],
        ads: [
          {
            Type: "TEXT_AD" as const,
            TextAd: { Title: "Продукт", Text: "Купить", Href: "https://example.com" },
          },
        ],
        // no _meta → Name.split("_")[0] = "abc"
      },
    ]);

    const pools = extractCombinatorialPools(bundle);
    expect(pools["abc"]).toBeDefined();
    expect(pools["abc"].headlines).toContain("Продукт");
  });

  it("extracts Title2 from TEXT_IMAGE_AD ads as headline", () => {
    const bundle = makeBundle([
      {
        group: { Name: "cl06_test", Type: "TEXT_AD_GROUP", RegionIds: [213] },
        keywords: [{ Keyword: "тест" }],
        ads: [
          {
            Type: "TEXT_IMAGE_AD" as const,
            TextImageAd: {
              AdImageHash: "abc",
              Title: "Картинка заголовок",
              Title2: "Картинка подзаголовок",
              Text: "Картинка текст",
              Href: "https://example.com",
            },
          },
        ],
        _meta: { cluster_id: "cl06" },
      },
    ]);

    const pools = extractCombinatorialPools(bundle);
    expect(pools["cl06"].headlines).toContain("Картинка заголовок");
    expect(pools["cl06"].headlines).toContain("Картинка подзаголовок");
    expect(pools["cl06"].texts).toContain("Картинка текст");
  });

  it("returns entries for all groups keyed by their cluster_id", () => {
    const bundle = makeBundle([
      {
        group: { Name: "g1_test", Type: "TEXT_AD_GROUP", RegionIds: [213] },
        keywords: [{ Keyword: "один" }],
        ads: [{ Type: "TEXT_AD" as const, TextAd: { Title: "Т1", Text: "Текст1", Href: "https://a.com" } }],
        _meta: { cluster_id: "g1" },
      },
      {
        group: { Name: "g2_test", Type: "TEXT_AD_GROUP", RegionIds: [213] },
        keywords: [{ Keyword: "два" }],
        ads: [{ Type: "TEXT_AD" as const, TextAd: { Title: "Т2", Text: "Текст2", Href: "https://b.com" } }],
        _meta: { cluster_id: "g2" },
      },
    ]);

    const pools = extractCombinatorialPools(bundle);
    expect(Object.keys(pools)).toEqual(["g1", "g2"]);
  });
});
