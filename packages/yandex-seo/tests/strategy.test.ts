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

// payload-builder is NOT mocked — we test its real buildUnifiedCampaignPayload
import { buildUnifiedCampaignPayload } from "../src/lib/payload-builder.js";
import {
  resolveCampaignStrategy,
  resolveCampaignType,
  isMultiCampaignBundle,
  resolveDailyBudgetByCampaign,
} from "../src/tools/direct-upload-from-yaml.js";
import { pickAdTemplate, computePlanHash } from "../src/lib/upload-pipeline.js";
import { computeCampaignName } from "../src/lib/pipeline/plan-hash.js";

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
// Multi-campaign bundles — cluster-map strategy + per-campaign budget
// ---------------------------------------------------------------------------

/** Multi-campaign bundle: two groups, distinct `campaign`, campaigns budget map. */
function makeMultiBundle() {
  return {
    campaign: {
      campaign: {
        Name: "base-camp",
        Type: "UNIFIED_PERFORMANCE_CAMPAIGN",
        StartDate: "2026-01-01",
        DailyBudget: { Amount: 10_000_000, Currency: "USD" },
      },
      campaigns: {
        "Целевые запросы": { DailyBudget: { Amount: 20_000_000 } },
        "Брендовые запросы": { DailyBudget: { Amount: 5_000_000 } },
      },
    },
    groups: [
      { campaign: "Целевые запросы", _meta: { cluster_id: "ag01" }, group: { Name: "G1", Type: "UNIFIED_AD_GROUP", RegionIds: [1] }, keywords: [{ Keyword: "k1" }], ads: [] },
      { campaign: "Брендовые запросы", _meta: { cluster_id: "ag37" }, group: { Name: "G37", Type: "UNIFIED_AD_GROUP", RegionIds: [1] }, keywords: [{ Keyword: "k2" }], ads: [] },
    ],
    validation_errors: [],
  } as unknown as Parameters<typeof resolveCampaignStrategy>[0];
}

describe("computeCampaignName — cluster-map mode", () => {
  const strategy = {
    mode: "cluster-map" as const,
    cluster_to_campaign: { ag01: "Целевые запросы", ag37: "Брендовые запросы" },
    default_campaign: "base-camp",
  };
  it("maps a known cluster to its campaign", () => {
    expect(computeCampaignName("ag01", "transactional", strategy)).toBe("Целевые запросы");
    expect(computeCampaignName("ag37", "branded", strategy)).toBe("Брендовые запросы");
  });
  it("falls back to default_campaign for an unmapped cluster", () => {
    expect(computeCampaignName("ag99", "transactional", strategy)).toBe("base-camp");
  });
});

