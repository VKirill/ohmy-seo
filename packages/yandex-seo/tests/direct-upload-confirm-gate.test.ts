/**
 * Tests for the confirm-gate invariant in runDirectUploadFromYaml:
 *   - When dry_run=true OR confirm is missing/false OR plan_hash is absent,
 *     NO dependency-creation API calls (sitelinks/promo/callouts/images) are made.
 *   - When confirm=true AND plan_hash is present, deps ARE created.
 *   - Dep creation failures are surfaced in the result, not swallowed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock all external modules BEFORE importing the module under test
// ---------------------------------------------------------------------------

// We'll replace these with controllable spies
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

vi.mock("../src/lib/account-resolver.js", () => ({}));
vi.mock("../src/lib/csv-parser.js", () => ({}));
vi.mock("../src/lib/bundle-ledger.js", () => ({}));

vi.mock("@ohmy-seo/mcp-core/errors", () => ({
  errorToMcpContent: (e: unknown) => ({
    content: [{ type: "text", text: String(e) }],
  }),
}));

// Import after mocks
import { runDirectUploadFromYaml } from "../src/tools/direct-upload-from-yaml.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Minimal valid bundle returned by loadCampaignFolder */
function makeBundle(opts: {
  hasSitelinks?: boolean;
  hasPromo?: boolean;
  hasCallouts?: boolean;
  hasImages?: boolean;
} = {}) {
  return {
    validation_errors: [],
    campaign: {
      campaign: {
        Name: "Test Campaign",
        Type: "TEXT_CAMPAIGN",
        StartDate: "2026-01-01",
        DailyBudget: { Amount: 300_000_000, Currency: "RUB" },
        TextCampaign: {
          BiddingStrategy: {
            Search: { BiddingStrategyType: "HIGHEST_POSITION" },
          },
        },
      },
      upload_strategy: "one-per-cluster",
      dedupe_by_name: false,
      sitelinks_set: opts.hasSitelinks ? { Sitelinks: [{ Title: "Link", Href: "https://example.com" }] } : undefined,
      promo_extension: opts.hasPromo
        ? { AdExtension: { Type: "PROMOTION", Promotion: {} } }
        : undefined,
      callouts: opts.hasCallouts ? ["Free shipping", "24/7 support"] : undefined,
      images: opts.hasImages
        ? { hero: { url: "https://example.com/img.jpg" } }
        : undefined,
    },
    groups: [
      {
        group: { Name: "cl01_test", Type: "TEXT_AD_GROUP", RegionIds: [213] },
        keywords: [{ Keyword: "test keyword" }],
        ads: [
          {
            Type: "TEXT_AD" as const,
            TextAd: {
              Title: "Test Title",
              Title2: "Subtitle",
              Text: "Ad text here",
              Href: "https://example.com",
            },
          },
        ],
        _meta: { cluster_id: "cl01", intent: "transactional" },
      },
    ],
  };
}

/** Successful sitelinks API response */
function sitelinksOkResponse(id: number) {
  return {
    ok: true,
    data: { result: { AddResults: [{ Id: id }] } },
  };
}

/** Failed sitelinks API response (HTTP error) */
const sitelinksHttpErrorResponse = { ok: false, body: "Internal Server Error" };

/** AddResults with item-level Errors */
function sitelinksItemErrorResponse() {
  return {
    ok: true,
    data: {
      result: {
        AddResults: [{ Errors: [{ Message: "Invalid sitelink" }] }],
      },
    },
  };
}

