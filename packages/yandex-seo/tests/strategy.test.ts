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

import { resolveCampaignStrategy } from "../src/tools/direct-upload-from-yaml.js";

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
