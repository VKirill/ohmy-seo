/**
 * per-group-dedup-from-yaml.test.ts — per-group sitelinks/callouts orchestration
 * in runDirectUploadFromYaml.
 *
 * Covers:
 *   - Live mode creates each UNIQUE sitelinks/callouts content exactly once
 *     (dedupe by JSON content), incl. reuse of the campaign-level set when a
 *     group's override content is identical to it.
 *   - Per-group id maps are passed to uploadCampaignBundle; groups without an
 *     override are absent from the maps (fall back to campaign-level ids).
 *   - Dry-run bundle_summary reports has_sitelinks (incl. group-only case),
 *     groups_with_*_override and unique set counts.
 *   - Dry-run passes per-group CONTENT maps to the pipeline (plan_hash input).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock all external modules BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockExecuteApiCall = vi.fn();
const mockUploadCampaignBundle = vi.fn();
const mockRunDirectUploadImage = vi.fn();
const mockLoadCampaignFolder = vi.fn();
const mockResolveRefs = vi.fn();
const mockBuildSitelinksSetPayload = vi.fn();
const mockBuildPromoExtensionPayload = vi.fn();
const mockBuildCalloutPayload = vi.fn();

vi.mock("../src/lib/api-gateway.js", () => ({
  executeApiCall: (...args: unknown[]) => mockExecuteApiCall(...args),
}));
vi.mock("../src/lib/upload-pipeline.js", () => ({
  uploadCampaignBundle: (...args: unknown[]) => mockUploadCampaignBundle(...args),
}));
vi.mock("../src/tools/direct-upload-image.js", () => ({
  runDirectUploadImage: (...args: unknown[]) => mockRunDirectUploadImage(...args),
}));
vi.mock("../src/lib/yaml-loader.js", () => ({
  loadCampaignFolder: (...args: unknown[]) => mockLoadCampaignFolder(...args),
  resolveRefs: (...args: unknown[]) => mockResolveRefs(...args),
}));
vi.mock("../src/lib/payload-builder.js", () => ({
  buildSitelinksSetPayload: (...args: unknown[]) => mockBuildSitelinksSetPayload(...args),
  buildPromoExtensionPayload: (...args: unknown[]) => mockBuildPromoExtensionPayload(...args),
  buildCalloutPayload: (...args: unknown[]) => mockBuildCalloutPayload(...args),
}));
vi.mock("../src/lib/account-resolver.js", () => ({
  resolveAccount: () => ({ yandex_login: "testlogin", label: "testlogin" }),
}));
vi.mock("../src/lib/scopes.js", () => ({ SCOPES: { DIRECT_API: "direct:api" } }));
vi.mock("@ohmy-seo/mcp-core/errors", () => ({
  errorToMcpContent: (e: unknown) => ({
    content: [{ type: "text", text: String(e) }],
  }),
}));

// Import after mocks
import { runDirectUploadFromYaml } from "../src/tools/direct-upload-from-yaml.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// plan_hash is 14 chars; .slice(0,12) = "abc123planHa"
const TEST_PLAN_HASH = "abc123planHash";
const TEST_ACK_VALID = "I-UNDERSTAND-BUNDLE-LIVE:testlogin:abc123planHa";

const CAMPAIGN_SITELINKS = {
  Sitelinks: [
    { Title: "О компании", Description: "Кто мы", Href: "https://example.com/about" },
    { Title: "Контакты", Description: "Свяжитесь с нами", Href: "https://example.com/contacts" },
  ],
};
const CAMPAIGN_CALLOUTS = ["Гарантия 2 года", "Доставка по РФ"];

const GROUP_SITELINKS_S1 = {
  Sitelinks: [
    { Title: "Каталог", Description: "Весь ассортимент", Href: "https://example.com/catalog" },
    { Title: "Цены", Description: "Актуальный прайс", Href: "https://example.com/prices" },
  ],
};
const GROUP_CALLOUTS_K1 = ["Скидка 20%", "Монтаж включён"];

function makeGroup(
  clusterId: string,
  name: string,
  extra: Record<string, unknown> = {}
) {
  return {
    group: { Name: name, Type: "TEXT_AD_GROUP", RegionIds: [213] },
    keywords: [{ Keyword: `ключ ${clusterId}` }],
    ads: [
      {
        Type: "TEXT_AD" as const,
        TextAd: {
          Title: "Заголовок",
          Title2: "Второй",
          Text: "Текст объявления",
          Href: "https://example.com",
        },
      },
    ],
    _meta: { cluster_id: clusterId, intent: "transactional" },
    ...extra,
  };
}

/**
 * 4 groups:
 *   cl01 — override S1/K1 (unique content)
 *   cl02 — override with content IDENTICAL to cl01 (must reuse, not re-create)
 *   cl03 — override with content IDENTICAL to campaign-level (must reuse campaign ids)
 *   cl04 — no overrides (falls back to campaign-level, absent from per-group maps)
 */
