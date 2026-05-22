import { describe, it, expect, vi } from "vitest";

// Mock transitive dependencies that import @ohmy-seo/mcp-core subpaths
vi.mock("../src/lib/api-gateway.js", () => ({}));
vi.mock("../src/lib/account-resolver.js", () => ({}));
vi.mock("../src/lib/csv-parser.js", () => ({}));
vi.mock("../src/lib/bundle-ledger.js", () => ({}));
vi.mock("../src/lib/yaml-loader.js", () => ({}));
vi.mock("../src/lib/scopes.js", () => ({ SCOPES: {} }));
vi.mock("../src/lib/api/confirm-gate.js", () => ({ requireConfirmGate: () => {} }));
vi.mock("../src/tools/direct-upload-image.js", () => ({}));
vi.mock("@ohmy-seo/mcp-core/errors", () => ({
  errorToMcpContent: (e: unknown) => ({ content: [{ type: "text", text: String(e) }] }),
}));

// payload-builder is NOT mocked — we test its real buildCampaignPayload
import { buildCampaignPayload } from "../src/lib/payload-builder.js";
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

// ---------------------------------------------------------------------------
// buildCampaignPayload — bidding_strategy passthrough
// ---------------------------------------------------------------------------

/** The rsya bundle's BiddingStrategy as it appears in _campaign.yaml after YAML parse. */
const rsyaBiddingStrategy = {
  Search: { BiddingStrategyType: "SERVING_OFF" },
  Network: {
    BiddingStrategyType: "WB_MAXIMUM_CLICKS",
    WbMaximumClicks: { WeeklySpendLimit: 59500000 },
  },
};

const searchBiddingStrategy = {
  Search: { BiddingStrategyType: "HIGHEST_POSITION" },
  Network: { BiddingStrategyType: "SERVING_OFF" },
};

function extractTextCampaign(payload: ReturnType<typeof buildCampaignPayload>) {
  const campaign = payload.params.Campaigns[0] as Record<string, unknown>;
  return campaign["TextCampaign"] as Record<string, unknown>;
}

describe("buildCampaignPayload — bidding_strategy passthrough", () => {
  it("rsya bundle: passes WB_MAXIMUM_CLICKS and WeeklySpendLimit=59500000 verbatim", () => {
    const payload = buildCampaignPayload({
      type: "rsya",
      name: "test-rsya-campaign",
      daily_budget_rub: 300,
      bidding_strategy_type: "WB_DAILY_BUDGET",
      bidding_strategy: rsyaBiddingStrategy,
    });

    const tc = extractTextCampaign(payload);
    const bs = tc["BiddingStrategy"] as typeof rsyaBiddingStrategy;

    // Network must use WB_MAXIMUM_CLICKS — not WB_DAILY_BUDGET
    expect(bs.Network.BiddingStrategyType).toBe("WB_MAXIMUM_CLICKS");
    // WeeklySpendLimit (not WeeklySpendingLimit)
    expect(bs.Network.WbMaximumClicks.WeeklySpendLimit).toBe(59500000);
    // Search must be SERVING_OFF
    expect(bs.Search.BiddingStrategyType).toBe("SERVING_OFF");
  });

  it("search bundle: passes Search.HIGHEST_POSITION and Network.SERVING_OFF verbatim", () => {
    const payload = buildCampaignPayload({
      type: "search",
      name: "test-search-campaign",
      daily_budget_rub: 300,
      bidding_strategy_type: "HIGHEST_POSITION",
      bidding_strategy: searchBiddingStrategy,
    });

    const tc = extractTextCampaign(payload);
    const bs = tc["BiddingStrategy"] as typeof searchBiddingStrategy;

    expect(bs.Search.BiddingStrategyType).toBe("HIGHEST_POSITION");
    expect(bs.Network.BiddingStrategyType).toBe("SERVING_OFF");
  });

  it("bidding_strategy omitted → rsya reconstruction produces WB_DAILY_BUDGET (fallback preserved)", () => {
    const payload = buildCampaignPayload({
      type: "rsya",
      name: "test-rsya-fallback",
      daily_budget_rub: 300,
      bidding_strategy_type: "WB_DAILY_BUDGET",
      // bidding_strategy intentionally omitted
    });

    const tc = extractTextCampaign(payload);
    const bs = tc["BiddingStrategy"] as Record<string, Record<string, unknown>>;

    // Old reconstruction path: WB_DAILY_BUDGET on Network
    expect(bs["Network"]["BiddingStrategyType"]).toBe("WB_DAILY_BUDGET");
    expect(bs["Search"]["BiddingStrategyType"]).toBe("SERVING_OFF");
  });

  it("bidding_strategy omitted → search reconstruction produces HIGHEST_POSITION (fallback preserved)", () => {
    const payload = buildCampaignPayload({
      type: "search",
      name: "test-search-fallback",
      daily_budget_rub: 300,
      bidding_strategy_type: "HIGHEST_POSITION",
      // bidding_strategy intentionally omitted
    });

    const tc = extractTextCampaign(payload);
    const bs = tc["BiddingStrategy"] as Record<string, Record<string, unknown>>;

    expect(bs["Search"]["BiddingStrategyType"]).toBe("HIGHEST_POSITION");
    expect(bs["Network"]["BiddingStrategyType"]).toBe("SERVING_OFF");
  });
});
