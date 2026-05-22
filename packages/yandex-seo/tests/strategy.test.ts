import { describe, it, expect, vi } from "vitest";

// Mock transitive dependencies that import @ohmy-seo/mcp-core subpaths
vi.mock("../src/lib/api-gateway.js", () => ({}));
vi.mock("../src/lib/account-resolver.js", () => ({}));
vi.mock("../src/lib/csv-parser.js", () => ({}));
vi.mock("../src/lib/bundle-ledger.js", () => ({}));
vi.mock("../src/lib/payload-builder.js", () => ({}));
vi.mock("../src/lib/yaml-loader.js", () => ({}));
vi.mock("../src/lib/scopes.js", () => ({ SCOPES: {} }));
vi.mock("../src/lib/api/confirm-gate.js", () => ({ requireConfirmGate: () => {} }));
vi.mock("../src/tools/direct-upload-image.js", () => ({}));
vi.mock("@ohmy-seo/mcp-core/errors", () => ({
  errorToMcpContent: (e: unknown) => ({ content: [{ type: "text", text: String(e) }] }),
}));

import { resolveCampaignStrategy, resolveCampaignType } from "../src/tools/direct-upload-from-yaml.js";
import { pickAdTemplate } from "../src/lib/upload-pipeline.js";

/** Minimal bundle fixture factory. */
function makeBundle(overrides: { upload_strategy?: string; campaignName?: string }) {
  return {
    campaign: {
      upload_strategy: overrides.upload_strategy as "one-per-cluster" | "single-campaign" | undefined,
      campaign: {
        Name: overrides.campaignName ?? "Default-Campaign",
        Type: "TEXT_CAMPAIGN",
        StartDate: "2026-01-01",
        DailyBudget: { Amount: 300_000_000, Currency: "RUB" },
      },
      sitelinks_set: undefined,
      promo_extension: undefined,
      images: undefined,
    },
    groups: [],
    validation_errors: [],
  } as unknown as Parameters<typeof resolveCampaignStrategy>[0];
}

/** Minimal bundle fixture for resolveCampaignType tests. */
function makeBundleWithBidding(
  searchType: string,
  networkType: string
) {
  return {
    campaign: {
      upload_strategy: "one-per-cluster" as const,
      campaign: {
        Name: "Test-Campaign",
        Type: "TEXT_CAMPAIGN",
        StartDate: "2026-01-01",
        DailyBudget: { Amount: 300_000_000, Currency: "RUB" },
        TextCampaign: {
          BiddingStrategy: {
            Search: { BiddingStrategyType: searchType },
            Network: { BiddingStrategyType: networkType },
          },
        },
      },
      sitelinks_set: undefined,
      promo_extension: undefined,
      images: undefined,
    },
    groups: [],
    validation_errors: [],
  } as unknown as Parameters<typeof resolveCampaignType>[0];
}

describe("resolveCampaignType", () => {
  it("returns 'rsya' when Network is active and Search is SERVING_OFF", () => {
    const bundle = makeBundleWithBidding("SERVING_OFF", "WB_MAXIMUM_CLICKS");
    expect(resolveCampaignType(bundle)).toBe("rsya");
  });

  it("returns 'rsya' for WB_DAILY_BUDGET network with SERVING_OFF search", () => {
    const bundle = makeBundleWithBidding("SERVING_OFF", "WB_DAILY_BUDGET");
    expect(resolveCampaignType(bundle)).toBe("rsya");
  });

  it("returns 'search' when Search is HIGHEST_POSITION and Network is SERVING_OFF", () => {
    const bundle = makeBundleWithBidding("HIGHEST_POSITION", "SERVING_OFF");
    expect(resolveCampaignType(bundle)).toBe("search");
  });

  it("returns 'search' when Search is AVERAGE_CPC and Network is SERVING_OFF", () => {
    const bundle = makeBundleWithBidding("AVERAGE_CPC", "SERVING_OFF");
    expect(resolveCampaignType(bundle)).toBe("search");
  });

  it("returns 'search' when TextCampaign is absent", () => {
    const bundle = makeBundle({});
    expect(resolveCampaignType(bundle)).toBe("search");
  });
});

describe("pickAdTemplate — href passthrough", () => {
  const templates = [
    {
      variant_label: "v0",
      title: "Title 1",
      text: "Text 1",
      href: "https://landing.example.com/page",
      cluster_filter: { cluster_id_pattern: "^42$" },
    },
    {
      variant_label: "v1",
      title: "Title 2",
      text: "Text 2",
      // no href
      cluster_filter: { cluster_id_pattern: "^99$" },
    },
  ];

  it("returns href from matched template when present", () => {
    const result = pickAdTemplate("42", "informational", templates, "agent-provided", "https://site.example.com");
    expect(result.href).toBe("https://landing.example.com/page");
  });

  it("returns undefined href when template has no href (fallback to site_url is caller's responsibility)", () => {
    const result = pickAdTemplate("99", "informational", templates, "agent-provided", "https://site.example.com");
    expect(result.href).toBeUndefined();
  });

  it("returns undefined href for fallback-template strategy", () => {
    const result = pickAdTemplate("55", "informational", undefined, "fallback-template", "https://site.example.com");
    expect(result.href).toBeUndefined();
  });
});

describe("resolveCampaignStrategy", () => {
  it("single-campaign mode pulls campaign_name from bundle.campaign.campaign.Name", () => {
    const bundle = makeBundle({ upload_strategy: "single-campaign", campaignName: "Test-Campaign-X" });
    const strategy = resolveCampaignStrategy(bundle);
    expect(strategy).toEqual({ mode: "single-campaign", campaign_name: "Test-Campaign-X" });
  });

  it("default one-per-cluster when upload_strategy is absent", () => {
    const bundle = makeBundle({});
    const strategy = resolveCampaignStrategy(bundle);
    expect(strategy).toEqual({ mode: "one-per-cluster" });
  });

  it("explicit one-per-cluster returns one-per-cluster strategy", () => {
    const bundle = makeBundle({ upload_strategy: "one-per-cluster" });
    const strategy = resolveCampaignStrategy(bundle);
    expect(strategy).toEqual({ mode: "one-per-cluster" });
  });
});