/** Minimal plan result returned by uploadCampaignBundle for dry_run=true */
const planResult = {
  dry_run: true,
  plan_hash: "abc123planHash",
  expected_ack_live: "I-UNDERSTAND-BUNDLE-LIVE:test:abc123plan",
  next_actions: ["Re-call with dry_run=false, confirm=true, ..."],
  total_clusters: 1,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runDirectUploadFromYaml — confirm gate invariant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCampaignFolder.mockReturnValue(makeBundle({ hasSitelinks: true, hasPromo: true, hasCallouts: true, hasImages: true }));
    mockResolveRefs.mockImplementation((bundle: unknown) => bundle);
    mockUploadCampaignBundle.mockResolvedValue(planResult);
    mockBuildSitelinksSetPayload.mockReturnValue({});
    mockBuildPromoExtensionPayload.mockReturnValue({});
    mockBuildCalloutPayload.mockReturnValue({});
  });

  it("dry_run=true: ZERO dependency API calls, returns plan stage", async () => {
    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: true,
    });

    expect(mockExecuteApiCall).not.toHaveBeenCalled();
    expect(mockRunDirectUploadImage).not.toHaveBeenCalled();

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("dry_run");
  });

  it("dry_run=false but confirm missing: ZERO dependency API calls, returns plan_needed", async () => {
    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      plan_hash: "abc123planHash",
      // confirm NOT provided
    });

    expect(mockExecuteApiCall).not.toHaveBeenCalled();
    expect(mockRunDirectUploadImage).not.toHaveBeenCalled();

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("plan_needed");
    expect(text.reason).toMatch(/confirm/i);
  });

  it("dry_run=false, confirm=false: ZERO dependency API calls, returns plan_needed", async () => {
    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      plan_hash: "abc123planHash",
      confirm: false,
    });

    expect(mockExecuteApiCall).not.toHaveBeenCalled();
    expect(mockRunDirectUploadImage).not.toHaveBeenCalled();

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("plan_needed");
  });

  it("dry_run=false, confirm=true but plan_hash missing: ZERO dependency API calls, returns plan_needed", async () => {
    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      // plan_hash NOT provided
    });

    expect(mockExecuteApiCall).not.toHaveBeenCalled();
    expect(mockRunDirectUploadImage).not.toHaveBeenCalled();

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("plan_needed");
    expect(text.reason).toMatch(/plan_hash/i);
  });

  it("confirm=true + plan_hash present: dependency API calls ARE made", async () => {
    // For live path, uploadCampaignBundle resolves to a live result
    const liveResult = {
      dry_run: false,
      plan_hash: "abc123planHash",
      campaigns_created: [12345],
      ad_groups_created: [],
      keywords_added: 5,
      ads_created: [],
      images_uploaded: [],
      metrika_linked: false,
      canary_passed: true,
      total_clusters: 1,
      clusters_processed: 1,
      ledger_path: "/data/ledger.jsonl",
      errors: [],
      recovery_command: "",
      next_actions: [],
    };
    mockUploadCampaignBundle.mockResolvedValue(liveResult);
    mockExecuteApiCall.mockResolvedValue(sitelinksOkResponse(101));
    mockRunDirectUploadImage.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ ad_image_hash: "hashXYZ" }) }],
    });

    await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: "abc123planHash",
      acknowledge_live: "I-UNDERSTAND-BUNDLE-LIVE:test:abc123plan",
    });

    // At least sitelinks + promo + callouts endpoints should have been called
    expect(mockExecuteApiCall).toHaveBeenCalled();
    expect(mockRunDirectUploadImage).toHaveBeenCalled();
  });
});

describe("runDirectUploadFromYaml — dep creation failure surfacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveRefs.mockImplementation((bundle: unknown) => bundle);
    mockBuildSitelinksSetPayload.mockReturnValue({});
    mockBuildPromoExtensionPayload.mockReturnValue({});
    mockBuildCalloutPayload.mockReturnValue({});
    // Default uploadCampaignBundle for live path
    mockUploadCampaignBundle.mockResolvedValue({
      dry_run: false,
      plan_hash: "abc123planHash",
      campaigns_created: [],
      ad_groups_created: [],
      keywords_added: 0,
      ads_created: [],
      images_uploaded: [],
      metrika_linked: false,
      canary_passed: false,
      total_clusters: 1,
      clusters_processed: 0,
      ledger_path: "",
      errors: [],
      recovery_command: "",
      next_actions: [],
    });
  });

  it("HTTP error on sitelinks: dep_errors appears in result, does not throw", async () => {
    mockLoadCampaignFolder.mockReturnValue(makeBundle({ hasSitelinks: true }));
    mockExecuteApiCall.mockResolvedValue(sitelinksHttpErrorResponse);

    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: "abc123planHash",
      acknowledge_live: "I-UNDERSTAND-BUNDLE-LIVE:test:abc123plan",
    });

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("live_orchestration");
    expect(text.dep_errors).toBeDefined();
    expect(text.dep_errors).toHaveLength(1);
    expect(text.dep_errors[0]).toMatch(/sitelinks.*failed/i);
  });

  it("item-level Errors in AddResults: dep_errors appears in result", async () => {
    mockLoadCampaignFolder.mockReturnValue(makeBundle({ hasSitelinks: true }));
    mockExecuteApiCall.mockResolvedValue(sitelinksItemErrorResponse());

    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: "abc123planHash",
      acknowledge_live: "I-UNDERSTAND-BUNDLE-LIVE:test:abc123plan",
    });

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("live_orchestration");
    expect(text.dep_errors).toBeDefined();
    expect(text.dep_errors[0]).toMatch(/Invalid sitelink/);
  });

  it("image upload failure: dep_errors captures the failed image name", async () => {
    mockLoadCampaignFolder.mockReturnValue(makeBundle({ hasImages: true }));
    mockRunDirectUploadImage.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ error: "upload failed" }) }],
    });

    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: "abc123planHash",
      acknowledge_live: "I-UNDERSTAND-BUNDLE-LIVE:test:abc123plan",
    });

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("live_orchestration");
    expect(text.dep_errors).toBeDefined();
    expect(text.dep_errors[0]).toMatch(/hero/);
  });

  it("successful deps: dep_errors is absent (not set in result)", async () => {
    mockLoadCampaignFolder.mockReturnValue(makeBundle({ hasSitelinks: true }));
    mockExecuteApiCall.mockResolvedValue(sitelinksOkResponse(42));

    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: "abc123planHash",
      acknowledge_live: "I-UNDERSTAND-BUNDLE-LIVE:test:abc123plan",
    });

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("live_orchestration");
    expect(text.dep_errors).toBeUndefined();
    expect(text.context_created.sitelinks_set_id).toBe(42);
  });
});