function makeBundle(opts: { campaignLevel?: boolean } = { campaignLevel: true }) {
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return {
    validation_errors: [],
    campaign: {
      campaign: {
        Name: "Test Campaign",
        Type: "TEXT_CAMPAIGN",
        StartDate: "2026-08-01",
        DailyBudget: { Amount: 300_000_000, Currency: "RUB" },
        TextCampaign: {
          BiddingStrategy: {
            Search: { BiddingStrategyType: "HIGHEST_POSITION" },
          },
        },
      },
      upload_strategy: "one-per-cluster",
      dedupe_by_name: false,
      sitelinks_set: opts.campaignLevel ? clone(CAMPAIGN_SITELINKS) : undefined,
      callouts: opts.campaignLevel ? clone(CAMPAIGN_CALLOUTS) : undefined,
      images: undefined,
    },
    groups: [
      makeGroup("cl01", "cl01_unique", {
        sitelinks_set: clone(GROUP_SITELINKS_S1),
        callouts: clone(GROUP_CALLOUTS_K1),
      }),
      makeGroup("cl02", "cl02_same_as_cl01", {
        sitelinks_set: clone(GROUP_SITELINKS_S1),
        callouts: clone(GROUP_CALLOUTS_K1),
      }),
      makeGroup("cl03", "cl03_same_as_campaign", {
        sitelinks_set: clone(CAMPAIGN_SITELINKS),
        callouts: clone(CAMPAIGN_CALLOUTS),
      }),
      makeGroup("cl04", "cl04_no_override"),
    ],
  };
}

/** Minimal plan result returned by uploadCampaignBundle for dry_run=true */
const planResult = {
  dry_run: true,
  plan_hash: TEST_PLAN_HASH,
  expected_ack_live: TEST_ACK_VALID,
  next_actions: [],
  total_clusters: 4,
  clusters_processed: 0,
  campaigns_created: [],
  ad_groups_created: [],
  keywords_added: 0,
  ads_created: [],
  images_uploaded: [],
  metrika_linked: false,
  canary_passed: false,
  ledger_path: "",
  errors: [],
  recovery_command: "",
};

describe("runDirectUploadFromYaml — per-group sitelinks/callouts dedup (live)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCampaignFolder.mockReturnValue(makeBundle());
    mockResolveRefs.mockImplementation((bundle: unknown) => bundle);
    mockUploadCampaignBundle.mockResolvedValue(planResult);
    mockBuildSitelinksSetPayload.mockReturnValue({});
    mockBuildCalloutPayload.mockReturnValue({});

    // Sitelinks.add → ids 101, 102, ...; AdExtensions.add (callouts) → id pairs 201/202, 203/204, ...
    let sitelinksId = 100;
    let calloutId = 200;
    mockExecuteApiCall.mockImplementation(async (opts: { endpoint: string }) => {
      if (opts.endpoint === "/json/v5/sitelinks") {
        return { ok: true, data: { result: { AddResults: [{ Id: ++sitelinksId }] } } };
      }
      if (opts.endpoint === "/json/v5/adextensions") {
        return {
          ok: true,
          data: { result: { AddResults: [{ Id: ++calloutId }, { Id: ++calloutId }] } },
        };
      }
      return { ok: false, body: "unexpected endpoint" };
    });
  });

  it("creates each unique sitelinks/callouts content ONCE and maps groups to shared ids", async () => {
    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: TEST_PLAN_HASH,
      acknowledge_live: TEST_ACK_VALID,
    });

    // Unique contents: campaign set + S1 → exactly 2 Sitelinks.add calls
    const sitelinksCalls = mockExecuteApiCall.mock.calls.filter(
      (args) => (args[0] as { endpoint: string }).endpoint === "/json/v5/sitelinks"
    );
    expect(sitelinksCalls).toHaveLength(2);

    // Unique callout sets: campaign CC + K1 → exactly 2 AdExtensions.add calls (no promo in bundle)
    const calloutCalls = mockExecuteApiCall.mock.calls.filter(
      (args) => (args[0] as { endpoint: string }).endpoint === "/json/v5/adextensions"
    );
    expect(calloutCalls).toHaveLength(2);

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("live_orchestration");

    // Campaign set = 101 (created first), unique group set S1 = 102
    expect(text.context_created.sitelinks_set_id).toBe(101);
    expect(text.context_created.sitelinks_set_id_per_group).toEqual({
      cl01: 102,
      cl02: 102, // identical content — reuses cl01's set
      cl03: 101, // identical to campaign — reuses the campaign set
      // cl04 absent — falls back to campaign-level id inside the pipeline
    });
    expect(text.context_created.callout_ids).toEqual([201, 202]);
    expect(text.context_created.callout_ids_per_group).toEqual({
      cl01: [203, 204],
      cl02: [203, 204],
      cl03: [201, 202],
    });

    // The live pipeline call receives the per-group id maps + campaign-level fallbacks
    const liveCall = mockUploadCampaignBundle.mock.calls
      .map((args) => args[0] as Record<string, unknown>)
      .find((input) => input["dry_run"] === false);
    expect(liveCall).toBeDefined();
    expect(liveCall!["sitelinks_set_id"]).toBe(101);
    expect(liveCall!["callout_ids"]).toEqual([201, 202]);
    expect(liveCall!["sitelinks_set_id_per_group"]).toEqual({ cl01: 102, cl02: 102, cl03: 101 });
    expect(liveCall!["callout_ids_per_group"]).toEqual({ cl01: [203, 204], cl02: [203, 204], cl03: [201, 202] });
    // Content maps (plan_hash inputs) are also present on the live call
    expect(liveCall!["sitelinks_set_per_group"]).toEqual({
      cl01: GROUP_SITELINKS_S1,
      cl02: GROUP_SITELINKS_S1,
      cl03: CAMPAIGN_SITELINKS,
    });
    // Campaign-level callout CONTENT is passed at live too — it is the plan_hash
    // input (live-created callout_ids are NOT hashed), so it must match dry-run.
    expect(liveCall!["callouts"]).toEqual(CAMPAIGN_CALLOUTS);
    const dryCalls = mockUploadCampaignBundle.mock.calls
      .map((args) => args[0] as Record<string, unknown>)
      .filter((input) => input["dry_run"] === true);
    for (const dryCall of dryCalls) {
      expect(dryCall["callouts"]).toEqual(CAMPAIGN_CALLOUTS);
    }
  });
});