describe("multi-campaign bundle detection + strategy", () => {
  it("isMultiCampaignBundle is true when a campaigns map or group.campaign is present", () => {
    expect(isMultiCampaignBundle(makeMultiBundle())).toBe(true);
    expect(isMultiCampaignBundle(makeBundle({}))).toBe(false);
  });

  it("resolveCampaignStrategy returns cluster-map with per-group assignment", () => {
    expect(resolveCampaignStrategy(makeMultiBundle())).toEqual({
      mode: "cluster-map",
      cluster_to_campaign: { ag01: "Целевые запросы", ag37: "Брендовые запросы" },
      default_campaign: "base-camp",
    });
  });

  it("resolveDailyBudgetByCampaign extracts per-campaign micros from the campaigns map", () => {
    expect(resolveDailyBudgetByCampaign(makeMultiBundle())).toEqual({
      "Целевые запросы": 20_000_000,
      "Брендовые запросы": 5_000_000,
    });
  });

  it("resolveDailyBudgetByCampaign is undefined for a single-campaign bundle", () => {
    expect(resolveDailyBudgetByCampaign(makeBundle({}))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildUnifiedCampaignPayload — ЕПК (UNIFIED_CAMPAIGN) shape
// ---------------------------------------------------------------------------

function extractCampaign(payload: ReturnType<typeof buildUnifiedCampaignPayload>) {
  return payload.params.Campaigns[0] as Record<string, unknown>;
}

function extractUnified(payload: ReturnType<typeof buildUnifiedCampaignPayload>) {
  return extractCampaign(payload)["UnifiedCampaign"] as Record<string, unknown>;
}

describe("buildUnifiedCampaignPayload — envelope + DailyBudget", () => {
  it("method is 'add' and Campaign carries Name + StartDate", () => {
    const payload = buildUnifiedCampaignPayload({
      name: "test-unified-campaign",
      daily_budget_micros: 300_000_000,
      start_date: "2026-01-01",
    });
    expect(payload.method).toBe("add");
    const campaign = extractCampaign(payload);
    expect(campaign["Name"]).toBe("test-unified-campaign");
    expect(campaign["StartDate"]).toBe("2026-01-01");
  });

  it("DailyBudget sits at the Campaign level (not inside UnifiedCampaign)", () => {
    const payload = buildUnifiedCampaignPayload({
      name: "test-daily-budget-level",
      daily_budget_micros: 300_000_000,
    });
    const campaign = extractCampaign(payload);
    const unified = extractUnified(payload);
    expect(campaign["DailyBudget"]).toEqual({ Amount: 300_000_000, Mode: "STANDARD" });
    expect(unified["DailyBudget"]).toBeUndefined();
  });

  it("DailyBudget carries NO Currency sub-field (currency follows the account)", () => {
    const payload = buildUnifiedCampaignPayload({
      name: "test-no-currency",
      daily_budget_micros: 8_500_000,
    });
    const daily = extractCampaign(payload)["DailyBudget"] as Record<string, unknown>;
    expect(daily["Currency"]).toBeUndefined();
    expect(daily["Mode"]).toBe("STANDARD");
  });

  it("passes daily_budget_micros through as-is (no ×1e6 conversion)", () => {
    const payload = buildUnifiedCampaignPayload({
      name: "test-passthrough",
      daily_budget_micros: 42_000_000,
    });
    const daily = extractCampaign(payload)["DailyBudget"] as Record<string, unknown>;
    expect(daily["Amount"]).toBe(42_000_000);
  });
});

describe("buildUnifiedCampaignPayload — verbatim bidding_strategy, weekly budget, TimeTargeting", () => {
  it("uses a verbatim bidding_strategy as-is (weekly WB + BidCeiling)", () => {
    const bs = {
      Search: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: 10_000_000, BidCeiling: 5_000_000 } },
      Network: { BiddingStrategyType: "SERVING_OFF" },
    };
    const payload = buildUnifiedCampaignPayload({ name: "wb", bidding_strategy: bs });
    expect(extractUnified(payload)["BiddingStrategy"]).toEqual(bs);
  });

  it("OMITS DailyBudget for an auto (non-manual) search strategy", () => {
    const payload = buildUnifiedCampaignPayload({
      name: "auto-no-daily",
      daily_budget_micros: 10_000_000, // must be ignored for auto strategies
      bidding_strategy: {
        Search: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: 10_000_000 } },
        Network: { BiddingStrategyType: "SERVING_OFF" },
      },
    });
    expect(extractCampaign(payload)["DailyBudget"]).toBeUndefined();
  });

  it("keeps DailyBudget for a manual (HIGHEST_POSITION) verbatim strategy", () => {
    const payload = buildUnifiedCampaignPayload({
      name: "manual-keeps-daily",
      daily_budget_micros: 10_000_000,
      bidding_strategy: { Search: { BiddingStrategyType: "HIGHEST_POSITION" }, Network: { BiddingStrategyType: "SERVING_OFF" } },
    });
    expect(extractCampaign(payload)["DailyBudget"]).toEqual({ Amount: 10_000_000, Mode: "STANDARD" });
  });

  it("puts TimeTargeting at the Campaign level (sibling of UnifiedCampaign)", () => {
    const tt = { Schedule: { Items: ["1,100,100"] }, ConsiderWorkingWeekends: "YES" };
    const payload = buildUnifiedCampaignPayload({ name: "tt", daily_budget_micros: 10_000_000, time_targeting: tt });
    expect(extractCampaign(payload)["TimeTargeting"]).toEqual(tt);
    expect(extractUnified(payload)["TimeTargeting"]).toBeUndefined();
  });
});

describe("buildUnifiedCampaignPayload — BiddingStrategy + Settings", () => {
  it("defaults search_strategy_type to HIGHEST_POSITION and Network to SERVING_OFF", () => {
    const payload = buildUnifiedCampaignPayload({
      name: "test-default-strategy",
      daily_budget_micros: 300_000_000,
    });
    const bs = extractUnified(payload)["BiddingStrategy"] as Record<string, Record<string, unknown>>;
    expect(bs["Search"]["BiddingStrategyType"]).toBe("HIGHEST_POSITION");
    expect(bs["Network"]["BiddingStrategyType"]).toBe("SERVING_OFF");
  });

  it("passes an explicit search_strategy_type through to the Search strategy", () => {
    const payload = buildUnifiedCampaignPayload({
      name: "test-explicit-strategy",
      daily_budget_micros: 300_000_000,
      search_strategy_type: "AVERAGE_CPC",
    });
    const bs = extractUnified(payload)["BiddingStrategy"] as Record<string, Record<string, unknown>>;
    expect(bs["Search"]["BiddingStrategyType"]).toBe("AVERAGE_CPC");
    expect(bs["Network"]["BiddingStrategyType"]).toBe("SERVING_OFF");
  });

  it("always emits the ADD_METRICA_TAG setting", () => {
    const payload = buildUnifiedCampaignPayload({
      name: "test-metrica-setting",
      daily_budget_micros: 300_000_000,
    });
    const unified = extractUnified(payload);
    expect(unified["Settings"]).toEqual([{ Option: "ADD_METRICA_TAG", Value: "YES" }]);
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

  it("changing campaign callout CONTENT produces a different hash (fail-closed)", () => {
    const h1 = computePlanHash({ ...basePlanInput, callouts: ["Гарантия 2 года", "Доставка"] });
    const h2 = computePlanHash({ ...basePlanInput, callouts: ["Гарантия 2 года", "Монтаж"] });
    expect(h1).not.toBe(h2);
  });

  it("live-created callout_ids do NOT affect the hash (dry-run/live must agree)", () => {
    // callout_ids are created between dry-run and live by direct-upload-from-yaml;
    // binding them would make EVERY live run with callouts fail stage-1 hash validation.
    const dryInput = { ...basePlanInput, callouts: ["Гарантия 2 года", "Доставка"] };
    const liveInput = { ...dryInput, callout_ids: [201, 202] };
    expect(computePlanHash(liveInput)).toBe(computePlanHash(dryInput));
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

  it("per-campaign budget map changes the hash; empty/absent map leaves it byte-identical", () => {
    const h0 = computePlanHash({ ...basePlanInput });
    const hEmpty = computePlanHash({ ...basePlanInput, daily_budget_micros_by_campaign: {} });
    const hNull = computePlanHash({ ...basePlanInput, daily_budget_micros_by_campaign: null });
    const hMap = computePlanHash({ ...basePlanInput, daily_budget_micros_by_campaign: { "Целевые запросы": 5 } });
    expect(hEmpty).toBe(h0); // empty map omitted from planInput → unchanged (old bundles safe)
    expect(hNull).toBe(h0);
    expect(hMap).not.toBe(h0);
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
