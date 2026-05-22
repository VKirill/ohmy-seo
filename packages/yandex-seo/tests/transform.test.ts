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

import { extractAdTemplates } from "../src/tools/direct-upload-from-yaml.js";
import { pickAdTemplate } from "../src/lib/upload-pipeline.js";

describe("extractAdTemplates + pickAdTemplate integration", () => {
  it("extracts real Title/Text from YAML TextAd and pickAdTemplate uses them", () => {
    // Minimal bundle fixture — 1 group, cluster_id=cl04, 1 TEXT_AD
    const bundle = {
      campaign: {
        campaign: {
          Name: "Test",
          Type: "TEXT_CAMPAIGN",
          StartDate: "2026-01-01",
          DailyBudget: { Amount: 300_000_000, Currency: "RUB" },
        },
        sitelinks_set: undefined,
        promo_extension: undefined,
        images: undefined,
        validation_errors: [],
      },
      groups: [
        {
          group: {
            Name: "cl04_scrubbers",
            Type: "TEXT_AD_GROUP",
            RegionIds: [213],
          },
          keywords: [{ Keyword: "промышленные скрубберы" }],
          ads: [
            {
              Type: "TEXT_AD" as const,
              TextAd: {
                Title: "Промышленные скрубберы",
                Title2: "Цена от",
                Text: "Изготовим по ТЗ",
                Href: "https://example.com",
              },
            },
          ],
          _meta: { cluster_id: "cl04", intent: "transactional" },
        },
      ],
      validation_errors: [],
    } as unknown as ReturnType<typeof import("../src/lib/yaml-loader.js").loadCampaignFolder>;

    const ad_templates = extractAdTemplates(bundle);

    // Should produce one template for cluster cl04
    expect(ad_templates).toHaveLength(1);
    expect(ad_templates[0].title).toBe("Промышленные скрубберы");
    expect(ad_templates[0].title2).toBe("Цена от");
    expect(ad_templates[0].text).toBe("Изготовим по ТЗ");
    expect(ad_templates[0].cluster_filter?.cluster_id_pattern).toBe("^cl04$");

    // pickAdTemplate with cluster_id=cl04 should return the real ad text, not the placeholder
    const picked = pickAdTemplate(
      "cl04",
      "transactional",
      ad_templates,
      "agent-provided",
      "https://example.com"
    );
    expect(picked.title).toBe("Промышленные скрубберы");
    expect(picked.title).not.toBe("cl04");
    expect(picked.title2).toBe("Цена от");
    expect(picked.text).toBe("Изготовим по ТЗ");
  });

  it("extracts real texts from TEXT_IMAGE_AD as well", () => {
    const bundle = {
      campaign: {
        campaign: {
          Name: "Test",
          Type: "TEXT_CAMPAIGN",
          StartDate: "2026-01-01",
          DailyBudget: { Amount: 300_000_000, Currency: "RUB" },
        },
        validation_errors: [],
      },
      groups: [
        {
          group: { Name: "cl05_foo", Type: "TEXT_AD_GROUP", RegionIds: [213] },
          keywords: [{ Keyword: "foo" }],
          ads: [
            {
              Type: "TEXT_IMAGE_AD" as const,
              TextImageAd: {
                AdImageHash: "abc123",
                Title: "Картинка заголовок",
                Title2: "Подзаголовок",
                Text: "Текст объявления",
                Href: "https://example.com",
              },
            },
          ],
          _meta: { cluster_id: "cl05", intent: "informational" },
        },
      ],
      validation_errors: [],
    } as unknown as ReturnType<typeof import("../src/lib/yaml-loader.js").loadCampaignFolder>;

    const ad_templates = extractAdTemplates(bundle);
    expect(ad_templates).toHaveLength(1);
    expect(ad_templates[0].title).toBe("Картинка заголовок");
    expect(ad_templates[0].text).toBe("Текст объявления");

    const picked = pickAdTemplate("cl05", "informational", ad_templates, "agent-provided", "https://example.com");
    expect(picked.title).toBe("Картинка заголовок");
    expect(picked.title).not.toBe("cl05");
  });

  it("skips RESPONSIVE_AD ads (only TEXT_AD and TEXT_IMAGE_AD extracted)", () => {
    const bundle = {
      campaign: { campaign: { Name: "T", Type: "TEXT_CAMPAIGN", StartDate: "2026-01-01", DailyBudget: { Amount: 0, Currency: "RUB" } }, validation_errors: [] },
      groups: [
        {
          group: { Name: "cl06_responsive", Type: "UNIFIED_AD_GROUP", RegionIds: [213] },
          keywords: [{ Keyword: "bar" }],
          ads: [
            {
              Type: "RESPONSIVE_AD" as const,
              ResponsiveAd: {
                Titles: ["Title 1"],
                Texts: ["Text 1"],
                Hrefs: ["https://example.com"],
              },
            },
          ],
          _meta: { cluster_id: "cl06", intent: "informational" },
        },
      ],
      validation_errors: [],
    } as unknown as ReturnType<typeof import("../src/lib/yaml-loader.js").loadCampaignFolder>;

    const ad_templates = extractAdTemplates(bundle);
    // RESPONSIVE_AD is filtered out
    expect(ad_templates).toHaveLength(0);
  });
});
