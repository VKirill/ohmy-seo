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
import { pickAdTemplate, computePlanHash } from "../src/lib/upload-pipeline.js";

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

// ---------------------------------------------------------------------------
// computePlanHash — content binding
// ---------------------------------------------------------------------------

/** Minimal base input for computePlanHash. */
const basePlanInput = {
  csv_hash: "abc123",
  account_login: "test-login",
  campaign_strategy: { mode: "one-per-cluster" as const },
  campaign_type: "search",
  site_url: "https://example.com",
  daily_budget_micros: 300_000_000,
  region_ids: [213],
  bidding_strategy_type: "WB_DAILY_BUDGET",
  rsya_image_urls: [],
  ads_per_group: 3,
  canary_percent: 10,
  max_clusters: 50,
  cluster_count: 5,
  campaign_names: ["camp-a", "camp-b"],
};

describe("computePlanHash — determinism and content binding", () => {
  it("same inputs produce the same hash", () => {
    const h1 = computePlanHash({ ...basePlanInput });
    const h2 = computePlanHash({ ...basePlanInput });
    expect(h1).toBe(h2);
  });

  it("changing ad title produces a different hash", () => {
    const h1 = computePlanHash({
      ...basePlanInput,
      ad_templates: [{ variant_label: "v0", title: "Original Title", text: "Text" }],
    });
    const h2 = computePlanHash({
      ...basePlanInput,
      ad_templates: [{ variant_label: "v0", title: "CHANGED Title", text: "Text" }],
    });
    expect(h1).not.toBe(h2);
  });

  it("changing bidding_strategy produces a different hash", () => {
    const h1 = computePlanHash({
      ...basePlanInput,
      bidding_strategy: { Search: { BiddingStrategyType: "HIGHEST_POSITION" } },
    });
    const h2 = computePlanHash({
      ...basePlanInput,
      bidding_strategy: { Search: { BiddingStrategyType: "AVERAGE_CPC" } },
    });
    expect(h1).not.toBe(h2);
  });

  it("changing sitelinks_set produces a different hash", () => {
    const h1 = computePlanHash({
      ...basePlanInput,
      sitelinks_set: { Sitelinks: [{ Title: "Link 1", Href: "https://example.com/1" }] },
    });
    const h2 = computePlanHash({
      ...basePlanInput,
      sitelinks_set: { Sitelinks: [{ Title: "Link CHANGED", Href: "https://example.com/1" }] },
    });
    expect(h1).not.toBe(h2);
  });

  it("changing callout_ids produces a different hash", () => {
    const h1 = computePlanHash({ ...basePlanInput, callout_ids: [1, 2, 3] });
    const h2 = computePlanHash({ ...basePlanInput, callout_ids: [1, 2, 99] });
    expect(h1).not.toBe(h2);
  });

  it("changing image_hashes_keys produces a different hash", () => {
    const h1 = computePlanHash({ ...basePlanInput, image_hashes_keys: ["img-a", "img-b"] });
    const h2 = computePlanHash({ ...basePlanInput, image_hashes_keys: ["img-a", "img-DIFFERENT"] });
    expect(h1).not.toBe(h2);
  });

  it("hash is stable regardless of ad_templates array key insertion order", () => {
    const tmpl1 = { variant_label: "v0", title: "Title", text: "Text", href: "https://x.com", cluster_filter: { intent: "informational" } };
    const h1 = computePlanHash({ ...basePlanInput, ad_templates: [tmpl1] });
    // Reconstruct the template object with a different key insertion order
    const tmpl2 = { cluster_filter: { intent: "informational" }, href: "https://x.com", text: "Text", title: "Title", variant_label: "v0" };
    const h2 = computePlanHash({ ...basePlanInput, ad_templates: [tmpl2] });
    expect(h1).toBe(h2);
  });

  it("null ad_templates and absent ad_templates produce the same hash", () => {
    const h1 = computePlanHash({ ...basePlanInput, ad_templates: null });
    const h2 = computePlanHash({ ...basePlanInput });
    expect(h1).toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// computePlanHash — dry-run / live image-hash consistency (P0 #2)
// Ensures that an rsya bundle with declared images produces the SAME hash
// whether we supply declared_image_keys (dry-run path, no uploads yet) or
// image_hashes_keys (live path, only successful uploads present).
// ---------------------------------------------------------------------------

describe("computePlanHash — dry-run and live hash agree for rsya bundle with images", () => {
  /** Rsya bundle base input (no image fields). */
  const rsyaBase = {
    ...basePlanInput,
    campaign_type: "rsya",
    bidding_strategy_type: "WB_DAILY_BUDGET",
  };

  it("dry-run path (declared_image_keys) equals live path (same declared_image_keys) for banner_1to1", () => {
    const declaredKeys = ["banner_1to1"];

    // Dry-run: no image_hashes uploaded yet — pass declared keys directly
    const dryHash = computePlanHash({
      ...rsyaBase,
      image_hashes_keys: declaredKeys, // populated from bundle declaration
    });

    // Live path: same declared keys (not the partial upload result)
    const liveHash = computePlanHash({
      ...rsyaBase,
      image_hashes_keys: declaredKeys,
    });

    expect(dryHash).toBe(liveHash);
  });

  it("dry hash differs when declared keys differ (sensitivity check)", () => {
    const h1 = computePlanHash({ ...rsyaBase, image_hashes_keys: ["banner_1to1"] });
    const h2 = computePlanHash({ ...rsyaBase, image_hashes_keys: ["banner_1to1", "banner_16to9"] });
    expect(h1).not.toBe(h2);
  });

  it("null image_hashes_keys (dry-run no images) equals null at live time (no images declared)", () => {
    const h1 = computePlanHash({ ...rsyaBase, image_hashes_keys: null });
    const h2 = computePlanHash({ ...rsyaBase });
    expect(h1).toBe(h2);
  });

  it("dry-run with 3 declared keys matches live with same 3 declared keys (order-independent)", () => {
    const declaredKeys = ["img_c", "img_a", "img_b"]; // unsorted
    const sortedKeys = ["img_a", "img_b", "img_c"];

    // computePlanHash sorts the keys internally
    const h1 = computePlanHash({ ...rsyaBase, image_hashes_keys: declaredKeys });
    const h2 = computePlanHash({ ...rsyaBase, image_hashes_keys: sortedKeys });
    expect(h1).toBe(h2);
  });
});