describe("runDirectUploadFromYaml — dry-run plan reflects per-group overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCampaignFolder.mockReturnValue(makeBundle());
    mockResolveRefs.mockImplementation((bundle: unknown) => bundle);
    mockUploadCampaignBundle.mockResolvedValue(planResult);
  });

  it("bundle_summary lists override groups and unique set counts; nothing is created", async () => {
    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: true,
    });

    expect(mockExecuteApiCall).not.toHaveBeenCalled();

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("dry_run");
    expect(text.bundle_summary.has_sitelinks).toBe(true);
    expect(text.bundle_summary.groups_with_sitelinks_override).toEqual([
      "cl01_unique",
      "cl02_same_as_cl01",
      "cl03_same_as_campaign",
    ]);
    expect(text.bundle_summary.groups_with_callouts_override).toEqual([
      "cl01_unique",
      "cl02_same_as_cl01",
      "cl03_same_as_campaign",
    ]);
    // campaign set + S1 (cl01/cl02 shared, cl03 == campaign) = 2 unique
    expect(text.bundle_summary.unique_sitelinks_sets_to_create).toBe(2);
    expect(text.bundle_summary.unique_callout_sets_to_create).toBe(2);
  });

  it("passes per-group CONTENT maps to the pipeline so they are bound into plan_hash", async () => {
    await runDirectUploadFromYaml({ folder: "/fake/folder", dry_run: true });

    const dryCall = mockUploadCampaignBundle.mock.calls[0][0] as Record<string, unknown>;
    expect(dryCall["dry_run"]).toBe(true);
    expect(dryCall["sitelinks_set_per_group"]).toEqual({
      cl01: GROUP_SITELINKS_S1,
      cl02: GROUP_SITELINKS_S1,
      cl03: CAMPAIGN_SITELINKS,
    });
    expect(dryCall["callouts_per_group"]).toEqual({
      cl01: GROUP_CALLOUTS_K1,
      cl02: GROUP_CALLOUTS_K1,
      cl03: CAMPAIGN_CALLOUTS,
    });
  });

  it("has_sitelinks=true when ONLY groups have sitelinks (no campaign-level set)", async () => {
    const bundle = makeBundle({ campaignLevel: false });
    mockLoadCampaignFolder.mockReturnValue(bundle);

    const result = await runDirectUploadFromYaml({ folder: "/fake/folder", dry_run: true });
    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.bundle_summary.has_sitelinks).toBe(true);
    // No campaign-level set: unique sets = S1 (cl01/cl02) + CAMPAIGN_SITELINKS content on cl03 = 2
    expect(text.bundle_summary.unique_sitelinks_sets_to_create).toBe(2);
  });
});
